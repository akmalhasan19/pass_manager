import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../shared/ipcChannels';
import type { Item, ItemDecrypted } from '../../shared/types';
import { FolderRepository } from '../database/repositories/FolderRepository';
import { ItemRepository } from '../database/repositories/ItemRepository';
import { TagRepository } from '../database/repositories/TagRepository';
import { TrashRepository } from '../database/repositories/TrashRepository';
import { isDatabaseOpen, getDatabase } from '../database/connection';
import { getMasterKey } from './authHandlers';
import { encryptString, decryptString } from '../crypto/encryption';

const folderRepo = new FolderRepository();
const itemRepo = new ItemRepository();
const tagRepo = new TagRepository();
const trashRepo = new TrashRepository();

function decryptItem(item: Item, key: Buffer): ItemDecrypted {
  const tags = tagRepo.getByItem(item.id);
  return {
    id: item.id,
    folderId: item.folderId,
    title: item.title,
    username: item.username,
    password: item.passwordEncrypted ? decryptString(Buffer.from(item.passwordEncrypted), key) : '',
    url: item.url,
    notes: item.notesEncrypted ? decryptString(Buffer.from(item.notesEncrypted), key) : null,
    emoji: item.emoji,
    coverImage: item.coverImage,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    isFavorite: item.isFavorite,
    sortOrder: item.sortOrder,
    tags: tags.length > 0 ? tags : undefined,
  };
}

function serializeItemForTrash(item: Item): string {
  return JSON.stringify({
    id: item.id,
    folderId: item.folderId,
    title: item.title,
    username: item.username,
    passwordEncrypted: item.passwordEncrypted
      ? Buffer.from(item.passwordEncrypted).toString('base64')
      : null,
    url: item.url,
    notesEncrypted: item.notesEncrypted
      ? Buffer.from(item.notesEncrypted).toString('base64')
      : null,
    emoji: item.emoji,
    coverImage: item.coverImage,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    isFavorite: item.isFavorite,
    sortOrder: item.sortOrder,
  });
}

function deserializeItemFromTrash(json: string) {
  const parsed = JSON.parse(json);
  return {
    ...parsed,
    passwordEncrypted: parsed.passwordEncrypted
      ? Buffer.from(parsed.passwordEncrypted, 'base64')
      : null,
    notesEncrypted: parsed.notesEncrypted ? Buffer.from(parsed.notesEncrypted, 'base64') : null,
  };
}

