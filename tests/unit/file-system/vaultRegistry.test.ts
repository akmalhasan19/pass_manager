import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import {
  createVault,
  updateVault,
  deleteVault,
  listVaults,
  getVaultById,
  invalidateRegistryCache,
} from '../../../src/main/file-system/vaultRegistry';
import { isValidVaultId } from '../../../src/shared/vaultPathStrategy';

// The registry file is stored at {userData}/vault-registry.json.
// In tests, `app.getPath('userData')` is unavailable, so it falls back to cwd()/data.
const actualRegistryPath = join(process.cwd(), 'data', 'vault-registry.json');

describe('Vault Registry - ID and Path Strategy Integration', () => {
  beforeEach(() => {
    invalidateRegistryCache();
    if (existsSync(actualRegistryPath)) {
      unlinkSync(actualRegistryPath);
    }
  });

  afterEach(() => {
    invalidateRegistryCache();
  });

  // ─── UUID as Stable ID ────────────────────────────────────────────

  describe('createVault uses UUID as vaultId', () => {
    it('assigns a valid UUID v4 as the vault id', () => {
      const entry = createVault({ name: 'Test Vault' });
      expect(isValidVaultId(entry.id)).toBe(true);
    });

    it('generates unique IDs for different vaults', () => {
      const e1 = createVault({ name: 'Vault A' });
      const e2 = createVault({ name: 'Vault B' });
      expect(e1.id).not.toBe(e2.id);
      expect(isValidVaultId(e1.id)).toBe(true);
      expect(isValidVaultId(e2.id)).toBe(true);
    });

    it('ID is independent of the vault name', () => {
      const entry = createVault({ name: 'My Personal Vault 2024!' });
      // ID should be a pure UUID, not derived from the name
      expect(entry.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
    });
  });

  // ─── Safe Filename from vaultId ───────────────────────────────────

  describe('database filename is derived from vaultId', () => {
    it('databasePath contains vault-{uuid}.db pattern', () => {
      const entry = createVault({ name: 'Test Vault' });
      const expectedFilename = `vault-${entry.id}.db`;
      expect(entry.databasePath).toContain(expectedFilename);
    });

    it('databasePath does not contain the vault name', () => {
      const entry = createVault({ name: 'Super Secret Stuff' });
      expect(entry.databasePath).not.toContain('Super');
      expect(entry.databasePath).not.toContain('Secret');
      expect(entry.databasePath).not.toContain('Stuff');
    });

    it('different vaults get different database paths', () => {
      const e1 = createVault({ name: 'Vault A' });
      const e2 = createVault({ name: 'Vault B' });
      expect(e1.databasePath).not.toBe(e2.databasePath);
    });
  });

  // ─── Display Name vs Physical Filename Separation ─────────────────

  describe('rename vault does not move the database file', () => {
    it('updateVault(name) changes name but not databasePath', () => {
      const entry = createVault({ name: 'Original Name' });
      const originalPath = entry.databasePath;
      const originalId = entry.id;

      const updated = updateVault(entry.id, { name: 'Renamed Vault' });

      expect(updated.name).toBe('Renamed Vault');
      expect(updated.databasePath).toBe(originalPath);
      expect(updated.id).toBe(originalId);
    });

    it('multiple renames keep the same database path', () => {
      const entry = createVault({ name: 'First Name' });
      const originalPath = entry.databasePath;

      updateVault(entry.id, { name: 'Second Name' });
      updateVault(entry.id, { name: 'Third Name' });
      const final = updateVault(entry.id, { name: 'Final Name' });

      expect(final.name).toBe('Final Name');
      expect(final.databasePath).toBe(originalPath);
    });
  });

  // ─── Managed Directory as Default ─────────────────────────────────

  describe('all vault files stay in managed directory by default', () => {
    it('databasePath is inside a "vaults" directory under app data', () => {
      const entry = createVault({ name: 'Default Location Vault' });
      expect(entry.databasePath).toContain('vaults');
      expect(entry.databasePath).toContain('vault-');
      expect(entry.databasePath).toContain('.db');
    });

    it('isCustomLocation is false when no custom path is provided', () => {
      const entry = createVault({ name: 'No Custom Path' });
      expect(entry.isCustomLocation).toBe(false);
    });

    it('isCustomLocation is true when custom path is provided', () => {
      const entry = createVault({
        name: 'Custom Location Vault',
        customDatabasePath: '/mnt/external/custom-vault.db',
      });
      expect(entry.isCustomLocation).toBe(true);
      expect(entry.databasePath).toBe('/mnt/external/custom-vault.db');
    });
  });

  // ─── Registry Persistence with UUID IDs ───────────────────────────

  describe('registry persists and loads vault entries with UUID IDs', () => {
    it('created vaults are findable by ID after reload', () => {
      const entry = createVault({ name: 'Persistent Vault' });
      invalidateRegistryCache();

      const found = getVaultById(entry.id);
      expect(found).not.toBeNull();
      expect(found!.id).toBe(entry.id);
      expect(found!.name).toBe('Persistent Vault');
    });

    it('all vaults in registry have valid UUID IDs', () => {
      createVault({ name: 'Vault One' });
      createVault({ name: 'Vault Two' });
      createVault({ name: 'Vault Three' });
      invalidateRegistryCache();

      const vaults = listVaults();
      for (const v of vaults) {
        expect(isValidVaultId(v.id)).toBe(true);
      }
    });
  });

  // ─── Vault Deletion ───────────────────────────────────────────────

  describe('deleteVault removes the registry entry by ID', () => {
    it('deleted vault is no longer findable by ID', () => {
      const entry = createVault({ name: 'To Be Deleted' });
      deleteVault(entry.id);

      expect(getVaultById(entry.id)).toBeNull();
    });

    it('other vaults are unaffected by deletion', () => {
      const keep = createVault({ name: 'Keep This' });
      const remove = createVault({ name: 'Remove This' });

      deleteVault(remove.id);

      expect(getVaultById(keep.id)).not.toBeNull();
      expect(getVaultById(keep.id)!.name).toBe('Keep This');
    });
  });
});
