import { ipcMain, dialog, BrowserWindow } from 'electron';
import { readFileSync, writeFileSync } from 'node:fs';
import { IPC_CHANNELS } from '../../shared/ipcChannels';
import { secureClear } from '../../shared/secureMemory';
import {
  EXPORT_FORMAT_VERSION,
  EXPORT_MAGIC,
  EXPORT_FILE_EXTENSION,
  type ExportPayload,
  type ExportMetadata,
  type ExportFolder,
  type ExportItem,
  type ExportTag,
  type ExportAttachment,
  type EncryptedExportFile,
  type PlainTextExportItemRich,
} from '../../shared/types';
import { APP_NAME, APP_VERSION } from '../../shared/constants';
import { isDatabaseOpen, getDatabase, getActiveVaultId } from '../database/connection';
import { getVaultById } from '../file-system/vaultRegistry';
import { FolderRepository } from '../database/repositories/FolderRepository';
import { ItemRepository } from '../database/repositories/ItemRepository';
import { TagRepository } from '../database/repositories/TagRepository';
import { getMasterKey } from './authHandlers';
import { encryptAES256GCM, decryptString, encryptString } from '../crypto/encryption';
import { itemsToCsv, itemsToJsonPlain } from '../import-export/plainTextFormats';

interface ActiveVaultContext {
  vaultId: string;
  vaultName: string;
}

function getActiveVaultContext(): ActiveVaultContext | null {
  if (!isDatabaseOpen()) return null;
  const vaultId = getActiveVaultId();
  if (!vaultId) return null;
  const vault = getVaultById(vaultId);
  return { vaultId, vaultName: vault?.name ?? vaultId };
}

const folderRepo = new FolderRepository();
const itemRepo = new ItemRepository();
const tagRepo = new TagRepository();

type ExportFormat = 'encrypted-json' | 'json-plain' | 'csv';

function getExportFileFilter(format: ExportFormat): Electron.FileFilter {
  switch (format) {
    case 'encrypted-json':
      return { name: 'SecurePass Backup', extensions: ['spm'] };
    case 'json-plain':
      return { name: 'JSON File', extensions: ['json'] };
    case 'csv':
      return { name: 'CSV File', extensions: ['csv'] };
    default:
      return { name: 'All Files', extensions: ['*'] };
  }
}

function getExportExtension(format: ExportFormat): string {
  switch (format) {
    case 'encrypted-json':
      return EXPORT_FILE_EXTENSION;
    case 'json-plain':
      return '.json';
    case 'csv':
      return '.csv';
    default:
      return '';
  }
}

export function buildExportMetadata(
  itemCount: number,
  folderCount: number,
  tagCount: number,
  attachmentCount: number,
  vaultContext?: ActiveVaultContext | null,
): ExportMetadata {
  return {
    appName: APP_NAME,
    appVersion: APP_VERSION,
    exportedAt: Date.now(),
    formatVersion: EXPORT_FORMAT_VERSION,
    schemaVersion: 1,
    itemCount,
    folderCount,
    tagCount,
    attachmentCount,
    sourceVaultId: vaultContext?.vaultId,
    sourceVaultName: vaultContext?.vaultName,
  };
}

export function arrayBufferToBase64(buffer: ArrayBuffer | Uint8Array | null): string | null {
  if (!buffer) return null;
  return Buffer.from(buffer).toString('base64');
}

function readAllAttachments(): ExportAttachment[] {
  const db = getDatabase();
  if (!db) return [];

  const stmt = db.prepare('SELECT * FROM attachments ORDER BY created_at ASC');
  const attachments: ExportAttachment[] = [];

  while (stmt.step()) {
    const row = stmt.getAsObject() as Record<string, unknown>;
    const storagePath = row.storage_path as string;
    let dataEncrypted: string | null = null;

    try {
      const fileBuffer = readFileSync(storagePath);
      const key = getMasterKey();
      if (key) {
        const encrypted = encryptString(fileBuffer.toString('base64'), key);
        dataEncrypted = encrypted.toString('base64');
        // SECURITY: Wipe encrypted buffer after converting to base64
        secureClear(encrypted);
      }
      // SECURITY: Wipe plaintext file data after encryption
      secureClear(fileBuffer);
    } catch {
      // Skip attachments that cannot be read
    }

    if (dataEncrypted) {
      attachments.push({
        id: row.id as string,
        itemId: (row.item_id as string) ?? null,
        folderId: (row.folder_id as string) ?? null,
        fileName: row.file_name as string,
        mimeType: (row.mime_type as string) ?? 'application/octet-stream',
        fileSize: (row.file_size as number) ?? 0,
        dataEncrypted,
        createdAt: row.created_at as number,
      });
    }
  }

  stmt.free();
  return attachments;
}

