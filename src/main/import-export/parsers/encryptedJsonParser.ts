import { getMasterKey } from '../../ipc/authHandlers';
import {
  createImportPayload,
  createImportFolder,
  createImportTag,
  makeImportPayload,
  ImportFormatError,
  ImportParseError,
  type Importer,
} from '../importer';
import {
  decryptAES256GCM,
  decryptString,
  deserializeEncrypted,
} from '../../crypto/encryption';
import { validateEncryptedFileStructure, validateExportPayloadSchema } from '../schemaValidator';
import { secureClear } from '../../../shared/secureMemory';
import type {
  ExportPayload,
  ExportItem,
  ImportFormat,
  ImportItem,
} from '../../../shared/types';

function exportItemToImportItem(exportItem: ExportItem, masterKey: Buffer): ImportItem {
  let password = '';
  let passwordBuf: Buffer | null = null;
  if (exportItem.passwordEncrypted) {
    try {
      passwordBuf = Buffer.from(exportItem.passwordEncrypted, 'base64');
      password = decryptString(passwordBuf, masterKey);
    } catch {
      password = '';
    }
  }

  let notes: string | null = null;
  let notesBuf: Buffer | null = null;
  if (exportItem.notesEncrypted) {
    try {
      notesBuf = Buffer.from(exportItem.notesEncrypted, 'base64');
      notes = decryptString(notesBuf, masterKey);
    } catch {
      notes = null;
    }
  }

  // SECURITY: Wipe temporary buffers containing encrypted data
  secureClear(passwordBuf);
  secureClear(notesBuf);

  return {
    id: exportItem.id,
    folderId: exportItem.folderId,
    title: exportItem.title,
    username: exportItem.username,
    password,
    url: exportItem.url,
    notes,
    emoji: exportItem.emoji ?? null,
    coverImage: exportItem.coverImage ?? null,
    createdAt: exportItem.createdAt,
    updatedAt: exportItem.updatedAt,
    isFavorite: exportItem.isFavorite,
    sortOrder: exportItem.sortOrder,
    tagIds: exportItem.tagIds ?? [],
  };
}

export class EncryptedJsonImporter implements Importer {
  readonly format: ImportFormat = 'encrypted-json';

  parse(content: string): ImportPayload {
    const masterKey = getMasterKey();
    if (!masterKey) {
      throw new ImportParseError(
        'No master key available. Please unlock the vault first before importing encrypted backups.',
      );
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch (cause) {
      throw new ImportParseError(
        `Invalid JSON in encrypted backup file: ${cause instanceof Error ? cause.message : 'Malformed JSON'}`,
        undefined,
        { cause },
      );
    }

    const encryptedFile = validateEncryptedFileStructure(parsed);

    const iv = Buffer.from(encryptedFile.iv, 'base64');
    const tag = Buffer.from(encryptedFile.authTag, 'base64');
    const ciphertext = Buffer.from(encryptedFile.ciphertext, 'base64');

    let decryptedPayload: ExportPayload;
    let plaintextBuffer: Buffer | null = null;
    let payloadJson: string | null = null;
    try {
      plaintextBuffer = decryptAES256GCM({ ciphertext, iv, tag }, masterKey);
      payloadJson = plaintextBuffer.toString('utf-8');
      const parsedPayload = JSON.parse(payloadJson);
      decryptedPayload = validateExportPayloadSchema(parsedPayload);
    } catch (cause) {
      if (cause instanceof ImportParseError || cause instanceof ImportFormatError) {
        throw cause;
      }
      throw new ImportParseError(
        `Failed to decrypt backup file: ${cause instanceof Error ? cause.message : 'Decryption error'}. The file may be corrupted or the vault key has changed.`,
        undefined,
        { cause },
      );
    } finally {
      // SECURITY: Wipe sensitive material before leaving scope
      secureClear(plaintextBuffer);
      secureClear(iv);
      secureClear(tag);
      secureClear(ciphertext);
      // SECURITY: Drop reference to immutable plaintext string to allow GC.
      // V8 strings cannot be zeroed in place, but we minimize exposure.
      if (payloadJson) {
        payloadJson = null;
      }
    }

    const payload = createImportPayload();

    const folderMap = new Map<string, string>();

    for (const exportFolder of decryptedPayload.folders) {
      const folderId = exportFolder.id || exportFolder.id;
      folderMap.set(exportFolder.id, folderId);

      payload.folders.push(
        createImportFolder({
          id: folderId,
          parentId: exportFolder.parentId,
          name: exportFolder.name,
          emoji: exportFolder.emoji ?? null,
          coverImage: exportFolder.coverImage ?? null,
          createdAt: exportFolder.createdAt,
          updatedAt: exportFolder.updatedAt,
          sortOrder: exportFolder.sortOrder,
        }),
      );
    }

    for (const exportItem of decryptedPayload.items) {
      if (!exportItem.title) continue;

      const folderId = exportItem.folderId
        ? folderMap.get(exportItem.folderId) || exportItem.folderId
        : '';

      const importItem = exportItemToImportItem(exportItem, masterKey);
      importItem.folderId = folderId;

      payload.items.push(importItem);
    }

    for (const exportTag of decryptedPayload.tags) {
      payload.tags.push(
        createImportTag({
          id: exportTag.id,
          name: exportTag.name,
          color: exportTag.color,
        }),
      );
    }

    for (const exportAtt of decryptedPayload.attachments) {
      let rawData: Buffer;
      let encryptedDataBuf: Buffer | null = null;
      try {
        encryptedDataBuf = Buffer.from(exportAtt.dataEncrypted, 'base64');
        const encryptedData = deserializeEncrypted(encryptedDataBuf);
        rawData = decryptAES256GCM(encryptedData, masterKey);
      } catch {
        rawData = Buffer.alloc(0);
      } finally {
        // SECURITY: Wipe temporary buffer containing encrypted data
        secureClear(encryptedDataBuf);
      }

      payload.attachments.push({
        id: exportAtt.id,
        itemId: exportAtt.itemId,
        folderId: exportAtt.folderId,
        fileName: exportAtt.fileName,
        mimeType: exportAtt.mimeType,
        fileSize: exportAtt.fileSize,
        rawData,
        createdAt: exportAtt.createdAt,
      });
    }

    return makeImportPayload(payload);
  }
}

export function createEncryptedJsonImporter(): Importer {
  return new EncryptedJsonImporter();
}
