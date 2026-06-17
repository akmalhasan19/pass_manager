import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../shared/ipcChannels';
import { MAX_FIELD_LENGTHS } from '../../shared/constants';
import { sanitizeField, validateCharacters } from '../../shared/validation';
import { FolderRepository } from '../database/repositories/FolderRepository';
import { TrashRepository } from '../database/repositories/TrashRepository';
import { isDatabaseOpen, getDatabase } from '../database/connection';
import { getMasterKey } from './authHandlers';
import { encryptString, decryptString } from '../crypto/encryption';
import { secureClear, secureClearString } from '../../shared/secureMemory';

const folderRepo = new FolderRepository();
const trashRepo = new TrashRepository();

export function registerFolderHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.FOLDER_GET_TREE, () => {
    try {
      if (!isDatabaseOpen()) {
        return { success: false, error: 'Database is not open.' };
      }
      const data = folderRepo.getTree();
      return { success: true, data };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  });

  ipcMain.handle(
    IPC_CHANNELS.FOLDER_CREATE,
    (
      _event,
      { parentId, name, emoji }: { parentId: string | null; name: string; emoji?: string },
    ) => {
      try {
        if (!isDatabaseOpen()) {
          return { success: false, error: 'Database is not open.' };
        }

        if (!name || name.trim().length === 0) {
          return { success: false, error: 'Folder name is required.' };
        }

        const sanitizedName = sanitizeField('folderName', name);
        const trimmedName = sanitizedName.trim();
        if (trimmedName.length === 0) {
          return { success: false, error: 'Folder name is required.' };
        }
        if (trimmedName.length > MAX_FIELD_LENGTHS.FOLDER_NAME) {
          return {
            success: false,
            error: `Folder name must be ${MAX_FIELD_LENGTHS.FOLDER_NAME} characters or less.`,
          };
        }

        const charError = validateCharacters('folderName', trimmedName);
        if (charError) {
          return { success: false, error: 'Folder name contains invalid characters.' };
        }

        const duplicateExists = folderRepo.existsByParentIdAndName(parentId, trimmedName);
        if (duplicateExists) {
          return {
            success: false,
            error: 'A folder with this name already exists.',
          };
        }

        const data = folderRepo.create(parentId, trimmedName, emoji ?? null);
        return { success: true, data };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.FOLDER_UPDATE,
    (
      _event,
      {
        id,
        name,
        emoji,
        coverImage,
      }: { id: string; name?: string; emoji?: string; coverImage?: string },
    ) => {
      try {
        if (!isDatabaseOpen()) {
          return { success: false, error: 'Database is not open.' };
        }

        const existing = folderRepo.getById(id);
        if (!existing) {
          return { success: false, error: 'Folder not found.' };
        }

        if (name !== undefined) {
          const sanitizedName = sanitizeField('folderName', name);
          const trimmedName = sanitizedName.trim();
          if (trimmedName.length === 0) {
            return { success: false, error: 'Folder name is required.' };
          }
          if (trimmedName.length > MAX_FIELD_LENGTHS.FOLDER_NAME) {
            return {
              success: false,
              error: `Folder name must be ${MAX_FIELD_LENGTHS.FOLDER_NAME} characters or less.`,
            };
          }
          const charError = validateCharacters('folderName', trimmedName);
          if (charError) {
            return { success: false, error: 'Folder name contains invalid characters.' };
          }

          if (trimmedName !== existing.name) {
            const duplicateExists = folderRepo.existsByParentIdAndName(
              existing.parentId,
              trimmedName,
              id,
            );
            if (duplicateExists) {
              return {
                success: false,
                error: 'A folder with this name already exists.',
              };
            }
          }
        }

        const data = folderRepo.update(id, {
          name: name !== undefined ? sanitizeField('folderName', name).trim() : undefined,
          emoji,
          coverImage,
        });
        return { success: true, data };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.FOLDER_MOVE,
    (
      _event,
      { id, newParentId, sortOrder }: { id: string; newParentId: string | null; sortOrder: number },
    ) => {
      try {
        if (!isDatabaseOpen()) {
          return { success: false, error: 'Database is not open.' };
        }

        const existing = folderRepo.getById(id);
        if (!existing) {
          return { success: false, error: 'Folder not found.' };
        }

        const moved = folderRepo.move(id, newParentId, sortOrder);
        if (!moved) {
          return {
            success: false,
            error: 'Invalid move operation. Checking for circular reference or self-reference.',
          };
        }

        const data = folderRepo.getTree();
        return { success: true, data };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    },
  );

  ipcMain.handle(IPC_CHANNELS.FOLDER_DELETE, (_event, { id }: { id: string }) => {
    try {
      if (!isDatabaseOpen()) {
        return { success: false, error: 'Database is not open.' };
      }

      const folder = folderRepo.getById(id);
      if (!folder) {
        return { success: false, error: 'Folder not found.' };
      }

      const key = getMasterKey();
      if (!key) {
        return { success: false, error: 'No master key available. Unlock first.' };
      }

      const db = getDatabase();
      if (!db) {
        return { success: false, error: 'Database not available.' };
      }

      const descendantIds = folderRepo.getDescendantIds(id);
      const allFolderIds = [id, ...descendantIds];

      const itemStmt = db.prepare('SELECT id FROM items WHERE folder_id = ?');
      for (const folderId of allFolderIds) {
        itemStmt.bind([folderId]);
        while (itemStmt.step()) {
          const row = itemStmt.getAsObject() as { id: string };
          trashRepo.add('item', row.id, folderId, null);
        }
        itemStmt.reset();
      }
      itemStmt.free();

      for (const folderId of allFolderIds) {
        const childFolder = folderRepo.getById(folderId);
        if (childFolder) {
          const folderJson = JSON.stringify({
            id: childFolder.id,
            parentId: childFolder.parentId,
            name: childFolder.name,
            emoji: childFolder.emoji,
            coverImage: childFolder.coverImage,
            createdAt: childFolder.createdAt,
            updatedAt: childFolder.updatedAt,
            sortOrder: childFolder.sortOrder,
          });
          const encrypted = encryptString(folderJson, key);
          trashRepo.add('folder', childFolder.id, childFolder.parentId, encrypted);
          // SECURITY: Wipe encrypted buffer after storing in trash
          secureClear(encrypted);
        }
      }

      folderRepo.delete(id);

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  });

  ipcMain.handle(IPC_CHANNELS.FOLDER_RESTORE, (_event, { id }: { id: string }) => {
    try {
      if (!isDatabaseOpen()) {
        return { success: false, error: 'Database is not open.' };
      }

      const key = getMasterKey();
      if (!key) {
        return { success: false, error: 'No master key available. Unlock first.' };
      }

      const allTrash = trashRepo.getAll();
      const folderEntries = allTrash.filter(
        (entry) => entry.originalType === 'folder' && entry.originalId === id,
      );

      if (folderEntries.length === 0) {
        return { success: false, error: 'Folder not found in trash.' };
      }

      folderEntries.sort((a, b) => (a.deletedAt ?? 0) - (b.deletedAt ?? 0));

      const entry = folderEntries[0];
      const db = getDatabase();
      if (!db) {
        return { success: false, error: 'Database not available.' };
      }

      let folderData: {
        id: string;
        parentId: string | null;
        name: string;
        emoji: string | null;
        coverImage: string | null;
        createdAt: number;
        updatedAt: number;
        sortOrder: number;
      };

      if (entry.dataEncrypted) {
        const dataBuf = Buffer.from(entry.dataEncrypted);
        const decrypted = decryptString(dataBuf, key);
        // SECURITY: Wipe temporary buffer containing encrypted data
        secureClear(dataBuf);
        folderData = JSON.parse(decrypted);
        // SECURITY: Wipe immutable string reference — V8 strings cannot be
        // zeroed in place, but we drop the reference to allow GC collection.
        secureClearString(decrypted);
      } else {
        return { success: false, error: 'No data in trash entry.' };
      }

      const allDescendants = allTrash
        .filter((e) => e.originalType === 'folder' && e.originalId !== id)
        .sort((a, b) => (a.deletedAt ?? 0) - (b.deletedAt ?? 0));

      const now = Date.now();
      db.run(
        `INSERT INTO folders (id, parent_id, name, emoji, cover_image, created_at, updated_at, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          folderData.id,
          folderData.parentId,
          folderData.name,
          folderData.emoji,
          folderData.coverImage,
          folderData.createdAt,
          now,
          folderData.sortOrder,
        ],
      );

      trashRepo.removeByOriginalId(id);

      for (const desc of allDescendants) {
        if (!desc.dataEncrypted) continue;

        const descDataBuf = Buffer.from(desc.dataEncrypted);
        const decrypted = decryptString(descDataBuf, key);
        // SECURITY: Wipe temporary buffer containing encrypted data
        secureClear(descDataBuf);
        const childData = JSON.parse(decrypted);
        // SECURITY: Wipe immutable string reference — V8 strings cannot be
        // zeroed in place, but we drop the reference to allow GC collection.
        secureClearString(decrypted);

        const parentStillExists = folderRepo.getById(childData.parentId);
        if (!parentStillExists) {
          continue;
        }

        db.run(
          `INSERT OR IGNORE INTO folders (id, parent_id, name, emoji, cover_image, created_at, updated_at, sort_order)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            childData.id,
            childData.parentId,
            childData.name,
            childData.emoji,
            childData.coverImage,
            childData.createdAt,
            now,
            childData.sortOrder,
          ],
        );

        trashRepo.removeByOriginalId(desc.originalId);
      }

      const data = folderRepo.getTree();
      return { success: true, data };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  });
}
