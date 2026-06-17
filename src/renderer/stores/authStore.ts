import { create } from 'zustand';
import type { VaultRegistryEntry } from '../../shared/types';
import { useUIStore } from './uiStore';
import { useItemStore } from './itemStore';
import { useFolderStore } from './folderStore';
import { useToastStore } from './toastStore';
import { useErrorStore } from './errorStore';
import { useSettingsStore } from './settingsStore';
import { t } from '../i18n/useTranslation';

export type AuthStatus = 'idle' | 'checking' | 'setup' | 'locked' | 'unlocked' | 'error';

interface AuthState {
  status: AuthStatus;
  error: string | null;
  vaultError: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  activeVaultId: string | null;
  activeVaultName: string | null;
  selectedVaultId: string | null;
  vaults: VaultRegistryEntry[];
  isLoadingVaults: boolean;
  isCreatingVault: boolean;
  isSwitchingVault: boolean;
  isDeletingVault: boolean;
  checkAuth: () => Promise<void>;
  initApp: (password: string) => Promise<void>;
  unlock: (password: string) => Promise<void>;
  lock: () => Promise<void>;
  changePassword: (oldPassword: string, newPassword: string) => Promise<void>;
  selectVault: (vaultId: string, masterPassword: string) => Promise<void>;
  deleteVault: (vaultId: string, deleteDatabaseFile?: boolean, deleteAttachments?: boolean) => Promise<boolean>;
  clearError: () => void;
  clearVaultError: () => void;
  setSelectedVaultId: (vaultId: string | null) => void;
  loadVaults: () => Promise<void>;
  refreshActiveVaultName: () => void;
}

function deriveFlags(status: AuthStatus): { isAuthenticated: boolean; isLoading: boolean } {
  return {
    isAuthenticated: status === 'unlocked',
    isLoading: status === 'idle' || status === 'checking',
  };
}

/**
 * Resolve the display name for a vault from the vault list.
 */
function resolveVaultName(vaults: VaultRegistryEntry[], vaultId: string | null): string | null {
  if (!vaultId) return null;
  const vault = vaults.find((v) => v.id === vaultId);
  return vault?.name ?? null;
}

/**
 * Reset all renderer stores that hold vault-specific data.
 *
 * SECURITY: Must be called AFTER the old vault is locked (keys wiped) and
 * BEFORE the new vault is loaded. This prevents:
 * - Decrypted passwords from the old vault leaking into the new vault's UI
 * - Selected folder/item IDs from the old vault being used in the new vault
 * - Stale search results or cached data from the old vault
 *
 * Order matters:
 * 1. clearSensitiveData() overwrites plaintext passwords/notes before reset()
 * 2. Folder store reset clears selectedFolderId and expandedFolderIds
 * 3. UI store reset returns to home view and closes panels/search
 * 4. Settings store reset forces re-fetch for the new vault's preferences
 * 5. Toast/error stores cleared to avoid confusing stale notifications
 */
function resetAllVaultStores(): void {
  // SECURITY: Wipe decrypted passwords/notes first, then clear all item state
  useItemStore.getState().clearSensitiveData();
  useFolderStore.getState().reset();
  useUIStore.getState().reset();
  useSettingsStore.getState().reset();
  useToastStore.getState().clearToasts();
  useErrorStore.getState().clearAll();
}

