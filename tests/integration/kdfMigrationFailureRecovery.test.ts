/**
 * Sub-Task 6.2: Failure Recovery & Rollback Tests
 *
 * Verifies the three recovery guarantees promised in
 * `docs/PLANNING-ARGON2ID-MIGRATION.md` Sub-Task 6.2:
 *
 *  1. Automatic rollback: if migration fails, no `.tmp.*` file is
 *     left in the vault directory, the pre-migration backup is
 *     preserved, and the live vault file is unchanged.
 *  2. Manual recovery instructions: when the backup is still on
 *     disk the response carries `backupAvailable` and a
 *     `manualRecoveryInstructions` string the renderer can show.
 *  3. Failure logging: every migration failure is logged with a
 *     full stack trace and no password, key, salt, or hash ever
 *     appears in the log arguments.
 *
 * The tests drive the real `AUTH_MIGRATE_KDF` IPC handler and
 * trigger failures by mocking the underlying crypto / filesystem
 * primitives. The renderer side is exercised implicitly through
 * the IPC type contract.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { IPC_CHANNELS } from '@shared/ipcChannels';
import {
  registerAuthHandlers,
  clearKeys,
  lockCurrentVault,
} from '@main/ipc/authHandlers';
import { registerVaultHandlers } from '@main/ipc/vaultHandlers';
import { registerItemHandlers } from '@main/ipc/itemHandlers';
import { registerFolderHandlers } from '@main/ipc/folderHandlers';
import { closeDatabase, initializeSqlJs, getActiveVaultId } from '@main/database/connection';
import { invalidateRegistryCache } from '@main/file-system/vaultRegistry';
import { logger } from '@shared/logger';
import * as argon2idModule from '@main/crypto/argon2id';
import { initArgon2idEngine } from '@main/crypto/argon2id';

const testDataDir = join(process.cwd(), 'test-data', 'kdf-failure-recovery');

const ipcHandlers = new Map<string, (_event: unknown, ...args: unknown[]) => unknown>();

/**
 * Mock the `node:fs` module so the migration handler's
 * `copyFileSync` call (which creates the pre-migration backup) can
 * be made to fail. The mock delegates all other fs functions to
 * the real implementation so the rest of the test (vault create,
 * file reads, etc.) keeps working.
 */
vi.mock('node:fs', async () => {
  const mock = await import('./kdfMigrationFailureRecovery.fsMock');
  return {
    copyFileSync: mock.copyFileSync,
    existsSync: mock.existsSync,
    mkdirSync: mock.mkdirSync,
    readFileSync: mock.readFileSync,
    writeFileSync: mock.writeFileSync,
    renameSync: mock.renameSync,
    unlinkSync: mock.unlinkSync,
    rmSync: mock.rmSync,
    statSync: mock.statSync,
    readdirSync: mock.readdirSync,
    createReadStream: mock.createReadStream,
    createWriteStream: mock.createWriteStream,
  };
});

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
    handle: (
      channel: string,
      handler: (_event: unknown, ...args: unknown[]) => unknown,
    ) => {
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

const MASTER_PASSWORD = 'Failure-Recovery-M@ster-P@ssword-2024!';

interface IpcResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  vaultId?: string;
  [key: string]: unknown;
}

interface MigrateKdfResult {
  success: boolean;
  error?: string;
  fallbackOccurred?: boolean;
  fallbackReason?: string;
  fallbackToPbkdf2?: boolean;
  backupAvailable?: boolean;
  backupPath?: string;
  vaultPath?: string;
  manualRecoveryInstructions?: string;
  failureStage?: string;
  cause?: string;
  stack?: string;
}

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

async function invokeIpc<T>(channel: string, ...args: unknown[]): Promise<T> {
  const handler = ipcHandlers.get(channel);
  if (!handler) {
    throw new Error(`No IPC handler registered for channel: ${channel}`);
  }
  return handler(null, ...args) as T;
}

