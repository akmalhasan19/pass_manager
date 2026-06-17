import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import {
  generateVaultId,
  isValidVaultId,
  generateVaultFilename,
  resolveVaultDatabasePath,
  isManagedVaultPath,
  VAULT_FILENAME_PREFIX,
  VAULT_FILENAME_EXTENSION,
} from '../../../src/shared/vaultPathStrategy';

// ─── UUID v4 Generation ──────────────────────────────────────────────

describe('generateVaultId', () => {
  it('returns a valid UUID v4 string', () => {
    const id = generateVaultId();
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it('generates unique IDs on successive calls', () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateVaultId()));
    expect(ids.size).toBe(100);
  });

  it('always generates version 4 UUIDs', () => {
    for (let i = 0; i < 50; i++) {
      const id = generateVaultId();
      // The 13th character (index 14 after accounting for hyphens) must be '4'
      expect(id[14]).toBe('4');
    }
  });

  it('generates UUIDs with correct variant bits (8, 9, a, or b)', () => {
    for (let i = 0; i < 50; i++) {
      const id = generateVaultId();
      // The 17th character (index 19) must be 8, 9, a, or b
      expect('89ab').toContain(id[19]);
    }
  });
});

// ─── UUID v4 Validation ──────────────────────────────────────────────

describe('isValidVaultId', () => {
  it('accepts a valid UUID v4', () => {
    expect(isValidVaultId('550e8400-e29b-41d4-a716-446655440000')).toBe(true);
  });

  it('accepts a freshly generated UUID', () => {
    expect(isValidVaultId(generateVaultId())).toBe(true);
  });

  it('accepts uppercase UUID v4', () => {
    expect(isValidVaultId('550E8400-E29B-41D4-A716-446655440000')).toBe(true);
  });

  it('rejects empty string', () => {
    expect(isValidVaultId('')).toBe(false);
  });

  it('rejects non-string input', () => {
    expect(isValidVaultId(null as unknown as string)).toBe(false);
    expect(isValidVaultId(undefined as unknown as string)).toBe(false);
    expect(isValidVaultId(123 as unknown as string)).toBe(false);
  });

  it('rejects UUID v1 (version digit is not 4)', () => {
    expect(isValidVaultId('550e8400-e29b-11d4-a716-446655440000')).toBe(false);
  });

  it('rejects UUID with wrong variant bits', () => {
    // variant bits should be 8,9,a,b; 'c' is invalid
    expect(isValidVaultId('550e8400-e29b-41d4-c716-446655440000')).toBe(false);
  });

  it('rejects a vault name (not a UUID)', () => {
    expect(isValidVaultId('Personal Vault')).toBe(false);
  });

  it('rejects path traversal attempt', () => {
    expect(isValidVaultId('../../../etc/passwd')).toBe(false);
  });

  it('rejects UUID without hyphens', () => {
    expect(isValidVaultId('550e8400e29b41d4a716446655440000')).toBe(false);
  });

  it('rejects truncated UUID', () => {
    expect(isValidVaultId('550e8400-e29b-41d4-a716')).toBe(false);
  });

  it('rejects UUID with extra characters', () => {
    expect(isValidVaultId('550e8400-e29b-41d4-a716-446655440000-extra')).toBe(false);
  });
});

// ─── Filename Generation ─────────────────────────────────────────────

