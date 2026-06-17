import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  existsSync,
  unlinkSync,
  writeFileSync,
  mkdirSync,
  rmSync,
  readdirSync,
  readFileSync,
} from 'node:fs';
import { join } from 'node:path';
import {
  createVault,
  deleteVault,
  listVaults,
  getVaultById,
  invalidateRegistryCache,
  recoverRegistryFromDisk,
  commitRecovery,
  checkVaultFileStatus,
  checkAllVaultFiles,
  removeMissingVaults,
  backupRegistryFile,
  restoreRegistryFromBackup,
} from '../../../src/main/file-system/vaultRegistry';
import { generateVaultId } from '../../../src/shared/vaultPathStrategy';
import type { VaultRegistryEntry } from '../../../src/shared/types';

const testDataDir = join(process.cwd(), 'data');
const registryPath = join(testDataDir, 'vault-registry.json');
const vaultsDir = join(testDataDir, 'vaults');
const authDir = join(testDataDir, 'vault-auth');

function cleanTestData(): void {
  invalidateRegistryCache();

  // Delete registry
  if (existsSync(registryPath)) {
    unlinkSync(registryPath);
  }

  // Clean vaults directory
  if (existsSync(vaultsDir)) {
    const files = readdirSync(vaultsDir);
    for (const f of files) {
      unlinkSync(join(vaultsDir, f));
    }
  } else {
    mkdirSync(vaultsDir, { recursive: true });
  }

  // Clean auth directory
  if (existsSync(authDir)) {
    const files = readdirSync(authDir);
    for (const f of files) {
      unlinkSync(join(authDir, f));
    }
  } else {
    mkdirSync(authDir, { recursive: true });
  }

  // Clean any registry backups
  const dataFiles = readdirSync(testDataDir);
  for (const f of dataFiles) {
    if (f.startsWith('vault-registry.json.backup')) {
      unlinkSync(join(testDataDir, f));
    }
  }
}

function createVaultFileOnDisk(vaultId: string): string {
  const dbPath = join(vaultsDir, `vault-${vaultId}.db`);
  writeFileSync(dbPath, 'SQLite format 3\0mock database content');
  return dbPath;
}

function createAuthFileOnDisk(vaultId: string): void {
  if (!existsSync(authDir)) {
    mkdirSync(authDir, { recursive: true });
  }
  const authPath = join(authDir, `${vaultId}.auth.json`);
  writeFileSync(
    authPath,
    JSON.stringify({
      salt: 'dGVzdC1zYWx0',
      kdfAlgorithm: 'pbkdf2',
      kdfIterations: 600000,
      verificationHash: 'test-hash',
      createdAt: Date.now(),
    }),
  );
}

/**
 * Creates a vault and also creates its matching auth metadata file on disk,
 * simulating a fully initialized vault in production.
 */
function createInitializedVault(name: string, options?: { isDefault?: boolean }): VaultRegistryEntry {
  const vault = createVault({ name, ...options });
  writeFileSync(vault.databasePath, 'SQLite format 3\0mock database content');
  createAuthFileOnDisk(vault.id);
  invalidateRegistryCache();
  return vault;
}

