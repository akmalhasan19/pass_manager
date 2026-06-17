import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../shared/ipcChannels';
import type { VaultRegistryEntry } from '../../shared/types';
import { VaultRegistryError } from '../../shared/types';
import { getVaultById } from '../file-system/vaultRegistry';
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
}
