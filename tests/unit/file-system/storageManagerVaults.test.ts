import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { VaultRegistryFile } from '../../../src/shared/types';
import {
  createVaultMetadata,
  deleteVaultMetadata,
  ensureDefaultVaultRegistry,
  listVaultMetadata,
  readVaultMetadata,
  renameVaultMetadata,
  resolveNewVaultDatabasePath,
  resolveVaultDatabasePath,
  validateVault,
} from '../../../src/main/file-system/storageManager';
import { invalidateRegistryCache } from '../../../src/main/file-system/vaultRegistry';

const testDataDir = join(process.cwd(), 'test-data', 'storage-manager-vaults');
const registryPath = join(testDataDir, 'vault-registry.json');
const legacyDatabasePath = join(testDataDir, 'securepass.db');

vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => {
      if (name !== 'userData') {
        throw new Error(`Unexpected Electron path request: ${name}`);
      }
      return testDataDir;
    },
  },
}));

function resetTestData(): void {
  invalidateRegistryCache();
  rmSync(testDataDir, { recursive: true, force: true });
  mkdirSync(testDataDir, { recursive: true });
}

describe('Storage Manager vault APIs', () => {
  beforeEach(() => {
    resetTestData();
  });

  afterEach(() => {
    resetTestData();
  });

  it('creates metadata and resolves the database path by vaultId', () => {
    const vault = createVaultMetadata({ name: 'Personal' });

    expect(readVaultMetadata(vault.id).name).toBe('Personal');
    expect(resolveVaultDatabasePath(vault.id)).toBe(vault.databasePath);
    expect(vault.databasePath).toBe(join(testDataDir, 'vaults', `vault-${vault.id}.db`));
  });

  it('renames vault metadata without moving the database path', () => {
    const vault = createVaultMetadata({ name: 'Work' });
    const originalPath = vault.databasePath;

    const renamed = renameVaultMetadata(vault.id, 'Work Archive');

    expect(renamed.name).toBe('Work Archive');
    expect(renamed.databasePath).toBe(originalPath);
    expect(resolveVaultDatabasePath(vault.id)).toBe(originalPath);
  });

  it('rejects registry entries whose managed database path escapes the vault directory', () => {
    const unsafeVaultId = '550e8400-e29b-41d4-a716-446655440000';
    const registry: VaultRegistryFile = {
      version: 1,
      vaults: [
        {
          id: unsafeVaultId,
          name: 'Unsafe',
          databasePath: join(testDataDir, 'securepass.db'),
          createdAt: Date.now(),
          lastOpenedAt: null,
          lastOpenedVersion: null,
          description: null,
          color: null,
          icon: null,
          isDefault: true,
          sortOrder: 1,
          isCustomLocation: false,
        },
      ],
    };
    writeFileSync(registryPath, JSON.stringify(registry), 'utf-8');
    invalidateRegistryCache();

    expect(() => validateVault(unsafeVaultId)).toThrow(
      'Vault database path is outside the managed vault directory',
    );
  });

  it('deletes registry metadata and optionally removes the vault database file', () => {
    const vault = createVaultMetadata({ name: 'Delete Me' });
    writeFileSync(vault.databasePath, 'database-bytes');

    const removed = deleteVaultMetadata(vault.id, { deleteDatabaseFile: true });

    expect(removed.id).toBe(vault.id);
    expect(listVaultMetadata()).toEqual([]);
    expect(existsSync(vault.databasePath)).toBe(false);
  });

  it('migrates a legacy single-vault database into the default vault registry entry', () => {
    writeFileSync(legacyDatabasePath, 'legacy-database-bytes');

    const migrated = ensureDefaultVaultRegistry();

    expect(migrated).not.toBeNull();
    expect(migrated!.name).toBe('Default Vault');
    expect(migrated!.databasePath).toBe(legacyDatabasePath);
    expect(migrated!.isDefault).toBe(true);
    expect(migrated!.isCustomLocation).toBe(true);
    expect(listVaultMetadata()).toHaveLength(1);
  });

  it('does not create a default vault when no legacy database exists', () => {
    const migrated = ensureDefaultVaultRegistry();

    expect(migrated).toBeNull();
    expect(listVaultMetadata()).toEqual([]);
  });

  it('resolves new managed vault paths inside the vault directory', () => {
    const path = resolveNewVaultDatabasePath('550e8400-e29b-41d4-a716-446655440000');

    expect(path).toBe(join(testDataDir, 'vaults', 'vault-550e8400-e29b-41d4-a716-446655440000.db'));
  });
});