describe('generateVaultFilename', () => {
  it('produces the expected vault-{uuid}.db format', () => {
    const vaultId = '550e8400-e29b-41d4-a716-446655440000';
    const filename = generateVaultFilename(vaultId);
    expect(filename).toBe('vault-550e8400-e29b-41d4-a716-446655440000.db');
  });

  it('starts with VAULT_FILENAME_PREFIX', () => {
    const filename = generateVaultFilename(generateVaultId());
    expect(filename.startsWith(VAULT_FILENAME_PREFIX)).toBe(true);
  });

  it('ends with VAULT_FILENAME_EXTENSION', () => {
    const filename = generateVaultFilename(generateVaultId());
    expect(filename.endsWith(VAULT_FILENAME_EXTENSION)).toBe(true);
  });

  it('contains no path separators (safe filename)', () => {
    const filename = generateVaultFilename(generateVaultId());
    expect(filename).not.toMatch(/[/\\]/);
  });

  it('contains no user-controlled content beyond the UUID', () => {
    const vaultId = generateVaultId();
    const filename = generateVaultFilename(vaultId);
    // The only variable part is the UUID itself
    expect(filename).toBe(`vault-${vaultId}.db`);
  });

  it('is deterministic for the same vault ID', () => {
    const vaultId = '550e8400-e29b-41d4-a716-446655440000';
    expect(generateVaultFilename(vaultId)).toBe(generateVaultFilename(vaultId));
  });

  it('throws for an invalid vault ID', () => {
    expect(() => generateVaultFilename('not-a-uuid')).toThrow('Invalid vault ID');
  });

  it('throws for path traversal in vault ID', () => {
    expect(() => generateVaultFilename('../../../etc/passwd')).toThrow('Invalid vault ID');
  });

  it('produces different filenames for different vault IDs', () => {
    const id1 = generateVaultId();
    const id2 = generateVaultId();
    expect(generateVaultFilename(id1)).not.toBe(generateVaultFilename(id2));
  });
});

// ─── Path Resolution: Managed Directory ──────────────────────────────

describe('resolveVaultDatabasePath - managed directory', () => {
  const managedDir = '/home/user/.config/app/vaults';

  it('resolves to managed dir when no custom path is given', () => {
    const vaultId = '550e8400-e29b-41d4-a716-446655440000';
    const result = resolveVaultDatabasePath(vaultId, managedDir);
    expect(result).toBe(
      join(managedDir, 'vault-550e8400-e29b-41d4-a716-446655440000.db'),
    );
  });

  it('resolves to managed dir when custom path is undefined', () => {
    const vaultId = generateVaultId();
    const result = resolveVaultDatabasePath(vaultId, managedDir, undefined);
    const normalizedManaged = join(managedDir);
    expect(result).toContain(normalizedManaged);
  });

  it('resolves to managed dir when custom path is empty string', () => {
    const vaultId = generateVaultId();
    const result = resolveVaultDatabasePath(vaultId, managedDir, '');
    const normalizedManaged = join(managedDir);
    expect(result).toContain(normalizedManaged);
  });

  it('resolves to managed dir when custom path is whitespace only', () => {
    const vaultId = generateVaultId();
    const result = resolveVaultDatabasePath(vaultId, managedDir, '   ');
    const normalizedManaged = join(managedDir);
    expect(result).toContain(normalizedManaged);
  });

  it('resolves to managed dir when custom path is null', () => {
    const vaultId = generateVaultId();
    const result = resolveVaultDatabasePath(vaultId, managedDir, null as unknown as string);
    const normalizedManaged = join(managedDir);
    expect(result).toContain(normalizedManaged);
  });

  it('uses the deterministic filename in managed dir', () => {
    const vaultId = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
    const result = resolveVaultDatabasePath(vaultId, managedDir);
    expect(result).toBe(join(managedDir, `vault-${vaultId}.db`));
  });
});

// ─── Path Resolution: Custom Path ────────────────────────────────────

describe('resolveVaultDatabasePath - custom path', () => {
  const managedDir = '/home/user/.config/app/vaults';

  it('uses the custom path when provided', () => {
    const vaultId = generateVaultId();
    const customPath = '/mnt/external/vault.db';
    const result = resolveVaultDatabasePath(vaultId, managedDir, customPath);
    expect(result).toBe(customPath);
  });

  it('accepts absolute Windows-style paths', () => {
    const vaultId = generateVaultId();
    const customPath = 'D:\\Backups\\vault.db';
    const result = resolveVaultDatabasePath(vaultId, managedDir, customPath);
    expect(result).toBe(customPath);
  });

  it('rejects relative custom paths', () => {
    const vaultId = generateVaultId();
    expect(() =>
      resolveVaultDatabasePath(vaultId, managedDir, 'relative/path/vault.db'),
    ).toThrow('Custom database path must be an absolute path');
  });

  it('rejects custom path with path traversal (..)', () => {
    const vaultId = generateVaultId();
    expect(() =>
      resolveVaultDatabasePath(vaultId, managedDir, '/mnt/external/../../../etc/passwd'),
    ).toThrow('Custom database path contains invalid traversal sequences');
  });

  it('rejects custom path with URL-encoded traversal', () => {
    const vaultId = generateVaultId();
    expect(() =>
      resolveVaultDatabasePath(vaultId, managedDir, '/mnt/external/%2e%2e/secret'),
    ).toThrow('Custom database path contains invalid traversal sequences');
  });

  it('rejects custom path with null bytes', () => {
    const vaultId = generateVaultId();
    expect(() =>
      resolveVaultDatabasePath(vaultId, managedDir, '/mnt/external/vault\0.db'),
    ).toThrow('Custom database path contains invalid traversal sequences');
  });
});

