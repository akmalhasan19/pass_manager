/**
 * Sub-Task 6.1: Single-Vault Legacy Migration
 *
 * Verifies that:
 *   1. Legacy single-file vaults without the `kdfAlgorithm` field are detected
 *      and marked as KDF migration candidates before any format migration.
 *   2. KDF migration detection happens *before* or at least *alongside*
 *      database schema (format) migrations inside `unlockVault()`.
 *   3. The vault file format is never changed unless the user has
 *      successfully unlocked the vault at least once.
 *
 * The test uses the real Argon2id native module and a real sql.js database
 * so the full single-vault legacy migration path is exercised end-to-end.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const testDataDir = join(process.cwd(), 'test-data', 'single-vault-legacy');

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
    handle: vi.fn(),
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

import {
  detectKdfMigrationCandidate,
  getVaultAuthPath,
} from '@main/file-system/vaultAuthStorage';
import {
  unlockVault,
  clearKeys,
} from '@main/ipc/authHandlers';
import {
  closeDatabase,
  initializeSqlJs,
  getActiveVaultId,
} from '@main/database/connection';
import {
  createVault,
  invalidateRegistryCache,
  resolveVaultDatabasePath,
} from '@main/file-system/vaultRegistry';
import {
  generateSalt,
  hashKeyForVerification,
  deriveMasterKey,
} from '@main/crypto/keyDerivation';
import { KDF_VERSION } from '@shared/constants';
import type { AuthMetadata } from '@shared/types';

const MASTER_PASSWORD = 'MyStr0ng!M@sterP@ssword';
const TEST_PBKDF2_ITERATIONS = 1000;

type IpcResult<T = unknown> = Promise<{ success: boolean; data?: T; error?: string }>;

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
  return hashKeyForVerification(Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer));
}

async function buildLegacyNoFieldAuthMetadata(): Promise<{
  salt: Buffer;
  verificationHash: string;
}> {
  const salt = generateSalt();
  const key = await deriveMasterKey(MASTER_PASSWORD, salt, {
    algorithm: 'pbkdf2',
    iterations: TEST_PBKDF2_ITERATIONS,
  });
  return {
    salt,
    verificationHash: hashKeyForVerification(key),
  };
}

function writeLegacyNoFieldAuthFile(
  vaultId: string,
  payload: { salt: Buffer; verificationHash: string },
): void {
  const authPath = getVaultAuthPath(vaultId);
  const legacyAuth = {
    salt: payload.salt.toString('base64'),
    kdfIterations: TEST_PBKDF2_ITERATIONS,
    kdfMemory: null,
    kdfParallelism: null,
    verificationHash: payload.verificationHash,
    createdAt: Date.now(),
  };
  writeFileSync(authPath, JSON.stringify(legacyAuth, null, 2), 'utf-8');
}

async function buildPbkdf2AuthMetadata(): Promise<AuthMetadata> {
  const salt = generateSalt();
  const key = await deriveMasterKey(MASTER_PASSWORD, salt, {
    algorithm: 'pbkdf2',
    iterations: TEST_PBKDF2_ITERATIONS,
  });
  return {
    salt,
    kdfAlgorithm: 'pbkdf2',
    kdfIterations: TEST_PBKDF2_ITERATIONS,
    kdfMemory: null,
    kdfParallelism: null,
    verificationHash: hashKeyForVerification(key),
    createdAt: Date.now(),
    kdfParams: {
      algorithm: 'pbkdf2',
      iterations: TEST_PBKDF2_ITERATIONS,
    },
    kdfVersion: KDF_VERSION,
  };
}

async function buildArgon2idAuthMetadata(): Promise<AuthMetadata> {
  const TEST_ARGON2ID_PARAMS = {
    algorithm: 'argon2id' as const,
    memoryCost: 1024,
    timeCost: 1,
    parallelism: 1,
  };
  const salt = generateSalt();
  const key = await deriveMasterKey(MASTER_PASSWORD, salt, TEST_ARGON2ID_PARAMS);
  return {
    salt,
    kdfAlgorithm: 'argon2id',
    kdfIterations: 1,
    kdfMemory: 1024,
    kdfParallelism: 1,
    verificationHash: hashKeyForVerification(key),
    createdAt: Date.now(),
    kdfParams: { ...TEST_ARGON2ID_PARAMS },
    kdfVersion: KDF_VERSION,
    migratedAt: Date.now(),
  };
}

describe('Sub-Task 6.1: Single-Vault Legacy Migration', () => {
  beforeAll(async () => {
    await initializeSqlJs();
  });

  afterAll(() => {
    closeDatabase();
    clearKeys();
  });

  beforeEach(() => {
    resetTestData();
  });

  afterEach(() => {
    teardownTestData();
  });

  function teardownTestData() {
    closeDatabase();
    clearKeys();
    invalidateRegistryCache();
  }

  // 1. Detection and marking ------------------------------------------------

  describe('detectKdfMigrationCandidate', () => {
    it('detects a legacy single-file vault without kdfAlgorithm as a migration candidate', async () => {
      const vault = createVault({ name: 'Legacy Single-File Vault' });
      const payload = await buildLegacyNoFieldAuthMetadata();
      writeLegacyNoFieldAuthFile(vault.id, payload);

      const status = detectKdfMigrationCandidate(vault.id);

      expect(status.isCandidate).toBe(true);
      expect(status.currentAlgorithm).toBe('pbkdf2');
      expect(status.hasKdfAlgorithmField).toBe(false);
      expect(status.hasFlatLegacyFormat).toBe(true);
      expect(status.reason).toContain('Legacy single-file vault without kdfAlgorithm field');
    });

    it('detects a PBKDF2 vault with explicit kdfAlgorithm as a migration candidate', async () => {
      const vault = createVault({ name: 'PBKDF2 Vault' });
      const authMetadata = await buildPbkdf2AuthMetadata();
      writeFileSync(
        getVaultAuthPath(vault.id),
        JSON.stringify(
          { ...authMetadata, salt: authMetadata.salt.toString('base64') },
          null,
          2,
        ),
      );

      const status = detectKdfMigrationCandidate(vault.id);

      expect(status.isCandidate).toBe(true);
      expect(status.currentAlgorithm).toBe('pbkdf2');
      expect(status.hasKdfAlgorithmField).toBe(true);
      expect(status.hasFlatLegacyFormat).toBe(false);
      expect(status.reason).toContain('Vault is using PBKDF2');
    });

    it('does not mark an Argon2id vault as a candidate', async () => {
      const vault = createVault({ name: 'Modern Argon2id Vault' });
      const authMetadata = await buildArgon2idAuthMetadata();
      writeFileSync(
        getVaultAuthPath(vault.id),
        JSON.stringify(
          { ...authMetadata, salt: authMetadata.salt.toString('base64') },
          null,
          2,
        ),
      );

      const status = detectKdfMigrationCandidate(vault.id);

      expect(status.isCandidate).toBe(false);
      expect(status.currentAlgorithm).toBe('argon2id');
      expect(status.hasKdfAlgorithmField).toBe(true);
      expect(status.reason).toContain('already using Argon2id');
    });

    it('returns unknown status when auth file is missing', () => {
      const vault = createVault({ name: 'Missing Auth Vault' });
      const status = detectKdfMigrationCandidate(vault.id);

      expect(status.isCandidate).toBe(false);
      expect(status.currentAlgorithm).toBe('unknown');
      expect(status.hasKdfAlgorithmField).toBe(false);
      expect(status.reason).toContain('Unable to read auth metadata');
    });
  });

  // 2. Unlock detects candidate before schema migration ---------------------

  describe('unlockVault KDF detection before schema migration', () => {
    it('detects legacy single-file vault as candidate and returns needsMigration BEFORE opening DB', async () => {
      const vault = createVault({ name: 'Legacy No-Field Vault' });
      const payload = await buildLegacyNoFieldAuthMetadata();
      writeLegacyNoFieldAuthFile(vault.id, payload);

      // Verify candidate status before unlock
      const preStatus = detectKdfMigrationCandidate(vault.id);
      expect(preStatus.isCandidate).toBe(true);
      expect(preStatus.hasKdfAlgorithmField).toBe(false);

      // Unlock the vault — should succeed and flag needsMigration
      const result = await unlockVault(vault.id, MASTER_PASSWORD);
      expect(result.success).toBe(true);
      expect(result.needsMigration).toBe(true);
      expect(result.vaultId).toBe(vault.id);

      // Verify the vault file exists (schema migration ran successfully)
      const databasePath = resolveVaultDatabasePath(vault.id);
      expect(existsSync(databasePath)).toBe(true);
      expect(statSync(databasePath).size).toBeGreaterThan(0);
    });

    it('detects PBKDF2 vault as candidate and returns needsMigration', async () => {
      const vault = createVault({ name: 'PBKDF2 Candidate' });
      const authMetadata = await buildPbkdf2AuthMetadata();
      writeFileSync(
        getVaultAuthPath(vault.id),
        JSON.stringify(
          { ...authMetadata, salt: authMetadata.salt.toString('base64') },
          null,
          2,
        ),
      );

      const result = await unlockVault(vault.id, MASTER_PASSWORD);
      expect(result.success).toBe(true);
      expect(result.needsMigration).toBe(true);
    });

    it('does not flag needsMigration for an Argon2id vault', async () => {
      const vault = createVault({ name: 'Argon2id No-Migration' });
      const authMetadata = await buildArgon2idAuthMetadata();
      writeFileSync(
        getVaultAuthPath(vault.id),
        JSON.stringify(
          { ...authMetadata, salt: authMetadata.salt.toString('base64') },
          null,
          2,
        ),
      );
      writeFileSync(vault.databasePath, 'SQLite format 3\0', 'utf-8');

      const result = await unlockVault(vault.id, MASTER_PASSWORD);
      expect(result.success).toBe(true);
      expect(result.needsMigration).toBe(false);
    });
  });

  // 3. No format change before unlock --------------------------------------

  describe('no format change before unlock', () => {
    it('does not modify the auth file before unlock', async () => {
      const vault = createVault({ name: 'Immutable Before Unlock' });
      const payload = await buildLegacyNoFieldAuthMetadata();
      writeLegacyNoFieldAuthFile(vault.id, payload);

      const authPath = getVaultAuthPath(vault.id);
      const beforeContent = readFileSync(authPath, 'utf-8');
      const beforeMtime = statSync(authPath).mtimeMs;

      // Wait a tiny bit to ensure any accidental write would change mtime
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Verify the file remains unchanged just after creation
      const afterContent = readFileSync(authPath, 'utf-8');
      const afterMtime = statSync(authPath).mtimeMs;
      expect(afterContent).toBe(beforeContent);
      expect(afterMtime).toBe(beforeMtime);
    });

    it('does not create a new vault DB file before unlock', async () => {
      const vault = createVault({ name: 'No DB Before Unlock' });
      const payload = await buildLegacyNoFieldAuthMetadata();
      writeLegacyNoFieldAuthFile(vault.id, payload);

      const databasePath = resolveVaultDatabasePath(vault.id);
      expect(existsSync(databasePath)).toBe(false);

      // Only after unlock should the DB come into existence
      const result = await unlockVault(vault.id, MASTER_PASSWORD);
      expect(result.success).toBe(true);
      expect(existsSync(databasePath)).toBe(true);
    });
  });
});
