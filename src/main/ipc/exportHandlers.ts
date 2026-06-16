import { ipcMain, dialog, BrowserWindow } from 'electron';
import { readFileSync, writeFileSync } from 'node:fs';
import { IPC_CHANNELS } from '../../shared/ipcChannels';
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
import { isDatabaseOpen, getDatabase } from '../database/connection';
import { FolderRepository } from '../database/repositories/FolderRepository';
import { ItemRepository } from '../database/repositories/ItemRepository';
import { TagRepository } from '../database/repositories/TagRepository';
import { getMasterKey } from './authHandlers';
import { encryptAES256GCM, decryptString, encryptString } from '../crypto/encryption';
import { itemsToCsv, itemsToJsonPlain } from '../import-export/plainTextFormats';

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
      }
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

export function buildEncryptedPayload(): ExportPayload {
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
    const password = item.passwordEncrypted
      ? decryptString(Buffer.from(item.passwordEncrypted), key)
      : '';
    const notes = item.notesEncrypted
      ? decryptString(Buffer.from(item.notesEncrypted), key)
      : null;
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
    const password = item.passwordEncrypted
      ? decryptString(Buffer.from(item.passwordEncrypted), key)
      : '';
    const notes = item.notesEncrypted
      ? decryptString(Buffer.from(item.notesEncrypted), key)
      : '';
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
  const encrypted = encryptAES256GCM(Buffer.from(jsonString, 'utf-8'), key);

  return {
    magic: EXPORT_MAGIC,
    formatVersion: EXPORT_FORMAT_VERSION,
    encryptionAlgorithm: 'aes-256-gcm',
    iv: encrypted.iv.toString('base64'),
    authTag: encrypted.tag.toString('base64'),
    ciphertext: encrypted.ciphertext.toString('base64'),
  };
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

        const win = BrowserWindow.getFocusedWindow();
        if (!win) {
          return { success: false, error: 'No active window.' };
        }

        const defaultFileName = `securepass-export-${new Date().toISOString().slice(0, 10)}${getExportExtension(format)}`;
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
            const payload = buildEncryptedPayload();
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