// ─── Path Resolution: Error Cases ────────────────────────────────────

describe('resolveVaultDatabasePath - error handling', () => {
  const managedDir = '/home/user/.config/app/vaults';

  it('throws for an invalid vault ID', () => {
    expect(() => resolveVaultDatabasePath('not-a-uuid', managedDir)).toThrow('Invalid vault ID');
  });

  it('throws for empty vault ID', () => {
    expect(() => resolveVaultDatabasePath('', managedDir)).toThrow('Invalid vault ID');
  });

  it('throws for empty managed directory', () => {
    const vaultId = generateVaultId();
    expect(() => resolveVaultDatabasePath(vaultId, '')).toThrow(
      'Managed directory must be a non-empty string',
    );
  });

  it('throws for null managed directory', () => {
    const vaultId = generateVaultId();
    expect(() => resolveVaultDatabasePath(vaultId, null as unknown as string)).toThrow(
      'Managed directory must be a non-empty string',
    );
  });
});

// ─── Managed Path Detection ──────────────────────────────────────────

describe('isManagedVaultPath', () => {
  const managedDir = '/home/user/.config/app/vaults';

  it('returns true for a path inside the managed directory', () => {
    const dbPath = join(managedDir, 'vault-550e8400-e29b-41d4-a716-446655440000.db');
    expect(isManagedVaultPath(dbPath, managedDir)).toBe(true);
  });

  it('returns false for a path outside the managed directory', () => {
    expect(isManagedVaultPath('/mnt/external/vault.db', managedDir)).toBe(false);
  });

  it('returns false for empty inputs', () => {
    expect(isManagedVaultPath('', managedDir)).toBe(false);
    expect(isManagedVaultPath('/some/path.db', '')).toBe(false);
    expect(isManagedVaultPath('', '')).toBe(false);
  });

  it('returns false for null/undefined inputs', () => {
    expect(isManagedVaultPath(null as unknown as string, managedDir)).toBe(false);
    expect(isManagedVaultPath(managedDir, null as unknown as string)).toBe(false);
  });

  it('detects custom location even if filename matches pattern', () => {
    const vaultId = '550e8400-e29b-41d4-a716-446655440000';
    const fakePath = `/tmp/vault-${vaultId}.db`;
    expect(isManagedVaultPath(fakePath, managedDir)).toBe(false);
  });
});

// ─── Display Name vs Physical Filename Separation ────────────────────

describe('display name / physical filename separation', () => {
  it('filename derivation never uses the display name', () => {
    const vaultId = '550e8400-e29b-41d4-a716-446655440000';
    const filename = generateVaultFilename(vaultId);
    // The filename should only contain the UUID, not any display name
    expect(filename).not.toContain('Personal');
    expect(filename).not.toContain('Work');
    expect(filename).toBe('vault-550e8400-e29b-41d4-a716-446655440000.db');
  });

  it('two vaults with different IDs get different filenames regardless of name', () => {
    const id1 = '11111111-1111-4111-8111-111111111111';
    const id2 = '22222222-2222-4222-8222-222222222222';
    const fn1 = generateVaultFilename(id1);
    const fn2 = generateVaultFilename(id2);
    expect(fn1).not.toBe(fn2);
  });
});

// ─── Constants ───────────────────────────────────────────────────────

describe('constants', () => {
  it('VAULT_FILENAME_PREFIX is "vault-"', () => {
    expect(VAULT_FILENAME_PREFIX).toBe('vault-');
  });

  it('VAULT_FILENAME_EXTENSION is ".db"', () => {
    expect(VAULT_FILENAME_EXTENSION).toBe('.db');
  });
});
