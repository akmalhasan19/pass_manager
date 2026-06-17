import { describe, it, expect, beforeEach, vi } from 'vitest';
import { enableMapSet } from 'immer';
import { useAuthStore } from '../../../src/renderer/stores/authStore';
import { useItemStore } from '../../../src/renderer/stores/itemStore';
import { useFolderStore } from '../../../src/renderer/stores/folderStore';
import { useUIStore } from '../../../src/renderer/stores/uiStore';
import { useSettingsStore } from '../../../src/renderer/stores/settingsStore';
import { useToastStore } from '../../../src/renderer/stores/toastStore';
import { useErrorStore } from '../../../src/renderer/stores/errorStore';
import type { ItemDecrypted, Folder, VaultRegistryEntry } from '../../../src/shared/types';

enableMapSet();

const mockVaultsSelect = vi.fn();
const mockVaultsList = vi.fn();
const mockAuthCleanup = vi.fn();
const mockAuthLock = vi.fn();

vi.stubGlobal('window', {
  electron: {
    auth: { cleanupListeners: mockAuthCleanup, lock: mockAuthLock },
    vaults: { select: mockVaultsSelect, list: mockVaultsList },
  },
  dispatchEvent: vi.fn(),
  addEventListener: vi.fn(),
});

function makeVault(id: string, name: string): VaultRegistryEntry {
  return {
    id,
    name,
    databasePath: `vault-${id}.db`,
    createdAt: Date.now(),
    lastOpenedAt: null,
    lastOpenedVersion: null,
    description: null,
    color: null,
    icon: null,
    isDefault: false,
    sortOrder: 0,
  };
}

function makeItem(id: string, title: string, folderId: string): ItemDecrypted {
  const now = Date.now();
  return {
    id,
    folderId,
    title,
    username: 'old-user',
    password: 'old-password',
    url: 'https://old.example.com',
    notes: 'old notes',
    emoji: null,
    coverImage: null,
    createdAt: now,
    updatedAt: now,
    isFavorite: false,
    sortOrder: 0,
  };
}

function makeFolder(id: string, name: string): Folder {
  const now = Date.now();
  return {
    id,
    parentId: null,
    name,
    emoji: null,
    coverImage: null,
    createdAt: now,
    updatedAt: now,
    sortOrder: 0,
  };
}

describe('vault switch resets renderer stores', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Simulate an unlocked vault A with vault-specific data cached in stores
    useAuthStore.setState({
      status: 'unlocked',
      error: null,
      vaultError: null,
      isAuthenticated: true,
      isLoading: false,
      activeVaultId: 'vault-a',
      activeVaultName: 'Vault A',
      selectedVaultId: 'vault-a',
      vaults: [makeVault('vault-a', 'Vault A'), makeVault('vault-b', 'Vault B')],
      isLoadingVaults: false,
      isCreatingVault: false,
      isSwitchingVault: false,
      isDeletingVault: false,
      isRenamingVault: false,
      isSettingDefaultVault: false,
      isBackingUpVault: false,
      isRestoringVault: false,
    });

    useItemStore.setState({
      items: { 'item-a': makeItem('item-a', 'Old Item', 'folder-a') },
      itemIds: ['item-a'],
      currentFolderId: 'folder-a',
      selectedItemId: 'item-a',
      isLoading: false,
      error: null,
    });

    useFolderStore.setState({
      folders: [makeFolder('folder-a', 'Old Folder')],
      selectedFolderId: 'folder-a',
      expandedFolderIds: new Set(['folder-a']),
      isLoading: false,
      error: null,
    });

    useUIStore.setState({
      sidebarOpen: true,
      darkMode: false,
      quickFindOpen: true,
      activeView: 'item',
      centerPanelVisible: false,
    });

    useSettingsStore.setState({
      settings: {
        autoLockTime: 300000,
        theme: 'dark',
        defaultPasswordLength: 20,
        defaultPasswordUppercase: true,
        defaultPasswordLowercase: true,
        defaultPasswordNumbers: true,
        defaultPasswordSymbols: true,
        defaultPasswordExcludeAmbiguous: true,
        trashAutoPurgeDays: 30,
        passwordHealthOldDays: 90,
      },
      isLoaded: true,
      isLoading: false,
      error: null,
    });

    useToastStore.setState({
      toasts: [{ id: 'toast-old', message: 'Old toast', type: 'info', durationMs: 1000 }],
    });

    useErrorStore.setState({
      errors: [
        {
          id: 'error-old',
          message: 'Old error',
          source: 'test',
          timestamp: Date.now(),
        },
      ],
      isOpen: true,
    });
  });

  it('clears all vault-specific renderer stores when switching to another vault', async () => {
    mockVaultsSelect.mockResolvedValue({ success: true, vaultId: 'vault-b' });
    mockVaultsList.mockResolvedValue({
      success: true,
      data: [makeVault('vault-a', 'Vault A'), makeVault('vault-b', 'Vault B')],
    });

    await useAuthStore.getState().selectVault('vault-b', 'master-password');

    const auth = useAuthStore.getState();
    expect(auth.status).toBe('unlocked');
    expect(auth.activeVaultId).toBe('vault-b');
    expect(auth.activeVaultName).toBe('Vault B');
    expect(auth.isSwitchingVault).toBe(false);
    expect(auth.vaultError).toBeNull();

    const item = useItemStore.getState();
    expect(Object.keys(item.items)).toHaveLength(0);
    expect(item.itemIds).toHaveLength(0);
    expect(item.currentFolderId).toBeNull();
    expect(item.selectedItemId).toBeNull();

    const folder = useFolderStore.getState();
    expect(folder.folders).toHaveLength(0);
    expect(folder.selectedFolderId).toBeNull();
    expect(folder.expandedFolderIds.size).toBe(0);

    const ui = useUIStore.getState();
    expect(ui.activeView).toBe('home');
    expect(ui.quickFindOpen).toBe(false);
    expect(ui.centerPanelVisible).toBe(true);

    const settings = useSettingsStore.getState();
    expect(settings.isLoaded).toBe(false);
    expect(settings.settings.theme).toBe('system');

    // Stale errors should be cleared; a success toast may be present
    expect(useErrorStore.getState().errors).toHaveLength(0);
    expect(useToastStore.getState().toasts.some((t) => t.message === 'Old toast')).toBe(false);

    expect(mockAuthCleanup).toHaveBeenCalled();
    expect(mockVaultsSelect).toHaveBeenCalledWith('vault-b', 'master-password');
  });

  it('still resets vault-specific stores even if the switch IPC call fails', async () => {
    mockVaultsSelect.mockResolvedValue({ success: false, error: 'Wrong password' });

    await useAuthStore.getState().selectVault('vault-b', 'wrong-password');

    expect(useAuthStore.getState().status).toBe('locked');
    expect(useAuthStore.getState().activeVaultId).toBeNull();
    expect(useItemStore.getState().items).toEqual({});
    expect(useFolderStore.getState().folders).toHaveLength(0);
    expect(useErrorStore.getState().errors).toHaveLength(0);
  });
});