export function buildEncryptedPayload(vaultContext?: ActiveVaultContext | null): ExportPayload {
  const folders = folderRepo.getFlatList().map(
    (f): ExportFolder => ({
      id: f.id,
      parentId: f.parentId,
      name: f.name,
      emoji: f.emoji,
      coverImage: f.coverImage,
      createdAt: f.createdAt,
      updatedAt: f.updatedAt,
      sortOrder: f.sortOrder,
    }),
  );

  const items = itemRepo.getAll().map((item): ExportItem => {
    const tagIds = tagRepo.getByItem(item.id).map((t) => t.id);
    return {
      id: item.id,
      folderId: item.folderId,
      title: item.title,
      username: item.username,
      passwordEncrypted: arrayBufferToBase64(item.passwordEncrypted),
      url: item.url,
      notesEncrypted: arrayBufferToBase64(item.notesEncrypted),
      emoji: item.emoji,
      coverImage: item.coverImage,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      isFavorite: item.isFavorite,
      sortOrder: item.sortOrder,
      tagIds,
    };
  });

  const tags = tagRepo.getAll().map(
    (t): ExportTag => ({
      id: t.id,
      name: t.name,
      color: t.color,
    }),
  );

  const attachments = readAllAttachments();

  const metadata = buildExportMetadata(
    items.length,
    folders.length,
    tags.length,
    attachments.length,
    vaultContext,
  );

  return {
    formatVersion: EXPORT_FORMAT_VERSION,
    metadata,
    folders,
    items,
    tags,
    attachments,
  };
}

function buildPlainTextItems(): PlainTextExportItemRich[] {
  const key = getMasterKey();
  if (!key) return [];

  const allItems = itemRepo.getAll();
  const folders = folderRepo.getFlatList();
  const folderMap = new Map(folders.map((f) => [f.id, f.name]));

  return allItems.map((item): PlainTextExportItemRich => {
    let passwordBuf: Buffer | null = null;
    let password = '';
    if (item.passwordEncrypted) {
      passwordBuf = Buffer.from(item.passwordEncrypted);
      password = decryptString(passwordBuf, key);
    }

    let notesBuf: Buffer | null = null;
    let notes: string | null = null;
    if (item.notesEncrypted) {
      notesBuf = Buffer.from(item.notesEncrypted);
      notes = decryptString(notesBuf, key);
    }

    // SECURITY: Wipe temporary buffers containing encrypted data
    secureClear(passwordBuf);
    secureClear(notesBuf);

    const tags = tagRepo.getByItem(item.id).map((t) => t.name);

    return {
      title: item.title,
      username: item.username,
      password,
      url: item.url,
      notes: notes ? { html: notes, text: notes } : null,
      tags,
      folder: folderMap.get(item.folderId) ?? undefined,
      isFavorite: item.isFavorite,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    };
  });
}

function buildPlainTextItemsForCsv(): Array<{ title: string; username: string; password: string; url: string; notes: string; tags: string[] }> {
  const key = getMasterKey();
  if (!key) return [];

  const allItems = itemRepo.getAll();

  return allItems.map((item) => {
    let passwordBuf: Buffer | null = null;
    let password = '';
    if (item.passwordEncrypted) {
      passwordBuf = Buffer.from(item.passwordEncrypted);
      password = decryptString(passwordBuf, key);
    }

    let notesBuf: Buffer | null = null;
    let notes = '';
    if (item.notesEncrypted) {
      notesBuf = Buffer.from(item.notesEncrypted);
      notes = decryptString(notesBuf, key);
    }

    // SECURITY: Wipe temporary buffers containing encrypted data
    secureClear(passwordBuf);
    secureClear(notesBuf);

    const tags = tagRepo.getByItem(item.id).map((t) => t.name);

    return {
      title: item.title,
      username: item.username,
      password,
      url: item.url,
      notes,
      tags,
    };
  });
}

