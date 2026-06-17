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
import { join, basename, resolve, isAbsolute } from 'node:path';
import { app } from 'electron';
import { containsPathTraversal, isPathWithinDirectory } from '../../shared/fileSecurity';
import { secureClear } from '../../shared/secureMemory';
import type { VaultRegistryEntry } from '../../shared/types';
import { VaultRegistryError } from '../../shared/types';
import {
  createVault,
  deleteVault,
  getDefaultVault,
  getVaultById,
  listVaults,
  resolveVaultDatabasePath as resolveManagedVaultDatabasePath,
  updateVault,
} from './vaultRegistry';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;
const STREAM_CHUNK_SIZE = 65536;
const LEGACY_DATABASE_FILENAME = 'securepass.db';
const DEFAULT_MIGRATED_VAULT_NAME = 'Default Vault';

function getUserDataPath(): string {
  const userDataPath = app?.getPath?.('userData') ?? join(process.cwd(), 'data');
  if (!existsSync(userDataPath)) {
    mkdirSync(userDataPath, { recursive: true });
  }
  return userDataPath;
}

export function getVaultStoragePath(): string {
  const dir = join(getUserDataPath(), 'vaults');
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function getLegacyDatabasePath(): string {
  return join(getUserDataPath(), LEGACY_DATABASE_FILENAME);
}

function assertSafeAbsolutePath(pathToValidate: string, code: string): string {
  if (typeof pathToValidate !== 'string' || pathToValidate.trim().length === 0) {
    throw new VaultRegistryError('Vault database path must be a non-empty string', code);
  }

  const trimmed = pathToValidate.trim();
  if (containsPathTraversal(trimmed)) {
    throw new VaultRegistryError('Vault database path contains traversal sequences', code, {
      databasePath: trimmed,
    });
  }

  const absolutePath = resolve(trimmed);
  if (!isAbsolute(absolutePath)) {
    throw new VaultRegistryError('Vault database path must resolve to an absolute path', code, {
      databasePath: trimmed,
    });
  }

  return absolutePath;
}

export function validateVaultDatabasePath(entry: VaultRegistryEntry): void {
  const databasePath = assertSafeAbsolutePath(entry.databasePath, 'INVALID_VAULT_DATABASE_PATH');
  const managedVaultDir = getVaultStoragePath();

  if (entry.isCustomLocation) {
    return;
  }

  if (!isPathWithinDirectory(managedVaultDir, databasePath)) {
    throw new VaultRegistryError(
      'Vault database path is outside the managed vault directory',
      'VAULT_PATH_OUTSIDE_ALLOWED_DIRECTORY',
      { vaultId: entry.id, databasePath, managedVaultDir },
    );
  }
}

export function resolveVaultDatabasePath(vaultId: string): string {
  const entry = getVaultById(vaultId);
  if (!entry) {
    throw new VaultRegistryError('Vault not found: ' + vaultId, 'VAULT_NOT_FOUND', { vaultId });
  }

  validateVaultDatabasePath(entry);
  return entry.databasePath;
}

export function createVaultMetadata(input: Parameters<typeof createVault>[0]): VaultRegistryEntry {
  const entry = createVault(input);
  validateVaultDatabasePath(entry);
  return entry;
}

export function readVaultMetadata(vaultId: string): VaultRegistryEntry {
  const entry = getVaultById(vaultId);
  if (!entry) {
    throw new VaultRegistryError('Vault not found: ' + vaultId, 'VAULT_NOT_FOUND', { vaultId });
  }

  validateVaultDatabasePath(entry);
  return entry;
}

export function listVaultMetadata(): VaultRegistryEntry[] {
  const vaults = listVaults();
  for (const vault of vaults) {
    validateVaultDatabasePath(vault);
  }
  return vaults;
}

export function renameVaultMetadata(vaultId: string, name: string): VaultRegistryEntry {
  const entry = updateVault(vaultId, { name });
  validateVaultDatabasePath(entry);
  return entry;
}

export function updateVaultMetadata(
  vaultId: string,
  updates: Parameters<typeof updateVault>[1],
): VaultRegistryEntry {
  const entry = updateVault(vaultId, updates);
  validateVaultDatabasePath(entry);
  return entry;
}

export function deleteVaultMetadata(
  vaultId: string,
  options: { deleteDatabaseFile?: boolean } = {},
): VaultRegistryEntry {
  const entry = readVaultMetadata(vaultId);
  const removed = deleteVault(vaultId);

  if (options.deleteDatabaseFile && existsSync(entry.databasePath)) {
    unlinkSync(entry.databasePath);
  }

  return removed;
}

export function validateVault(vaultId: string): VaultRegistryEntry {
  return readVaultMetadata(vaultId);
}

export function ensureDefaultVaultRegistry(): VaultRegistryEntry | null {
  const existingVaults = listVaults();
  if (existingVaults.length > 0) {
    const defaultVault = getDefaultVault() ?? existingVaults[0];
    validateVaultDatabasePath(defaultVault);
    return defaultVault;
  }

  const legacyDatabasePath = getLegacyDatabasePath();
  if (!existsSync(legacyDatabasePath)) {
    return null;
  }

  const entry = createVault({
    name: DEFAULT_MIGRATED_VAULT_NAME,
    isDefault: true,
    customDatabasePath: legacyDatabasePath,
  });

  validateVaultDatabasePath(entry);
  return entry;
}

export function resolveNewVaultDatabasePath(vaultId: string, customPath?: string): string {
  const databasePath = resolveManagedVaultDatabasePath(vaultId, customPath);
  const isCustom = customPath !== undefined && customPath.trim().length > 0;

  if (!isCustom && !isPathWithinDirectory(getVaultStoragePath(), databasePath)) {
    throw new VaultRegistryError(
      'Resolved vault database path is outside the managed vault directory',
      'VAULT_PATH_OUTSIDE_ALLOWED_DIRECTORY',
      { vaultId, databasePath },
    );
  }

  return databasePath;
}

export function getStoragePath(): string {
  const dir = join(getUserDataPath(), 'attachments');
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function getTempPath(): string {
  const dir = join(getUserDataPath(), 'temp');
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
        // SECURITY: Wipe the random overwrite buffer after use
        secureClear(overwriteBuffer);
      }
    }

    unlinkSync(storagePath);
  } catch (cause) {
    throw new Error(
      `Failed to securely delete file: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }
}
