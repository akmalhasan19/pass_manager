import { ipcMain, dialog, BrowserWindow } from 'electron';
import { readFileSync, existsSync } from 'node:fs';
import { IPC_CHANNELS } from '../../shared/ipcChannels';
import {
  IMPORT_FORMAT_EXTENSIONS,
  IMPORT_FORMAT_MIME_TYPES,
  type ImportFormat,
  type ImportDialogResult,
  type ImportPayload,
  type CsvColumnMapping,
  type DuplicateReport,
  type ImportCommitRequest,
} from '../../shared/types';
import { createImporterFactoryWithAllDefaults, createGenericCsvImporterWithMapping } from '../import-export/registry';
import { parseCsvLine } from '../import-export/plainTextFormats';
import { detectDuplicates, buildExistingItemRefs, applyResolutionMap } from '../import-export/duplicateDetection';
import { ItemRepository } from '../database/repositories/ItemRepository';
import { isDatabaseOpen, getDatabase } from '../database/connection';
import { getMasterKey } from './authHandlers';
import { encryptString } from '../crypto/encryption';

const itemRepo = new ItemRepository();

const FORMAT_FILTERS: Record<ImportFormat, Electron.FileFilter> = {
  'keepass-xml': { name: 'KeePass XML', extensions: ['xml'] },
  'bitwarden-json': { name: 'Bitwarden JSON', extensions: ['json'] },
  '1password-csv': { name: '1Password CSV', extensions: ['csv'] },
  'generic-csv': { name: 'CSV Files', extensions: ['csv'] },
  'encrypted-json': { name: 'SecurePass Backup', extensions: ['spm', 'json.encr'] },
};

function getAllowedExtensions(format: ImportFormat): string[] {
  return IMPORT_FORMAT_EXTENSIONS[format];
}

function getFormatForExtension(fileName: string): ImportFormat | null {
  const lower = fileName.toLowerCase();
  for (const format of Object.keys(IMPORT_FORMAT_EXTENSIONS) as ImportFormat[]) {
    const exts = IMPORT_FORMAT_EXTENSIONS[format];
    if (exts.some((ext) => lower.endsWith(ext))) {
      return format;
    }
  }
  return null;
}

function validateFileExtension(filePath: string, format: ImportFormat): boolean {
  const lower = filePath.toLowerCase();
  const allowed = getAllowedExtensions(format);
  return allowed.some((ext) => lower.endsWith(ext));
}

function validateMimeType(_filePath: string, _format: ImportFormat): boolean {
  return true;
}

