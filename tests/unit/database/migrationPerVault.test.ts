import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  closeDatabase,
  getDatabase,
  initializeSqlJs,
  isDatabaseOpen,
  openDatabaseForVault,
} from '../../../src/main/database/connection';
import { migrateVaultDatabase, runSchema } from '../../../src/main/database/migrations';
import { createVaultMetadata } from '../../../src/main/file-system/storageManager';
import { invalidateRegistryCache } from '../../../src/main/file-system/vaultRegistry';

const testDataDir = join(process.cwd(), 'test-data', 'migration-per-vault');

vi.mock('electron', () => ({
  app: {
    getAppPath: () => process.cwd(),
    getPath: (name: string) => {
      if (name !== 'userData') {
        throw new Error(`Unexpected Electron path request: ${name}`);
      }
      return testDataDir;
    },
  },
}));

function resetTestData(): void {
  try {
    closeDatabase();
  } catch {
    // Ignore close errors during cleanup
  }
  invalidateRegistryCache();
  rmSync(testDataDir, { recursive: true, force: true });
  mkdirSync(testDataDir, { recursive: true });
}

/**
 * Helper: opens a vault database, reads the schema_version from its settings
 * table, then closes it. Returns the version number (0 if not set).
 */
function readSchemaVersion(vaultId: string): number {
  openDatabaseForVault(vaultId);
  try {
    const db = getDatabase();
    const stmt = db.prepare("SELECT value FROM settings WHERE key = 'schema_version'");
    let version = 0;
    if (stmt.step()) {
      const row = stmt.getAsObject() as { value: string };
      version = parseInt(row.value, 10) || 0;
    }
    stmt.free();
    return version;
  } finally {
    closeDatabase();
  }
}

