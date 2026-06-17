import { ipcMain, dialog, BrowserWindow, shell } from 'electron';
import { copyFileSync, existsSync } from 'node:fs';
import { basename, extname } from 'node:path';
import { IPC_CHANNELS } from '../../shared/ipcChannels';
import type { VaultRegistryEntry } from '../../shared/types';
import { VaultRegistryError } from '../../shared/types';
import { getVaultById, updateVault } from '../file-system/vaultRegistry';
import {
  createVaultMetadata,
  listVaultMetadata,
  renameVaultMetadata,
  deleteVaultMetadata,
} from '../file-system/storageManager';
import { migrateVaultDatabase } from '../database/migrations';
import { initializeSqlJs, isDatabaseOpen } from '../database/connection';
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

          // Set up auth for the new vault by unlocking it with the provided password
          // This derives the key, writes auth metadata, and opens the DB
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
}
