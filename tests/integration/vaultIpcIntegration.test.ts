import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { existsSync, rmSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { IPC_CHANNELS } from '@shared/ipcChannels';
import { registerAuthHandlers, clearKeys, lockCurrentVault } from '@main/ipc/authHandlers';
import { registerVaultHandlers } from '@main/ipc/vaultHandlers';
import { registerItemHandlers } from '@main/ipc/itemHandlers';
import { registerFolderHandlers } from '@main/ipc/folderHandlers';
import { closeDatabase, getActiveVaultId, isDatabaseOpen, getActiveDatabasePath } from '@main/database/connection';
import { invalidateRegistryCache, listVaults, getVaultById } from '@main/file-system/vaultRegistry';

const testDataDir = join(process.cwd(), 'test-data', 'ipc-integration');

const ipcHandlers = new Map<string, (_event: unknown, ...args: unknown[]) => unknown>();

vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => {
      if (name === 'userData') return testDataDir;
      if (name === 'appPath') return process.cwd();
      throw new Error(`Unexpected Electron path request: ${name}`);
    },
    getAppPath: () => process.cwd(),
  },
  ipcMain: {
    handle: (channel: string, handler: (_event: unknown, ...args: unknown[]) => unknown) => {
      ipcHandlers.set(channel, handler);
    },
    on: vi.fn(),
    once: vi.fn(),
    removeHandler: vi.fn(),
    removeAllListeners: vi.fn(),
  },
  dialog: {
    showOpenDialog: vi.fn(),
    showSaveDialog: vi.fn(),
  },
  BrowserWindow: {
    getFocusedWindow: vi.fn(() => null),
  },
  shell: {
    showItemInFolder: vi.fn(),
  },
}));

async function invokeIpc<T>(channel: string, ...args: unknown[]): Promise<T> {
  const handler = ipcHandlers.get(channel);
  if (!handler) {
    throw new Error(`No IPC handler registered for channel: ${channel}`);
  }
  return handler(null, ...args) as T;
}

function resetTestData(): void {
  closeDatabase();
  clearKeys();
  invalidateRegistryCache();

  if (existsSync(testDataDir)) {
    rmSync(testDataDir, { recursive: true, force: true });
  }
  mkdirSync(testDataDir, { recursive: true });
}

interface IpcResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  vaultId?: string;
}

