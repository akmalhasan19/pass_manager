/**
 * Sub-Task 5.2: Integration Tests untuk Unlock Dual-Path
 *
 * These tests cover the `unlockVault()` function with three different
 * auth metadata formats to verify the dual-read path:
 *
 *  1. Legacy PBKDF2 metadata (explicit `kdfAlgorithm: "pbkdf2"`)
 *  2. New Argon2id metadata (explicit `kdfAlgorithm: "argon2id"`)
 *  3. Vaults without the `kdfAlgorithm` field — must default to PBKDF2
 *
 * The tests use the real Argon2id native module (when available) and a real
 * sql.js database so the full unlock pipeline is exercised end-to-end.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const testDataDir = join(process.cwd(), 'test-data', 'unlock-dual-path');

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
  unlockVault,
  clearKeys,
  getCurrentKdfAlgorithm,
  getCurrentKdfIterations,
  getActiveAuthVaultId,
  getMasterKey,
} from '@main/ipc/authHandlers';
import {
  closeDatabase,
  isDatabaseOpen,
  getActiveVaultId,
  initializeSqlJs,
} from '@main/database/connection';
import {
  invalidateRegistryCache,
  createVault,
  getVaultById,
  resolveVaultDatabasePath,
} from '@main/file-system/vaultRegistry';
import {
  writeVaultAuthMetadata,
  getVaultAuthPath,
  vaultAuthFileExists,
} from '@main/file-system/vaultAuthStorage';
import { generateSalt, hashKeyForVerification, deriveMasterKey } from '@main/crypto/keyDerivation';
import type { AuthMetadata } from '@shared/types';
import { KDF_VERSION } from '@shared/constants';

const MASTER_PASSWORD = 'MyStr0ng!M@sterP@ssword';

const TEST_PBKDF2_ITERATIONS = 1000;

const TEST_ARGON2ID_PARAMS = {
  algorithm: 'argon2id' as const,
  memoryCost: 1024,
  timeCost: 1,
  parallelism: 1,
};

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
  const salt = generateSalt();
  const key = await deriveMasterKey(MASTER_PASSWORD, salt, TEST_ARGON2ID_PARAMS);
  return {
    salt,
    kdfAlgorithm: 'argon2id',
    kdfIterations: TEST_ARGON2ID_PARAMS.timeCost,
    kdfMemory: TEST_ARGON2ID_PARAMS.memoryCost,
    kdfParallelism: TEST_ARGON2ID_PARAMS.parallelism,
    verificationHash: hashKeyForVerification(key),
    createdAt: Date.now(),
    kdfParams: { ...TEST_ARGON2ID_PARAMS },
    kdfVersion: KDF_VERSION,
    migratedAt: Date.now(),
  };
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

function teardownTestData(): void {
  closeDatabase();
  clearKeys();
  invalidateRegistryCache();
}

describe('Sub-Task 5.2: Unlock Dual-Path Integration', () => {
  beforeEach(async () => {
    resetTestData();
    await initializeSqlJs();
  });

  afterEach(() => {
    teardownTestData();
  });

  describe('unlock with legacy PBKDF2 metadata', () => {
    it('should unlock a vault using legacy PBKDF2 metadata without crashing', async () => {
      const vault = createVault({ name: 'Legacy PBKDF2 Vault' });
      const vaultId = vault.id;
      expect(getVaultById(vaultId)).not.toBeNull();

      const authMetadata = await buildPbkdf2AuthMetadata();
      writeVaultAuthMetadata(vaultId, authMetadata);
      expect(vaultAuthFileExists(vaultId)).toBe(true);

      const result = await unlockVault(vaultId, MASTER_PASSWORD);

      expect(result.success).toBe(true);
      expect(result.vaultId).toBe(vaultId);
      expect(result.error).toBeUndefined();
      expect(result.needsMigration).toBe(true);

      expect(getActiveAuthVaultId()).toBe(vaultId);
      expect(getCurrentKdfAlgorithm()).toBe('pbkdf2');
      expect(getCurrentKdfIterations()).toBe(TEST_PBKDF2_ITERATIONS);
      expect(getMasterKey()).not.toBeNull();
      expect(getMasterKey()?.length).toBe(32);

      expect(isDatabaseOpen()).toBe(true);
      expect(getActiveVaultId()).toBe(vaultId);
    });

    it('should reject unlock with a wrong password but still treat it as a PBKDF2 vault', async () => {
      const vault = createVault({ name: 'Wrong Password PBKDF2' });
      const vaultId = vault.id;

      const authMetadata = await buildPbkdf2AuthMetadata();
      writeVaultAuthMetadata(vaultId, authMetadata);

      const result = await unlockVault(vaultId, 'Wr0ng!P@ssword');

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/invalid master password/i);
      expect(getActiveAuthVaultId()).toBeNull();
      expect(getMasterKey()).toBeNull();
      expect(isDatabaseOpen()).toBe(false);
    });
  });

  describe('unlock with new Argon2id metadata', () => {
    it('should unlock a vault using new Argon2id metadata without crashing', async () => {
      const vault = createVault({ name: 'Modern Argon2id Vault' });
      const vaultId = vault.id;

      const authMetadata = await buildArgon2idAuthMetadata();
      writeVaultAuthMetadata(vaultId, authMetadata);
      expect(vaultAuthFileExists(vaultId)).toBe(true);

      const result = await unlockVault(vaultId, MASTER_PASSWORD);

      expect(result.success).toBe(true);
      expect(result.vaultId).toBe(vaultId);
      expect(result.error).toBeUndefined();
      expect(result.needsMigration).toBe(false);

      expect(getActiveAuthVaultId()).toBe(vaultId);
      expect(getCurrentKdfAlgorithm()).toBe('argon2id');
      expect(getCurrentKdfIterations()).toBe(TEST_ARGON2ID_PARAMS.timeCost);
      expect(getMasterKey()).not.toBeNull();
      expect(getMasterKey()?.length).toBe(32);

      expect(isDatabaseOpen()).toBe(true);
      expect(getActiveVaultId()).toBe(vaultId);
    });

    it('should prefer structured kdfParams over the flat fields when both are present', async () => {
      const vault = createVault({ name: 'Argon2id kdfParams Preferred' });
      const vaultId = vault.id;

      const salt = generateSalt();
      const key = await deriveMasterKey(MASTER_PASSWORD, salt, TEST_ARGON2ID_PARAMS);
      const verificationHash = hashKeyForVerification(key);

      const authMetadata: AuthMetadata = {
        salt,
        kdfAlgorithm: 'argon2id',
        kdfIterations: 99,
        kdfMemory: 999,
        kdfParallelism: 99,
        verificationHash,
        createdAt: Date.now(),
        kdfParams: { ...TEST_ARGON2ID_PARAMS },
        kdfVersion: KDF_VERSION,
      };
      writeVaultAuthMetadata(vaultId, authMetadata);

      const result = await unlockVault(vaultId, MASTER_PASSWORD);

      expect(result.success).toBe(true);
      expect(result.needsMigration).toBe(false);
      expect(getCurrentKdfAlgorithm()).toBe('argon2id');
      expect(getCurrentKdfIterations()).toBe(TEST_ARGON2ID_PARAMS.timeCost);
    });
  });

  describe('unlock with missing kdfAlgorithm field', () => {
    it('should assume PBKDF2 and unlock successfully when kdfAlgorithm is absent', async () => {
      const vault = createVault({ name: 'Legacy No-Field Vault' });
      const vaultId = vault.id;

      const payload = await buildLegacyNoFieldAuthMetadata();
      writeLegacyNoFieldAuthFile(vaultId, payload);

      const authPath = getVaultAuthPath(vaultId);
      const raw = JSON.parse(readFileSync(authPath, 'utf-8'));
      expect(raw.kdfAlgorithm).toBeUndefined();

      const result = await unlockVault(vaultId, MASTER_PASSWORD);

      expect(result.success).toBe(true);
      expect(result.vaultId).toBe(vaultId);
      expect(result.error).toBeUndefined();
      expect(result.needsMigration).toBe(true);

      expect(getActiveAuthVaultId()).toBe(vaultId);
      expect(getCurrentKdfAlgorithm()).toBe('pbkdf2');
      expect(getCurrentKdfIterations()).toBe(TEST_PBKDF2_ITERATIONS);
      expect(getMasterKey()).not.toBeNull();
      expect(getMasterKey()?.length).toBe(32);

      expect(isDatabaseOpen()).toBe(true);
      expect(getActiveVaultId()).toBe(vaultId);
    });

    it('should reject wrong passwords on legacy no-field vaults without crashing', async () => {
      const vault = createVault({ name: 'No-Field Wrong Password' });
      const vaultId = vault.id;

      const payload = await buildLegacyNoFieldAuthMetadata();
      writeLegacyNoFieldAuthFile(vaultId, payload);

      const result = await unlockVault(vaultId, 'TotallyWrongPassword');

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/invalid master password/i);
      expect(isDatabaseOpen()).toBe(false);
      expect(getActiveAuthVaultId()).toBeNull();
    });
  });

  describe('session state cleanup', () => {
    it('should clear the master key and close the database after the unlocked vault is locked', async () => {
      const vault = createVault({ name: 'Cleanup Test' });
      const vaultId = vault.id;

      const authMetadata = await buildPbkdf2AuthMetadata();
      writeVaultAuthMetadata(vaultId, authMetadata);

      const unlockResult = await unlockVault(vaultId, MASTER_PASSWORD);
      expect(unlockResult.success).toBe(true);
      expect(isDatabaseOpen()).toBe(true);
      expect(getMasterKey()).not.toBeNull();

      closeDatabase();
      clearKeys();

      expect(isDatabaseOpen()).toBe(false);
      expect(getActiveAuthVaultId()).toBeNull();
      expect(getMasterKey()).toBeNull();
    });
  });

  describe('vault database file lifecycle', () => {
    it('should create the database file on disk after a successful unlock', async () => {
      const vault = createVault({ name: 'DB File Created' });
      const vaultId = vault.id;
      const databasePath = resolveVaultDatabasePath(vaultId);

      const authMetadata = await buildPbkdf2AuthMetadata();
      writeVaultAuthMetadata(vaultId, authMetadata);

      const result = await unlockVault(vaultId, MASTER_PASSWORD);

      expect(result.success).toBe(true);
      expect(existsSync(databasePath)).toBe(true);
      expect(statSync(databasePath).size).toBeGreaterThan(0);
    });
  });
});
