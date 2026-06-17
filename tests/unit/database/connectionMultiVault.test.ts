import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import {
  closeDatabase,
  getActiveDatabasePath,
  getActiveVaultId,
  getDatabase,
  initializeSqlJs,
  isDatabaseOpen,
  openDatabaseForVault,
} from '../../../src/main/database/connection';
import { runSchema } from '../../../src/main/database/migrations';
import { FolderRepository } from '../../../src/main/database/repositories/FolderRepository';
import { createVaultMetadata } from '../../../src/main/file-system/storageManager';
import { invalidateRegistryCache } from '../../../src/main/file-system/vaultRegistry';

const testDataDir = join(process.cwd(), 'test-data', 'connection-multi-vault');

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
    // Test setup should not fail because a previous database was already closed.
  }
  invalidateRegistryCache();
  rmSync(testDataDir, { recursive: true, force: true });
  mkdirSync(testDataDir, { recursive: true });
}

describe('Database connection multi-vault layer', () => {
  beforeAll(async () => {
    await initializeSqlJs();
  });

  beforeEach(() => {
    resetTestData();
  });

  afterEach(() => {
    resetTestData();
  });

  it('fails clearly when database operations run without an active vault', () => {
    expect(isDatabaseOpen()).toBe(false);
    expect(() => getDatabase()).toThrow('No active vault is open');
  });

  it('opens the database for the selected vault and exposes active vault context', () => {
    const vault = createVaultMetadata({ name: 'Personal' });

    openDatabaseForVault(vault.id);
    runSchema();

    expect(isDatabaseOpen()).toBe(true);
    expect(getActiveVaultId()).toBe(vault.id);
    expect(getActiveDatabasePath()).toBe(vault.databasePath);
  });

  it('closes the previous vault before opening the next vault', () => {
    const personal = createVaultMetadata({ name: 'Personal' });
    const work = createVaultMetadata({ name: 'Work' });

    openDatabaseForVault(personal.id);
    runSchema();
    getDatabase().run("INSERT INTO settings (key, value) VALUES ('owner', 'personal')");

    openDatabaseForVault(work.id);
    runSchema();
    getDatabase().run("INSERT INTO settings (key, value) VALUES ('owner', 'work')");

    expect(getActiveVaultId()).toBe(work.id);
    expect(getActiveDatabasePath()).toBe(work.databasePath);

    openDatabaseForVault(personal.id);
    const stmt = getDatabase().prepare("SELECT value FROM settings WHERE key = 'owner'");
    expect(stmt.step()).toBe(true);
    expect((stmt.getAsObject() as { value: string }).value).toBe('personal');
    stmt.free();
  });

  it('keeps repository instances bound to the current active connection after vault switch', () => {
    const repo = new FolderRepository();
    const personal = createVaultMetadata({ name: 'Personal' });
    const work = createVaultMetadata({ name: 'Work' });

    openDatabaseForVault(personal.id);
    runSchema();
    repo.create(null, 'Personal Root');

    openDatabaseForVault(work.id);
    runSchema();
    repo.create(null, 'Work Root');
    expect(repo.getFlatList().map((folder) => folder.name)).toEqual(['Work Root']);

    openDatabaseForVault(personal.id);
    expect(repo.getFlatList().map((folder) => folder.name)).toEqual(['Personal Root']);
  });
});
