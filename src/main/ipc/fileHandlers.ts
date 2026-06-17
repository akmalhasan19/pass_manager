import { ipcMain } from 'electron';
import { readFileSync, writeFileSync, existsSync, unlinkSync, mkdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { app } from 'electron';
import { IPC_CHANNELS } from '../../shared/ipcChannels';
import { FileAttachmentRepository } from '../database/repositories/FileAttachmentRepository';
import { isDatabaseOpen, getActiveVaultId } from '../database/connection';
import { getMasterKey } from './authHandlers';
import { encryptAES256GCM, decryptAES256GCM } from '../crypto/encryption';
import {
  containsPathTraversal,
  sanitizeFileName,
  validateFileUpload,
  FILE_SIZE_LIMITS,
} from '../../shared/fileSecurity';
import { secureClear } from '../../shared/secureMemory';

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

function getAttachmentsDir(vaultId: string): string {
  const userDataPath = app?.getPath?.('userData') ?? join(process.cwd(), 'data');
  const dir = join(userDataPath, 'attachments', vaultId);
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

  return decryptAES256GCM({ ciphertext, iv, tag }, key);
}

export function registerFileHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.FILE_GET_BY_ITEM, async (_event, { itemId }: { itemId: string }) => {
    try {
      if (!isDatabaseOpen()) {
        return { success: false, error: 'Database is not open.' };
      }
      const attachments = fileRepo.getByItem(itemId);
      return { success: true, data: attachments };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  });

  ipcMain.handle(
    IPC_CHANNELS.FILE_ATTACH,
    async (_event, { itemId, filePath }: { itemId: string; filePath: string }) => {
      try {
        if (!isDatabaseOpen()) {
          return { success: false, error: 'Database is not open.' };
        }

        const vaultId = getActiveVaultId();
        if (!vaultId) {
          return { success: false, error: 'No active vault.' };
        }

        const key = getMasterKey();
        if (!key) {
          return { success: false, error: 'No master key available. Unlock first.' };
        }

        // Validate file path for security
        if (!filePath || containsPathTraversal(filePath)) {
          return { success: false, error: 'Invalid file path.' };
        }

        if (!existsSync(filePath)) {
          return { success: false, error: 'Source file not found.' };
        }

        // Get file stats for size validation
        const stats = statSync(filePath);

        // Validate file (extension + size)
        const validation = validateFileUpload(filePath, stats.size, {
          maxSize: FILE_SIZE_LIMITS.ATTACHMENT,
        });
        if (!validation.valid) {
          return { success: false, error: validation.error };
        }

        const rawFileName = filePath.split(/[/\\]/).pop() ?? 'unnamed';
        const fileName = sanitizeFileName(rawFileName);
        const fileBuffer = readFileSync(filePath);
        const encrypted = encryptFileData(fileBuffer, key);

        // SECURITY: Wipe plaintext file data after encryption
        secureClear(fileBuffer);

        const attachmentsDir = getAttachmentsDir(vaultId);
        const storageName = `${Date.now()}-${fileName.replace(/[^a-zA-Z0-9._-]/g, '_')}.enc`;
        const storagePath = join(attachmentsDir, storageName);

        writeFileSync(storagePath, encrypted);

        // SECURITY: Wipe encrypted buffer after writing to disk
        secureClear(encrypted);

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

        const vaultId = getActiveVaultId();
        if (!vaultId) {
          return { success: false, error: 'No active vault.' };
        }

        const key = getMasterKey();
        if (!key) {
          return { success: false, error: 'No master key available. Unlock first.' };
        }

        const attachment = fileRepo.getById(attachmentId);
        if (!attachment) {
          return { success: false, error: 'Attachment not found.' };
        }

        // Validate storage path is within vault-scoped attachments directory
        if (containsPathTraversal(attachment.storagePath)) {
          return { success: false, error: 'Invalid attachment storage path.' };
        }

        const attachmentsDir = getAttachmentsDir(vaultId);
        if (!attachment.storagePath.startsWith(attachmentsDir)) {
          return { success: false, error: 'Attachment storage path is outside the allowed directory.' };
        }

        if (!existsSync(attachment.storagePath)) {
          return { success: false, error: 'Encrypted file not found on disk.' };
        }

        const encryptedBlob = readFileSync(attachment.storagePath);
        const decrypted = decryptFileData(encryptedBlob, key);

        // SECURITY: Wipe encrypted data after decryption
        secureClear(encryptedBlob);

        const tempDir = getTempDir();
        const safeFileName = sanitizeFileName(attachment.fileName);
        const tempPath = join(tempDir, safeFileName);

        writeFileSync(tempPath, decrypted);

        // SECURITY: Wipe decrypted data after writing to temp file
        secureClear(decrypted);

        return {
          success: true,
          data: {
            filePath: tempPath,
            fileName: safeFileName,
            mimeType: attachment.mimeType,
          },
        };
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

        const vaultId = getActiveVaultId();
        if (!vaultId) {
          return { success: false, error: 'No active vault.' };
        }

        const attachment = fileRepo.getById(attachmentId);
        if (!attachment) {
          return { success: false, error: 'Attachment not found.' };
        }

        // Validate storage path is within vault-scoped attachments directory
        if (containsPathTraversal(attachment.storagePath)) {
          return { success: false, error: 'Invalid attachment storage path.' };
        }

        const attachmentsDir = getAttachmentsDir(vaultId);
        if (!attachment.storagePath.startsWith(attachmentsDir)) {
          return { success: false, error: 'Attachment storage path is outside the allowed directory.' };
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
