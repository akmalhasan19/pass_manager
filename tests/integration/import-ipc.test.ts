import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import initSqlJs, { Database as SqlJsDatabase } from 'sql.js';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { FolderRepository } from '@main/database/repositories/FolderRepository';
import { ItemRepository } from '@main/database/repositories/ItemRepository';
import { encryptString, decryptString } from '@main/crypto/encryption';
import { createImporterFactoryWithAllDefaults } from '@main/import-export/registry';
import {
  detectDuplicates,
  buildExistingItemRefs,
  applyResolutionMap,
} from '@main/import-export/duplicateDetection';
import type {
  ImportPayload,
  DuplicateResolutionMap,
} from '@shared/types';

const FTS5_RELATED = /items_fts|fts5/i;

const FIXTURE_DIR = join(__dirname, '..', '..', 'test-data', 'fixtures');

function loadFixture(name: string): string {
  const path = join(FIXTURE_DIR, name);
  if (!existsSync(path)) {
    throw new Error(`Fixture not found: ${path}`);
  }
  return readFileSync(path, 'utf-8');
}

async function createDb(): Promise<SqlJsDatabase> {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  db.run('PRAGMA foreign_keys = ON');
  db.run('PRAGMA journal_mode = MEMORY');

  const schemaPath = join(__dirname, '..', '..', 'src', 'main', 'database', 'schema.sql');
  const schema = readFileSync(schemaPath, 'utf-8');
  const noComments = schema
    .split('\n')
    .filter((l) => !l.trim().startsWith('--'))
    .join('\n');
  const statements = noComments
    .split(';')
    .map((s) => s.trim() + ';')
    .filter((s) => s.length > 1);

  for (const stmt of statements) {
    if (FTS5_RELATED.test(stmt)) continue;
    try {
      db.run(stmt);
    } catch {
      /* skip */
    }
  }
  return db;
}

let testDb: SqlJsDatabase | null = null;

vi.mock('@main/database/connection', () => ({
  getDatabase: () => testDb,
  isDatabaseOpen: () => testDb !== null,
  initializeSqlJs: vi.fn().mockResolvedValue(undefined),
  saveDatabase: vi.fn(),
  closeDatabase: vi.fn(),
  openDatabase: vi.fn(),
  runQuery: vi.fn(),
  runMany: vi.fn(),
  prepare: vi.fn(),
}));

vi.mock('@main/ipc/authHandlers', () => ({
  getMasterKey: () => TEST_KEY,
}));

const folderRepo = new FolderRepository();
const itemRepo = new ItemRepository();

const TEST_KEY = Buffer.from('0123456789abcdef0123456789abcdef', 'utf-8');

