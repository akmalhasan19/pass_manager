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
import { MAX_FIELD_LENGTHS } from '../../../src/shared/constants';
import { VaultRegistryError } from '../../../src/shared/types';

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

  // ─── Vault Name Validation ─────────────────────────────────────────

  describe('vault name validation', () => {
    it('rejects empty name', () => {
      expect(() => createVault({ name: '' })).toThrow(VaultRegistryError);
      expect(() => createVault({ name: '' })).toThrow('Vault name is invalid');
    });

    it('rejects whitespace-only name', () => {
      expect(() => createVault({ name: '   ' })).toThrow(VaultRegistryError);
      expect(() => createVault({ name: '\t\n' })).toThrow(VaultRegistryError);
    });

    it('rejects name exceeding maximum length', () => {
      const tooLong = 'A'.repeat(MAX_FIELD_LENGTHS.VAULT_NAME + 1);
      expect(() => createVault({ name: tooLong })).toThrow(VaultRegistryError);
      expect(() => createVault({ name: tooLong })).toThrow('Vault name is invalid');
    });

    it('accepts name at exactly maximum length', () => {
      const maxLength = 'A'.repeat(MAX_FIELD_LENGTHS.VAULT_NAME);
      const entry = createVault({ name: maxLength });
      expect(entry.name).toBe(maxLength);
    });

    it('rejects names containing ASCII control characters', () => {
      expect(() => createVault({ name: 'Bad\x00Name' })).toThrow(VaultRegistryError);
      expect(() => createVault({ name: 'Bad\x1FName' })).toThrow(VaultRegistryError);
    });

    it('rejects confusing names like ".", "..", and "..."', () => {
      expect(() => createVault({ name: '.' })).toThrow(VaultRegistryError);
      expect(() => createVault({ name: '..' })).toThrow(VaultRegistryError);
      expect(() => createVault({ name: '...' })).toThrow(VaultRegistryError);
      expect(() => createVault({ name: '~' })).toThrow(VaultRegistryError);
    });

    it('trims leading and trailing whitespace from names', () => {
      const entry = createVault({ name: '  Trimmed Vault  ' });
      expect(entry.name).toBe('Trimmed Vault');
    });

    it('accepts Unicode names including emoji, CJK, and RTL scripts', () => {
      const unicodeNames = [
        'Vault 🗝️',
        'パスワード',
        'مخزن',
        'Hello 👋 世界',
        'Café',
      ];

      for (const name of unicodeNames) {
        const entry = createVault({ name });
        expect(entry.name).toBe(name.trim());
      }
    });
  });

  // ─── Duplicate Name Detection ──────────────────────────────────────

  describe('duplicate name detection', () => {
    it('rejects duplicate names case-insensitively', () => {
      createVault({ name: 'Personal' });

      expect(() => createVault({ name: 'personal' })).toThrow(VaultRegistryError);
      expect(() => createVault({ name: 'PERSONAL' })).toThrow(VaultRegistryError);
      expect(() => createVault({ name: '  personal  ' })).toThrow(VaultRegistryError);
    });

    it('rejects duplicate names after Unicode NFC normalization', () => {
      // 'Cafe\u0301' (e + combining acute) should match 'Café' (precomposed)
      createVault({ name: 'Café' });

      expect(() => createVault({ name: 'Cafe\u0301' })).toThrow(VaultRegistryError);
    });

    it('rejects duplicate names during updateVault', () => {
      const first = createVault({ name: 'Work' });
      createVault({ name: 'Personal' });

      expect(() => updateVault(first.id, { name: 'Personal' })).toThrow(VaultRegistryError);
    });

    it('allows renaming a vault to its current name', () => {
      const entry = createVault({ name: 'Personal' });

      const updated = updateVault(entry.id, { name: 'Personal' });

      expect(updated.name).toBe('Personal');
    });

    it('allows different vaults to have distinct names', () => {
      createVault({ name: 'Personal' });
      createVault({ name: 'Work' });
      createVault({ name: 'Family' });

      const vaults = listVaults();
      const names = vaults.map((v) => v.name);
      expect(new Set(names).size).toBe(3);
    });
  });

  // ─── listVaults Ordering and Lifecycle ─────────────────────────────

  describe('listVaults ordering and lifecycle', () => {
    it('returns vaults sorted by sortOrder', () => {
      const third = createVault({ name: 'Third' });
      const first = createVault({ name: 'First' });
      const second = createVault({ name: 'Second' });

      updateVault(second.id, { sortOrder: 1 });
      updateVault(first.id, { sortOrder: 2 });
      updateVault(third.id, { sortOrder: 3 });

      const names = listVaults().map((v) => v.name);
      expect(names).toEqual(['Second', 'First', 'Third']);
    });

    it('reflects create, update, and delete in listVaults', () => {
      const alpha = createVault({ name: 'Alpha' });
      const beta = createVault({ name: 'Beta' });

      expect(listVaults()).toHaveLength(2);

      updateVault(alpha.id, { name: 'Alpha Prime' });
      expect(listVaults().some((v) => v.name === 'Alpha Prime')).toBe(true);

      deleteVault(beta.id);
      expect(listVaults()).toHaveLength(1);
      expect(listVaults()[0].name).toBe('Alpha Prime');
    });
  });

  // ─── Custom Database Path Validation ───────────────────────────────

  describe('createVault rejects unsafe custom database paths', () => {
    it('rejects custom path with directory traversal', () => {
      expect(() =>
        createVault({
          name: 'Evil Vault',
          customDatabasePath: '/vaults/../../../etc/passwd',
        }),
      ).toThrow('Custom database path contains invalid traversal sequences');
    });

    it('rejects relative custom paths', () => {
      expect(() =>
        createVault({
          name: 'Relative Vault',
          customDatabasePath: 'my-vault.db',
        }),
      ).toThrow('Custom database path must be an absolute path');
    });

    it('rejects URL-encoded traversal in custom paths', () => {
      expect(() =>
        createVault({
          name: 'Encoded Traversal',
          customDatabasePath: '/vaults/%2e%2e%2fsecret.db',
        }),
      ).toThrow('Custom database path contains invalid traversal sequences');
    });
  });
});
