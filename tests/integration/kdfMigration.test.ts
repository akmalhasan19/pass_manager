/**
 * Sub-Task 5.3: Migration Tests
 *
 * Covers the PBKDF2 → Argon2id migration handler (AUTH_MIGRATE_KDF) end-to-end:
 *
 *  1. Successful migration: vault file changes, metadata updates, backup lifecycle.
 *  2. Rollback: when migration fails the old vault remains usable with PBKDF2.
 *  3. Data integrity: items survive the re-encryption round-trip (decrypt matches).
 *  4. Idempotency: a vault already on Argon2id is not migrated twice.
 *
 * The tests drive the public IPC surface (VAULT_CREATE, AUTH_UNLOCK, ITEM_CREATE,
 * AUTH_MIGRATE_KDF) and the real Argon2id native module so the migration is
 * exercised in full.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { IPC_CHANNELS } from '@shared/ipcChannels';
import { registerAuthHandlers, clearKeys, lockCurrentVault } from '@main/ipc/authHandlers';
import { registerVaultHandlers } from '@main/ipc/vaultHandlers';
import { registerItemHandlers } from '@main/ipc/itemHandlers';
import { registerFolderHandlers } from '@main/ipc/folderHandlers';
import { closeDatabase, getActiveVaultId, initializeSqlJs } from '@main/database/connection';
import { invalidateRegistryCache } from '@main/file-system/vaultRegistry';
import { readVaultAuthMetadata, getVaultAuthPath } from '@main/file-system/vaultAuthStorage';
import { generateSalt, hashKeyForVerification, deriveMasterKey } from '@main/crypto/keyDerivation';
import type { AuthMetadata, ItemDecrypted } from '@shared/types';
import { KDF_VERSION } from '@shared/constants';
import * as argon2idModule from '@main/crypto/argon2id';

const { initArgon2idEngine } = argon2idModule;

const testDataDir = join(process.cwd(), 'test-data', 'kdf-migration');

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

const MASTER_PASSWORD = 'MyStr0ng!M@sterP@ssword';

interface VaultCreateResult {
  id: string;
  name: string;
  databasePath: string;
}

interface FolderCreateResult {
  id: string;
  name: string;
}

interface ItemCreateResult {
  id: string;
  title: string;
  password: string;
  notes: string | null;
}

interface MigrateKdfResult {
  success: boolean;
  error?: string;
  fallbackOccurred?: boolean;
  fallbackReason?: string;
  fallbackToPbkdf2?: boolean;
}

interface IpcResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  vaultId?: string;
}

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
  mkdirSync(join(testDataDir, 'vaults'), { recursive: true });
  mkdirSync(join(testDataDir, 'vault-auth'), { recursive: true });
}

function sha256Hex(buffer: Buffer | string): string {
  return createHash('sha256').update(buffer).digest('hex');
}

async function createVaultWithItems(
  name: string,
  items: Array<{ title: string; password: string; notes: string | null }>,
): Promise<{ vaultId: string; databasePath: string; items: ItemCreateResult[] }> {
  const createResult = await invokeIpc<IpcResult<VaultCreateResult>>(IPC_CHANNELS.VAULT_CREATE, {
    name,
    masterPassword: MASTER_PASSWORD,
  });
  expect(createResult.success).toBe(true);
  const vaultId = createResult.data!.id;
  const databasePath = createResult.data!.databasePath;

  const folderResult = await invokeIpc<IpcResult<FolderCreateResult>>(IPC_CHANNELS.FOLDER_CREATE, {
    parentId: null,
    name: 'Migration Folder',
  });
  expect(folderResult.success).toBe(true);
  const folderId = folderResult.data!.id;

  const created: ItemCreateResult[] = [];
  for (const item of items) {
    const result = await invokeIpc<IpcResult<ItemCreateResult>>(IPC_CHANNELS.ITEM_CREATE, {
      folderId,
      title: item.title,
      username: 'user',
      password: item.password,
      url: 'https://example.com',
      notes: item.notes,
      emoji: null,
    });
    expect(result.success).toBe(true);
    created.push(result.data!);
  }

  return { vaultId, databasePath, items: created };
}

async function fetchAllItems(): Promise<ItemDecrypted[]> {
  const listResult = await invokeIpc<IpcResult<Array<{ id: string }>>>(IPC_CHANNELS.ITEM_GET_ALL);
  expect(listResult.success).toBe(true);
  const ids = (listResult.data as Array<{ id: string }>) ?? [];
  const decrypted: ItemDecrypted[] = [];
  for (const { id } of ids) {
    const itemResult = await invokeIpc<IpcResult<ItemDecrypted>>(IPC_CHANNELS.ITEM_GET_BY_ID, {
      id,
    });
    expect(itemResult.success).toBe(true);
    decrypted.push(itemResult.data as ItemDecrypted);
  }
  return decrypted;
}

function itemsDecryptedHash(items: ItemDecrypted[]): string {
  const sorted = [...items].sort((a, b) => a.id.localeCompare(b.id));
  const serialized = sorted
    .map(
      (item) =>
        `${item.id}|${item.title}|${item.username}|${item.password}|${item.notes ?? ''}|${item.url}`,
    )
    .join('\n');
  return sha256Hex(serialized);
}

async function writeArgon2idAuthFile(vaultId: string, masterPassword: string): Promise<void> {
  const salt = generateSalt();
  const key = await deriveMasterKey(masterPassword, salt, {
    algorithm: 'argon2id',
    memoryCost: 1024,
    timeCost: 1,
    parallelism: 1,
  });
  const verificationHash = hashKeyForVerification(key);
  const authMetadata: AuthMetadata = {
    salt,
    kdfAlgorithm: 'argon2id',
    kdfIterations: 1,
    kdfMemory: 1024,
    kdfParallelism: 1,
    verificationHash,
    createdAt: Date.now(),
    migratedAt: Date.now(),
    kdfParams: {
      algorithm: 'argon2id',
      memoryCost: 1024,
      timeCost: 1,
      parallelism: 1,
    },
    kdfVersion: KDF_VERSION,
  };

  const authPath = getVaultAuthPath(vaultId);
  const payload = {
    ...authMetadata,
    salt: authMetadata.salt.toString('base64'),
  };
  writeFileSync(authPath, JSON.stringify(payload, null, 2), 'utf-8');
}

describe('Sub-Task 5.3: Migration Tests (PBKDF2 → Argon2id)', () => {
  beforeAll(async () => {
    registerAuthHandlers();
    registerVaultHandlers();
    registerItemHandlers();
    registerFolderHandlers();
    await initializeSqlJs();
    await initArgon2idEngine();
  });

  afterAll(() => {
    closeDatabase();
    clearKeys();
  });

  beforeEach(() => {
    resetTestData();
  });

  describe('successful PBKDF2 → Argon2id migration', () => {
    it('rewrites the vault file, updates metadata to argon2id, and cleans up the backup', async () => {
      const { vaultId, databasePath, items } = await createVaultWithItems('Migration Success', [
        { title: 'Gmail', password: 'mySecret-P@ssw0rd!', notes: 'primary account' },
        { title: 'GitHub', password: 'anotherSecret!2024', notes: null },
      ]);
      expect(items).toHaveLength(2);

      expect(existsSync(databasePath)).toBe(true);
      const beforeFileHash = sha256Hex(readFileSync(databasePath));

      const authBefore = readVaultAuthMetadata(vaultId);
      expect(authBefore.kdfAlgorithm).toBe('pbkdf2');
      expect(authBefore.migratedAt).toBeUndefined();

      const backupPath = `${databasePath}.pre-argon2id-backup`;
      expect(existsSync(backupPath)).toBe(false);

      const result = await invokeIpc<IpcResult<MigrateKdfResult>>(IPC_CHANNELS.AUTH_MIGRATE_KDF);
      expect(result.success).toBe(true);
      expect(result.error).toBeUndefined();

      expect(existsSync(databasePath)).toBe(true);
      const afterStat = statSync(databasePath);
      expect(afterStat.size).toBeGreaterThan(0);
      const afterFileHash = sha256Hex(readFileSync(databasePath));
      expect(afterFileHash).not.toBe(beforeFileHash);

      const authAfter = readVaultAuthMetadata(vaultId);
      expect(authAfter.kdfAlgorithm).toBe('argon2id');
      expect(authAfter.kdfParams?.algorithm).toBe('argon2id');
      expect(authAfter.migratedAt).toBeDefined();
      expect(typeof authAfter.migratedAt).toBe('number');
      expect(authAfter.salt.equals(authBefore.salt)).toBe(false);
      expect(authAfter.verificationHash).not.toBe(authBefore.verificationHash);

      expect(existsSync(backupPath)).toBe(false);

      const kdfStatus = await invokeIpc<
        IpcResult<{ kdfAlgorithm: string; needsMigration: boolean; argon2idAvailable: boolean }>
      >(IPC_CHANNELS.AUTH_GET_KDF_STATUS);
      expect(kdfStatus.success).toBe(true);
      expect(kdfStatus.data?.kdfAlgorithm).toBe('argon2id');
      expect(kdfStatus.data?.needsMigration).toBe(false);
    });

    it('keeps the same in-memory master key functional so decrypted items remain readable', async () => {
      const { items } = await createVaultWithItems('Migration Session', [
        { title: 'Item A', password: 'pw-A-1', notes: 'note A' },
      ]);
      expect(items).toHaveLength(1);

      const beforeItems = await fetchAllItems();
      expect(beforeItems).toHaveLength(1);
      expect(beforeItems[0].password).toBe('pw-A-1');

      const migrateResult = await invokeIpc<IpcResult<MigrateKdfResult>>(
        IPC_CHANNELS.AUTH_MIGRATE_KDF,
      );
      expect(migrateResult.success).toBe(true);

      const afterItems = await fetchAllItems();
      expect(afterItems).toHaveLength(1);
      expect(afterItems[0].id).toBe(items[0].id);
      expect(afterItems[0].password).toBe('pw-A-1');
      expect(afterItems[0].notes).toBe('note A');
    });
  });

  describe('migration rollback on failure', () => {
    it('keeps the vault on PBKDF2 and unlockable when Argon2id derivation throws mid-migration', async () => {
      const { vaultId, databasePath, items } = await createVaultWithItems('Migration Rollback', [
        { title: 'Survives Rollback', password: 'p@ssword-rollback-1', notes: 'safe note' },
      ]);
      expect(items).toHaveLength(1);

      const beforeFileHash = sha256Hex(readFileSync(databasePath));
      const beforeAuth = readVaultAuthMetadata(vaultId);
      expect(beforeAuth.kdfAlgorithm).toBe('pbkdf2');

      const deriveSpy = vi
        .spyOn(argon2idModule, 'deriveKeyArgon2id')
        .mockImplementation(async () => {
          throw new Error('Simulated Argon2id failure during migration');
        });

      let migrateResult: IpcResult<MigrateKdfResult> | undefined;
      try {
        migrateResult = await invokeIpc<IpcResult<MigrateKdfResult>>(IPC_CHANNELS.AUTH_MIGRATE_KDF);
      } finally {
        deriveSpy.mockRestore();
      }

      expect(migrateResult).toBeDefined();
      expect(migrateResult!.success).toBe(false);
      expect(migrateResult!.error).toMatch(/argon2id|derivation|simulated/i);

      const afterFileHash = sha256Hex(readFileSync(databasePath));
      const afterAuth = readVaultAuthMetadata(vaultId);
      expect(afterAuth.kdfAlgorithm).toBe('pbkdf2');
      expect(afterAuth.verificationHash).toBe(beforeAuth.verificationHash);
      expect(afterAuth.salt.equals(beforeAuth.salt)).toBe(true);
      expect(afterFileHash).toBe(beforeFileHash);

      lockCurrentVault();

      const unlockResult = await invokeIpc<IpcResult>(IPC_CHANNELS.AUTH_UNLOCK, {
        masterPassword: MASTER_PASSWORD,
        vaultId,
      });
      expect(unlockResult.success).toBe(true);
      expect(unlockResult.needsMigration).toBe(true);

      const readBack = await fetchAllItems();
      expect(readBack).toHaveLength(1);
      expect(readBack[0].title).toBe('Survives Rollback');
      expect(readBack[0].password).toBe('p@ssword-rollback-1');
      expect(readBack[0].notes).toBe('safe note');
    });
  });

  describe('data integrity through re-encryption', () => {
    it('preserves all item plaintexts across migration (hash before == hash after)', async () => {
      const seeded: Array<{ title: string; password: string; notes: string | null }> = [
        { title: 'Item One', password: 'p@ss-1-very-secret', notes: 'notes for one' },
        { title: 'Item Two', password: 'p@ss-2-also-secret', notes: null },
        { title: 'Item Three', password: 'p@ss-3-final-secret', notes: 'multi\nline\nnotes' },
        {
          title: 'Item Four',
          password: 'p@ss-4-with-unicode-🔐-🛡️',
          notes: 'unicode notes ✓',
        },
      ];
      const { items } = await createVaultWithItems('Migration Integrity', seeded);
      expect(items).toHaveLength(seeded.length);

      const itemsBefore = await fetchAllItems();
      const hashBefore = itemsDecryptedHash(itemsBefore);

      const result = await invokeIpc<IpcResult<MigrateKdfResult>>(IPC_CHANNELS.AUTH_MIGRATE_KDF);
      expect(result.success).toBe(true);

      const itemsAfter = await fetchAllItems();
      const hashAfter = itemsDecryptedHash(itemsAfter);

      expect(itemsAfter).toHaveLength(seeded.length);
      expect(hashAfter).toBe(hashBefore);

      const titleToAfter = new Map(itemsAfter.map((it) => [it.title, it]));
      for (const seed of seeded) {
        const after = titleToAfter.get(seed.title);
        expect(after).toBeDefined();
        expect(after!.password).toBe(seed.password);
        expect(after!.notes).toBe(seed.notes);
        expect(after!.username).toBe('user');
        expect(after!.url).toBe('https://example.com');
      }

      const itemsAfterRelock = await fetchAllItems();
      expect(itemsDecryptedHash(itemsAfterRelock)).toBe(hashBefore);
    });

    it('keeps the on-disk vault file consistent: backup is removed and data remains intact', async () => {
      const seeded: Array<{ title: string; password: string; notes: string | null }> = [
        { title: 'Stable One', password: 'p@ss-stable-1', notes: null },
        { title: 'Stable Two', password: 'p@ss-stable-2', notes: 'stable notes' },
      ];
      const { databasePath } = await createVaultWithItems('Migration Integrity Stable', seeded);

      const itemsBefore = await fetchAllItems();
      const hashBefore = itemsDecryptedHash(itemsBefore);

      const backupPath = `${databasePath}.pre-argon2id-backup`;
      const result = await invokeIpc<IpcResult<MigrateKdfResult>>(IPC_CHANNELS.AUTH_MIGRATE_KDF);
      expect(result.success).toBe(true);
      expect(existsSync(backupPath)).toBe(false);

      const afterMigrateItems = await fetchAllItems();
      expect(itemsDecryptedHash(afterMigrateItems)).toBe(hashBefore);
    });
  });

  describe('no double-migration on already-Argon2id vaults', () => {
    it('rejects migration on an Argon2id vault and leaves metadata untouched', async () => {
      const createResult = await invokeIpc<IpcResult<VaultCreateResult>>(
        IPC_CHANNELS.VAULT_CREATE,
        { name: 'Already Argon2id', masterPassword: MASTER_PASSWORD },
      );
      expect(createResult.success).toBe(true);
      const vaultId = createResult.data!.id;
      const databasePath = createResult.data!.databasePath;

      lockCurrentVault();
      closeDatabase();

      await writeArgon2idAuthFile(vaultId, MASTER_PASSWORD);
      const authBefore = readVaultAuthMetadata(vaultId);
      expect(authBefore.kdfAlgorithm).toBe('argon2id');
      const fileHashBefore = sha256Hex(readFileSync(databasePath));

      const unlockResult = await invokeIpc<IpcResult>(IPC_CHANNELS.AUTH_UNLOCK, {
        masterPassword: MASTER_PASSWORD,
        vaultId,
      });
      expect(unlockResult.success).toBe(true);
      expect(unlockResult.needsMigration).toBe(false);

      const migrateResult = await invokeIpc<IpcResult<MigrateKdfResult>>(
        IPC_CHANNELS.AUTH_MIGRATE_KDF,
      );
      expect(migrateResult.success).toBe(false);
      expect(migrateResult.error).toMatch(/not using pbkdf2|migration not needed/i);

      const authAfter = readVaultAuthMetadata(vaultId);
      expect(authAfter.kdfAlgorithm).toBe('argon2id');
      expect(authAfter.migratedAt).toBe(authBefore.migratedAt);
      expect(authAfter.verificationHash).toBe(authBefore.verificationHash);
      expect(authAfter.salt.equals(authBefore.salt)).toBe(true);
      expect(authAfter.kdfIterations).toBe(authBefore.kdfIterations);
      expect(authAfter.kdfMemory).toBe(authBefore.kdfMemory);
      expect(authAfter.kdfParallelism).toBe(authBefore.kdfParallelism);

      expect(existsSync(`${databasePath}.pre-argon2id-backup`)).toBe(false);

      const fileHashAfter = sha256Hex(readFileSync(databasePath));
      expect(fileHashAfter).toBe(fileHashBefore);

      const kdfStatus = await invokeIpc<
        IpcResult<{ kdfAlgorithm: string; needsMigration: boolean }>
      >(IPC_CHANNELS.AUTH_GET_KDF_STATUS);
      expect(kdfStatus.success).toBe(true);
      expect(kdfStatus.data?.kdfAlgorithm).toBe('argon2id');
      expect(kdfStatus.data?.needsMigration).toBe(false);
    });

    it('does not loop migration when invoked twice (second call is a no-op)', async () => {
      await createVaultWithItems('No Migration Loop', [
        { title: 'Loop Item', password: 'p@ss-loop', notes: 'n' },
      ]);

      const first = await invokeIpc<IpcResult<MigrateKdfResult>>(IPC_CHANNELS.AUTH_MIGRATE_KDF);
      expect(first.success).toBe(true);

      const activeVaultId = getActiveVaultId();
      expect(activeVaultId).toBeTruthy();
      const authAfterFirst = readVaultAuthMetadata(activeVaultId as string);
      const migratedAtFirst = authAfterFirst.migratedAt;

      await new Promise((resolve) => setTimeout(resolve, 5));

      const second = await invokeIpc<IpcResult<MigrateKdfResult>>(IPC_CHANNELS.AUTH_MIGRATE_KDF);
      expect(second.success).toBe(false);
      expect(second.error).toMatch(/not using pbkdf2|migration not needed/i);

      const authAfterSecond = readVaultAuthMetadata(activeVaultId as string);
      expect(authAfterSecond.kdfAlgorithm).toBe('argon2id');
      expect(authAfterSecond.migratedAt).toBe(migratedAtFirst);
      expect(authAfterSecond.verificationHash).toBe(authAfterFirst.verificationHash);
    });
  });
});
