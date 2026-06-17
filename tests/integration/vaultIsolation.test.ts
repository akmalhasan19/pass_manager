import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { dialog, BrowserWindow } from 'electron';
import { IPC_CHANNELS } from '@shared/ipcChannels';
import { registerAuthHandlers, clearKeys } from '@main/ipc/authHandlers';
import { registerVaultHandlers } from '@main/ipc/vaultHandlers';
import { registerItemHandlers } from '@main/ipc/itemHandlers';
import { registerFolderHandlers } from '@main/ipc/folderHandlers';
import { registerSearchHandlers } from '@main/ipc/searchHandlers';
import { registerHealthHandlers } from '@main/ipc/healthHandlers';
import { registerFileHandlers } from '@main/ipc/fileHandlers';
import { registerExportHandlers } from '@main/ipc/exportHandlers';
import { closeDatabase, getActiveVaultId, isDatabaseOpen } from '@main/database/connection';
import { invalidateRegistryCache } from '@main/file-system/vaultRegistry';
import type { VaultRegistryEntry } from '@shared/types';

const testDataDir = join(process.cwd(), 'test-data', 'vault-isolation');

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
    getFocusedWindow: vi.fn(),
  },
  shell: {
    showItemInFolder: vi.fn(),
  },
}));

const mockShowSaveDialog = vi.mocked(dialog.showSaveDialog);
const mockShowOpenDialog = vi.mocked(dialog.showOpenDialog);
const mockGetFocusedWindow = vi.mocked(BrowserWindow.getFocusedWindow);

async function invokeIpc<T>(channel: string, ...args: unknown[]): Promise<T> {
  const handler = ipcHandlers.get(channel);
  if (!handler) {
    throw new Error(`No IPC handler registered for channel: ${channel}`);
  }
  return handler(null, ...args) as T;
}

interface IpcResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  vaultId?: string;
}

function resetTestData(): void {
  closeDatabase();
  clearKeys();
  invalidateRegistryCache();

  if (existsSync(testDataDir)) {
    rmSync(testDataDir, { recursive: true, force: true });
  }
  mkdirSync(testDataDir, { recursive: true });

  mockGetFocusedWindow.mockReturnValue(null);
  mockShowSaveDialog.mockReset();
  mockShowOpenDialog.mockReset();
  mockGetFocusedWindow.mockReset();
}

function makeExportWindow() {
  const webContents = { send: vi.fn() };
  mockGetFocusedWindow.mockReturnValue({ webContents });
  return webContents;
}

const MASTER_PASSWORD = 'MyStr0ng!M@sterP@ssword';

async function createVault(name: string): Promise<VaultRegistryEntry> {
  const result = await invokeIpc<IpcResult<VaultRegistryEntry>>(IPC_CHANNELS.VAULT_CREATE, {
    name,
    masterPassword: MASTER_PASSWORD,
  });
  expect(result.success).toBe(true);
  return result.data!;
}

async function selectVault(vaultId: string): Promise<void> {
  const result = await invokeIpc<IpcResult>(IPC_CHANNELS.VAULT_SELECT, {
    vaultId,
    masterPassword: MASTER_PASSWORD,
  });
  expect(result.success).toBe(true);
  expect(getActiveVaultId()).toBe(vaultId);
  expect(isDatabaseOpen()).toBe(true);
}

async function createFolder(name: string): Promise<{ id: string; name: string }> {
  const result = await invokeIpc<IpcResult<{ id: string; name: string }>>(
    IPC_CHANNELS.FOLDER_CREATE,
    { parentId: null, name, emoji: '📁' },
  );
  expect(result.success).toBe(true);
  return result.data!;
}

async function createItem(
  folderId: string,
  title: string,
  password: string,
): Promise<{ id: string; title: string }> {
  const result = await invokeIpc<IpcResult<{ id: string; title: string }>>(
    IPC_CHANNELS.ITEM_CREATE,
    {
      folderId,
      title,
      username: 'user',
      password,
      url: 'https://example.com',
      notes: null,
      emoji: '🔑',
    },
  );
  expect(result.success).toBe(true);
  return result.data!;
}

async function attachFile(itemId: string, sourcePath: string): Promise<string> {
  const result = await invokeIpc<IpcResult<{ id: string }>>(IPC_CHANNELS.FILE_ATTACH, {
    itemId,
    filePath: sourcePath,
  });
  expect(result.success).toBe(true);
  return result.data!.id;
}