function sha256Hex(buf: Buffer | string): string {
  return createHash('sha256').update(buf).digest('hex');
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

function listVaultDirectoryFiles(): string[] {
  const vaultsDir = join(testDataDir, 'vaults');
  if (!existsSync(vaultsDir)) return [];
  return readdirSync(vaultsDir);
}

function listTempFiles(): string[] {
  return listVaultDirectoryFiles().filter((name) => name.includes('.tmp.'));
}

function listBackupFiles(): string[] {
  return listVaultDirectoryFiles().filter((name) => name.endsWith('.pre-argon2id-backup'));
}

async function createVaultWithItems(
  name: string,
  items: Array<{ title: string; password: string; notes: string | null }>,
): Promise<{ vaultId: string; databasePath: string; items: ItemCreateResult[] }> {
  const createResult = await invokeIpc<IpcResult<VaultCreateResult>>(
    IPC_CHANNELS.VAULT_CREATE,
    { name, masterPassword: MASTER_PASSWORD },
  );
  expect(createResult.success).toBe(true);
  const vaultId = createResult.data!.id;
  const databasePath = createResult.data!.databasePath;

  const folderResult = await invokeIpc<IpcResult<FolderCreateResult>>(
    IPC_CHANNELS.FOLDER_CREATE,
    { parentId: null, name: 'Failure Recovery Folder' },
  );
  expect(folderResult.success).toBe(true);
  const folderId = folderResult.data!.id;

  const created: ItemCreateResult[] = [];
  for (const item of items) {
    const result = await invokeIpc<IpcResult<ItemCreateResult>>(
      IPC_CHANNELS.ITEM_CREATE,
      {
        folderId,
        title: item.title,
        username: 'user',
        password: item.password,
        url: 'https://example.com',
        notes: item.notes,
        emoji: null,
      },
    );
    expect(result.success).toBe(true);
    created.push(result.data!);
  }

  return { vaultId, databasePath, items: created };
}

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

afterEach(() => {
  vi.restoreAllMocks();
  lockCurrentVault();
  closeDatabase();
  clearKeys();
  invalidateRegistryCache();
});

// =========================================================================
// 6.2.1 — Automatic rollback: temp files, backup, vault preservation
// =========================================================================

describe('6.2.1 — Automatic rollback on migration failure', () => {
  it('does not leave a `.tmp.*` file in the vault directory when derivation fails', async () => {
    await createVaultWithItems('Rollback Temp Cleanup', [
      { title: 'Stable Item', password: 'p@ss-stable-1', notes: 'note' },
    ]);

    expect(listTempFiles()).toEqual([]);

    const deriveSpy = vi
      .spyOn(argon2idModule, 'deriveKeyArgon2id')
      .mockImplementation(async () => {
        throw new Error('Simulated Argon2id derivation failure');
      });

    let result: IpcResult<MigrateKdfResult> | undefined;
    try {
      result = await invokeIpc<IpcResult<MigrateKdfResult>>(IPC_CHANNELS.AUTH_MIGRATE_KDF);
    } finally {
      deriveSpy.mockRestore();
    }

    expect(result).toBeDefined();
    expect(result!.success).toBe(false);
    expect(listTempFiles()).toEqual([]);
  });

  it('does not leave a `.tmp.*` file when re-encryption fails', async () => {
    await createVaultWithItems('Rollback Reencrypt Cleanup', [
      { title: 'Stable', password: 'p@ss-stable', notes: null },
    ]);
    expect(listTempFiles()).toEqual([]);

    const deriveSpy = vi
      .spyOn(argon2idModule, 'deriveKeyArgon2id')
      .mockImplementation(async () => {
        // The migration derives a real key, then calls reEncryptVaultData.
        // The simplest way to make re-encryption fail is to return a
        // deliberately wrong-length key: the AES-GCM call will throw
        // because the key is not 32 bytes.
        return Buffer.alloc(8, 0x42);
      });

    let result: IpcResult<MigrateKdfResult> | undefined;
    try {
      result = await invokeIpc<IpcResult<MigrateKdfResult>>(IPC_CHANNELS.AUTH_MIGRATE_KDF);
    } finally {
      deriveSpy.mockRestore();
    }

    expect(result).toBeDefined();
    expect(result!.success).toBe(false);
    expect(listTempFiles()).toEqual([]);
  });

  it('preserves the pre-migration backup file on disk for manual recovery', async () => {
    const { vaultId } = await createVaultWithItems('Rollback Backup Preserved', [
      { title: 'Item A', password: 'p@ss-A', notes: 'note A' },
    ]);

    const deriveSpy = vi
      .spyOn(argon2idModule, 'deriveKeyArgon2id')
      .mockImplementation(async () => {
        throw new Error('Simulated Argon2id failure');
      });

    let result: IpcResult<MigrateKdfResult> | undefined;
    try {
      result = await invokeIpc<IpcResult<MigrateKdfResult>>(IPC_CHANNELS.AUTH_MIGRATE_KDF);
    } finally {
      deriveSpy.mockRestore();
    }

    expect(result!.success).toBe(false);

    // The backup file must be on disk so the user can recover manually.
    const backupFiles = listBackupFiles();
    expect(backupFiles.length).toBe(1);
    const backupName = backupFiles[0];
    expect(backupName).toContain(vaultId);

    // The backup must be a byte-for-byte copy of the original vault.
    const originalBytes = readFileSync(
      join(testDataDir, 'vaults', `vault-${vaultId}.db`),
    );
    const backupBytes = readFileSync(join(testDataDir, 'vaults', backupName));
    expect(sha256Hex(backupBytes)).toBe(sha256Hex(originalBytes));
  });

  it('leaves the live vault file byte-identical to the pre-migration state', async () => {
    const { databasePath } = await createVaultWithItems('Rollback Vault Intact', [
      { title: 'Item A', password: 'p@ss-A', notes: null },
    ]);
    const beforeHash = sha256Hex(readFileSync(databasePath));

    const deriveSpy = vi
      .spyOn(argon2idModule, 'deriveKeyArgon2id')
      .mockImplementation(async () => {
        throw new Error('Simulated failure');
      });

    let result: IpcResult<MigrateKdfResult> | undefined;
    try {
      result = await invokeIpc<IpcResult<MigrateKdfResult>>(IPC_CHANNELS.AUTH_MIGRATE_KDF);
    } finally {
      deriveSpy.mockRestore();
    }

    expect(result!.success).toBe(false);
    expect(existsSync(databasePath)).toBe(true);
    const afterHash = sha256Hex(readFileSync(databasePath));
    expect(afterHash).toBe(beforeHash);
  });

  it('lets the user unlock the vault with the original master password after a failed migration', async () => {
    const { vaultId } = await createVaultWithItems('Rollback Unlock', [
      { title: 'Item A', password: 'p@ss-A-1', notes: 'note' },
    ]);
    expect(typeof vaultId).toBe('string');

    const deriveSpy = vi
      .spyOn(argon2idModule, 'deriveKeyArgon2id')
      .mockImplementation(async () => {
        throw new Error('Simulated failure');
      });

    let migrateResult: IpcResult<MigrateKdfResult> | undefined;
    try {
      migrateResult = await invokeIpc<IpcResult<MigrateKdfResult>>(IPC_CHANNELS.AUTH_MIGRATE_KDF);
    } finally {
      deriveSpy.mockRestore();
    }

    expect(migrateResult!.success).toBe(false);

    // Lock and re-unlock to simulate the user closing the app and coming back.
    lockCurrentVault();
    closeDatabase();

    const unlockResult = await invokeIpc<IpcResult<{ needsMigration?: boolean }>>(
      IPC_CHANNELS.AUTH_UNLOCK,
      { masterPassword: MASTER_PASSWORD, vaultId },
    );
    expect(unlockResult.success).toBe(true);
    // PBKDF2 vaults always need migration until the user successfully migrates.
    expect(unlockResult.needsMigration).toBe(true);
    expect(getActiveVaultId()).toBe(vaultId);
  });

  it('restores the vault from backup when re-encryption fails', async () => {
    // The migration handler restores the vault from the pre-migration
    // backup when the re-encryption step throws. We trigger a
    // re-encryption failure by returning a deliberately wrong-length
    // key from `deriveKeyArgon2id`; AES-GCM then throws because the
    // key is not 32 bytes.
    const { databasePath } = await createVaultWithItems('Rollback Reencrypt Restore', [
      { title: 'Item A', password: 'p@ss-A', notes: null },
    ]);
    const originalHash = sha256Hex(readFileSync(databasePath));

    const deriveSpy = vi
      .spyOn(argon2idModule, 'deriveKeyArgon2id')
      .mockImplementation(async () => Buffer.alloc(8, 0x42));

    let result: IpcResult<MigrateKdfResult> | undefined;
    try {
      result = await invokeIpc<IpcResult<MigrateKdfResult>>(IPC_CHANNELS.AUTH_MIGRATE_KDF);
    } finally {
      deriveSpy.mockRestore();
    }

    expect(result!.success).toBe(false);
    expect(result!.failureStage).toBe('re-encrypt');

    // The re-encrypt path restores the vault from backup. Because the
    // failure happened during AES-GCM (before the temp-file rename
    // was attempted), the live vault file is byte-identical to the
    // original. This proves the restore is a no-op in this scenario
    // (which is the safe outcome — re-encryption only writes the
    // renamed temp file on success).
    expect(existsSync(databasePath)).toBe(true);
    expect(sha256Hex(readFileSync(databasePath))).toBe(originalHash);

    // The backup is preserved for manual recovery.
    expect(result!.backupAvailable).toBe(true);
  });
});

// =========================================================================
// 6.2.2 — Manual recovery instructions
// =========================================================================

describe('6.2.2 — Manual recovery instructions when backup is available', () => {
  it('returns `backupAvailable: true` when the backup file survives the failure', async () => {
    await createVaultWithItems('Recovery Instructions Available', [
      { title: 'Item A', password: 'p@ss-A', notes: null },
    ]);

    const deriveSpy = vi
      .spyOn(argon2idModule, 'deriveKeyArgon2id')
      .mockImplementation(async () => {
        throw new Error('Simulated failure');
      });

    let result: IpcResult<MigrateKdfResult> | undefined;
    try {
      result = await invokeIpc<IpcResult<MigrateKdfResult>>(IPC_CHANNELS.AUTH_MIGRATE_KDF);
    } finally {
      deriveSpy.mockRestore();
    }

    expect(result!.success).toBe(false);
    expect(result!.backupAvailable).toBe(true);
    expect(typeof result!.backupPath).toBe('string');
    expect((result!.backupPath as string).endsWith('.pre-argon2id-backup')).toBe(true);
    expect(typeof result!.vaultPath).toBe('string');
  });

  it('includes a `manualRecoveryInstructions` string the renderer can show verbatim', async () => {
    await createVaultWithItems('Recovery Instructions String', [
      { title: 'Item A', password: 'p@ss-A', notes: null },
    ]);

    const deriveSpy = vi
      .spyOn(argon2idModule, 'deriveKeyArgon2id')
      .mockImplementation(async () => {
        throw new Error('Simulated failure');
      });

    let result: IpcResult<MigrateKdfResult> | undefined;
    try {
      result = await invokeIpc<IpcResult<MigrateKdfResult>>(IPC_CHANNELS.AUTH_MIGRATE_KDF);
    } finally {
      deriveSpy.mockRestore();
    }

    expect(result!.success).toBe(false);
    const instructions = result!.manualRecoveryInstructions;
    expect(typeof instructions).toBe('string');
    expect(instructions).toBeDefined();
    expect(instructions!.length).toBeGreaterThan(20);

    // The instructions must reference both the backup path and the
    // vault path so the user knows where to copy files.
    expect(instructions).toContain(result!.backupPath as string);
    expect(instructions).toContain(result!.vaultPath as string);

    // The instructions must mention "backup" and "vault" so the user
    // understands what is being asked of them.
    expect(instructions!.toLowerCase()).toContain('backup');
    expect(instructions!.toLowerCase()).toContain('vault');
  });

  it('omits `manualRecoveryInstructions` when backup creation fails (no recovery possible)', async () => {
    // When the very first copyFileSync (which creates the backup)
    // fails, the migration handler cannot preserve the old vault. The
    // response must therefore NOT claim a backup is available and
    // must NOT include recovery instructions.
    await createVaultWithItems('Recovery Without Backup', [
      { title: 'Item A', password: 'p@ss-A', notes: null },
    ]);

    const { mockFsState } = await import('./kdfMigrationFailureRecovery.fsMock');
    mockFsState.copyFileSyncShouldFail = true;
    try {
      const result = await invokeIpc<IpcResult<MigrateKdfResult>>(
        IPC_CHANNELS.AUTH_MIGRATE_KDF,
      );
      expect(result.success).toBe(false);
      expect(result.failureStage).toBe('backup');
      expect(result.backupAvailable).toBe(false);
      expect(result.manualRecoveryInstructions).toBeUndefined();
    } finally {
      mockFsState.copyFileSyncShouldFail = false;
    }
  });

  it('reports `backupAvailable: false` when the original backup creation failed', async () => {
    await createVaultWithItems('Recovery Backup Failed', [
      { title: 'Item A', password: 'p@ss-A', notes: null },
    ]);

    const { mockFsState } = await import('./kdfMigrationFailureRecovery.fsMock');
    mockFsState.copyFileSyncShouldFail = true;
    try {
      const result = await invokeIpc<IpcResult<MigrateKdfResult>>(
        IPC_CHANNELS.AUTH_MIGRATE_KDF,
      );
      expect(result.success).toBe(false);
      expect(result.backupAvailable).toBe(false);
      expect(result.manualRecoveryInstructions).toBeUndefined();
      expect(result.error).toMatch(/backup/i);
      expect(result.failureStage).toBe('backup');
    } finally {
      mockFsState.copyFileSyncShouldFail = false;
    }
  });

  it('includes the actual paths of the backup and vault files in the recovery instructions', async () => {
    const { databasePath } = await createVaultWithItems('Recovery Real Paths', [
      { title: 'Item A', password: 'p@ss-A', notes: null },
    ]);

    const deriveSpy = vi
      .spyOn(argon2idModule, 'deriveKeyArgon2id')
      .mockImplementation(async () => {
        throw new Error('Simulated failure');
      });

    let result: IpcResult<MigrateKdfResult> | undefined;
    try {
      result = await invokeIpc<IpcResult<MigrateKdfResult>>(IPC_CHANNELS.AUTH_MIGRATE_KDF);
    } finally {
      deriveSpy.mockRestore();
    }

    expect(result!.success).toBe(false);
    const expectedBackupPath = `${databasePath}.pre-argon2id-backup`;
    expect(result!.backupPath).toBe(expectedBackupPath);
    expect(result!.vaultPath).toBe(databasePath);
    expect(result!.manualRecoveryInstructions).toContain(expectedBackupPath);
    expect(result!.manualRecoveryInstructions).toContain(databasePath);
  });
});

// =========================================================================
// 6.2.3 — Failure logging with stack trace and no sensitive material
// =========================================================================

describe('6.2.3 — Failure logging (stack trace, no sensitive material)', () => {
  function collectLogArgs(spy: ReturnType<typeof vi.spyOn>): unknown[] {
    return spy.mock.calls.flatMap((call) => call.slice(1));
  }

  /**
   * Find the metadata object (the second arg of `logger.error`) that
   * contains a `stack` field. The migration handler logs every
   * failure with a metadata object that always includes `cause` and
   * `stack`, so this is the canonical signature of an error log.
   */
  function findLogCallWithStack(
    spy: ReturnType<typeof vi.spyOn>,
    messageFragment: string,
  ): Record<string, unknown> | undefined {
    for (const call of spy.mock.calls) {
      const [message, secondArg] = call;
      if (typeof message !== 'string' || !message.includes(messageFragment)) continue;
      if (
        secondArg &&
        typeof secondArg === 'object' &&
        'stack' in secondArg &&
        typeof (secondArg as { stack?: unknown }).stack === 'string'
      ) {
        return secondArg as Record<string, unknown>;
      }
    }
    return undefined;
  }

  it('logs the failure with a non-empty `stack` field on key-derivation failure', async () => {
    await createVaultWithItems('Log Stack Derive', [
      { title: 'Item A', password: 'p@ss-A', notes: null },
    ]);

    const errorSpy = vi.spyOn(logger, 'error');
    const deriveSpy = vi
      .spyOn(argon2idModule, 'deriveKeyArgon2id')
      .mockImplementation(async () => {
        throw new Error('Simulated key-derivation failure');
      });

    try {
      await invokeIpc<IpcResult<MigrateKdfResult>>(IPC_CHANNELS.AUTH_MIGRATE_KDF);
    } finally {
      deriveSpy.mockRestore();
    }

    const call = findLogCallWithStack(errorSpy, 'key derivation failed');
    expect(call).toBeDefined();
    const stack = call!.stack as string;
    expect(stack.length).toBeGreaterThan(0);
    expect(stack).toContain('Error');
    expect(stack).toContain('Simulated key-derivation failure');
  });

  it('logs the failure with a non-empty `stack` field on re-encryption failure', async () => {
    await createVaultWithItems('Log Stack Reencrypt', [
      { title: 'Item A', password: 'p@ss-A', notes: null },
    ]);

    const errorSpy = vi.spyOn(logger, 'error');
    const deriveSpy = vi
      .spyOn(argon2idModule, 'deriveKeyArgon2id')
      .mockImplementation(async () => {
        // Wrong-length key causes AES-GCM to throw inside reEncryptVaultData.
        return Buffer.alloc(8, 0x42);
      });

    try {
      await invokeIpc<IpcResult<MigrateKdfResult>>(IPC_CHANNELS.AUTH_MIGRATE_KDF);
    } finally {
      deriveSpy.mockRestore();
    }

    const call = findLogCallWithStack(errorSpy, 're-encryption failed');
    expect(call).toBeDefined();
    const stack = call!.stack as string;
    expect(stack.length).toBeGreaterThan(0);
  });

  it('logs the failure with a non-empty `stack` field on backup creation failure', async () => {
    await createVaultWithItems('Log Stack Backup', [
      { title: 'Item A', password: 'p@ss-A', notes: null },
    ]);

    const errorSpy = vi.spyOn(logger, 'error');
    const { mockFsState } = await import('./kdfMigrationFailureRecovery.fsMock');
    mockFsState.copyFileSyncShouldFail = true;
    try {
      await invokeIpc<IpcResult<MigrateKdfResult>>(IPC_CHANNELS.AUTH_MIGRATE_KDF);
    } finally {
      mockFsState.copyFileSyncShouldFail = false;
    }

    const call = findLogCallWithStack(errorSpy, 'backup before migration');
    expect(call).toBeDefined();
    const stack = call!.stack as string;
    expect(stack.length).toBeGreaterThan(0);
  });

  it('does not log the master password, derived key, salt, or verification hash', async () => {
    await createVaultWithItems('Log No Secrets', [
      { title: 'Item A', password: 'p@ss-A', notes: null },
    ]);

    const errorSpy = vi.spyOn(logger, 'error');
    const deriveSpy = vi
      .spyOn(argon2idModule, 'deriveKeyArgon2id')
      .mockImplementation(async () => {
        throw new Error('Simulated failure for log test');
      });

    try {
      await invokeIpc<IpcResult<MigrateKdfResult>>(IPC_CHANNELS.AUTH_MIGRATE_KDF);
    } finally {
      deriveSpy.mockRestore();
    }

    const allArgs = collectLogArgs(errorSpy);
    expect(allArgs.length).toBeGreaterThan(0);

    const serialized = JSON.stringify(allArgs);

    // The master password must never appear in any log argument.
    expect(serialized).not.toContain(MASTER_PASSWORD);

    // Standard sensitive field names that should not be emitted with
    // a real value. The logger redaction layer replaces these with
    // "[REDACTED]" but we additionally check that no plaintext salt,
    // key, password, or hash bytes leak through.
    const sensitiveNeedles = [
      MASTER_PASSWORD.toLowerCase(),
      'master_password',
      'masterpassword',
    ];
    for (const needle of sensitiveNeedles) {
      expect(serialized.toLowerCase()).not.toContain(needle);
    }

    // The result's stack trace can mention internal helpers; we only
    // assert that no plaintext salt/verifier bytes (long hex strings
    // matching the salt / verification format) appear in the logs.
    // Salts are 32 bytes → 44-char base64. Verification hashes are
    // 32-byte SHA-256 → 64-char hex. We assert no such patterns.
    const longBase64 = /[A-Za-z0-9+/]{40,}={0,2}/g;
    const longHex = /[a-f0-9]{64,}/g;
    expect(serialized.match(longBase64) ?? []).toEqual([]);
    expect(serialized.match(longHex) ?? []).toEqual([]);
  });

  it('reports a `failureStage` field for every error path so QA can group failures', async () => {
    // Path 1: preflight (no vault unlocked)
    closeDatabase();
    clearKeys();
    const preflightResult = await invokeIpc<IpcResult<MigrateKdfResult>>(
      IPC_CHANNELS.AUTH_MIGRATE_KDF,
    );
    expect(preflightResult.success).toBe(false);
    expect(preflightResult.failureStage).toBe('preflight');

    // Re-create the vault for the next failure path.
    await createVaultWithItems('Log Failure Stages', [
      { title: 'Item A', password: 'p@ss-A', notes: null },
    ]);

    // Path 2: backup creation
    const { mockFsState: mockState } = await import(
      './kdfMigrationFailureRecovery.fsMock'
    );
    mockState.copyFileSyncShouldFail = true;
    let backupResult: IpcResult<MigrateKdfResult> | undefined;
    try {
      backupResult = await invokeIpc<IpcResult<MigrateKdfResult>>(
        IPC_CHANNELS.AUTH_MIGRATE_KDF,
      );
    } finally {
      mockState.copyFileSyncShouldFail = false;
    }
    expect(backupResult).toBeDefined();
    expect(backupResult!.success).toBe(false);
    expect(backupResult!.failureStage).toBe('backup');

    // Path 3: key derivation
    const deriveSpy = vi
      .spyOn(argon2idModule, 'deriveKeyArgon2id')
      .mockImplementation(async () => {
        throw new Error('Simulated derivation failure');
      });
    const deriveResult = await invokeIpc<IpcResult<MigrateKdfResult>>(
      IPC_CHANNELS.AUTH_MIGRATE_KDF,
    );
    expect(deriveResult.success).toBe(false);
    expect(deriveResult.failureStage).toBe('key-derivation');
    deriveSpy.mockRestore();

    // Path 4: re-encryption
    const badKeySpy = vi
      .spyOn(argon2idModule, 'deriveKeyArgon2id')
      .mockImplementation(async () => Buffer.alloc(8, 0x42));
    const reencryptResult = await invokeIpc<IpcResult<MigrateKdfResult>>(
      IPC_CHANNELS.AUTH_MIGRATE_KDF,
    );
    expect(reencryptResult.success).toBe(false);
    expect(reencryptResult.failureStage).toBe('re-encrypt');
    badKeySpy.mockRestore();
  });
});
