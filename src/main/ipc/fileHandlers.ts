import { ipcMain } from 'electron';
import {
  readFileSync,
  writeFileSync,
  existsSync,
  unlinkSync,
  mkdirSync,
} from 'node:fs';
import { join } from 'node:path';
import { app } from 'electron';
import { IPC_CHANNELS } from '../../shared/ipcChannels';
import { FileAttachmentRepository } from '../database/repositories/FileAttachmentRepository';
import { isDatabaseOpen } from '../database/connection';
import { getMasterKey } from './authHandlers';
import { encryptAES256GCM, decryptAES256GCM } from '../crypto/encryption';

const fileRepo = new FileAttachmentRepository();

const MIME_TYPES: Record<string, string> = {
  '.txt': 'text/plain',
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.xml': 'application/xml',
  '.csv': 'text/csv',
  '.md': 'text/markdown',
  '.pdf': 'application/pdf',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.mp4': 'video/mp4',
  '.mp3': 'audio/mpeg',
  '.zip': 'application/zip',
  '.gz': 'application/gzip',
  '.tar': 'application/x-tar',
  '.enc': 'application/octet-stream',
};

function getMimeType(fileName: string): string {
  const ext = fileName.toLowerCase().match(/\.[^.]+$/)?.[0] ?? '';
  return MIME_TYPES[ext] ?? 'application/octet-stream';
}

function getAttachmentsDir(): string {
  const userDataPath = app?.getPath?.('userData') ?? join(process.cwd(), 'data');
  const dir = join(userDataPath, 'attachments');
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function getTempDir(): string {
  const userDataPath = app?.getPath?.('userData') ?? join(process.cwd(), 'data');
  const dir = join(userDataPath, 'temp');
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function encryptFileData(plaintext: Buffer, key: Buffer): Buffer {
  const encrypted = encryptAES256GCM(plaintext, key);
  const ivLength = Buffer.alloc(1, encrypted.iv.length);
  const tagLength = Buffer.alloc(1, encrypted.tag.length);
  return Buffer.concat([ivLength, tagLength, encrypted.iv, encrypted.tag, encrypted.ciphertext]);
}

function decryptFileData(encryptedBlob: Buffer, key: Buffer): Buffer {
  let offset = 0;
  const ivLength = encryptedBlob.readUInt8(offset);
  offset += 1;
  const tagLength = encryptedBlob.readUInt8(offset);
  offset += 1;
  const iv = encryptedBlob.subarray(offset, offset + ivLength);
  offset += ivLength;
  const tag = encryptedBlob.subarray(offset, offset + tagLength);
  offset += tagLength;
  const ciphertext = encryptedBlob.subarray(offset);

  return decryptAES256GCM({ ciphertext: Buffer.from(ciphertext), iv, tag }, key);
}

export function registerFileHandlers(): void {
  ipcMain.handle(
    IPC_CHANNELS.FILE_ATTACH,
    async (_event, { itemId, filePath }: { itemId: string; filePath: string }) => {
      try {
        if (!isDatabaseOpen()) {
          return { success: false, error: 'Database is not open.' };
        }

        const key = getMasterKey();
        if (!key) {
          return { success: false, error: 'No master key available. Unlock first.' };
        }

        if (!existsSync(filePath)) {
          return { success: false, error: 'Source file not found.' };
        }

        const fileName = filePath.split(/[/\\]/).pop() ?? 'unnamed';
        const fileBuffer = readFileSync(filePath);
        const encrypted = encryptFileData(fileBuffer, key);

        const attachmentsDir = getAttachmentsDir();
        const storageName = `${Date.now()}-${fileName.replace(/[^a-zA-Z0-9._-]/g, '_')}.enc`;
        const storagePath = join(attachmentsDir, storageName);

        writeFileSync(storagePath, encrypted);

        const attachment = fileRepo.create(
          itemId,
          null,
          fileName,
          getMimeType(fileName),
          fileBuffer.length,
          storagePath,
        );

        return { success: true, data: attachment };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.FILE_DOWNLOAD,
    async (_event, { attachmentId }: { attachmentId: string }) => {
      try {
        if (!isDatabaseOpen()) {
          return { success: false, error: 'Database is not open.' };
        }

        const key = getMasterKey();
        if (!key) {
          return { success: false, error: 'No master key available. Unlock first.' };
        }

        const attachment = fileRepo.getById(attachmentId);
        if (!attachment) {
          return { success: false, error: 'Attachment not found.' };
        }

        if (!existsSync(attachment.storagePath)) {
          return { success: false, error: 'Encrypted file not found on disk.' };
        }

        const encryptedBlob = readFileSync(attachment.storagePath);
        const decrypted = decryptFileData(encryptedBlob, key);

        const tempDir = getTempDir();
        const tempPath = join(tempDir, attachment.fileName);

        writeFileSync(tempPath, decrypted);

        return { success: true, data: { filePath: tempPath, fileName: attachment.fileName, mimeType: attachment.mimeType } };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.FILE_DELETE,
    async (_event, { attachmentId }: { attachmentId: string }) => {
      try {
        if (!isDatabaseOpen()) {
          return { success: false, error: 'Database is not open.' };
        }

        const attachment = fileRepo.getById(attachmentId);
        if (!attachment) {
          return { success: false, error: 'Attachment not found.' };
        }

        if (existsSync(attachment.storagePath)) {
          try {
            unlinkSync(attachment.storagePath);
          } catch {
            // File may have already been deleted
          }
        }

        fileRepo.delete(attachmentId);

        return { success: true };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    },
  );
}