export function serializeEncryptedExport(payload: ExportPayload, key: Buffer): EncryptedExportFile {
  const jsonString = JSON.stringify(payload);
  const plaintextBuf = Buffer.from(jsonString, 'utf-8');
  let encrypted;
  try {
    encrypted = encryptAES256GCM(plaintextBuf, key);
  } finally {
    // SECURITY: Wipe plaintext buffer after encryption
    secureClear(plaintextBuf);
  }

  const result: EncryptedExportFile = {
    magic: EXPORT_MAGIC,
    formatVersion: EXPORT_FORMAT_VERSION,
    encryptionAlgorithm: 'aes-256-gcm',
    iv: encrypted.iv.toString('base64'),
    authTag: encrypted.tag.toString('base64'),
    ciphertext: encrypted.ciphertext.toString('base64'),
  };

  // SECURITY: Wipe encrypted buffers after serialization
  secureClear(encrypted.iv);
  secureClear(encrypted.tag);
  secureClear(encrypted.ciphertext);

  return result;
}

export function registerExportHandlers(): void {
  ipcMain.handle(
    IPC_CHANNELS.EXPORT_DATA,
    async (
      _event,
      { format }: { format: ExportFormat },
    ): Promise<{ success: boolean; filePath?: string; error?: string }> => {
      try {
        if (!isDatabaseOpen()) {
          return { success: false, error: 'Database is not open.' };
        }

        const key = getMasterKey();
        if (!key) {
          return { success: false, error: 'No master key available. Unlock first.' };
        }

        const vaultCtx = getActiveVaultContext();

        const win = BrowserWindow.getFocusedWindow();
        if (!win) {
          return { success: false, error: 'No active window.' };
        }

        const vaultSuffix = vaultCtx ? `-${vaultCtx.vaultName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}` : '';
        const defaultFileName = `securepass-export${vaultSuffix}-${new Date().toISOString().slice(0, 10)}${getExportExtension(format)}`;
        const result = await dialog.showSaveDialog(win, {
          defaultPath: defaultFileName,
          filters: [getExportFileFilter(format)],
          title: 'Export Data',
        });

        if (result.canceled || !result.filePath) {
          return { success: false, error: 'User cancelled export.' };
        }

        const filePath = result.filePath;
        const sendProgress = (percent: number, phase: string) => {
          win.webContents.send(IPC_CHANNELS.EXPORT_PROGRESS, { percent, phase });
        };

        sendProgress(0, 'preparing');

        switch (format) {
          case 'encrypted-json': {
            sendProgress(10, 'reading-data');
            const payload = buildEncryptedPayload(vaultCtx);
            sendProgress(40, 'serializing');
            const encryptedFile = serializeEncryptedExport(payload, key);
            sendProgress(70, 'writing');
            const fileContent = JSON.stringify(encryptedFile, null, 2);
            writeFileSync(filePath, fileContent, 'utf-8');
            sendProgress(100, 'done');
            break;
          }
          case 'json-plain': {
            sendProgress(10, 'reading-data');
            const items = buildPlainTextItems();
            sendProgress(50, 'serializing');
            const fileContent = itemsToJsonPlain(items);
            sendProgress(70, 'writing');
            writeFileSync(filePath, fileContent, 'utf-8');
            sendProgress(100, 'done');
            break;
          }
          case 'csv': {
            sendProgress(10, 'reading-data');
            const items = buildPlainTextItemsForCsv();
            sendProgress(50, 'serializing');
            const fileContent = itemsToCsv(items);
            sendProgress(70, 'writing');
            writeFileSync(filePath, fileContent, 'utf-8');
            sendProgress(100, 'done');
            break;
          }
          default:
            return { success: false, error: `Unsupported export format: ${format}` };
        }

        return { success: true, filePath };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error during export.',
        };
      }
    },
  );
}