describe('Vault Isolation', () => {
  beforeAll(() => {
    registerAuthHandlers();
    registerVaultHandlers();
    registerItemHandlers();
    registerFolderHandlers();
    registerSearchHandlers();
    registerHealthHandlers();
    registerFileHandlers();
    registerExportHandlers();
  });

  afterAll(() => {
    closeDatabase();
    clearKeys();
  });

  beforeEach(() => {
    resetTestData();
  });

  // =========================================================================
  // 7.3.1 — Two vaults with different items never cross-query
  // =========================================================================
  describe('item and folder queries are scoped to active vault', () => {
    it('returns only the active vault data after switching', async () => {
      const vaultA = await createVault('Vault Alpha');
      const folderA = await createFolder('Alpha Folder');
      const itemA = await createItem(folderA.id, 'Alpha Item', 'password');

      const vaultB = await createVault('Vault Beta');
      const folderB = await createFolder('Beta Folder');
      const itemB = await createItem(folderB.id, 'Beta Item', 'MyStr0ng!UniqueB@123');

      // Verify we are on vault B and only see B's data
      expect(getActiveVaultId()).toBe(vaultB.id);

      const treeB = await invokeIpc<IpcResult>(IPC_CHANNELS.FOLDER_GET_TREE);
      expect(treeB.data).toHaveLength(1);
      expect((treeB.data as Array<{ name: string }>)[0].name).toBe('Beta Folder');

      const allB = await invokeIpc<IpcResult>(IPC_CHANNELS.ITEM_GET_ALL);
      expect((allB.data as Array<{ id: string }>).length).toBe(1);
      expect((allB.data as Array<{ id: string }>)[0].id).toBe(itemB.id);

      const getA = await invokeIpc<IpcResult>(IPC_CHANNELS.ITEM_GET_BY_ID, { id: itemA.id });
      expect(getA.success).toBe(false);

      // Switch to A and verify isolation the other direction
      await selectVault(vaultA.id);

      const treeA = await invokeIpc<IpcResult>(IPC_CHANNELS.FOLDER_GET_TREE);
      expect(treeA.data).toHaveLength(1);
      expect((treeA.data as Array<{ name: string }>)[0].name).toBe('Alpha Folder');

      const allA = await invokeIpc<IpcResult>(IPC_CHANNELS.ITEM_GET_ALL);
      expect((allA.data as Array<{ id: string }>).length).toBe(1);
      expect((allA.data as Array<{ id: string }>)[0].id).toBe(itemA.id);

      const getB = await invokeIpc<IpcResult>(IPC_CHANNELS.ITEM_GET_BY_ID, { id: itemB.id });
      expect(getB.success).toBe(false);
    });
  });

  // =========================================================================
  // 7.3.2 — Folder IDs from different vaults do not collide in the UI
  // =========================================================================
  describe('folder IDs from different vaults do not collide', () => {
    it('does not resolve a folder ID from vault A while vault B is active', async () => {
      const vaultA = await createVault('Vault Alpha');
      const folderA = await createFolder('Shared');

      const vaultB = await createVault('Vault Beta');
      const folderB = await createFolder('Shared');

      expect(folderA.id).not.toBe(folderB.id);

      // Active vault is B; asking for A's folder ID should fail
      await selectVault(vaultB.id);
      const getAFolder = await invokeIpc<IpcResult>(IPC_CHANNELS.FOLDER_UPDATE, {
        id: folderA.id,
        name: 'Should Not Update',
      });
      expect(getAFolder.success).toBe(false);

      const treeB = await invokeIpc<IpcResult>(IPC_CHANNELS.FOLDER_GET_TREE);
      const flatB = treeB.data as Array<{ id: string; name: string }>;
      expect(flatB.some((f) => f.id === folderA.id)).toBe(false);
      expect(flatB.some((f) => f.id === folderB.id && f.name === 'Shared')).toBe(true);

      // Switch back to A and ensure A's folder is still intact
      await selectVault(vaultA.id);
      const treeA = await invokeIpc<IpcResult>(IPC_CHANNELS.FOLDER_GET_TREE);
      const flatA = treeA.data as Array<{ id: string; name: string }>;
      expect(flatA.some((f) => f.id === folderA.id && f.name === 'Shared')).toBe(true);
      expect(flatA.some((f) => f.id === folderB.id)).toBe(false);
    });
  });

  // =========================================================================
  // 7.3.3 — Search, health, trash, attachment, and export stay scoped
  // =========================================================================
  describe('search is scoped to active vault', () => {
    it('only returns results from the currently unlocked vault', async () => {
      const vaultA = await createVault('Vault Alpha');
      const folderA = await createFolder('Alpha Folder');
      await createItem(folderA.id, 'Alpha Secret', 'password');

      const vaultB = await createVault('Vault Beta');
      const folderB = await createFolder('Beta Folder');
      await createItem(folderB.id, 'Beta Secret', 'MyStr0ng!UniqueB@123');

      type SearchResult = { type: string; title: string };

      await selectVault(vaultB.id);
      const searchAlpha = await invokeIpc<IpcResult>(IPC_CHANNELS.ITEM_SEARCH, {
        query: 'Alpha',
      });
      expect((searchAlpha.data as SearchResult[]).some((r) => r.title === 'Alpha Secret')).toBe(
        false,
      );

      const searchBeta = await invokeIpc<IpcResult>(IPC_CHANNELS.ITEM_SEARCH, { query: 'Beta' });
      const betaItems = (searchBeta.data as SearchResult[]).filter((r) => r.type === 'item');
      expect(betaItems.length).toBe(1);
      expect(betaItems[0].title).toBe('Beta Secret');

      await selectVault(vaultA.id);
      const searchAlphaA = await invokeIpc<IpcResult>(IPC_CHANNELS.ITEM_SEARCH, {
        query: 'Alpha',
      });
      const alphaItems = (searchAlphaA.data as SearchResult[]).filter((r) => r.type === 'item');
      expect(alphaItems.length).toBe(1);
      expect(alphaItems[0].title).toBe('Alpha Secret');
    });
  });

  describe('password health is scoped to active vault', () => {
    it('only analyzes passwords from the currently unlocked vault', async () => {
      const vaultA = await createVault('Vault Alpha');
      const folderA = await createFolder('Alpha Folder');
      await createItem(folderA.id, 'Alpha Item', 'password');

      const vaultB = await createVault('Vault Beta');
      const folderB = await createFolder('Beta Folder');
      await createItem(folderB.id, 'Beta Item', 'MyStr0ng!UniqueB@123');

      await selectVault(vaultA.id);
      const healthA = await invokeIpc<IpcResult>(IPC_CHANNELS.HEALTH_ANALYZE, {});
      expect(healthA.success).toBe(true);
      expect((healthA.data as { weak: number }).weak).toBeGreaterThanOrEqual(1);
      expect(
        (healthA.data as { weakPasswords: Array<{ title: string }> }).weakPasswords.some(
          (entry) => entry.title === 'Alpha Item',
        ),
      ).toBe(true);

      await selectVault(vaultB.id);
      const healthB = await invokeIpc<IpcResult>(IPC_CHANNELS.HEALTH_ANALYZE, {});
      expect(healthB.success).toBe(true);
      expect((healthB.data as { weak: number }).weak).toBe(0);
      expect(
        (healthB.data as { weakPasswords: Array<{ title: string }> }).weakPasswords.some(
          (entry) => entry.title === 'Alpha Item',
        ),
      ).toBe(false);
    });
  });

  describe('trash is scoped to active vault', () => {
    it('cannot restore an item trashed in vault A while vault B is active', async () => {
      const vaultA = await createVault('Vault Alpha');
      const folderA = await createFolder('Alpha Folder');
      const itemA = await createItem(folderA.id, 'Alpha Trashed', 'password');

      const vaultB = await createVault('Vault Beta');
      const folderB = await createFolder('Beta Folder');
      await createItem(folderB.id, 'Beta Item', 'MyStr0ng!UniqueB@123');

      await selectVault(vaultA.id);
      const deleteResult = await invokeIpc<IpcResult>(IPC_CHANNELS.ITEM_DELETE, { id: itemA.id });
      expect(deleteResult.success).toBe(true);

      await selectVault(vaultB.id);
      const restoreInB = await invokeIpc<IpcResult>(IPC_CHANNELS.ITEM_RESTORE, { id: itemA.id });
      expect(restoreInB.success).toBe(false);

      await selectVault(vaultA.id);
      const restoreInA = await invokeIpc<IpcResult>(IPC_CHANNELS.ITEM_RESTORE, { id: itemA.id });
      expect(restoreInA.success).toBe(true);
      expect((restoreInA.data as { id: string }).id).toBe(itemA.id);
    });
  });

  describe('attachments are scoped to active vault', () => {
    it('only exposes attachments that belong to the currently unlocked vault', async () => {
      const sourceA = join(testDataDir, 'source-a.txt');
      const sourceB = join(testDataDir, 'source-b.txt');
      writeFileSync(sourceA, 'attachment A content', 'utf-8');
      writeFileSync(sourceB, 'attachment B content', 'utf-8');

      const vaultA = await createVault('Vault Alpha');
      const folderA = await createFolder('Alpha Folder');
      const itemA = await createItem(folderA.id, 'Alpha Item', 'password');
      const attachmentA = await attachFile(itemA.id, sourceA);

      const vaultB = await createVault('Vault Beta');
      const folderB = await createFolder('Beta Folder');
      const itemB = await createItem(folderB.id, 'Beta Item', 'MyStr0ng!UniqueB@123');
      const attachmentB = await attachFile(itemB.id, sourceB);

      await selectVault(vaultA.id);
      const filesA = await invokeIpc<IpcResult>(IPC_CHANNELS.FILE_GET_BY_ITEM, {
        itemId: itemA.id,
      });
      expect((filesA.data as Array<{ id: string }>).length).toBe(1);
      expect((filesA.data as Array<{ id: string }>)[0].id).toBe(attachmentA);

      const filesAForBItem = await invokeIpc<IpcResult>(IPC_CHANNELS.FILE_GET_BY_ITEM, {
        itemId: itemB.id,
      });
      expect((filesAForBItem.data as Array<{ id: string }>).length).toBe(0);

      // Attempting to download B's attachment while A is active should be rejected
      const downloadCross = await invokeIpc<IpcResult>(IPC_CHANNELS.FILE_DOWNLOAD, {
        attachmentId: attachmentB,
      });
      expect(downloadCross.success).toBe(false);

      await selectVault(vaultB.id);
      const filesB = await invokeIpc<IpcResult>(IPC_CHANNELS.FILE_GET_BY_ITEM, {
        itemId: itemB.id,
      });
      expect((filesB.data as Array<{ id: string }>).length).toBe(1);
      expect((filesB.data as Array<{ id: string }>)[0].id).toBe(attachmentB);

      const downloadB = await invokeIpc<IpcResult>(IPC_CHANNELS.FILE_DOWNLOAD, {
        attachmentId: attachmentB,
      });
      expect(downloadB.success).toBe(true);
      expect(existsSync((downloadB.data as { filePath: string }).filePath)).toBe(true);
    });
  });

  describe('export is scoped to active vault', () => {
    it('plain-text export only contains items from the active vault', async () => {
      const vaultA = await createVault('Vault Alpha');
      const folderA = await createFolder('Alpha Folder');
      await createItem(folderA.id, 'Alpha Export', 'password');

      const vaultB = await createVault('Vault Beta');
      const folderB = await createFolder('Beta Folder');
      await createItem(folderB.id, 'Beta Export', 'MyStr0ng!UniqueB@123');

      // Export vault A
      await selectVault(vaultA.id);
      const exportPathA = join(testDataDir, 'export-a.json');
      makeExportWindow();
      mockShowSaveDialog.mockResolvedValue({ canceled: false, filePath: exportPathA });

      const exportA = await invokeIpc<IpcResult>(IPC_CHANNELS.EXPORT_DATA, {
        format: 'json-plain',
      });
      expect(exportA.success).toBe(true);
      expect(existsSync(exportPathA)).toBe(true);

      const parsedA = JSON.parse(readFileSync(exportPathA, 'utf-8')) as Array<{
        title: string;
      }>;
      expect(parsedA.length).toBe(1);
      expect(parsedA[0].title).toBe('Alpha Export');

      // Export vault B
      await selectVault(vaultB.id);
      const exportPathB = join(testDataDir, 'export-b.json');
      makeExportWindow();
      mockShowSaveDialog.mockResolvedValue({ canceled: false, filePath: exportPathB });

      const exportB = await invokeIpc<IpcResult>(IPC_CHANNELS.EXPORT_DATA, {
        format: 'json-plain',
      });
      expect(exportB.success).toBe(true);
      expect(existsSync(exportPathB)).toBe(true);

      const parsedB = JSON.parse(readFileSync(exportPathB, 'utf-8')) as Array<{
        title: string;
      }>;
      expect(parsedB.length).toBe(1);
      expect(parsedB[0].title).toBe('Beta Export');
    });
  });
});
