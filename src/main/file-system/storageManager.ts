import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import {
  createReadStream,
  createWriteStream,
  openSync,
  readSync,
  writeSync,
  closeSync,
  unlinkSync,
  existsSync,
  mkdirSync,
  statSync,
} from 'node:fs';
import { join, basename } from 'node:path';
import { app } from 'electron';
import { containsPathTraversal, isPathWithinDirectory } from '../../shared/fileSecurity';
import { secureClear } from '../../shared/secureMemory';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;
const STREAM_CHUNK_SIZE = 65536;

export function getStoragePath(): string {
  const userDataPath = app?.getPath?.('userData') ?? join(process.cwd(), 'data');
  const dir = join(userDataPath, 'attachments');
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function getTempPath(): string {
  const userDataPath = app?.getPath?.('userData') ?? join(process.cwd(), 'data');
  const dir = join(userDataPath, 'temp');
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

export async function encryptAndStoreFile(sourcePath: string, key: Buffer): Promise<string> {
  if (key.length !== KEY_BYTES) {
    throw new Error(`Key must be ${KEY_BYTES} bytes (got ${key.length})`);
  }

  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  const storageName = `${Date.now()}-${randomBytes(6).toString('hex')}.enc`;
  const storagePath = join(getStoragePath(), storageName);

  const readStream = createReadStream(sourcePath, { highWaterMark: STREAM_CHUNK_SIZE });
  const writeStream = createWriteStream(storagePath);

  writeStream.write(iv);

  return new Promise<string>((resolve, reject) => {
    readStream
      .pipe(cipher)
      .pipe(writeStream)
      .on('finish', () => {
        // SECURITY: Wipe IV after encryption stream completes
        secureClear(iv);
        resolve(storagePath);
      })
      .on('error', (err) => {
        // SECURITY: Wipe IV on error too
        secureClear(iv);
        reject(
          new Error(
            `Encryption stream failed: ${err instanceof Error ? err.message : String(err)}`,
          ),
        );
      });
  });
}

export async function decryptAndRetrieveFile(storagePath: string, key: Buffer): Promise<string> {
  if (key.length !== KEY_BYTES) {
    throw new Error(`Key must be ${KEY_BYTES} bytes (got ${key.length})`);
  }

  // Validate path for traversal attacks
  if (containsPathTraversal(storagePath)) {
    throw new Error('Invalid storage path: path traversal detected.');
  }

  // Validate path is within storage directory
  const storageDir = getStoragePath();
  if (!isPathWithinDirectory(storageDir, storagePath)) {
    throw new Error('Storage path is outside the allowed directory.');
  }

  if (!existsSync(storagePath)) {
    throw new Error(`Encrypted file not found: ${storagePath}`);
  }

  const stat = statSync(storagePath);
  const fileSize = stat.size;

  if (fileSize < IV_BYTES + TAG_BYTES) {
    throw new Error('Encrypted file is too small or corrupted');
  }

  const iv = Buffer.alloc(IV_BYTES);
  const fd = openSync(storagePath, 'r');
  try {
    readSync(fd, iv, 0, IV_BYTES, 0);
  } finally {
    closeSync(fd);
  }

  const tag = Buffer.alloc(TAG_BYTES);
  const tagFd = openSync(storagePath, 'r');
  try {
    readSync(tagFd, tag, 0, TAG_BYTES, fileSize - TAG_BYTES);
  } finally {
    closeSync(tagFd);
  }

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);

  const originalName = basename(storagePath).replace(/\.enc$/, '');
  const cleanName = originalName.replace(/^\d+-[a-f0-9]{12}-/, '') || 'decrypted-file';
  const tempFileName = `dec-${Date.now()}-${cleanName}`;
  const tempPath = join(getTempPath(), tempFileName);

  const readStream = createReadStream(storagePath, {
    start: IV_BYTES,
    end: fileSize - TAG_BYTES - 1,
    highWaterMark: STREAM_CHUNK_SIZE,
  });

  const writeStream = createWriteStream(tempPath);

  return new Promise<string>((resolve, reject) => {
    readStream
      .pipe(decipher)
      .pipe(writeStream)
      .on('finish', () => {
        // SECURITY: Wipe iv and tag after decryption is complete
        secureClear(iv);
        secureClear(tag);
        resolve(tempPath);
      })
      .on('error', (err) => {
        // SECURITY: Wipe iv and tag on error too
        secureClear(iv);
        secureClear(tag);
        reject(
          new Error(
            `Decryption stream failed: ${err instanceof Error ? err.message : String(err)}`,
          ),
        );
      });
  });
}

export function deleteStoredFile(storagePath: string): void {
  // Validate path for traversal attacks
  if (containsPathTraversal(storagePath)) {
    throw new Error('Invalid storage path: path traversal detected.');
  }

  // Validate path is within storage directory
  const storageDir = getStoragePath();
  if (!isPathWithinDirectory(storageDir, storagePath)) {
    throw new Error('Storage path is outside the allowed directory.');
  }

  if (!existsSync(storagePath)) {
    return;
  }

  try {
    const stat = statSync(storagePath);
    const fileSize = stat.size;

    if (fileSize > 0) {
      const blockSize = Math.min(STREAM_CHUNK_SIZE, fileSize);
      const overwriteBuffer = randomBytes(blockSize);
      const fd = openSync(storagePath, 'w');

      try {
        let bytesRemaining = fileSize;
        while (bytesRemaining > 0) {
          const toWrite = Math.min(bytesRemaining, overwriteBuffer.length);
          writeSync(fd, overwriteBuffer.subarray(0, toWrite), 0, toWrite);
          bytesRemaining -= toWrite;
        }
      } finally {
        closeSync(fd);
      }
    }

    unlinkSync(storagePath);
  } catch (cause) {
    throw new Error(
      `Failed to securely delete file: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }
}