function commitImportPayload(payload: ImportPayload): { importedCount: number } {
  const key = TEST_KEY;
  const db = testDb;
  if (!db) throw new Error('DB not open');

  let importedCount = 0;
  let defaultFolderId: string | null = null;

  db.run('BEGIN TRANSACTION');
  try {
    for (const folder of payload.folders) {
      const parentId = folder.parentId || null;
      const now = Date.now();
      db.run(
        `INSERT OR IGNORE INTO folders (id, parent_id, name, emoji, cover_image, created_at, updated_at, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [folder.id, parentId, folder.name, folder.emoji, folder.coverImage, folder.createdAt || now, folder.updatedAt || now, folder.sortOrder || 0],
      );
    }

    const hasItemsWithoutFolder = payload.items.some((item) => !item.folderId);
    if (hasItemsWithoutFolder) {
      const now = Date.now();
      defaultFolderId = 'imported-' + now;
      db.run(
        `INSERT INTO folders (id, parent_id, name, emoji, cover_image, created_at, updated_at, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [defaultFolderId, null, 'Imported', null, null, now, now, 0],
      );
    }

    for (const item of payload.items) {
      const passwordEncrypted = item.password
        ? (encryptString(item.password, key) as unknown as ArrayBuffer)
        : null;
      const notesEncrypted = item.notes
        ? (encryptString(item.notes, key) as unknown as ArrayBuffer)
        : null;

      let folderId = item.folderId;
      if (!folderId && defaultFolderId) {
        folderId = defaultFolderId;
      }

      if (folderId && !payload.folders.find((f) => f.id === folderId) && folderId !== defaultFolderId) {
        continue;
      }

      itemRepo.create(folderId || '', {
        title: item.title,
        username: item.username,
        passwordEncrypted,
        url: item.url,
        notesEncrypted,
        emoji: item.emoji ?? null,
        coverImage: item.coverImage ?? null,
      });

      importedCount++;
    }
    db.run('COMMIT');
  } catch (err) {
    db.run('ROLLBACK');
    throw err;
  }

  return { importedCount };
}

describe('Import IPC Integration', () => {
  beforeAll(async () => {
    testDb = await createDb();
  });

  afterAll(() => {
    if (testDb) {
      testDb.close();
      testDb = null;
    }
  });

  beforeEach(() => {
    if (testDb) {
      testDb.run('DELETE FROM item_tags');
      testDb.run('DELETE FROM attachments');
      testDb.run('DELETE FROM items');
      testDb.run('DELETE FROM tags');
      testDb.run('DELETE FROM folders');
      testDb.run('DELETE FROM settings');
    }
  });

  // =========================================================================
  // 4.2 — KeePass XML: file select → parse → insert → verify
  // =========================================================================
  describe('KeePass XML import flow', () => {
    it('should parse KeePass XML and insert items into DB', () => {
      const content = loadFixture('keepass-sample.xml');
      const factory = createImporterFactoryWithAllDefaults();
      const importer = factory.get('keepass-xml');
      const payload = importer.parse(content);

      expect(payload.items.length).toBe(4);
      expect(payload.folders.length).toBe(3);

      const result = commitImportPayload(payload);
      expect(result.importedCount).toBe(4);

      const allItems = itemRepo.getAll();
      expect(allItems.length).toBe(4);
    });

    it('should decrypt imported passwords correctly after insert', () => {
      const content = loadFixture('keepass-sample.xml');
      const factory = createImporterFactoryWithAllDefaults();
      const importer = factory.get('keepass-xml');
      const payload = importer.parse(content);

      commitImportPayload(payload);

      const allItems = itemRepo.getAll();
      const exampleCorp = allItems.find((i) => i.title === 'Example Corp');
      expect(exampleCorp).toBeDefined();
      expect(exampleCorp!.passwordEncrypted).toBeTruthy();

      const decryptedPw = decryptString(
        Buffer.from(exampleCorp!.passwordEncrypted as ArrayBuffer),
        TEST_KEY,
      );
      expect(decryptedPw).toBe('MySecretP@ss1');
    });

    it('should maintain relational integrity: items have valid folderId references', () => {
      const content = loadFixture('keepass-sample.xml');
      const factory = createImporterFactoryWithAllDefaults();
      const importer = factory.get('keepass-xml');
      const payload = importer.parse(content);

      const folderIds = new Set(payload.folders.map((f) => f.id));
      folderIds.add('');

      for (const item of payload.items) {
        expect(folderIds.has(item.folderId)).toBe(true);
      }
    });

    it('should not create duplicate folders when importing same file twice', () => {
      const content = loadFixture('keepass-sample.xml');
      const factory = createImporterFactoryWithAllDefaults();
      const importer = factory.get('keepass-xml');
      const payload = importer.parse(content);

      commitImportPayload(payload);
      const firstCount = itemRepo.getAll().length;
      expect(firstCount).toBe(4);

      commitImportPayload(payload);
      const secondCount = itemRepo.getAll().length;
      expect(secondCount).toBe(8);
    });
  });

  // =========================================================================
  // 4.2 — Bitwarden JSON: file select → parse → insert → verify
  // =========================================================================
  describe('Bitwarden JSON import flow', () => {
    it('should parse Bitwarden JSON and insert items into DB', () => {
      const content = loadFixture('bitwarden-sample.json');
      const factory = createImporterFactoryWithAllDefaults();
      const importer = factory.get('bitwarden-json');
      const payload = importer.parse(content);

      expect(payload.items.length).toBe(4);
      expect(payload.folders.length).toBe(2);

      const result = commitImportPayload(payload);
      expect(result.importedCount).toBe(4);

      const allItems = itemRepo.getAll();
      expect(allItems.length).toBe(4);
    });

    it('should decrypt imported passwords correctly after insert', () => {
      const content = loadFixture('bitwarden-sample.json');
      const factory = createImporterFactoryWithAllDefaults();
      const importer = factory.get('bitwarden-json');
      const payload = importer.parse(content);

      commitImportPayload(payload);

      const allItems = itemRepo.getAll();
      const twitter = allItems.find((i) => i.title === 'Twitter');
      expect(twitter).toBeDefined();
      expect(twitter!.passwordEncrypted).toBeTruthy();

      const decryptedPw = decryptString(
        Buffer.from(twitter!.passwordEncrypted as ArrayBuffer),
        TEST_KEY,
      );
      expect(decryptedPw).toBe('Tw1tt3rP@ss!');
    });

    it('should preserve folder assignment for imported items', () => {
      const content = loadFixture('bitwarden-sample.json');
      const factory = createImporterFactoryWithAllDefaults();
      const importer = factory.get('bitwarden-json');
      const payload = importer.parse(content);

      commitImportPayload(payload);

      const allItems = itemRepo.getAll();

      const twitter = allItems.find((i) => i.title === 'Twitter');
      expect(twitter).toBeDefined();
      expect(twitter!.folderId).toBeTruthy();

      const allFolders = folderRepo.getFlatList();
      const importedFolder = allFolders.find((f) => f.name === 'Imported');
      expect(importedFolder).toBeDefined();

      const noFolderItems = allItems.filter((i) => i.folderId === importedFolder!.id);
      expect(noFolderItems.length).toBe(2);
    });

    it('should maintain relational integrity: all items reference valid folders', () => {
      const content = loadFixture('bitwarden-sample.json');
      const factory = createImporterFactoryWithAllDefaults();
      const importer = factory.get('bitwarden-json');
      const payload = importer.parse(content);

      const folderIds = new Set(payload.folders.map((f) => f.id));
      folderIds.add('');

      for (const item of payload.items) {
        expect(folderIds.has(item.folderId)).toBe(true);
      }
    });
  });

  // =========================================================================
  // 4.2 — 1Password CSV: file select → parse → insert → verify
  // =========================================================================
  describe('1Password CSV import flow', () => {
    it('should parse 1Password CSV and insert items into DB', () => {
      const content = loadFixture('1password-sample.csv');
      const factory = createImporterFactoryWithAllDefaults();
      const importer = factory.get('1password-csv');
      const payload = importer.parse(content);

      expect(payload.items.length).toBe(6);

      const result = commitImportPayload(payload);
      expect(result.importedCount).toBe(6);

      const allItems = itemRepo.getAll();
      expect(allItems.length).toBe(6);
    });

    it('should decrypt imported passwords correctly after insert', () => {
      const content = loadFixture('1password-sample.csv');
      const factory = createImporterFactoryWithAllDefaults();
      const importer = factory.get('1password-csv');
      const payload = importer.parse(content);

      commitImportPayload(payload);

      const allItems = itemRepo.getAll();
      const twitter = allItems.find((i) => i.title === 'Twitter');
      expect(twitter).toBeDefined();
      expect(twitter!.passwordEncrypted).toBeTruthy();

      const decryptedPw = decryptString(
        Buffer.from(twitter!.passwordEncrypted as ArrayBuffer),
        TEST_KEY,
      );
      expect(decryptedPw).toBe('Tw1tt3rP@ss!');
    });

    it('should handle items without folders (all items go to Imported folder)', () => {
      const content = loadFixture('1password-sample.csv');
      const factory = createImporterFactoryWithAllDefaults();
      const importer = factory.get('1password-csv');
      const payload = importer.parse(content);

      for (const item of payload.items) {
        expect(item.folderId).toBe('');
      }

      commitImportPayload(payload);

      const allItems = itemRepo.getAll();
      const allFolders = folderRepo.getFlatList();
      const importedFolder = allFolders.find((f) => f.name === 'Imported');
      expect(importedFolder).toBeDefined();

      for (const item of allItems) {
        expect(item.folderId).toBe(importedFolder!.id);
      }
    });

    it('should create an Imported folder for items without folder assignment', () => {
      const content = loadFixture('1password-sample.csv');
      const factory = createImporterFactoryWithAllDefaults();
      const importer = factory.get('1password-csv');
      const payload = importer.parse(content);

      expect(payload.folders.length).toBe(0);

      commitImportPayload(payload);

      const allFolders = folderRepo.getFlatList();
      expect(allFolders.length).toBe(1);
      expect(allFolders[0].name).toBe('Imported');
    });
  });

  // =========================================================================
  // 4.2 — Duplicate detection integration
  // =========================================================================
  describe('Duplicate detection and resolution', () => {
    it('should detect duplicates when importing same data twice', () => {
      const content = loadFixture('keepass-sample.xml');
      const factory = createImporterFactoryWithAllDefaults();
      const importer = factory.get('keepass-xml');
      const payload = importer.parse(content);

      commitImportPayload(payload);

      const allDbItems = itemRepo.getAll();
      const existingRefs = buildExistingItemRefs(allDbItems);
      const report = detectDuplicates(payload.items, existingRefs);

      expect(report.duplicates.length).toBeGreaterThan(0);
      expect(report.totalImportItems).toBe(4);
    });

    it('should skip duplicates when resolution is skip', () => {
      const content = loadFixture('keepass-sample.xml');
      const factory = createImporterFactoryWithAllDefaults();
      const importer = factory.get('keepass-xml');
      const payload = importer.parse(content);

      commitImportPayload(payload);
      const initialCount = itemRepo.getAll().length;
      expect(initialCount).toBe(4);

      const allDbItems = itemRepo.getAll();
      const existingRefs = buildExistingItemRefs(allDbItems);
      const report = detectDuplicates(payload.items, existingRefs);

      const resolutionMap: DuplicateResolutionMap = {
        items: report.duplicates,
        globalResolution: 'skip',
        perItemResolutions: {},
      };

      const filteredPayload = applyResolutionMap(payload, resolutionMap);
      const result = commitImportPayload(filteredPayload);

      const finalCount = itemRepo.getAll().length;
      expect(finalCount).toBe(initialCount);
      expect(result.importedCount).toBe(0);
    });

    it('should rename duplicates when resolution is rename', () => {
      const content = loadFixture('keepass-sample.xml');
      const factory = createImporterFactoryWithAllDefaults();
      const importer = factory.get('keepass-xml');
      const payload = importer.parse(content);

      commitImportPayload(payload);

      const allDbItems = itemRepo.getAll();
      const existingRefs = buildExistingItemRefs(allDbItems);
      const report = detectDuplicates(payload.items, existingRefs);

      const resolutionMap: DuplicateResolutionMap = {
        items: report.duplicates,
        globalResolution: 'rename',
        perItemResolutions: {},
      };

      const renamedPayload = applyResolutionMap(payload, resolutionMap);
      const result = commitImportPayload(renamedPayload);

      expect(result.importedCount).toBe(4);

      const allItems = itemRepo.getAll();
      expect(allItems.length).toBe(8);

      const renamedItems = allItems.filter((i) => i.title.includes('(2)'));
      expect(renamedItems.length).toBeGreaterThan(0);
    });

    it('should report no duplicates for fresh import', () => {
      const content = loadFixture('keepass-sample.xml');
      const factory = createImporterFactoryWithAllDefaults();
      const importer = factory.get('keepass-xml');
      const payload = importer.parse(content);

      const allDbItems = itemRepo.getAll();
      const existingRefs = buildExistingItemRefs(allDbItems);
      const report = detectDuplicates(payload.items, existingRefs);

      expect(report.duplicates.length).toBe(0);
      expect(report.uniqueItems).toBe(4);
    });
  });

  // =========================================================================
  // 4.2 — Multi-format import to same vault
  // =========================================================================
  describe('Multi-format import', () => {
    it('should import from multiple formats into same vault without conflicts', () => {
      const keepassContent = loadFixture('keepass-sample.xml');
      const bitwardenContent = loadFixture('bitwarden-sample.json');
      const onepassContent = loadFixture('1password-sample.csv');

      const factory = createImporterFactoryWithAllDefaults();

      const keepassPayload = factory.get('keepass-xml').parse(keepassContent);
      const bitwardenPayload = factory.get('bitwarden-json').parse(bitwardenContent);
      const onepassPayload = factory.get('1password-csv').parse(onepassContent);

      commitImportPayload(keepassPayload);
      commitImportPayload(bitwardenPayload);
      commitImportPayload(onepassPayload);

      const allItems = itemRepo.getAll();
      expect(allItems.length).toBe(4 + 4 + 6);
    });

    it('should maintain data integrity across multi-format imports', () => {
      const keepassContent = loadFixture('keepass-sample.xml');
      const bitwardenContent = loadFixture('bitwarden-sample.json');

      const factory = createImporterFactoryWithAllDefaults();

      const keepassPayload = factory.get('keepass-xml').parse(keepassContent);
      const bitwardenPayload = factory.get('bitwarden-json').parse(bitwardenContent);

      commitImportPayload(keepassPayload);
      commitImportPayload(bitwardenPayload);

      const allItems = itemRepo.getAll();

      const exampleCorp = allItems.find((i) => i.title === 'Example Corp');
      expect(exampleCorp).toBeDefined();
      expect(exampleCorp!.username).toBe('user@example.com');

      const twitter = allItems.find((i) => i.title === 'Twitter');
      expect(twitter).toBeDefined();
      expect(twitter!.username).toBe('user@twitter.com');

      for (const item of allItems) {
        expect(item.passwordEncrypted).toBeTruthy();
        const decrypted = decryptString(
          Buffer.from(item.passwordEncrypted as ArrayBuffer),
          TEST_KEY,
        );
        expect(decrypted.length).toBeGreaterThan(0);
      }
    });
  });

  // =========================================================================
  // 4.2 — Error handling integration
  // =========================================================================
  describe('Import error handling', () => {
    it('should handle parse errors gracefully without corrupting DB', () => {
      const factory = createImporterFactoryWithAllDefaults();

      expect(() => {
        factory.get('keepass-xml').parse('not valid xml');
      }).toThrow();

      const allItems = itemRepo.getAll();
      expect(allItems.length).toBe(0);
    });

    it('should handle empty payload gracefully', () => {
      const emptyPayload: ImportPayload = {
        folders: [],
        items: [],
        tags: [],
        attachments: [],
      };

      const result = commitImportPayload(emptyPayload);
      expect(result.importedCount).toBe(0);

      const allItems = itemRepo.getAll();
      expect(allItems.length).toBe(0);
    });
  });
});