describe('Vault Failure Recovery', () => {
  beforeEach(() => {
    cleanTestData();
  });

  afterEach(() => {
    cleanTestData();
  });

  // ─── Registry Backup and Rollback ─────────────────────────────────

  describe('backupRegistryFile and restoreRegistryFromBackup', () => {
    it('creates a backup of the registry file', () => {
      const vault = createVault({ name: 'Test Vault' });
      const backupPath = backupRegistryFile();

      expect(backupPath).not.toBeNull();
      expect(existsSync(backupPath!)).toBe(true);

      const backupContent = JSON.parse(readFileSync(backupPath!, 'utf-8'));
      expect(backupContent.vaults).toHaveLength(1);
      expect(backupContent.vaults[0].id).toBe(vault.id);
    });

    it('returns null if no registry file exists', () => {
      const backupPath = backupRegistryFile();
      expect(backupPath).toBeNull();
    });

    it('restores registry from a backup file', () => {
      const vault = createVault({ name: 'Original Vault' });
      const backupPath = backupRegistryFile()!;

      // Corrupt the registry by deleting the vault
      deleteVault(vault.id);
      expect(getVaultById(vault.id)).toBeNull();

      // Restore from backup
      const restored = restoreRegistryFromBackup(backupPath);
      expect(restored).toBe(true);

      // Verify the vault is back
      invalidateRegistryCache();
      const found = getVaultById(vault.id);
      expect(found).not.toBeNull();
      expect(found!.name).toBe('Original Vault');
    });

    it('returns false if backup file does not exist', () => {
      const result = restoreRegistryFromBackup('/nonexistent/backup.json');
      expect(result).toBe(false);
    });

    it('multiple backups can be created', () => {
      createVault({ name: 'Vault A' });
      const bp1 = backupRegistryFile();
      expect(bp1).not.toBeNull();

      createVault({ name: 'Vault B' });
      const bp2 = backupRegistryFile();
      expect(bp2).not.toBeNull();

      expect(bp1).not.toBe(bp2);
    });
  });

  // ─── Registry Recovery from Disk ──────────────────────────────────

  describe('recoverRegistryFromDisk', () => {
    it('returns empty array when no vault files exist on disk', () => {
      const recovered = recoverRegistryFromDisk();
      expect(recovered).toEqual([]);
    });

    it('discovers vault database files in the vaults directory', () => {
      const id1 = generateVaultId();
      const id2 = generateVaultId();
      createVaultFileOnDisk(id1);
      createVaultFileOnDisk(id2);

      const recovered = recoverRegistryFromDisk();
      expect(recovered).toHaveLength(2);

      const ids = recovered.map((v) => v.id);
      expect(ids).toContain(id1);
      expect(ids).toContain(id2);
    });

    it('discovers auth metadata files without matching db files', () => {
      const id = generateVaultId();
      createAuthFileOnDisk(id);

      const recovered = recoverRegistryFromDisk();
      expect(recovered).toHaveLength(1);
      expect(recovered[0].id).toBe(id);
    });

    it('ignores files that do not match vault-{uuid}.db pattern', () => {
      writeFileSync(join(vaultsDir, 'random-file.db'), 'data');
      writeFileSync(join(vaultsDir, 'vault-not-a-uuid.db'), 'data');

      const recovered = recoverRegistryFromDisk();
      expect(recovered).toEqual([]);
    });

    it('ignores invalid UUID files in vaults directory', () => {
      writeFileSync(join(vaultsDir, 'vault-00000000-0000-0000-0000-000000000000.db'), 'data');

      const recovered = recoverRegistryFromDisk();
      // This is a valid UUID v4 pattern? No, 00000000-0000-0000-0000-000000000000 is not v4
      // (version should be 4). Let's check.
      expect(recovered).toHaveLength(0);
    });

    it('does not duplicate entries found in both vaults and auth dirs', () => {
      const id = generateVaultId();
      createVaultFileOnDisk(id);
      createAuthFileOnDisk(id);

      const recovered = recoverRegistryFromDisk();
      expect(recovered).toHaveLength(1);
    });

    it('generates descriptive names for recovered vaults', () => {
      const id = generateVaultId();
      createVaultFileOnDisk(id);

      const recovered = recoverRegistryFromDisk();
      expect(recovered[0].name).toContain('Recovered Vault');
      expect(recovered[0].description).toContain('Recovered from disk');
    });

    it('assigns sequential sort order to recovered entries', () => {
      const ids = [generateVaultId(), generateVaultId(), generateVaultId()];
      for (const id of ids) {
        createVaultFileOnDisk(id);
      }

      const recovered = recoverRegistryFromDisk();
      expect(recovered).toHaveLength(3);
      expect(recovered[0].sortOrder).toBe(0);
      expect(recovered[1].sortOrder).toBe(1);
      expect(recovered[2].sortOrder).toBe(2);
    });
  });

  // ─── Commit Recovery ──────────────────────────────────────────────

  describe('commitRecovery', () => {
    it('replaces registry contents with recovered entries', () => {
      // First create a normal vault
      const original = createVault({ name: 'Original' });

      // Then recover from disk
      const id = generateVaultId();
      createVaultFileOnDisk(id);
      const recovered = recoverRegistryFromDisk();

      // Commit the recovered entries
      const registry = commitRecovery(recovered);
      expect(registry.vaults).toHaveLength(1);
      expect(registry.vaults[0].id).toBe(id);
      expect(registry.vaults[0].name).toBe(
        recovered[0].name,
      );

      // Original vault should no longer be in registry
      invalidateRegistryCache();
      expect(getVaultById(original.id)).toBeNull();
    });

    it('marks the first recovered vault as default if none is default', () => {
      const ids = [generateVaultId(), generateVaultId()];
      createVaultFileOnDisk(ids[0]);
      createVaultFileOnDisk(ids[1]);

      const recovered = recoverRegistryFromDisk();
      const registry = commitRecovery(recovered);

      expect(registry.vaults[0].isDefault).toBe(true);
    });

    it('preserves existing default flag if one is set', () => {
      const ids = [generateVaultId(), generateVaultId()];
      createVaultFileOnDisk(ids[0]);
      createVaultFileOnDisk(ids[1]);

      const recovered = recoverRegistryFromDisk();
      recovered[1].isDefault = true;

      const registry = commitRecovery(recovered);
      expect(registry.vaults[1].isDefault).toBe(true);
    });
  });

  // ─── Vault File Status Checking ───────────────────────────────────

  describe('checkVaultFileStatus', () => {
    it('returns "ok" when the vault database and auth files exist', () => {
      const vault = createInitializedVault('Good Vault');

      const status = checkVaultFileStatus(vault.id);
      expect(status).toBe('ok');
    });

    it('returns "missing" when the database file does not exist', () => {
      const vault = createInitializedVault('Missing Vault');
      // Delete the database file but keep auth
      unlinkSync(vault.databasePath);

      const status = checkVaultFileStatus(vault.id);
      expect(status).toBe('missing');
    });

    it('returns "corrupted" when the database file is empty', () => {
      const vault = createInitializedVault('Corrupted Vault');
      // Overwrite with empty data
      writeFileSync(vault.databasePath, '');

      const status = checkVaultFileStatus(vault.id);
      expect(status).toBe('corrupted');
    });

    it('returns "missing" for non-existent vault ID', () => {
      const status = checkVaultFileStatus('nonexistent-id');
      expect(status).toBe('missing');
    });

    it('returns "auth_missing" when auth metadata file does not exist', () => {
      const vault = createVault({ name: 'No Auth Vault' });
      writeFileSync(vault.databasePath, 'SQLite format 3\0data');
      // No auth file created

      const status = checkVaultFileStatus(vault.id);
      expect(status).toBe('auth_missing');
    });
  });

  describe('checkAllVaultFiles', () => {
    it('returns status for all vaults in the registry', () => {
      const vault1 = createInitializedVault('Vault 1');
      const vault2 = createVault({ name: 'Vault 2' });
      // vault2 has no auth or db file

      // Clear cache so we read fresh state
      invalidateRegistryCache();

      const statuses = checkAllVaultFiles();
      expect(statuses).toHaveLength(2);

      const s1 = statuses.find((s) => s.entry.id === vault1.id);
      const s2 = statuses.find((s) => s.entry.id === vault2.id);

      expect(s1?.status).toBe('ok');
      expect(s2?.status).toBe('auth_missing');
    });

    it('returns "auth_missing" when auth file does not exist', () => {
      const vault = createVault({ name: 'No Auth' });
      writeFileSync(vault.databasePath, 'SQLite format 3\0data');

      const statuses = checkAllVaultFiles();
      const s = statuses.find((x) => x.entry.id === vault.id);
      expect(s?.status).toBe('auth_missing');
    });
  });

  // ─── Remove Missing Vaults ────────────────────────────────────────

  describe('removeMissingVaults', () => {
    it('removes vaults with missing database files', () => {
      // Keep: fully initialized vault with db + auth
      const keep = createInitializedVault('Keep');
      // Remove: registry entry but no db file and no auth
      const remove = createVault({ name: 'Remove' });

      invalidateRegistryCache();

      const removed = removeMissingVaults();
      expect(removed).toHaveLength(1);
      expect(removed[0].id).toBe(remove.id);

      invalidateRegistryCache();
      expect(getVaultById(keep.id)).not.toBeNull();
      expect(getVaultById(remove.id)).toBeNull();
    });

    it('returns empty array when all vault files and auth exist', () => {
      const v1 = createInitializedVault('Vault 1');
      const v2 = createInitializedVault('Vault 2');

      invalidateRegistryCache();

      const removed = removeMissingVaults();
      expect(removed).toEqual([]);

      invalidateRegistryCache();
      expect(listVaults()).toHaveLength(2);
    });

    it('assigns new default if the default vault was removed', () => {
      const v1 = createVault({ name: 'Default', isDefault: true });
      // v1 has no db file and no auth — will be removed
      const v2 = createInitializedVault('Other');

      invalidateRegistryCache();

      removeMissingVaults();

      invalidateRegistryCache();
      const remaining = listVaults();
      expect(remaining).toHaveLength(1);
      expect(remaining[0].isDefault).toBe(true);
      expect(remaining[0].id).toBe(v2.id);
    });

    it('creates a backup before removing vaults', () => {
      const vault = createVault({ name: 'To Remove' });

      const backupsBefore = readdirSync(testDataDir).filter((f) =>
        f.startsWith('vault-registry.json.backup'),
      ).length;

      removeMissingVaults();

      const backupsAfter = readdirSync(testDataDir).filter((f) =>
        f.startsWith('vault-registry.json.backup'),
      ).length;

      expect(backupsAfter).toBe(backupsBefore + 1);
    });
  });

  // ─── End-to-End Recovery Flow ─────────────────────────────────────

  describe('full recovery flow', () => {
    it('recovers from a corrupted registry by scanning disk', () => {
      // Set up some vault files on disk without a registry
      const id = generateVaultId();
      createVaultFileOnDisk(id);
      createAuthFileOnDisk(id);

      // Scan for recoverable vaults
      const recovered = recoverRegistryFromDisk();
      expect(recovered).toHaveLength(1);
      expect(recovered[0].id).toBe(id);

      // Commit the recovery
      const registry = commitRecovery(recovered);
      expect(registry.vaults).toHaveLength(1);

      // Verify the vault is accessible
      invalidateRegistryCache();
      const vault = getVaultById(id);
      expect(vault).not.toBeNull();
      expect(vault!.isDefault).toBe(true);
    });

    it('recovers from auth-only metadata (missing db file)', () => {
      // Auth metadata exists but no db file
      const id = generateVaultId();
      createAuthFileOnDisk(id);

      const recovered = recoverRegistryFromDisk();
      expect(recovered).toHaveLength(1);
      expect(recovered[0].databasePath).toContain('file missing');
    });
  });
});
