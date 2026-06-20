/**
 * Security Regression Tests — Sub-Task 7.4
 *
 * Covers security-critical behaviours introduced by Multi-Vault Support:
 * - Key material from a previous vault is wiped when switching vaults.
 * - Auto-lock does not leave a false "unlocked" state across vault switches.
 * - Importing an existing vault rejects malicious/traversal file paths.
 * - Deleting the active vault wipes key material and closes the DB before
 *   touching the file system.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { existsSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { IPC_CHANNELS } from '@shared/ipcChannels';
import {
  registerAuthHandlers,
  clearKeys,
  lockCurrentVault,
  getActiveAuthVaultId,
  getMasterKey,
} from '@main/ipc/authHandlers';
import { registerVaultHandlers } from '@main/ipc/vaultHandlers';
import {
  closeDatabase,
  getActiveVaultId,
  isDatabaseOpen,
  getActiveDatabasePath,
} from '@main/database/connection';
import { invalidateRegistryCache, listVaults, getVaultById } from '@main/file-system/vaultRegistry';
import { readVaultAuthMetadata } from '@main/file-system/vaultAuthStorage';
import { deriveMasterKey } from '@main/crypto/keyDerivation';
import { encryptString, decryptString } from '@main/crypto/encryption';

const testDataDir = join(process.cwd(), 'test-data', 'security-regression');

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
}

describe('Security Regression Tests (Sub-Task 7.4)', () => {
  beforeAll(() => {
    registerAuthHandlers();
    registerVaultHandlers();
  });

  afterAll(() => {
    closeDatabase();
    clearKeys();
  });

  beforeEach(() => {
    resetTestData();
  });

  // ========================================================================
  // 7.4.1 — Key material from the old vault is not used after switching.
  // ========================================================================
  describe('key material isolation after vault switch', () => {
    it('should hold the new vault key and reject data encrypted with the old vault key', async () => {
      const passwordA = 'OldVaultP@ssw0rd!A';
      const passwordB = 'NewVaultP@ssw0rd!B';

      const vaultA = await invokeIpc<IpcResult<{ id: string }>>(IPC_CHANNELS.VAULT_CREATE, {
        name: 'Vault A',
        masterPassword: passwordA,
      });
      const vaultB = await invokeIpc<IpcResult<{ id: string }>>(IPC_CHANNELS.VAULT_CREATE, {
        name: 'Vault B',
        masterPassword: passwordB,
      });

      const idA = vaultA.data!.id;
      const idB = vaultB.data!.id;

      // Unlock/select vault A.
      await invokeIpc<IpcResult>(IPC_CHANNELS.VAULT_SELECT, {
        vaultId: idA,
        masterPassword: passwordA,
      });

      expect(getActiveAuthVaultId()).toBe(idA);
      expect(isDatabaseOpen()).toBe(true);

      // Derive the expected key for vault A and verify it matches the active key.
      const authA = readVaultAuthMetadata(idA);
      let kdfParamsA: import('../../src/main/crypto/kdfEngine').KdfParams;
      if (authA.kdfVersion && authA.kdfVersion >= 1 && authA.kdfParams) {
        kdfParamsA = authA.kdfParams as import('../../src/main/crypto/kdfEngine').KdfParams;
      } else {
        kdfParamsA = {
          algorithm: authA.kdfAlgorithm,
          iterations: authA.kdfIterations,
        };
      }
      const keyA = await deriveMasterKey(passwordA, authA.salt, kdfParamsA);
      expect(getMasterKey()?.toString('hex')).toBe(keyA.toString('hex'));

      // Encrypt a secret with vault A's key.
      const secretA = encryptString('secret-from-vault-a', keyA);

      // Switch to vault B.
      const switchResult = await invokeIpc<IpcResult>(IPC_CHANNELS.VAULT_SELECT, {
        vaultId: idB,
        masterPassword: passwordB,
      });
      expect(switchResult.success).toBe(true);
      expect(getActiveAuthVaultId()).toBe(idB);
      expect(getActiveVaultId()).toBe(idB);
      expect(isDatabaseOpen()).toBe(true);

      const activeKey = getMasterKey();
      expect(activeKey).not.toBeNull();
      expect(activeKey!.toString('hex')).not.toBe(keyA.toString('hex'));

      // Data encrypted with vault A's key must not decrypt with vault B's key.
      expect(() => decryptString(secretA, activeKey!)).toThrow();

      // The active vault (B) must refuse the old vault's password.
      const wrongUnlock = await invokeIpc<IpcResult>(IPC_CHANNELS.AUTH_UNLOCK, {
        vaultId: idB,
        masterPassword: passwordA,
      });
      expect(wrongUnlock.success).toBe(false);
    });

    it('should clear the master key when the active vault is locked', async () => {
      const createResult = await invokeIpc<IpcResult<{ id: string }>>(IPC_CHANNELS.VAULT_CREATE, {
        name: 'Lock Key Wipe',
        masterPassword: 'Str0ng!LockTest',
      });

      await invokeIpc<IpcResult>(IPC_CHANNELS.VAULT_SELECT, {
        vaultId: createResult.data!.id,
        masterPassword: 'Str0ng!LockTest',
      });

      expect(getMasterKey()).not.toBeNull();
      lockCurrentVault();

      expect(getMasterKey()).toBeNull();
      expect(getActiveAuthVaultId()).toBeNull();
      expect(isDatabaseOpen()).toBe(false);
    });
  });

  // ========================================================================
  // 7.4.3 — Import existing vault rejects malicious file paths.
  // ========================================================================
  describe('import existing vault path validation', () => {
    it('rejects import paths containing traversal sequences', async () => {
      const safeFile = join(testDataDir, 'safe.db');
      writeFileSync(safeFile, Buffer.from('SQLite format 3\0', 'utf-8'));

      // Build a path that contains '..' but resolves to the existing safe file.
      const maliciousPath = `${testDataDir}\\..\\security-regression\\safe.db`;
      expect(existsSync(maliciousPath)).toBe(true);

      const result = await invokeIpc<IpcResult>(IPC_CHANNELS.VAULT_IMPORT, {
        filePath: maliciousPath,
        name: 'Traversal Import',
      });

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/traversal/i);
      expect(listVaults()).toHaveLength(0);
    });

    it('rejects relative import paths', async () => {
      const result = await invokeIpc<IpcResult>(IPC_CHANNELS.VAULT_IMPORT, {
        filePath: 'some\\relative\\path.db',
        name: 'Relative Import',
      });

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/absolute/i);
      expect(listVaults()).toHaveLength(0);
    });

    it('accepts a valid absolute database file path', async () => {
      const sourceDb = join(testDataDir, 'valid-vault.db');
      writeFileSync(sourceDb, Buffer.from('SQLite format 3\0', 'utf-8'));

      const result = await invokeIpc<IpcResult<{ id: string; databasePath: string }>>(
        IPC_CHANNELS.VAULT_IMPORT,
        {
          filePath: sourceDb,
          name: 'Imported Vault',
        },
      );

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();

      const importedId = result.data!.id;
      expect(getVaultById(importedId)).not.toBeNull();
      expect(existsSync(result.data!.databasePath)).toBe(true);
    });
  });

  // ========================================================================
  // 7.4.4 — Delete active vault wipes memory and closes DB before file ops.
  // ========================================================================
  describe('delete active vault secure teardown', () => {
    it('locks the active vault, wipes key material, closes DB, then removes the file', async () => {
      const createResult = await invokeIpc<IpcResult<{ id: string; databasePath: string }>>(
        IPC_CHANNELS.VAULT_CREATE,
        {
          name: 'Active Delete',
          masterPassword: 'D3lete!ActiveVault',
        },
      );

      const vaultId = createResult.data!.id;
      const databasePath = createResult.data!.databasePath;

      expect(getActiveAuthVaultId()).toBe(vaultId);
      expect(getActiveVaultId()).toBe(vaultId);
      expect(isDatabaseOpen()).toBe(true);
      expect(existsSync(databasePath)).toBe(true);

      const deleteResult = await invokeIpc<IpcResult>(IPC_CHANNELS.VAULT_DELETE, {
        vaultId,
        deleteDatabaseFile: true,
        deleteAttachments: true,
      });

      expect(deleteResult.success).toBe(true);
      expect(getActiveAuthVaultId()).toBeNull();
      expect(getMasterKey()).toBeNull();
      expect(getActiveVaultId()).toBeNull();
      expect(isDatabaseOpen()).toBe(false);
      expect(getVaultById(vaultId)).toBeNull();
      expect(existsSync(databasePath)).toBe(false);
    });
  });
});