export function registerItemHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.ITEM_GET_BY_FOLDER, (_event, { folderId }: { folderId: string }) => {
    try {
      if (!isDatabaseOpen()) {
        return { success: false, error: 'Database is not open.' };
      }

      const data = itemRepo.getByFolder(folderId);
      const itemsWithTags = data.map((item) => {
        const tags = tagRepo.getByItem(item.id);
        return { ...item, tags: tags.length > 0 ? tags : undefined };
      });

      return { success: true, data: itemsWithTags };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  });

  ipcMain.handle(IPC_CHANNELS.ITEM_GET_BY_ID, (_event, { id }: { id: string }) => {
    try {
      if (!isDatabaseOpen()) {
        return { success: false, error: 'Database is not open.' };
      }

      const key = getMasterKey();
      if (!key) {
        return { success: false, error: 'No master key available. Unlock first.' };
      }

      const item = itemRepo.getById(id);
      if (!item) {
        return { success: false, error: 'Item not found.' };
      }

      const data = decryptItem(item, key);
      return { success: true, data };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  });

  ipcMain.handle(
    IPC_CHANNELS.ITEM_CREATE,
    (
      _event,
      {
        folderId,
        ...fields
      }: {
        folderId: string;
        title: string;
        username?: string;
        password?: string | null;
        url?: string;
        notes?: string | null;
        emoji?: string | null;
        coverImage?: string | null;
      },
    ) => {
      try {
        if (!isDatabaseOpen()) {
          return { success: false, error: 'Database is not open.' };
        }

        if (!fields.title || fields.title.trim().length === 0) {
          return { success: false, error: 'Item title is required.' };
        }

        const key = getMasterKey();
        if (!key) {
          return { success: false, error: 'No master key available. Unlock first.' };
        }

        let passwordEncrypted: ArrayBuffer | null = null;
        if (fields.password) {
          passwordEncrypted = encryptString(fields.password, key) as unknown as ArrayBuffer;
        }

        let notesEncrypted: ArrayBuffer | null = null;
        if (fields.notes) {
          notesEncrypted = encryptString(fields.notes, key) as unknown as ArrayBuffer;
        }

        const item = itemRepo.create(folderId, {
          title: fields.title.trim(),
          username: fields.username,
          passwordEncrypted,
          url: fields.url,
          notesEncrypted,
          emoji: fields.emoji ?? null,
          coverImage: fields.coverImage ?? null,
        });

        const data = decryptItem(item, key);
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
    IPC_CHANNELS.ITEM_UPDATE,
    (
      _event,
      {
        id,
        ...fields
      }: {
        id: string;
        title?: string;
        username?: string;
        password?: string | null;
        url?: string;
        notes?: string | null;
        emoji?: string | null;
        coverImage?: string | null;
        isFavorite?: boolean;
        sortOrder?: number;
      },
    ) => {
      try {
        if (!isDatabaseOpen()) {
          return { success: false, error: 'Database is not open.' };
        }

        const key = getMasterKey();
        if (!key) {
          return { success: false, error: 'No master key available. Unlock first.' };
        }

        const existing = itemRepo.getById(id);
        if (!existing) {
          return { success: false, error: 'Item not found.' };
        }

        const updateFields: Partial<{
          title: string;
          username: string;
          passwordEncrypted: ArrayBuffer | null;
          url: string;
          notesEncrypted: ArrayBuffer | null;
          emoji: string | null;
          coverImage: string | null;
          isFavorite: boolean;
          sortOrder: number;
        }> = {};

        if (fields.title !== undefined) updateFields.title = fields.title.trim();
        if (fields.username !== undefined) updateFields.username = fields.username;
        if (fields.password !== undefined) {
          updateFields.passwordEncrypted = fields.password
            ? (encryptString(fields.password, key) as unknown as ArrayBuffer)
            : null;
        }
        if (fields.url !== undefined) updateFields.url = fields.url;
        if (fields.notes !== undefined) {
          updateFields.notesEncrypted = fields.notes
            ? (encryptString(fields.notes, key) as unknown as ArrayBuffer)
            : null;
        }
        if (fields.emoji !== undefined) updateFields.emoji = fields.emoji;
        if (fields.coverImage !== undefined) updateFields.coverImage = fields.coverImage;
        if (fields.isFavorite !== undefined) updateFields.isFavorite = fields.isFavorite;
        if (fields.sortOrder !== undefined) updateFields.sortOrder = fields.sortOrder;

        const item = itemRepo.update(id, updateFields);
        if (!item) {
          return { success: false, error: 'Failed to update item.' };
        }

        const data = decryptItem(item, key);
        return { success: true, data };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    },
  );

  ipcMain.handle(IPC_CHANNELS.ITEM_DELETE, (_event, { id }: { id: string }) => {
    try {
      if (!isDatabaseOpen()) {
        return { success: false, error: 'Database is not open.' };
      }

      const key = getMasterKey();
      if (!key) {
        return { success: false, error: 'No master key available. Unlock first.' };
      }

      const item = itemRepo.getById(id);
      if (!item) {
        return { success: false, error: 'Item not found.' };
      }

      const serialized = serializeItemForTrash(item);
      const encrypted = encryptString(serialized, key) as unknown as ArrayBuffer;
      trashRepo.add('item', id, item.folderId, encrypted);

      itemRepo.delete(id);

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  });

  ipcMain.handle(IPC_CHANNELS.ITEM_RESTORE, (_event, { id }: { id: string }) => {
    try {
      if (!isDatabaseOpen()) {
        return { success: false, error: 'Database is not open.' };
      }

      const key = getMasterKey();
      if (!key) {
        return { success: false, error: 'No master key available. Unlock first.' };
      }

      const allTrash = trashRepo.getAll();
      const entry = allTrash.find((e) => e.originalType === 'item' && e.originalId === id);

      if (!entry) {
        return { success: false, error: 'Item not found in trash.' };
      }

      if (!entry.dataEncrypted) {
        return { success: false, error: 'No data in trash entry.' };
      }

      const decrypted = decryptString(Buffer.from(entry.dataEncrypted), key);
      const itemData = deserializeItemFromTrash(decrypted);

      const db = getDatabase();
      if (!db) {
        return { success: false, error: 'Database not available.' };
      }

      if (itemData.folderId) {
        const folder = folderRepo.getById(itemData.folderId);
        if (!folder) {
          return { success: false, error: 'Original folder no longer exists.' };
        }
      }

      const now = Date.now();
      db.run(
        `INSERT INTO items (id, folder_id, title, username, password_encrypted, url, notes_encrypted, emoji, cover_image, created_at, updated_at, is_favorite, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          itemData.id,
          itemData.folderId,
          itemData.title,
          itemData.username ?? '',
          itemData.passwordEncrypted,
          itemData.url ?? '',
          itemData.notesEncrypted,
          itemData.emoji,
          itemData.coverImage,
          itemData.createdAt,
          now,
          itemData.isFavorite ? 1 : 0,
          itemData.sortOrder ?? 0,
        ],
      );

      trashRepo.removeByOriginalId(id);

      const restored = itemRepo.getById(itemData.id);
      const tags = tagRepo.getByItem(itemData.id);
      const data = { ...restored, tags: tags.length > 0 ? tags : undefined };

      return { success: true, data };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  });

  ipcMain.handle(IPC_CHANNELS.ITEM_TOGGLE_FAVORITE, (_event, { id }: { id: string }) => {
    try {
      if (!isDatabaseOpen()) {
        return { success: false, error: 'Database is not open.' };
      }

      const item = itemRepo.getById(id);
      if (!item) {
        return { success: false, error: 'Item not found.' };
      }

      const updatedItem = itemRepo.update(id, {
        isFavorite: !item.isFavorite,
      });

      const tags = tagRepo.getByItem(id);
      const data = { ...updatedItem, tags: tags.length > 0 ? tags : undefined };

      return { success: true, data };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  });

  ipcMain.handle(IPC_CHANNELS.ITEM_GET_ALL, () => {
    try {
      if (!isDatabaseOpen()) {
        return { success: false, error: 'Database is not open.' };
      }
      const data = itemRepo.getAll();
      const itemsWithTags = data.map((item) => {
        const tags = tagRepo.getByItem(item.id);
        return { ...item, tags: tags.length > 0 ? tags : undefined };
      });
      return { success: true, data: itemsWithTags };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  });
}