describe('Vault IPC Integration', () => {
  beforeAll(() => {
    registerAuthHandlers();
    registerVaultHandlers();
    registerItemHandlers();
    registerFolderHandlers();
  });

  afterAll(() => {
    closeDatabase();
    clearKeys();
  });

  beforeEach(() => {
    resetTestData();
  });

  // =========================================================================
  // 7.2.1 — Create vault then unlock it
  // =========================================================================
  describe('create vault then unlock', () => {
    it('creates a vault via VAULT_CREATE and unlocks it with the provided password', async () => {
      const createResult = await invokeIpc<IpcResult<{ id: string; name: string }>>(
        IPC_CHANNELS.VAULT_CREATE,
        {
          name: 'Personal',
          masterPassword: 'MyStr0ng!M@sterP@ssword',
        },
      );

      expect(createResult.success).toBe(true);
      expect(createResult.data).toBeDefined();
      const vaultId = createResult.data!.id;
      expect(vaultId).toBeDefined();
      expect(createResult.data!.name).toBe('Personal');

      // Verify the vault is active and database is open
      expect(getActiveVaultId()).toBe(vaultId);
      expect(isDatabaseOpen()).toBe(true);

      // Verify it can be unlocked again after locking
      const lockResult = await invokeIpc<IpcResult>(IPC_CHANNELS.AUTH_LOCK);
      expect(lockResult.success).toBe(true);
      expect(isDatabaseOpen()).toBe(false);

      const unlockResult = await invokeIpc<IpcResult>(IPC_CHANNELS.AUTH_UNLOCK, {
        masterPassword: 'MyStr0ng!M@sterP@ssword',
        vaultId,
      });

      expect(unlockResult.success).toBe(true);
      expect(unlockResult.vaultId).toBe(vaultId);
      expect(isDatabaseOpen()).toBe(true);
    });

    it('fails to unlock a vault with the wrong password', async () => {
      const createResult = await invokeIpc<IpcResult<{ id: string }>>(IPC_CHANNELS.VAULT_CREATE, {
        name: 'Work',
        masterPassword: 'MyStr0ng!M@sterP@ssword',
      });

      const vaultId = createResult.data!.id;

      await invokeIpc<IpcResult>(IPC_CHANNELS.AUTH_LOCK);

      const unlockResult = await invokeIpc<IpcResult>(IPC_CHANNELS.AUTH_UNLOCK, {
        masterPassword: 'Wr0ngP@ssword!',
        vaultId,
      });

      expect(unlockResult.success).toBe(false);
      expect(unlockResult.error).toContain('Invalid master password');
      expect(isDatabaseOpen()).toBe(false);
    });
  });

  // =========================================================================
  // 7.2.2 — Switch vault closes old connection and opens new one
  // =========================================================================
  describe('switch vault closes old connection and opens new one', () => {
    it('switches from one unlocked vault to another, closing the previous database', async () => {
      // Create two vaults
      const vaultA = await invokeIpc<IpcResult<{ id: string; databasePath: string }>>(
        IPC_CHANNELS.VAULT_CREATE,
        {
          name: 'Vault A',
          masterPassword: 'MyStr0ng!M@sterP@ssword',
        },
      );
      const vaultB = await invokeIpc<IpcResult<{ id: string; databasePath: string }>>(
        IPC_CHANNELS.VAULT_CREATE,
        {
          name: 'Vault B',
          masterPassword: 'MyStr0ng!M@sterP@ssword',
        },
      );

      const idA = vaultA.data!.id;
      const idB = vaultB.data!.id;
      const pathB = vaultB.data!.databasePath;

      // Ensure we start on vault A
      await invokeIpc<IpcResult>(IPC_CHANNELS.VAULT_SELECT, {
        vaultId: idA,
        masterPassword: 'MyStr0ng!M@sterP@ssword',
      });
      expect(getActiveVaultId()).toBe(idA);

      // Add data to vault A
      const folderResult = await invokeIpc<IpcResult<{ id: string }>>(IPC_CHANNELS.FOLDER_CREATE, {
        parentId: null,
        name: 'Folder In A',
      });
      expect(folderResult.success).toBe(true);

      // Switch to vault B
      const switchResult = await invokeIpc<IpcResult>(IPC_CHANNELS.VAULT_SELECT, {
        vaultId: idB,
        masterPassword: 'MyStr0ng!M@sterP@ssword',
      });

      expect(switchResult.success).toBe(true);
      expect(switchResult.vaultId).toBe(idB);
      expect(getActiveVaultId()).toBe(idB);
      expect(isDatabaseOpen()).toBe(true);
      expect(getActiveDatabasePath()).toBe(pathB);

      // Verify vault B is empty (no folder from A)
      const treeResult = await invokeIpc<IpcResult>(IPC_CHANNELS.FOLDER_GET_TREE);
      expect(treeResult.success).toBe(true);
      expect(treeResult.data).toEqual([]);

      // Switch back to A and verify the folder still exists there
      const switchBackResult = await invokeIpc<IpcResult>(IPC_CHANNELS.VAULT_SELECT, {
        vaultId: idA,
        masterPassword: 'MyStr0ng!M@sterP@ssword',
      });

      expect(switchBackResult.success).toBe(true);
      expect(getActiveVaultId()).toBe(idA);

      const treeA = await invokeIpc<IpcResult>(IPC_CHANNELS.FOLDER_GET_TREE);
      expect(treeA.success).toBe(true);
      expect((treeA.data as Array<{ name: string }>).length).toBe(1);
      expect((treeA.data as Array<{ name: string }>)[0].name).toBe('Folder In A');
    });

    it('fails to switch to a non-existent vault', async () => {
      const result = await invokeIpc<IpcResult>(IPC_CHANNELS.VAULT_SELECT, {
        vaultId: '00000000-0000-4000-8000-000000000000',
        masterPassword: 'MyStr0ng!M@sterP@ssword',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Vault not found');
    });
  });

  // =========================================================================
  // 7.2.3 — Item/folder handlers reject when no vault is unlocked
  // =========================================================================
  describe('item and folder handlers reject without unlocked vault', () => {
    it('rejects FOLDER_CREATE when no vault is unlocked', async () => {
      const result = await invokeIpc<IpcResult>(IPC_CHANNELS.FOLDER_CREATE, {
        parentId: null,
        name: 'Should Fail',
      });

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/Database is not open/i);
    });

    it('rejects FOLDER_GET_TREE when no vault is unlocked', async () => {
      const result = await invokeIpc<IpcResult>(IPC_CHANNELS.FOLDER_GET_TREE);

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/Database is not open/i);
    });

    it('rejects ITEM_GET_ALL when no vault is unlocked', async () => {
      const result = await invokeIpc<IpcResult>(IPC_CHANNELS.ITEM_GET_ALL);

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/Database is not open/i);
    });

    it('rejects ITEM_CREATE when no vault is unlocked', async () => {
      const result = await invokeIpc<IpcResult>(IPC_CHANNELS.ITEM_CREATE, {
        folderId: 'any-folder-id',
        title: 'Should Fail',
      });

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/Database is not open/i);
    });

    it('rejects ITEM_GET_BY_ID when no vault is unlocked', async () => {
      const result = await invokeIpc<IpcResult>(IPC_CHANNELS.ITEM_GET_BY_ID, { id: 'any-item-id' });

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/Database is not open/i);
    });
  });

  // =========================================================================
  // 7.2.4 — Delete vault removes registry entry and file per options
  // =========================================================================
  describe('delete vault removes registry entry and file per options', () => {
    it('deletes registry entry and database file when deleteDatabaseFile is true', async () => {
      const createResult = await invokeIpc<IpcResult<{ id: string; databasePath: string }>>(
        IPC_CHANNELS.VAULT_CREATE,
        {
          name: 'Delete With File',
          masterPassword: 'MyStr0ng!M@sterP@ssword',
        },
      );

      const vaultId = createResult.data!.id;
      const databasePath = createResult.data!.databasePath;

      expect(existsSync(databasePath)).toBe(true);

      // Lock first to ensure delete of an active vault is safe
      await invokeIpc<IpcResult>(IPC_CHANNELS.AUTH_LOCK);

      const deleteResult = await invokeIpc<IpcResult>(IPC_CHANNELS.VAULT_DELETE, {
        vaultId,
        deleteDatabaseFile: true,
        deleteAttachments: true,
      });

      expect(deleteResult.success).toBe(true);
      expect(getVaultById(vaultId)).toBeNull();
      expect(listVaults()).toHaveLength(0);
      expect(existsSync(databasePath)).toBe(false);
    });

    it('deletes registry entry but keeps database file when deleteDatabaseFile is false', async () => {
      const createResult = await invokeIpc<IpcResult<{ id: string; databasePath: string }>>(
        IPC_CHANNELS.VAULT_CREATE,
        {
          name: 'Delete Keep File',
          masterPassword: 'MyStr0ng!M@sterP@ssword',
        },
      );

      const vaultId = createResult.data!.id;
      const databasePath = createResult.data!.databasePath;

      expect(existsSync(databasePath)).toBe(true);

      await invokeIpc<IpcResult>(IPC_CHANNELS.AUTH_LOCK);

      const deleteResult = await invokeIpc<IpcResult>(IPC_CHANNELS.VAULT_DELETE, {
        vaultId,
        deleteDatabaseFile: false,
        deleteAttachments: false,
      });

      expect(deleteResult.success).toBe(true);
      expect(getVaultById(vaultId)).toBeNull();
      expect(listVaults()).toHaveLength(0);
      expect(existsSync(databasePath)).toBe(true);

      // Cleanup
      if (existsSync(databasePath)) {
        rmSync(databasePath, { force: true });
      }
    });

    it('deletes an active vault safely by locking it first', async () => {
      const createResult = await invokeIpc<IpcResult<{ id: string; databasePath: string }>>(
        IPC_CHANNELS.VAULT_CREATE,
        {
          name: 'Delete Active',
          masterPassword: 'MyStr0ng!M@sterP@ssword',
        },
      );

      const vaultId = createResult.data!.id;
      const databasePath = createResult.data!.databasePath;

      expect(getActiveVaultId()).toBe(vaultId);
      expect(isDatabaseOpen()).toBe(true);

      const deleteResult = await invokeIpc<IpcResult>(IPC_CHANNELS.VAULT_DELETE, {
        vaultId,
        deleteDatabaseFile: true,
        deleteAttachments: true,
      });

      expect(deleteResult.success).toBe(true);
      expect(getActiveVaultId()).toBeNull();
      expect(isDatabaseOpen()).toBe(false);
      expect(getVaultById(vaultId)).toBeNull();
      expect(existsSync(databasePath)).toBe(false);
    });
  });
});