export const useAuthStore = create<AuthState>((set, get) => ({
  status: 'idle',
  error: null,
  vaultError: null,
  activeVaultId: null,
  activeVaultName: null,
  selectedVaultId: null,
  vaults: [],
  isLoadingVaults: false,
  isCreatingVault: false,
  isSwitchingVault: false,
  isDeletingVault: false,
  ...deriveFlags('idle'),

  /**
   * Loads the vault list from the main process via IPC.
   * Tracks loading state and surfaces errors rather than silently swallowing them.
   */
  loadVaults: async () => {
    set({ isLoadingVaults: true, vaultError: null });
    try {
      if (!window.electron) {
        set({ isLoadingVaults: false });
        return;
      }
      const result = await window.electron.vaults.list();
      if (result.success) {
        set({ vaults: result.data, isLoadingVaults: false });
      } else {
        set({
          isLoadingVaults: false,
          vaultError: result.error || t('vault.error.loadFailed'),
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : t('vault.error.loadFailed');
      set({ isLoadingVaults: false, vaultError: message });
    }
  },

  /**
   * Refreshes the activeVaultName from the current vault list.
   * Call after loadVaults or after any vault rename/delete.
   */
  refreshActiveVaultName: () => {
    const { vaults, activeVaultId } = get();
    set({ activeVaultName: resolveVaultName(vaults, activeVaultId) });
  },

  setSelectedVaultId: (vaultId: string | null) => {
    set({ selectedVaultId: vaultId });
  },

  checkAuth: async () => {
    set({ status: 'checking', error: null, ...deriveFlags('checking') });
    try {
      const result = await window.electron.auth.check();

      // Load vault list for UI display (vault selector, migration handling)
      let vaults: VaultRegistryEntry[] = [];
      try {
        const listResult = await window.electron.vaults.list();
        if (listResult.success) {
          vaults = listResult.data;
        }
      } catch {
        // Non-critical: continue with empty vault list
      }

      if (result.initialized) {
        // App is initialized — determine active vault context
        const resolvedVaultId = result.vaultId ?? null;
        const resolvedVaultName = result.vaultName ?? resolveVaultName(vaults, resolvedVaultId);

        set({
          status: 'locked',
          activeVaultId: resolvedVaultId,
          activeVaultName: resolvedVaultName,
          selectedVaultId: resolvedVaultId,
          vaults,
          ...deriveFlags('locked'),
        });
      } else if (vaults.length > 0) {
        // App not initialized but vaults exist (edge case: auth file missing but registry intact)
        // Show locked screen with vault selector so user can attempt unlock or create new vault
        const defaultVault = vaults.find((v) => v.isDefault) ?? vaults[0];
        set({
          status: 'locked',
          activeVaultId: null,
          activeVaultName: null,
          selectedVaultId: defaultVault.id,
          vaults,
          ...deriveFlags('locked'),
        });
      } else {
        // No vaults exist — show setup flow
        set({
          status: 'setup',
          activeVaultId: null,
          activeVaultName: null,
          selectedVaultId: null,
          vaults,
          ...deriveFlags('setup'),
        });
      }
    } catch {
      // On error, fall back to setup (first-time user or corrupted state)
      const next: AuthStatus = 'setup';
      set({
        status: next,
        activeVaultId: null,
        activeVaultName: null,
        selectedVaultId: null,
        vaults: [],
        ...deriveFlags(next),
      });
    }
  },

  initApp: async (password: string) => {
    set({ status: 'checking', error: null, vaultError: null, isCreatingVault: true, ...deriveFlags('checking') });
    try {
      if (!window.electron) {
        throw new Error(t('auth.error.ipcUnavailable'));
      }
      const result = await window.electron.auth.init(password);
      if (!result.success) {
        set({
          status: 'setup',
          activeVaultId: null,
          activeVaultName: null,
          error: result.error || t('auth.error.failedInit'),
          isCreatingVault: false,
          ...deriveFlags('setup'),
        });
        return;
      }

      // After successful init, reload vault list to pick up the newly created default vault
      let vaults: VaultRegistryEntry[] = [];
      try {
        const listResult = await window.electron.vaults.list();
        if (listResult.success) {
          vaults = listResult.data;
        }
      } catch {
        // Non-critical
      }

      const newVaultId = result.vaultId ?? null;
      set({
        status: 'unlocked',
        activeVaultId: newVaultId,
        activeVaultName: resolveVaultName(vaults, newVaultId),
        selectedVaultId: newVaultId,
        vaults,
        error: null,
        vaultError: null,
        isCreatingVault: false,
        ...deriveFlags('unlocked'),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : t('auth.error.failedInit');
      set({
        status: 'setup',
        activeVaultId: null,
        activeVaultName: null,
        error: message,
        isCreatingVault: false,
        ...deriveFlags('setup'),
      });
    }
  },

  unlock: async (password: string) => {
    const { selectedVaultId, vaults } = get();
    set({ status: 'checking', error: null, ...deriveFlags('checking') });
    try {
      if (!window.electron) {
        throw new Error(t('auth.error.ipcUnavailable'));
      }
      // Pass selectedVaultId so the main process unlocks the correct vault.
      // If null, main process falls back to default vault or legacy migration.
      const result = await window.electron.auth.unlock(password, selectedVaultId ?? undefined);
      if (!result.success) {
        set({
          status: 'locked',
          activeVaultId: null,
          activeVaultName: null,
          error: result.error || t('auth.error.incorrectPassword'),
          ...deriveFlags('locked'),
        });
        return;
      }
      const unlockedVaultId = result.vaultId ?? selectedVaultId ?? null;
      set({
        status: 'unlocked',
        activeVaultId: unlockedVaultId,
        activeVaultName: resolveVaultName(vaults, unlockedVaultId),
        selectedVaultId: unlockedVaultId,
        error: null,
        ...deriveFlags('unlocked'),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : t('auth.error.failedUnlock');
      set({
        status: 'locked',
        activeVaultId: null,
        activeVaultName: null,
        error: message,
        ...deriveFlags('locked'),
      });
    }
  },

  lock: async () => {
    set({ status: 'checking', ...deriveFlags('checking') });
    try {
      if (window.electron) {
        await window.electron.auth.lock();
      }
    } catch {
      // Lock should always proceed even if IPC fails
    } finally {
      // SECURITY: Wipe all decrypted data from renderer stores before lock.
      resetAllVaultStores();
      // SECURITY: Remove all IPC listeners to prevent lingering references
      // that could hold sensitive data in closure scope after lock.
      try {
        window.electron?.auth?.cleanupListeners?.();
      } catch {
        // Cleanup should not block lock
      }
      set({
        status: 'locked',
        activeVaultId: null,
        activeVaultName: null,
        // Keep selectedVaultId so the lock screen knows which vault to unlock
        error: null,
        ...deriveFlags('locked'),
      });
    }
  },

  changePassword: async (oldPassword: string, newPassword: string) => {
    set({ error: null });
    try {
      if (!window.electron) {
        throw new Error(t('auth.error.ipcUnavailable'));
      }
      await window.electron.auth.changePassword(oldPassword, newPassword);
    } catch (err) {
      const message = err instanceof Error ? err.message : t('auth.error.failedChangePassword');
      set({ error: message });
      throw err;
    }
  },

  /**
   * Switches to a different vault with secure memory handling.
   *
   * SECURITY FLOW:
   * 1. Wipe all renderer-side sensitive data (items, folders, UI state, toasts, errors).
   * 2. Remove IPC listeners to prevent stale closures holding vault-specific data.
   * 3. Call main process VAULT_SELECT which locks the old vault (wipes keys, closes DB)
   *    and unlocks the target vault with the provided password.
   * 4. On success: transition to unlocked, show security toast confirming old vault was secured.
   * 5. On failure: transition to locked (no vault is open), surface error.
   */
  selectVault: async (vaultId: string, masterPassword: string) => {
    // Resolve vault name BEFORE clearing stores (resetAllVaultStores clears vault list)
    const { vaults } = get();
    const targetVaultName = resolveVaultName(vaults, vaultId) ?? vaultId;

    set({ status: 'checking', error: null, vaultError: null, isSwitchingVault: true, ...deriveFlags('checking') });

    // SECURITY: Wipe all renderer stores that hold vault-specific data.
    // This happens BEFORE the IPC call so that even if the switch fails,
    // decrypted passwords and cached items from the old vault are cleared.
    resetAllVaultStores();
    try {
      window.electron?.auth?.cleanupListeners?.();
    } catch {
      // Cleanup should not block vault switch
    }

    try {
      if (!window.electron) {
        throw new Error(t('auth.error.ipcUnavailable'));
      }

      const result = await window.electron.vaults.select(vaultId, masterPassword);

      if (!result.success) {
        // Vault switch failed — no vault is open, go to locked state
        const errorMsg = result.error || t('auth.error.failedUnlock');
        set({
          status: 'locked',
          activeVaultId: null,
          activeVaultName: null,
          selectedVaultId: vaultId,
          error: null,
          vaultError: t('vault.error.switchFailed', { vaultName: targetVaultName, error: errorMsg }),
          isSwitchingVault: false,
          ...deriveFlags('locked'),
        });
        return;
      }

      // Reload vault list to reflect any metadata changes (e.g. lastOpenedAt)
      let updatedVaults: VaultRegistryEntry[] = [];
      try {
        const listResult = await window.electron.vaults.list();
        if (listResult.success) {
          updatedVaults = listResult.data;
        }
      } catch {
        // Non-critical
      }

      // Vault switch succeeded — old vault was locked (keys wiped), new vault is unlocked
      set({
        status: 'unlocked',
        activeVaultId: vaultId,
        activeVaultName: resolveVaultName(updatedVaults, vaultId),
        selectedVaultId: vaultId,
        vaults: updatedVaults,
        error: null,
        vaultError: null,
        isSwitchingVault: false,
        ...deriveFlags('unlocked'),
      });

      // SECURITY: Show toast confirming the old vault was secured and the new vault is ready.
      // This reassures the user that key material was properly wiped during the transition.
      useToastStore.getState().addToast(t('security.vaultSwitch.success'), 'success', 5000);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : t('auth.error.failedUnlock');
      set({
        status: 'locked',
        activeVaultId: null,
        activeVaultName: null,
        selectedVaultId: vaultId,
        error: null,
        vaultError: t('vault.error.switchFailed', { vaultName: targetVaultName, error: errorMsg }),
        isSwitchingVault: false,
        ...deriveFlags('locked'),
      });
    }
  },

  /**
   * Deletes a vault from the registry and optionally removes its database
   * file and attachments. If the vault being deleted is currently active,
   * the main process will lock it first.
   */
  deleteVault: async (vaultId: string, deleteDatabaseFile = true, deleteAttachments = true) => {
    const { vaults } = get();
    const targetVaultName = resolveVaultName(vaults, vaultId) ?? vaultId;

    set({ isDeletingVault: true, vaultError: null });
    try {
      if (!window.electron) {
        throw new Error(t('auth.error.ipcUnavailable'));
      }

      const result = await window.electron.vaults.delete(vaultId, deleteDatabaseFile, deleteAttachments);

      if (!result.success) {
        set({
          isDeletingVault: false,
          vaultError: t('vault.error.deleteFailed', { vaultName: targetVaultName, error: result.error || '' }),
        });
        return false;
      }

      // Reload vault list
      const listResult = await window.electron.vaults.list();
      const updatedVaults = listResult.success ? listResult.data : [];

      // If the deleted vault was the active one, reset to locked state
      const { activeVaultId } = get();
      if (activeVaultId === vaultId) {
        resetAllVaultStores();
        set({
          status: 'locked',
          activeVaultId: null,
          activeVaultName: null,
          selectedVaultId: updatedVaults.length > 0 ? updatedVaults[0].id : null,
          vaults: updatedVaults,
          isDeletingVault: false,
          vaultError: null,
          ...deriveFlags('locked'),
        });
      } else {
        set({ vaults: updatedVaults, isDeletingVault: false, vaultError: null });
      }

      useToastStore.getState().addToast(t('vault.success.deleted', { vaultName: targetVaultName }), 'success', 5000);
      return true;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : t('vault.error.deleteFailed', { vaultName: targetVaultName, error: '' });
      set({ isDeletingVault: false, vaultError: errorMsg });
      return false;
    }
  },

  clearError: () => set({ error: null }),
  clearVaultError: () => set({ vaultError: null }),
}));