describe('Per-vault migration', () => {
  beforeAll(async () => {
    await initializeSqlJs();
  });

  beforeEach(() => {
    resetTestData();
  });

  afterEach(() => {
    resetTestData();
  });

  it('creates schema and sets schema_version in a new vault database', () => {
    const vault = createVaultMetadata({ name: 'Personal' });

    // Database file should not exist yet (registry entry only)
    expect(existsSync(vault.databasePath)).toBe(false);

    migrateVaultDatabase(vault.id);

    // Database file should now exist with the schema applied
    expect(existsSync(vault.databasePath)).toBe(true);

    // Schema version should be set to CURRENT_VERSION (2)
    const version = readSchemaVersion(vault.id);
    expect(version).toBe(2);
  });

  it('creates all expected tables in the vault database', () => {
    const vault = createVaultMetadata({ name: 'Work' });
    migrateVaultDatabase(vault.id);

    openDatabaseForVault(vault.id);
    try {
      const db = getDatabase();
      const tables = [
        'folders',
        'items',
        'tags',
        'item_tags',
        'attachments',
        'trash',
        'settings',
      ];

      for (const table of tables) {
        const stmt = db.prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
        );
        stmt.bind([table]);
        const found = stmt.step();
        stmt.free();
        expect(found, `Table "${table}" should exist`).toBe(true);
      }
    } finally {
      closeDatabase();
    }
  });

  it('is idempotent — running migration twice does not corrupt data', () => {
    const vault = createVaultMetadata({ name: 'Personal' });

    migrateVaultDatabase(vault.id);

    // Insert some data
    openDatabaseForVault(vault.id);
    try {
      const db = getDatabase();
      db.run("INSERT INTO settings (key, value) VALUES ('custom_key', 'custom_value')");
    } finally {
      closeDatabase();
    }

    // Run migration again
    migrateVaultDatabase(vault.id);

    // Data should still be there
    openDatabaseForVault(vault.id);
    try {
      const db = getDatabase();
      const stmt = db.prepare("SELECT value FROM settings WHERE key = 'custom_key'");
      expect(stmt.step()).toBe(true);
      const row = stmt.getAsObject() as { value: string };
      expect(row.value).toBe('custom_value');
      stmt.free();

      // Schema version should still be 2
      const versionStmt = db.prepare("SELECT value FROM settings WHERE key = 'schema_version'");
      expect(versionStmt.step()).toBe(true);
      const versionRow = versionStmt.getAsObject() as { value: string };
      expect(parseInt(versionRow.value, 10)).toBe(2);
      versionStmt.free();
    } finally {
      closeDatabase();
    }
  });

  it('migrates each vault independently with separate schema versions', () => {
    const personal = createVaultMetadata({ name: 'Personal' });
    const work = createVaultMetadata({ name: 'Work' });

    // Migrate both vaults
    migrateVaultDatabase(personal.id);
    migrateVaultDatabase(work.id);

    // Both should have schema version 2
    expect(readSchemaVersion(personal.id)).toBe(2);
    expect(readSchemaVersion(work.id)).toBe(2);

    // Insert vault-specific data into Personal
    openDatabaseForVault(personal.id);
    try {
      const db = getDatabase();
      db.run("INSERT INTO settings (key, value) VALUES ('owner', 'personal')");
    } finally {
      closeDatabase();
    }

    // Insert different vault-specific data into Work
    openDatabaseForVault(work.id);
    try {
      const db = getDatabase();
      db.run("INSERT INTO settings (key, value) VALUES ('owner', 'work')");
    } finally {
      closeDatabase();
    }

    // Verify isolation: each vault has its own data
    openDatabaseForVault(personal.id);
    try {
      const db = getDatabase();
      const stmt = db.prepare("SELECT value FROM settings WHERE key = 'owner'");
      expect(stmt.step()).toBe(true);
      expect((stmt.getAsObject() as { value: string }).value).toBe('personal');
      stmt.free();
    } finally {
      closeDatabase();
    }

    openDatabaseForVault(work.id);
    try {
      const db = getDatabase();
      const stmt = db.prepare("SELECT value FROM settings WHERE key = 'owner'");
      expect(stmt.step()).toBe(true);
      expect((stmt.getAsObject() as { value: string }).value).toBe('work');
      stmt.free();
    } finally {
      closeDatabase();
    }
  });

  it('does not leave the database open after migration completes', () => {
    const vault = createVaultMetadata({ name: 'Personal' });

    expect(isDatabaseOpen()).toBe(false);
    migrateVaultDatabase(vault.id);
    expect(isDatabaseOpen()).toBe(false);
  });

  it('closes the database even if migration throws', () => {
    const vault = createVaultMetadata({ name: 'Personal' });

    // First, create a valid database
    migrateVaultDatabase(vault.id);

    // Now try to migrate a non-existent vault — this should throw
    // but still leave the database closed
    expect(() => migrateVaultDatabase('non-existent-vault-id')).toThrow();
    expect(isDatabaseOpen()).toBe(false);
  });

  it('allows normal database operations after migration', () => {
    const vault = createVaultMetadata({ name: 'Personal' });
    migrateVaultDatabase(vault.id);

    // Open for use
    openDatabaseForVault(vault.id);
    try {
      const db = getDatabase();

      // Should be able to create a folder
      db.run(
        "INSERT INTO folders (id, name, created_at, updated_at) VALUES ('f1', 'Test Folder', 0, 0)",
      );

      const stmt = db.prepare('SELECT name FROM folders WHERE id = ?');
      stmt.bind(['f1']);
      expect(stmt.step()).toBe(true);
      expect((stmt.getAsObject() as { name: string }).name).toBe('Test Folder');
      stmt.free();
    } finally {
      closeDatabase();
    }
  });

  it('runSchema with explicit db parameter creates tables correctly', async () => {
    // Test the db-parameter overload of runSchema
    const { createDatabase } = await import('../../../src/main/database/connection');
    const db = createDatabase();

    runSchema(db);

    // Verify tables exist
    const tables = ['folders', 'items', 'tags', 'settings'];
    for (const table of tables) {
      const stmt = db.prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
      );
      stmt.bind([table]);
      const found = stmt.step();
      stmt.free();
      expect(found, `Table "${table}" should exist in explicit-db schema`).toBe(true);
    }

    db.close();
  });
});
