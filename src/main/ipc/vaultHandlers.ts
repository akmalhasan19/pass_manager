import { ipcMain, dialog, BrowserWindow, shell } from 'electron';
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, extname, isAbsolute } from 'node:path';
import { IPC_CHANNELS } from '../../shared/ipcChannels';
import type { VaultRegistryEntry, VaultBackupFile, VaultRestoreResult } from '../../shared/types';
import {
  VaultRegistryError,
  VAULT_BACKUP_MAGIC,
  VAULT_BACKUP_FORMAT_VERSION,
  VAULT_BACKUP_FILE_EXTENSION,
} from '../../shared/types';
import { containsPathTraversal } from '../../shared/fileSecurity';
import {
  getVaultById,
  updateVault,
  recoverRegistryFromDisk,
  commitRecovery,
  checkAllVaultFiles,
  removeMissingVaults,
  invalidateRegistryCache,
} from '../file-system/vaultRegistry';
import {
  createVaultMetadata,
  listVaultMetadata,
  renameVaultMetadata,
  deleteVaultMetadata,
} from '../file-system/storageManager';
import { readVaultAuthMetadata, writeVaultAuthMetadata, vaultAuthFileExists } from '../file-system/vaultAuthStorage';
import {
  generateSalt,
  deriveMasterKey,
  hashKeyForVerification,
  DEFAULT_PBKDF2_ITERATIONS,
} from '../crypto/keyDerivation';
import { migrateVaultDatabase } from '../database/migrations';
import { initializeSqlJs, isDatabaseOpen, openDatabaseForVault, closeDatabase } from '../database/connection';
import {
  lockCurrentVault,
  unlockVault,
  getActiveAuthVaultId,
} from './authHandlers';
import { recordVaultOpened } from '../file-system/vaultRegistry';
import { APP_VERSION } from '../../shared/constants';
import { logger } from '../../shared/logger';

function requireVaultId(vaultId: unknown): string {
  if (typeof vaultId !== 'string' || vaultId.trim().length === 0) {
    throw new VaultRegistryError('Vault ID is required', 'INVALID_VAULT_ID');
  }
  return vaultId;
}

function serializeVaultEntry(entry: VaultRegistryEntry): VaultRegistryEntry {
  return { ...entry };
}