export function registerImportHandlers(): void {
  ipcMain.handle(
    IPC_CHANNELS.IMPORT_OPEN_FILE_DIALOG,
    async (_event, { format }: { format: ImportFormat }): Promise<{ success: boolean; data?: ImportDialogResult; error?: string }> => {
      try {
        const win = BrowserWindow.getFocusedWindow();
        if (!win) {
          return { success: false, error: 'No active window.' };
        }

        const filter = FORMAT_FILTERS[format];
        const result = await dialog.showOpenDialog(win, {
          properties: ['openFile'],
          filters: [filter],
          title: `Select ${filter.name} file`,
        });

        if (result.canceled || result.filePaths.length === 0) {
          return { success: false, error: 'User cancelled file selection.' };
        }

        const filePath = result.filePaths[0];

        if (!existsSync(filePath)) {
          return { success: false, error: 'Selected file does not exist.' };
        }

        if (!validateFileExtension(filePath, format)) {
          const allowed = getAllowedExtensions(format).join(', ');
          return {
            success: false,
            error: `Invalid file extension. Expected ${allowed} for ${filter.name} format.`,
          };
        }

        if (!validateMimeType(filePath, format)) {
          return {
            success: false,
            error: 'File MIME type does not match the selected format.',
          };
        }

        const fileName = filePath.split(/[/\\]/).pop() ?? 'unknown';
        const content = readFileSync(filePath, 'utf-8');

        const detectedFormat = getFormatForExtension(fileName);

        return {
          success: true,
          data: {
            format,
            filePath,
            content,
          },
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error opening file.',
        };
      }
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.IMPORT_PARSE_FILE,
    async (_event, { format, filePath, content }: ImportDialogResult): Promise<{ success: boolean; data?: ImportPayload; error?: string }> => {
      try {
        if (!content) {
          return { success: false, error: 'No file content provided.' };
        }

        if (content.length === 0) {
          return { success: false, error: 'File is empty.' };
        }

        const factory = createImporterFactoryWithAllDefaults();

        if (!factory.has(format)) {
          return { success: false, error: `Unsupported import format: ${format}.` };
        }

        const importer = factory.get(format);
        const payload = importer.parse(content);

        return { success: true, data: payload };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error parsing file.',
        };
      }
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.IMPORT_GET_CSV_HEADERS,
    async (_event, { content }: { content: string }): Promise<{ success: boolean; data?: { headers: string[]; sampleRow: string[] }; error?: string }> => {
      try {
        if (!content || content.trim().length === 0) {
          return { success: false, error: 'No file content provided.' };
        }

        const lines = content.split(/\r?\n/).filter((line) => line.trim().length > 0);

        if (lines.length < 1) {
          return { success: false, error: 'CSV file is empty.' };
        }

        const headers = parseCsvLine(lines[0]);
        const sampleRow = lines.length > 1 ? parseCsvLine(lines[1]) : [];

        return { success: true, data: { headers, sampleRow } };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error reading CSV headers.',
        };
      }
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.IMPORT_PARSE_GENERIC_CSV,
    async (
      _event,
      { content, columnMapping }: { content: string; columnMapping: CsvColumnMapping },
    ): Promise<{ success: boolean; data?: ImportPayload; error?: string }> => {
      try {
        if (!content) {
          return { success: false, error: 'No file content provided.' };
        }

        if (content.length === 0) {
          return { success: false, error: 'File is empty.' };
        }

        const importer = createGenericCsvImporterWithMapping(columnMapping);
        const payload = importer.parse(content);

        return { success: true, data: payload };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error parsing file.',
        };
      }
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.IMPORT_CHECK_DUPLICATES,
    async (
      _event,
      { payload }: { payload: ImportPayload },
    ): Promise<{ success: boolean; data?: DuplicateReport; error?: string }> => {
      try {
        if (!isDatabaseOpen()) {
          return { success: false, error: 'Database is not open.' };
        }

        const allDbItems = itemRepo.getAll();
        const existingRefs = buildExistingItemRefs(allDbItems);
        const report = detectDuplicates(payload.items, existingRefs);

        return { success: true, data: report };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error checking duplicates.',
        };
      }
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.IMPORT_COMMIT,
    async (
      _event,
      { payload, resolutionMap }: ImportCommitRequest,
    ): Promise<{ success: boolean; data?: { importedCount: number; replacedCount: number }; error?: string }> => {
      try {
        if (!isDatabaseOpen()) {
          return { success: false, error: 'Database is not open.' };
        }

        const key = getMasterKey();
        if (!key) {
          return { success: false, error: 'No master key available. Unlock first.' };
        }

        const finalPayload = applyResolutionMap(payload, resolutionMap);
        const db = getDatabase();

        if (!db) {
          return { success: false, error: 'Database not available.' };
        }

        const replaceMap = new Map<number, string>();
        for (const dup of resolutionMap.items) {
          const res = resolutionMap.perItemResolutions[dup.importItemIndex] ?? resolutionMap.globalResolution;
          if (res === 'replace') {
            replaceMap.set(dup.importItemIndex, dup.existingItemId);
          }
        }

        let importedCount = 0;
        let replacedCount = 0;

        db.run('BEGIN TRANSACTION');

        try {
          for (const item of finalPayload.items) {
            const passwordEncrypted = item.password
              ? (encryptString(item.password, key) as unknown as ArrayBuffer)
              : null;
            const notesEncrypted = item.notes
              ? (encryptString(item.notes, key) as unknown as ArrayBuffer)
              : null;

            itemRepo.create(item.folderId, {
              title: item.title,
              username: item.username,
              passwordEncrypted,
              url: item.url,
              notesEncrypted,
              emoji: item.emoji ?? null,
              coverImage: item.coverImage ?? null,
            });

            importedCount++;
          }

          db.run('COMMIT');

          return {
            success: true,
            data: { importedCount, replacedCount },
          };
        } catch (err) {
          db.run('ROLLBACK');
          throw err;
        }
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error committing import.',
        };
      }
    },
  );
}
