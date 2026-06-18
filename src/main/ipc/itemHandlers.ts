import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../shared/ipcChannels';
import { MAX_FIELD_LENGTHS, OTP_DEFAULTS } from '../../shared/constants';
import {
  sanitizeField,
  sanitizeTotpConfig,
  validateCharacters,
} from '../../shared/validation';
import { secureClear, secureClearString } from '../../shared/secureMemory';
import type { Item, ItemDecrypted, TotpConfig } from '../../shared/types';
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

/**
 * Populate `item.otp` with OTP config metadata for an Item.
 * Used by list-view IPC handlers before returning data to the renderer.
 *
 * SECURITY: The plaintext secret is NEVER included in the returned config.
 * Only period, digits, and algorithm are populated. OTP code generation
 * must be performed via the OTP_GENERATE IPC channel, which decrypts
 * the secret transiently in the main process.
 */
function decryptOtpForItem(item: Item, _key: Buffer): void {
  if (!item.otpSecretEncrypted) {
    item.otp = null;
    return;
  }
  // SECURITY: Do NOT decrypt the secret here. The renderer only needs
  // metadata to display OTP status and configuration details.
  item.otp = {
    secret: '', // Intentionally empty — secret never leaves main process
    period: item.otpPeriod,
    digits: item.otpDigits,
    algorithm: item.otpAlgorithm,
  };
}

function decryptItem(item: Item, key: Buffer): ItemDecrypted {
  const tags = tagRepo.getByItem(item.id);

  let password = '';
  let passwordBuf: Buffer | null = null;
  if (item.passwordEncrypted) {
    passwordBuf = Buffer.from(item.passwordEncrypted);
    password = decryptString(passwordBuf, key);
  }

  let notes: string | null = null;
  let notesBuf: Buffer | null = null;
  if (item.notesEncrypted) {
    notesBuf = Buffer.from(item.notesEncrypted);
    notes = decryptString(notesBuf, key);
  }

  // SECURITY: OTP secret is NOT decrypted here. The renderer receives only
  // the config metadata (period, digits, algorithm). OTP code generation
  // and secret retrieval are handled via dedicated IPC channels
  // (OTP_GENERATE, OTP_GET_CONFIG) that keep the plaintext in the main
  // process scope and wipe it after use.
  let otp: TotpConfig | null = null;
  if (item.otpSecretEncrypted) {
    otp = {
      secret: '', // Intentionally empty — secret never leaves main process
      period: item.otpPeriod,
      digits: item.otpDigits,
      algorithm: item.otpAlgorithm,
    };
  }

  // SECURITY: Wipe temporary buffers containing encrypted data
  secureClear(passwordBuf);
  secureClear(notesBuf);

  return {
    id: item.id,
    folderId: item.folderId,
    title: item.title,
    username: item.username,
    password,
    url: item.url,
    notes,
    emoji: item.emoji,
    coverImage: item.coverImage,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    isFavorite: item.isFavorite,
    sortOrder: item.sortOrder,
    otp,
    tags: tags.length > 0 ? tags : undefined,
  };
}

function serializeItemForTrash(item: Item): string {
  let passwordBase64: string | null = null;
  let passwordBuf: Buffer | null = null;
  if (item.passwordEncrypted) {
    passwordBuf = Buffer.from(item.passwordEncrypted);
    passwordBase64 = passwordBuf.toString('base64');
  }

  let notesBase64: string | null = null;
  let notesBuf: Buffer | null = null;
  if (item.notesEncrypted) {
    notesBuf = Buffer.from(item.notesEncrypted);
    notesBase64 = notesBuf.toString('base64');
  }

  let otpSecretBase64: string | null = null;
  let otpBuf: Buffer | null = null;
  if (item.otpSecretEncrypted) {
    otpBuf = Buffer.from(item.otpSecretEncrypted);
    otpSecretBase64 = otpBuf.toString('base64');
  }

  // SECURITY: Wipe temporary buffers containing encrypted data
  secureClear(passwordBuf);
  secureClear(notesBuf);
  secureClear(otpBuf);

  return JSON.stringify({
    id: item.id,
    folderId: item.folderId,
    title: item.title,
    username: item.username,
    passwordEncrypted: passwordBase64,
    url: item.url,
    notesEncrypted: notesBase64,
    emoji: item.emoji,
    coverImage: item.coverImage,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    isFavorite: item.isFavorite,
    sortOrder: item.sortOrder,
    otpSecretEncrypted: otpSecretBase64,
    otpPeriod: item.otpPeriod,
    otpDigits: item.otpDigits,
    otpAlgorithm: item.otpAlgorithm,
  });
}