export function registerVaultHandlers(): void {
  /**
   * Lists all known vaults from the registry.
   * Does not require an unlocked vault.
   */
  ipcMain.handle(IPC_CHANNELS.VAULT_LIST, () => {
    try {
      const vaults = listVaultMetadata();
      return { success: true, data: vaults.map(serializeVaultEntry) };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error listing vaults',
      };
    }
  });

  /**
   * Creates a new vault in the registry.
   * The new vault is NOT automatically unlocked — the caller must
   * call selectVault or unlock with a password to set up auth.
   *
   * Returns the created vault entry.
   */
  ipcMain.handle(
    IPC_CHANNELS.VAULT_CREATE,
    async (
      _event,
      {
        name,
        masterPassword,
        description,
        color,
        icon,
        isDefault,
        customDatabasePath,
      }: {
        name: string;
        masterPassword: string;
        description?: string | null;
        color?: string | null;
        icon?: string | null;
        isDefault?: boolean;
        customDatabasePath?: string;
      },
    ) => {
      try {
        if (!name || typeof name !== 'string') {
          return { success: false, error: 'Vault name is required.' };
        }

        if (!masterPassword || typeof masterPassword !== 'string') {
          return { success: false, error: 'Master password is required for new vault.' };
        }

        // Create vault entry in registry
        const vault = createVaultMetadata({
          name,
          description: description ?? null,
          color: color ?? null,
          icon: icon ?? null,
          isDefault: isDefault ?? false,
          customDatabasePath,
        });

        try {
          // Initialize SQL.js and run schema/migrations on the new vault DB
          await initializeSqlJs();
          migrateVaultDatabase(vault.id);

          // Set up auth for the new vault by deriving a key from the provided
          // password and writing per-vault auth metadata. Then unlock the vault.
          const salt = generateSalt();
          const key = deriveMasterKey(masterPassword, salt, {
            algorithm: 'pbkdf2',
            iterations: DEFAULT_PBKDF2_ITERATIONS,
          });

          const authMetadata = {
            salt,
            kdfAlgorithm: 'pbkdf2' as const,
            kdfIterations: DEFAULT_PBKDF2_ITERATIONS,
            kdfMemory: null as number | null,
            kdfParallelism: null as number | null,
            verificationHash: hashKeyForVerification(key),
            createdAt: Date.now(),
          };

          writeVaultAuthMetadata(vault.id, authMetadata);

          const unlockResult = await unlockVault(vault.id, masterPassword);
          if (!unlockResult.success) {
            // Clean up the vault entry if auth setup fails
            try {
              deleteVaultMetadata(vault.id, {
                deleteDatabaseFile: true,
                deleteAttachments: true,
              });
            } catch {
              // Best-effort cleanup
            }
            return {
              success: false,
              error: `Vault created but auth setup failed: ${unlockResult.error}`,
            };
          }

          logger.info('Vault created and unlocked', { vaultId: vault.id, name: vault.name });

          return { success: true, data: serializeVaultEntry(vault) };
        } catch (innerError) {
          // Clean up vault entry on failure
          try {
            deleteVaultMetadata(vault.id, {
              deleteDatabaseFile: true,
              deleteAttachments: true,
            });
          } catch {
            // Best-effort cleanup
          }
          throw innerError;
        }
      } catch (error) {
        const msg =
          error instanceof VaultRegistryError
            ? error.message
            : error instanceof Error
              ? error.message
              : 'Unknown error creating vault';
        return { success: false, error: msg };
      }
    },
  );

  /**
   * Switches to a different vault.
   *
   * Flow:
   * 1. If there is a currently active vault, lock it first (save DB, wipe keys).
   * 2. Unlock the target vault with the provided password.
   * 3. Return success/failure.
   *
   * The target vault must have been created (auth metadata must exist).
   */
  ipcMain.handle(
    IPC_CHANNELS.VAULT_SELECT,
    async (
      _event,
      { vaultId, masterPassword }: { vaultId: string; masterPassword: string },
    ) => {
      try {
        const targetVaultId = requireVaultId(vaultId);

        if (!masterPassword || typeof masterPassword !== 'string') {
          return { success: false, error: 'Master password is required to unlock the vault.' };
        }

        // Verify the target vault exists in the registry
        const targetVault = getVaultById(targetVaultId);
        if (!targetVault) {
          return {
            success: false,
            error: `Vault not found: ${targetVaultId}`,
          };
        }

        // If the target vault is already active, no-op
        const currentActiveId = getActiveAuthVaultId();
        if (currentActiveId === targetVaultId && isDatabaseOpen()) {
          return { success: true, vaultId: targetVaultId };
        }

        // Lock the currently active vault (if any)
        if (currentActiveId) {
          lockCurrentVault();
        }

        // Unlock the target vault
        const unlockResult = await unlockVault(targetVaultId, masterPassword);
        if (!unlockResult.success) {
          return unlockResult;
        }

        // Record that this vault was just opened
        try {
          recordVaultOpened(targetVaultId, APP_VERSION);
        } catch {
          // Non-fatal: recording open time is best-effort
        }

        logger.info('Vault selected', { vaultId: targetVaultId });

        return { success: true, vaultId: targetVaultId };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error selecting vault',
        };
      }
    },
  );

  /**
   * Renames a vault in the registry.
   * Does not affect the database file or auth metadata.
   */
  ipcMain.handle(
    IPC_CHANNELS.VAULT_RENAME,
    (_event, { vaultId, name }: { vaultId: string; name: string }) => {
      try {
        const targetVaultId = requireVaultId(vaultId);

        if (!name || typeof name !== 'string') {
          return { success: false, error: 'Vault name is required.' };
        }

        const updated = renameVaultMetadata(targetVaultId, name);
        logger.info('Vault renamed', { vaultId: targetVaultId, newName: name });

        return { success: true, data: serializeVaultEntry(updated) };
      } catch (error) {
        const msg =
          error instanceof VaultRegistryError
            ? error.message
            : error instanceof Error
              ? error.message
              : 'Unknown error renaming vault';
        return { success: false, error: msg };
      }
    },
  );

  /**
   * Deletes a vault from the registry and optionally removes its
   * database file and attachments.
   *
   * SECURITY: If the vault being deleted is currently active, it is
   * locked first (wiping key material from memory).
   */
  ipcMain.handle(
    IPC_CHANNELS.VAULT_DELETE,
    (
      _event,
      {
        vaultId,
        deleteDatabaseFile = true,
        deleteAttachments = true,
      }: {
        vaultId: string;
        deleteDatabaseFile?: boolean;
        deleteAttachments?: boolean;
      },
    ) => {
      try {
        const targetVaultId = requireVaultId(vaultId);

        // If the vault being deleted is currently active, lock it first
        const currentActiveId = getActiveAuthVaultId();
        if (currentActiveId === targetVaultId) {
          lockCurrentVault();
        }

        const removed = deleteVaultMetadata(targetVaultId, {
          deleteDatabaseFile,
          deleteAttachments,
        });

        logger.info('Vault deleted', {
          vaultId: targetVaultId,
          name: removed.name,
          deleteDatabaseFile,
          deleteAttachments,
        });

        return { success: true, data: serializeVaultEntry(removed) };
      } catch (error) {
        const msg =
          error instanceof VaultRegistryError
            ? error.message
            : error instanceof Error
              ? error.message
              : 'Unknown error deleting vault';
        return { success: false, error: msg };
      }
    },
  );

  /**
   * Sets a vault as the default vault in the registry.
   */
  ipcMain.handle(
    IPC_CHANNELS.VAULT_SET_DEFAULT,
    (_event, { vaultId }: { vaultId: string }) => {
      try {
        const targetVaultId = requireVaultId(vaultId);

        const vault = getVaultById(targetVaultId);
        if (!vault) {
          return { success: false, error: `Vault not found: ${targetVaultId}` };
        }

        const updated = updateVault(targetVaultId, { isDefault: true });
        logger.info('Vault set as default', { vaultId: targetVaultId });

        return { success: true, data: serializeVaultEntry(updated) };
      } catch (error) {
        const msg =
          error instanceof VaultRegistryError
            ? error.message
            : error instanceof Error
              ? error.message
              : 'Unknown error setting default vault';
        return { success: false, error: msg };
      }
    },
  );

  /**
   * Reveals the vault database file location in the system file manager.
   */
  ipcMain.handle(
    IPC_CHANNELS.VAULT_REVEAL_LOCATION,
    (_event, { vaultId }: { vaultId: string }) => {
      try {
        const targetVaultId = requireVaultId(vaultId);

        const vault = getVaultById(targetVaultId);
        if (!vault) {
          return { success: false, error: `Vault not found: ${targetVaultId}` };
        }

        // Show the file in the system file manager
        shell.showItemInFolder(vault.databasePath);

        logger.info('Vault location revealed', { vaultId: targetVaultId });

        return { success: true };
      } catch (error) {
        const msg =
          error instanceof VaultRegistryError
            ? error.message
            : error instanceof Error
              ? error.message
              : 'Unknown error revealing vault location';
        return { success: false, error: msg };
      }
    },
  );

  /**
   * Returns information about the currently active (unlocked) vault.
   * Returns null vaultId if no vault is currently unlocked.
   */
  ipcMain.handle(IPC_CHANNELS.VAULT_GET_ACTIVE, () => {
    try {
      const activeId = getActiveAuthVaultId();

      if (!activeId) {
        return { success: true, data: { vaultId: null, vault: null } };
      }

      const vault = getVaultById(activeId);
      return {
        success: true,
        data: {
          vaultId: activeId,
          vault: vault ? serializeVaultEntry(vault) : null,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error getting active vault',
      };
    }
  });

  /**
   * Opens a file dialog for the user to select an existing vault database file (.db).
   * Returns the selected file path or null if cancelled.
   */
  ipcMain.handle(
    IPC_CHANNELS.VAULT_IMPORT_FILE_DIALOG,
    async (): Promise<{ success: boolean; data?: { filePath: string; fileName: string }; error?: string }> => {
      try {
        const win = BrowserWindow.getFocusedWindow();
        if (!win) {
          return { success: false, error: 'No active window.' };
        }

        const result = await dialog.showOpenDialog(win, {
          properties: ['openFile'],
          filters: [
            { name: 'Vault Database', extensions: ['db', 'sqlite', 'sqlite3'] },
            { name: 'All Files', extensions: ['*'] },
          ],
        });

        if (result.canceled || result.filePaths.length === 0) {
          return { success: false, error: 'Dialog cancelled.' };
        }

        const filePath = result.filePaths[0];
        const fileName = basename(filePath);

        return {
          success: true,
          data: { filePath, fileName },
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error opening file dialog',
        };
      }
    },
  );

  /**
   * Imports an existing vault database file by copying it into the managed
   * vaults directory and registering it in the vault registry.
   *
   * SECURITY: The file is copied (not moved) to the managed directory.
   * The original file is not modified. The copied file must be a valid
   * SQLite database that was previously created by SecurePass Manager.
   *
   * The vault is NOT unlocked after import — the user must provide the
   * correct master password to unlock it.
   */
  ipcMain.handle(
    IPC_CHANNELS.VAULT_IMPORT,
    async (
      _event,
      { filePath, name }: { filePath: string; name: string },
    ): Promise<{ success: boolean; data?: VaultRegistryEntry; error?: string }> => {
      try {
        if (!filePath || typeof filePath !== 'string') {
          return { success: false, error: 'File path is required.' };
        }

        if (!name || typeof name !== 'string') {
          return { success: false, error: 'Vault name is required.' };
        }

        // SECURITY: Reject non-absolute or traversal-containing paths first. This
        // prevents an attacker from using relative paths or '..' sequences to import
        // arbitrary files from outside the user's chosen import location.
        if (!isAbsolute(filePath)) {
          return { success: false, error: 'File path must be absolute.' };
        }
        if (containsPathTraversal(filePath)) {
          return { success: false, error: 'File path contains invalid traversal sequences.' };
        }

        // SECURITY: Validate that the file exists and has a valid extension
        if (!existsSync(filePath)) {
          return { success: false, error: 'Selected file does not exist.' };
        }

        const lowerExt = extname(filePath).toLowerCase();
        if (!['.db', '.sqlite', '.sqlite3'].includes(lowerExt)) {
          return { success: false, error: 'Invalid file type. Expected a database file (.db, .sqlite, .sqlite3).' };
        }

        // SECURITY: Validate the vault name
        const sanitizedName = name.trim();
        if (sanitizedName.length === 0 || sanitizedName.length > 100) {
          return { success: false, error: 'Vault name must be between 1 and 100 characters.' };
        }

        // SECURITY: Resolve the target path within the managed vaults directory
        // to prevent path traversal attacks.
        const vault = createVaultMetadata({
          name: sanitizedName,
          customDatabasePath: undefined,
        });

        // Copy the database file to the resolved vault path
        try {
          copyFileSync(filePath, vault.databasePath);
        } catch (copyError) {
          // Clean up the registry entry if copy fails
          try {
            deleteVaultMetadata(vault.id, {
              deleteDatabaseFile: true,
              deleteAttachments: false,
            });
          } catch {
            // Best-effort cleanup
          }
          return {
            success: false,
            error: `Failed to copy database file: ${copyError instanceof Error ? copyError.message : String(copyError)}`,
          };
        }

        logger.info('Vault imported', { vaultId: vault.id, name: sanitizedName });

        return { success: true, data: serializeVaultEntry(vault) };
      } catch (error) {
        const msg =
          error instanceof VaultRegistryError
            ? error.message
            : error instanceof Error
              ? error.message
              : 'Unknown error importing vault';
        return { success: false, error: msg };
      }
    },
  );

  /**
   * Opens a save dialog for the user to choose where to save a vault backup file.
   * Returns the selected file path or null if cancelled.
   */
  ipcMain.handle(
    IPC_CHANNELS.VAULT_BACKUP_FILE_DIALOG,
    async (
      _event,
      { vaultId }: { vaultId: string },
    ): Promise<{ success: boolean; data?: { filePath: string }; error?: string }> => {
      try {
        const targetVaultId = requireVaultId(vaultId);
        const vault = getVaultById(targetVaultId);
        if (!vault) {
          return { success: false, error: `Vault not found: ${targetVaultId}` };
        }

        const win = BrowserWindow.getFocusedWindow();
        if (!win) {
          return { success: false, error: 'No active window.' };
        }

        const safeName = vault.name.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 50);
        const defaultFileName = `securepass-vault-backup-${safeName}-${new Date().toISOString().slice(0, 10)}${VAULT_BACKUP_FILE_EXTENSION}`;

        const result = await dialog.showSaveDialog(win, {
          defaultPath: defaultFileName,
          filters: [
            { name: 'SecurePass Vault Backup', extensions: ['spmv'] },
            { name: 'All Files', extensions: ['*'] },
          ],
          title: 'Save Vault Backup',
        });

        if (result.canceled || !result.filePath) {
          return { success: false, error: 'Dialog cancelled.' };
        }

        return { success: true, data: { filePath: result.filePath } };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error opening save dialog',
        };
      }
    },
  );

  /**
   * Creates an encrypted backup of a vault file without decrypting its contents.
   *
   * The backup bundles:
   * - The raw database file (encrypted at rest, copied as-is)
   * - The per-vault auth metadata (salt, KDF params, verification hash)
   *
   * The resulting .spmv file is a JSON file that can be restored later.
   * The database contents are NOT decrypted during this process.
   */
  ipcMain.handle(
    IPC_CHANNELS.VAULT_BACKUP,
    async (
      _event,
      { vaultId, filePath }: { vaultId: string; filePath: string },
    ): Promise<{ success: boolean; error?: string }> => {
      try {
        const targetVaultId = requireVaultId(vaultId);

        if (!filePath || typeof filePath !== 'string') {
          return { success: false, error: 'File path is required.' };
        }

        const vault = getVaultById(targetVaultId);
        if (!vault) {
          return { success: false, error: `Vault not found: ${targetVaultId}` };
        }

        // If the vault being backed up is currently active, save the database first
        const currentActiveId = getActiveAuthVaultId();
        if (currentActiveId === targetVaultId && isDatabaseOpen()) {
          // The database is in memory — save it to disk before backing up
          const { saveDatabase } = await import('../database/connection');
          saveDatabase();
        }

        // Read the database file (encrypted at rest)
        if (!existsSync(vault.databasePath)) {
          return { success: false, error: 'Vault database file not found on disk.' };
        }

        const dbBuffer = readFileSync(vault.databasePath);
        const databaseBase64 = dbBuffer.toString('base64');

        // Read auth metadata
        if (!vaultAuthFileExists(targetVaultId)) {
          return { success: false, error: 'Vault auth metadata not found. Cannot create a complete backup.' };
        }

        const authMetadata = readVaultAuthMetadata(targetVaultId);

        // Build the backup file
        const backupFile: VaultBackupFile = {
          magic: VAULT_BACKUP_MAGIC,
          formatVersion: VAULT_BACKUP_FORMAT_VERSION,
          vaultName: vault.name,
          databaseBase64,
          authMetadata: {
            salt: authMetadata.salt.toString('base64'),
            kdfAlgorithm: authMetadata.kdfAlgorithm,
            kdfIterations: authMetadata.kdfIterations,
            kdfMemory: authMetadata.kdfMemory,
            kdfParallelism: authMetadata.kdfParallelism,
            verificationHash: authMetadata.verificationHash,
            createdAt: authMetadata.createdAt,
          },
          backupCreatedAt: Date.now(),
        };

        // Write the backup file
        writeFileSync(filePath, JSON.stringify(backupFile, null, 2), 'utf-8');

        logger.info('Vault backup created', {
          vaultId: targetVaultId,
          name: vault.name,
          filePath,
        });

        return { success: true };
      } catch (error) {
        const msg =
          error instanceof VaultRegistryError
            ? error.message
            : error instanceof Error
              ? error.message
              : 'Unknown error creating vault backup';
        return { success: false, error: msg };
      }
    },
  );

  /**
   * Opens a file dialog for the user to select a vault backup file (.spmv).
   * Returns the file path and parsed content, or null if cancelled.
   */
  ipcMain.handle(
    IPC_CHANNELS.VAULT_RESTORE_FILE_DIALOG,
    async (): Promise<{
      success: boolean;
      data?: { filePath: string; vaultName: string };
      error?: string;
    }> => {
      try {
        const win = BrowserWindow.getFocusedWindow();
        if (!win) {
          return { success: false, error: 'No active window.' };
        }

        const result = await dialog.showOpenDialog(win, {
          properties: ['openFile'],
          filters: [
            { name: 'SecurePass Vault Backup', extensions: ['spmv'] },
            { name: 'All Files', extensions: ['*'] },
          ],
          title: 'Select Vault Backup File',
        });

        if (result.canceled || result.filePaths.length === 0) {
          return { success: false, error: 'Dialog cancelled.' };
        }

        const filePath = result.filePaths[0];

        // Read and validate the backup file
        const fileContent = readFileSync(filePath, 'utf-8');
        let backupFile: VaultBackupFile;
        try {
          backupFile = JSON.parse(fileContent);
        } catch {
          return { success: false, error: 'Invalid backup file: not valid JSON.' };
        }

        if (backupFile.magic !== VAULT_BACKUP_MAGIC) {
          return {
            success: false,
            error: `Invalid backup file: expected magic "${VAULT_BACKUP_MAGIC}", got "${backupFile.magic ?? 'undefined'}".`,
          };
        }

        if (backupFile.formatVersion !== VAULT_BACKUP_FORMAT_VERSION) {
          return {
            success: false,
            error: `Unsupported backup format version: ${backupFile.formatVersion}. Expected ${VAULT_BACKUP_FORMAT_VERSION}.`,
          };
        }

        if (!backupFile.vaultName || typeof backupFile.vaultName !== 'string') {
          return { success: false, error: 'Invalid backup file: missing vault name.' };
        }

        if (!backupFile.databaseBase64 || typeof backupFile.databaseBase64 !== 'string') {
          return { success: false, error: 'Invalid backup file: missing database data.' };
        }

        if (!backupFile.authMetadata) {
          return { success: false, error: 'Invalid backup file: missing auth metadata.' };
        }

        return {
          success: true,
          data: { filePath, vaultName: backupFile.vaultName },
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error opening file dialog',
        };
      }
    },
  );

  /**
   * Restores a vault from a backup file.
   *
   * Validation:
   * - Validates the backup file format (magic, version, required fields)
   * - Validates the database file is a valid SQLite database
   * - Validates auth metadata has required fields
   *
   * Name conflict handling:
   * - If a vault with the same name exists, the caller can provide a new name
   * - The caller is responsible for checking name conflicts before calling this
   *
   * The restored vault is NOT automatically unlocked — the user must
   * provide the correct master password to unlock it.
   */
  ipcMain.handle(
    IPC_CHANNELS.VAULT_RESTORE,
    async (
      _event,
      { filePath, name }: { filePath: string; name: string },
    ): Promise<{ success: boolean; data?: VaultRestoreResult; error?: string }> => {
      try {
        if (!filePath || typeof filePath !== 'string') {
          return { success: false, error: 'File path is required.' };
        }

        if (!name || typeof name !== 'string') {
          return { success: false, error: 'Vault name is required.' };
        }

        const sanitizedName = name.trim();
        if (sanitizedName.length === 0 || sanitizedName.length > 100) {
          return { success: false, error: 'Vault name must be between 1 and 100 characters.' };
        }

        // Read and parse the backup file
        if (!existsSync(filePath)) {
          return { success: false, error: 'Backup file not found.' };
        }

        const fileContent = readFileSync(filePath, 'utf-8');
        let backupFile: VaultBackupFile;
        try {
          backupFile = JSON.parse(fileContent);
        } catch {
          return { success: false, error: 'Invalid backup file: not valid JSON.' };
        }

        // Validate magic and version
        if (backupFile.magic !== VAULT_BACKUP_MAGIC) {
          return {
            success: false,
            error: `Invalid backup file: expected magic "${VAULT_BACKUP_MAGIC}", got "${backupFile.magic ?? 'undefined'}".`,
          };
        }

        if (backupFile.formatVersion !== VAULT_BACKUP_FORMAT_VERSION) {
          return {
            success: false,
            error: `Unsupported backup format version: ${backupFile.formatVersion}. Expected ${VAULT_BACKUP_FORMAT_VERSION}.`,
          };
        }

        // Validate required fields
        if (!backupFile.databaseBase64 || typeof backupFile.databaseBase64 !== 'string') {
          return { success: false, error: 'Invalid backup file: missing database data.' };
        }

        if (!backupFile.authMetadata) {
          return { success: false, error: 'Invalid backup file: missing auth metadata.' }
        }

        const authMeta = backupFile.authMetadata;
        if (
          !authMeta.salt ||
          !authMeta.verificationHash ||
          !authMeta.kdfAlgorithm
        ) {
          return {
            success: false,
            error: 'Invalid backup file: auth metadata is incomplete (missing salt, verification hash, or KDF algorithm).',
          };
        }

        // Decode and validate the database
        let dbBuffer: Buffer;
        try {
          dbBuffer = Buffer.from(backupFile.databaseBase64, 'base64');
        } catch {
          return { success: false, error: 'Invalid backup file: database data is corrupted.' };
        }

        if (dbBuffer.length === 0) {
          return { success: false, error: 'Invalid backup file: database is empty.' };
        }

        // Validate the database is a valid SQLite file (magic header: "SQLite format 3\0")
        const sqliteMagic = Buffer.from('SQLite format 3\0');
        if (dbBuffer.length < sqliteMagic.length || !dbBuffer.subarray(0, sqliteMagic.length).equals(sqliteMagic)) {
          return {
            success: false,
            error: 'Invalid backup file: the database is not a valid SQLite file. It may be corrupted.',
          };
        }

        // Create a new vault entry in the registry
        const vault = createVaultMetadata({
          name: sanitizedName,
          customDatabasePath: undefined,
        });

        try {
          // Write the database file from the backup
          writeFileSync(vault.databasePath, dbBuffer);

          // Validate the restored database by opening it
          try {
            await initializeSqlJs();
            openDatabaseForVault(vault.id);
            // If we get here, the database opened successfully
            closeDatabase();
          } catch (dbError) {
            // Database failed to open — clean up
            try {
              deleteVaultMetadata(vault.id, {
                deleteDatabaseFile: true,
                deleteAttachments: false,
              });
            } catch {
              // Best-effort cleanup
            }
            return {
              success: false,
              error: `Restored database is corrupted or incompatible: ${dbError instanceof Error ? dbError.message : String(dbError)}`,
            };
          }

          // Write auth metadata
          const authMetadata = {
            salt: Buffer.from(authMeta.salt, 'base64'),
            kdfAlgorithm: authMeta.kdfAlgorithm as 'pbkdf2' | 'argon2id',
            kdfIterations: authMeta.kdfIterations,
            kdfMemory: authMeta.kdfMemory ?? null,
            kdfParallelism: authMeta.kdfParallelism ?? null,
            verificationHash: authMeta.verificationHash,
            createdAt: authMeta.createdAt ?? Date.now(),
          };
          writeVaultAuthMetadata(vault.id, authMetadata);

          logger.info('Vault restored from backup', {
            vaultId: vault.id,
            name: sanitizedName,
            backupVaultName: backupFile.vaultName,
          });

          return {
            success: true,
            data: { vaultId: vault.id, vaultName: sanitizedName },
          };
        } catch (innerError) {
          // Clean up vault entry on failure
          try {
            deleteVaultMetadata(vault.id, {
              deleteDatabaseFile: true,
              deleteAttachments: false,
            });
          } catch {
            // Best-effort cleanup
          }
          throw innerError;
        }
      } catch (error) {
        const msg =
          error instanceof VaultRegistryError
            ? error.message
            : error instanceof Error
              ? error.message
              : 'Unknown error restoring vault from backup';
        return { success: false, error: msg };
      }
    },
  );

  /**
   * Recovers the vault registry from disk by scanning the managed vaults
   * directory and vault-auth directory. This is used when the registry
   * file is corrupted or lost, but vault database files still exist.
   *
   * Returns the recovered vault entries for the caller to review before
   * committing (via vault:recover).
   */
  ipcMain.handle(IPC_CHANNELS.VAULT_RECOVER, () => {
    try {
      const recovered = recoverRegistryFromDisk();
      return { success: true, data: recovered };
    } catch (error) {
      logger.error('Registry recovery scan failed', {
        cause: error instanceof Error ? error.message : String(error),
      });
      return {
        success: false,
        error: 'Failed to scan for recoverable vaults. The vaults directory may be inaccessible.',
      };
    }
  });

  /**
   * Checks the file status of all vaults in the registry.
   * Returns each vault with a status: 'ok', 'missing', 'corrupted', or 'auth_missing'.
   *
   * This is used by the UI to display warning indicators next to vaults
   * whose database files are no longer accessible.
   */
  ipcMain.handle(IPC_CHANNELS.VAULT_CHECK_FILES, () => {
    try {
      const vaultStatuses = checkAllVaultFiles();
      return { success: true, data: vaultStatuses };
    } catch (error) {
      logger.error('Vault file check failed', {
        cause: error instanceof Error ? error.message : String(error),
      });
      return {
        success: false,
        error: 'Failed to check vault file statuses.',
      };
    }
  });

  /**
   * Removes all vaults with missing database files from the registry.
   * This is a bulk cleanup operation for when vault files have been
   * lost (e.g., disk failure, manual deletion).
   *
   * Returns the list of removed vault entries.
   * Creates a registry backup before making changes for safety.
   */
  ipcMain.handle(IPC_CHANNELS.VAULT_REMOVE_MISSING, () => {
    try {
      const removed = removeMissingVaults();
      return { success: true, data: removed };
    } catch (error) {
      logger.error('Failed to remove missing vaults', {
        cause: error instanceof Error ? error.message : String(error),
      });
      return {
        success: false,
        error: 'Failed to remove missing vaults from the registry.',
      };
    }
  });
}