function deserializeItemFromTrash(json: string) {
  const parsed = JSON.parse(json);

  let passwordEncrypted: Buffer | null = null;
  if (parsed.passwordEncrypted) {
    passwordEncrypted = Buffer.from(parsed.passwordEncrypted, 'base64');
  }

  let notesEncrypted: Buffer | null = null;
  if (parsed.notesEncrypted) {
    notesEncrypted = Buffer.from(parsed.notesEncrypted, 'base64');
  }

  let otpSecretEncrypted: Buffer | null = null;
  if (parsed.otpSecretEncrypted) {
    otpSecretEncrypted = Buffer.from(parsed.otpSecretEncrypted, 'base64');
  }

  // Note: The base64 strings in parsed are now sensitive and should ideally
  // be cleared too, but JavaScript strings are immutable. The Buffers above
  // are the primary concern and are wiped by the caller after use.

  return {
    ...parsed,
    passwordEncrypted,
    notesEncrypted,
    otpSecretEncrypted,
  };
}

export function registerItemHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.ITEM_GET_BY_FOLDER, (_event, { folderId }: { folderId: string }) => {
    try {
      if (!isDatabaseOpen()) {
        return { success: false, error: 'Database is not open.' };
      }

      const key = getMasterKey();
      if (!key) {
        return { success: false, error: 'No master key available. Unlock first.' };
      }

      const data = itemRepo.getByFolder(folderId);
      const itemsWithTags = data.map((item) => {
        decryptOtpForItem(item, key);
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
        otpConfig?: TotpConfig | null;
      },
    ) => {
      try {
        if (!isDatabaseOpen()) {
          return { success: false, error: 'Database is not open.' };
        }

        if (!fields.title || fields.title.trim().length === 0) {
          return { success: false, error: 'Item title is required.' };
        }

        const sanitizedTitle = sanitizeField('itemTitle', fields.title);
        const trimmedTitle = sanitizedTitle.trim();
        if (trimmedTitle.length === 0) {
          return { success: false, error: 'Item title is required.' };
        }
        if (trimmedTitle.length > MAX_FIELD_LENGTHS.ITEM_TITLE) {
          return {
            success: false,
            error: `Item title must be ${MAX_FIELD_LENGTHS.ITEM_TITLE} characters or less.`,
          };
        }

        const titleCharError = validateCharacters('itemTitle', trimmedTitle);
        if (titleCharError) {
          return { success: false, error: 'Item title contains invalid characters.' };
        }

        const sanitizedUsername =
          fields.username !== undefined ? sanitizeField('username', fields.username) : undefined;
        if (sanitizedUsername && sanitizedUsername.length > MAX_FIELD_LENGTHS.USERNAME) {
          return {
            success: false,
            error: `Username must be ${MAX_FIELD_LENGTHS.USERNAME} characters or less.`,
          };
        }
        if (sanitizedUsername) {
          const usernameCharError = validateCharacters('username', sanitizedUsername);
          if (usernameCharError) {
            return { success: false, error: 'Username contains invalid characters.' };
          }
        }
        if (fields.password && fields.password.length > MAX_FIELD_LENGTHS.PASSWORD) {
          return {
            success: false,
            error: `Password must be ${MAX_FIELD_LENGTHS.PASSWORD} characters or less.`,
          };
        }
        if (fields.password) {
          const passwordCharError = validateCharacters('password', fields.password);
          if (passwordCharError) {
            return { success: false, error: 'Password contains invalid characters.' };
          }
        }
        const sanitizedUrl =
          fields.url !== undefined ? sanitizeField('url', fields.url) : undefined;
        if (sanitizedUrl && sanitizedUrl.length > MAX_FIELD_LENGTHS.URL) {
          return {
            success: false,
            error: `URL must be ${MAX_FIELD_LENGTHS.URL} characters or less.`,
          };
        }
        if (sanitizedUrl) {
          const urlCharError = validateCharacters('url', sanitizedUrl);
          if (urlCharError) {
            return { success: false, error: 'URL contains invalid characters.' };
          }
        }
        if (fields.notes && fields.notes.length > MAX_FIELD_LENGTHS.NOTES) {
          return {
            success: false,
            error: `Notes must be ${MAX_FIELD_LENGTHS.NOTES} characters or less.`,
          };
        }
        if (fields.notes) {
          const notesCharError = validateCharacters('notes', fields.notes);
          if (notesCharError) {
            return { success: false, error: 'Notes contain invalid characters.' };
          }
        }
        let normalizedOtpConfig: TotpConfig | null = null;
        if (fields.otpConfig !== undefined && fields.otpConfig !== null) {
          const { sanitized, error } = sanitizeTotpConfig(fields.otpConfig);
          if (error) {
            return { success: false, error: 'Invalid OTP configuration: ' + error };
          }
          normalizedOtpConfig = sanitized;
        }

        const titleDuplicateExists = itemRepo.existsByFolderIdAndTitle(folderId, trimmedTitle);
        if (titleDuplicateExists) {
          return {
            success: false,
            error: 'An item with this title already exists in this folder.',
          };
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

        let otpSecretEncrypted: ArrayBuffer | null = null;
        let otpPeriod = OTP_DEFAULTS.PERIOD;
        let otpDigits = OTP_DEFAULTS.DIGITS;
        let otpAlgorithm = OTP_DEFAULTS.ALGORITHM;
        if (normalizedOtpConfig) {
          otpSecretEncrypted = encryptString(normalizedOtpConfig.secret, key) as unknown as ArrayBuffer;
          otpPeriod = normalizedOtpConfig.period;
          otpDigits = normalizedOtpConfig.digits;
          otpAlgorithm = normalizedOtpConfig.algorithm;
        }

        const item = itemRepo.create(folderId, {
          title: trimmedTitle,
          username: sanitizedUsername ?? '',
          passwordEncrypted,
          url: sanitizedUrl ?? '',
          notesEncrypted,
          emoji: fields.emoji ?? null,
          coverImage: fields.coverImage ?? null,
          otpSecretEncrypted,
          otpPeriod,
          otpDigits,
          otpAlgorithm,
        });

        // SECURITY: Wipe encrypted buffers after they've been persisted to DB
        secureClear(passwordEncrypted as unknown as Buffer);
        secureClear(notesEncrypted as unknown as Buffer);
        secureClear(otpSecretEncrypted as unknown as Buffer);

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
        otpConfig?: TotpConfig | null;
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
          otpSecretEncrypted: ArrayBuffer | null;
          otpPeriod: number;
          otpDigits: number;
          otpAlgorithm: string;
        }> = {};

        if (fields.title !== undefined)
          updateFields.title = sanitizeField('itemTitle', fields.title).trim();
        if (fields.username !== undefined)
          updateFields.username = sanitizeField('username', fields.username);
        if (fields.password !== undefined) {
          updateFields.passwordEncrypted = fields.password
            ? (encryptString(fields.password, key) as unknown as ArrayBuffer)
            : null;
        }
        if (fields.url !== undefined) updateFields.url = sanitizeField('url', fields.url);
        if (fields.notes !== undefined) {
          updateFields.notesEncrypted = fields.notes
            ? (encryptString(fields.notes, key) as unknown as ArrayBuffer)
            : null;
        }

        if (
          updateFields.title !== undefined &&
          updateFields.title.length > MAX_FIELD_LENGTHS.ITEM_TITLE
        ) {
          return {
            success: false,
            error: `Item title must be ${MAX_FIELD_LENGTHS.ITEM_TITLE} characters or less.`,
          };
        }
        if (updateFields.title !== undefined) {
          if (updateFields.title.length === 0) {
            return { success: false, error: 'Item title is required.' };
          }
          const titleCharError = validateCharacters('itemTitle', updateFields.title);
          if (titleCharError) {
            return { success: false, error: 'Item title contains invalid characters.' };
          }
        }
        if (
          updateFields.username !== undefined &&
          updateFields.username.length > MAX_FIELD_LENGTHS.USERNAME
        ) {
          return {
            success: false,
            error: `Username must be ${MAX_FIELD_LENGTHS.USERNAME} characters or less.`,
          };
        }
        if (updateFields.username !== undefined) {
          const usernameCharError = validateCharacters('username', updateFields.username);
          if (usernameCharError) {
            return { success: false, error: 'Username contains invalid characters.' };
          }
        }
        if (fields.password && fields.password.length > MAX_FIELD_LENGTHS.PASSWORD) {
          return {
            success: false,
            error: `Password must be ${MAX_FIELD_LENGTHS.PASSWORD} characters or less.`,
          };
        }
        if (fields.password) {
          const passwordCharError = validateCharacters('password', fields.password);
          if (passwordCharError) {
            return { success: false, error: 'Password contains invalid characters.' };
          }
        }
        if (updateFields.url !== undefined && updateFields.url.length > MAX_FIELD_LENGTHS.URL) {
          return {
            success: false,
            error: `URL must be ${MAX_FIELD_LENGTHS.URL} characters or less.`,
          };
        }
        if (updateFields.url !== undefined) {
          const urlCharError = validateCharacters('url', updateFields.url);
          if (urlCharError) {
            return { success: false, error: 'URL contains invalid characters.' };
          }
        }
        if (fields.notes && fields.notes.length > MAX_FIELD_LENGTHS.NOTES) {
          return {
            success: false,
            error: `Notes must be ${MAX_FIELD_LENGTHS.NOTES} characters or less.`,
          };
        }
        if (fields.notes) {
          const notesCharError = validateCharacters('notes', fields.notes);
          if (notesCharError) {
            return { success: false, error: 'Notes contain invalid characters.' };
          }
        }

        if (fields.otpConfig !== undefined && fields.otpConfig !== null) {
          const { sanitized, error } = sanitizeTotpConfig(fields.otpConfig);
          if (error) {
            return { success: false, error: 'Invalid OTP configuration: ' + error };
          }
          updateFields.otpSecretEncrypted = encryptString(sanitized.secret, key) as unknown as ArrayBuffer;
          updateFields.otpPeriod = sanitized.period;
          updateFields.otpDigits = sanitized.digits;
          updateFields.otpAlgorithm = sanitized.algorithm;
        } else if (fields.otpConfig === null) {
          updateFields.otpSecretEncrypted = null;
        }

        if (updateFields.title !== undefined && updateFields.title !== existing.title) {
          const titleDuplicateExists = itemRepo.existsByFolderIdAndTitle(
            existing.folderId,
            updateFields.title,
            id,
          );
          if (titleDuplicateExists) {
            return {
              success: false,
              error: 'An item with this title already exists in this folder.',
            };
          }
        }

        if (fields.emoji !== undefined) updateFields.emoji = fields.emoji;
        if (fields.coverImage !== undefined) updateFields.coverImage = fields.coverImage;
        if (fields.isFavorite !== undefined) updateFields.isFavorite = fields.isFavorite;
        if (fields.sortOrder !== undefined) updateFields.sortOrder = fields.sortOrder;

        const item = itemRepo.update(id, updateFields);
        if (!item) {
          return { success: false, error: 'Failed to update item.' };
        }

        // SECURITY: Wipe encrypted buffers after they've been persisted to DB
        if (updateFields.passwordEncrypted !== undefined) {
          secureClear(updateFields.passwordEncrypted as unknown as Buffer);
        }
        if (updateFields.notesEncrypted !== undefined) {
          secureClear(updateFields.notesEncrypted as unknown as Buffer);
        }
        if (updateFields.otpSecretEncrypted !== undefined) {
          secureClear(updateFields.otpSecretEncrypted as unknown as Buffer);
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
      // SECURITY: Wipe encrypted buffer after storing in trash
      secureClear(encrypted as Buffer);

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

      const encryptedBuf = Buffer.from(entry.dataEncrypted);
      const decrypted = decryptString(encryptedBuf, key);
      // SECURITY: Wipe sensitive material before leaving scope
      secureClear(encryptedBuf);

      const itemData = deserializeItemFromTrash(decrypted);
      // SECURITY: Wipe immutable string reference — V8 strings cannot be
      // zeroed in place, but we drop the reference to allow GC collection.
      secureClearString(decrypted);

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
        `INSERT INTO items (id, folder_id, title, username, password_encrypted, url, notes_encrypted, emoji, cover_image, created_at, updated_at, is_favorite, sort_order, otp_secret, otp_period, otp_digits, otp_algorithm)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
          itemData.otpSecretEncrypted ?? null,
          itemData.otpPeriod ?? OTP_DEFAULTS.PERIOD,
          itemData.otpDigits ?? OTP_DEFAULTS.DIGITS,
          itemData.otpAlgorithm ?? OTP_DEFAULTS.ALGORITHM,
        ],
      );

      // SECURITY: Wipe deserialized encrypted buffers after DB insert
      secureClear(itemData.passwordEncrypted);
      secureClear(itemData.notesEncrypted);
      secureClear(itemData.otpSecretEncrypted);

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
      const key = getMasterKey();
      if (!key) {
        return { success: false, error: 'No master key available. Unlock first.' };
      }
      const data = itemRepo.getAll();
      const itemsWithTags = data.map((item) => {
        decryptOtpForItem(item, key);
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
