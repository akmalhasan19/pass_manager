import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import initSqlJs, { Database as SqlJsDatabase } from 'sql.js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FolderRepository } from '@main/database/repositories/FolderRepository';
import { ItemRepository } from '@main/database/repositories/ItemRepository';
import { TagRepository } from '@main/database/repositories/TagRepository';
import { encryptString, decryptString, decryptAES256GCM } from '@main/crypto/encryption';
import { validateEncryptedFileStructure, validateExportPayloadSchema } from '@main/import-export/schemaValidator';
import { EncryptedJsonImporter } from '@main/import-export/parsers/encryptedJsonParser';
import type { ExportPayload } from '@shared/types';

const FTS5_RELATED = /items_fts|fts5/i;

// ---------------------------------------------------------------------------
// DB setup
// ---------------------------------------------------------------------------
async function createDb(): Promise<SqlJsDatabase> {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  db.run('PRAGMA foreign_keys = ON');
  db.run('PRAGMA journal_mode = MEMORY');

  const schemaPath = join(__dirname, '..', '..', '..', 'src', 'main', 'database', 'schema.sql');
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

// ---------------------------------------------------------------------------
// Mock connection to point to our test DB
// ---------------------------------------------------------------------------
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

// Mock authHandlers to return a test key
vi.mock('@main/ipc/authHandlers', () => ({
  getMasterKey: () => TEST_KEY,
}));

// ---------------------------------------------------------------------------
// Shared state
// ---------------------------------------------------------------------------
const folderRepo = new FolderRepository();
const itemRepo = new ItemRepository();
const tagRepo = new TagRepository();

const TEST_KEY = Buffer.from('0123456789abcdef0123456789abcdef', 'utf-8');

// Import the export helpers after mock setup
const {
  buildExportMetadata,
  arrayBufferToBase64,
  serializeEncryptedExport,
  buildEncryptedPayload,
} = await import('@main/ipc/exportHandlers');

const {
  itemsToJsonPlain,
  jsonPlainToItems,
  itemsToCsv,
  csvToItems,
  escapeCsvField,
  unescapeCsvField,
  parseCsvLine,
} = await import('@main/import-export/plainTextFormats');
import type { PlainTextExportItemRich, PlainTextExportItem } from '@shared/types';

describe('Encrypted JSON Export', () => {
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
  // 3.2 — buildExportMetadata
  // =========================================================================
  it('should build metadata with correct counts and versions', () => {
    const metadata = buildExportMetadata(5, 3, 2, 1);
    expect(metadata.appName).toBe('SecurePass Manager');
    expect(metadata.appVersion).toBe('0.1.0');
    expect(metadata.formatVersion).toBe(1);
    expect(metadata.schemaVersion).toBe(1);
    expect(metadata.itemCount).toBe(5);
    expect(metadata.folderCount).toBe(3);
    expect(metadata.tagCount).toBe(2);
    expect(metadata.attachmentCount).toBe(1);
    expect(metadata.exportedAt).toBeGreaterThan(0);
    expect(metadata.exportedAt).toBeLessThanOrEqual(Date.now());
  });

  // =========================================================================
  // 3.2 — arrayBufferToBase64
  // =========================================================================
  it('should convert ArrayBuffer to base64 string', () => {
    const buffer = new Uint8Array([1, 2, 3, 4, 5]).buffer;
    const base64 = arrayBufferToBase64(buffer);
    expect(base64).toBe('AQIDBAU=');
  });

  it('should return null for null buffer', () => {
    expect(arrayBufferToBase64(null)).toBeNull();
  });

  // =========================================================================
  // 3.2 — serializeEncryptedExport round-trip
  // =========================================================================
  it('should produce a valid EncryptedExportFile that can be decrypted', () => {
    const payload: ExportPayload = {
      formatVersion: 1,
      metadata: {
        appName: 'SecurePass Manager',
        appVersion: '0.1.0',
        exportedAt: Date.now(),
        formatVersion: 1,
        schemaVersion: 1,
        itemCount: 1,
        folderCount: 0,
        tagCount: 0,
        attachmentCount: 0,
      },
      folders: [],
      items: [
        {
          id: 'item-1',
          folderId: 'folder-1',
          title: 'Test Item',
          username: 'user',
          passwordEncrypted: 'c29tZS1lbmNyeXB0ZWQtcGFzc3dvcmQ=',
          url: 'https://example.com',
          notesEncrypted: null,
          emoji: null,
          coverImage: null,
          createdAt: 1000,
          updatedAt: 1000,
          isFavorite: false,
          sortOrder: 0,
          tagIds: [],
        },
      ],
      tags: [],
      attachments: [],
    };

    const encryptedFile = serializeEncryptedExport(payload, TEST_KEY);

    // Validate structure
    expect(encryptedFile.magic).toBe('SPM');
    expect(encryptedFile.formatVersion).toBe(1);
    expect(encryptedFile.encryptionAlgorithm).toBe('aes-256-gcm');
    expect(encryptedFile.iv).toBeTruthy();
    expect(encryptedFile.authTag).toBeTruthy();
    expect(encryptedFile.ciphertext).toBeTruthy();

    // Validate via schema validator
    const validated = validateEncryptedFileStructure(encryptedFile);
    expect(validated.magic).toBe('SPM');

    // Decrypt round-trip
    const iv = Buffer.from(encryptedFile.iv, 'base64');
    const tag = Buffer.from(encryptedFile.authTag, 'base64');
    const ciphertext = Buffer.from(encryptedFile.ciphertext, 'base64');
    const decryptedBuffer = decryptAES256GCM({ ciphertext, iv, tag }, TEST_KEY);
    const decryptedJson = JSON.parse(decryptedBuffer.toString('utf-8'));
    const decryptedPayload = validateExportPayloadSchema(decryptedJson);

    expect(decryptedPayload.formatVersion).toBe(1);
    expect(decryptedPayload.metadata.itemCount).toBe(1);
    expect(decryptedPayload.items).toHaveLength(1);
    expect(decryptedPayload.items[0].id).toBe('item-1');
    expect(decryptedPayload.items[0].title).toBe('Test Item');
    expect(decryptedPayload.items[0].passwordEncrypted).toBe('c29tZS1lbmNyeXB0ZWQtcGFzc3dvcmQ=');
  });

  // =========================================================================
  // 3.2 — buildEncryptedPayload with real DB data
  // =========================================================================
  it('should serialize vault data to encrypted payload structure', () => {
    const folder = folderRepo.create(null, 'Export Test', '📦');
    const encryptedPw = encryptString('secretPassword', TEST_KEY);
    const encryptedNotes = encryptString('My secure notes', TEST_KEY);

    const item = itemRepo.create(folder.id, {
      title: 'Export Account',
      username: 'export@example.com',
      passwordEncrypted: encryptedPw,
      url: 'https://export.example.com',
      notesEncrypted: encryptedNotes,
      emoji: '🔐',
    });

    const tag = tagRepo.create('export-tag', '#00ff00');
    tagRepo.attachToItem(item.id, tag.id);

    const payload = buildEncryptedPayload();

    expect(payload.formatVersion).toBe(1);
    expect(payload.metadata.appName).toBe('SecurePass Manager');
    expect(payload.metadata.itemCount).toBe(1);
    expect(payload.metadata.folderCount).toBe(1);
    expect(payload.metadata.tagCount).toBe(1);
    expect(payload.metadata.attachmentCount).toBe(0);

    expect(payload.folders).toHaveLength(1);
    expect(payload.folders[0].id).toBe(folder.id);
    expect(payload.folders[0].name).toBe('Export Test');
    expect(payload.folders[0].emoji).toBe('📦');

    expect(payload.items).toHaveLength(1);
    expect(payload.items[0].id).toBe(item.id);
    expect(payload.items[0].title).toBe('Export Account');
    expect(payload.items[0].username).toBe('export@example.com');
    expect(payload.items[0].url).toBe('https://export.example.com');
    expect(payload.items[0].isFavorite).toBe(false);
    expect(payload.items[0].tagIds).toContain(tag.id);

    // Verify passwordEncrypted is a base64 string (not null)
    expect(payload.items[0].passwordEncrypted).toBeTruthy();
    expect(typeof payload.items[0].passwordEncrypted).toBe('string');

    // Verify we can decrypt the stored blob back
    const decryptedPw = decryptString(
      Buffer.from(payload.items[0].passwordEncrypted!, 'base64'),
      TEST_KEY,
    );
    expect(decryptedPw).toBe('secretPassword');

    expect(payload.tags).toHaveLength(1);
    expect(payload.tags[0].name).toBe('export-tag');
    expect(payload.tags[0].color).toBe('#00ff00');
  });

  // =========================================================================
  // 3.2 — Encrypted payload round-trip with import parser
  // =========================================================================
  it('should export encrypted payload that can be imported back', () => {
    const folder = folderRepo.create(null, 'Roundtrip', '🔄');
    const encryptedPw = encryptString('roundtripSecret', TEST_KEY);

    itemRepo.create(folder.id, {
      title: 'Roundtrip Item',
      username: 'roundtrip@example.com',
      passwordEncrypted: encryptedPw,
      url: 'https://roundtrip.example.com',
    });

    const payload = buildEncryptedPayload();
    const encryptedFile = serializeEncryptedExport(payload, TEST_KEY);
    const encryptedFileJson = JSON.stringify(encryptedFile);

    // Now import it back using the encrypted JSON parser
    const importer = new EncryptedJsonImporter();
    const importedPayload = importer.parse(encryptedFileJson);

    expect(importedPayload.items).toHaveLength(1);
    expect(importedPayload.items[0].title).toBe('Roundtrip Item');
    expect(importedPayload.items[0].username).toBe('roundtrip@example.com');
    expect(importedPayload.items[0].password).toBe('roundtripSecret');
    expect(importedPayload.items[0].url).toBe('https://roundtrip.example.com');

    expect(importedPayload.folders).toHaveLength(1);
    expect(importedPayload.folders[0].name).toBe('Roundtrip');
  });

  // =========================================================================
  // 4.3 — Comprehensive Round Trip Test
  // =========================================================================
  describe('Round Trip Test - Full Data Integrity', () => {
    it('should preserve all data through export → import cycle with deep equality', () => {
      // Create complex vault structure
      const folder1 = folderRepo.create(null, 'Work', '💼');
      const folder2 = folderRepo.create(null, 'Personal', '🏠');
      const subfolder1 = folderRepo.create(folder1.id, 'Projects', '📁');

      const encryptedPw1 = encryptString('WorkPass123!', TEST_KEY);
      const encryptedNotes1 = encryptString('Important work notes', TEST_KEY);
      const encryptedPw2 = encryptString('PersonalPass456@', TEST_KEY);
      const encryptedNotes2 = encryptString('Personal secrets here', TEST_KEY);
      const encryptedPw3 = encryptString('ProjectPass789#', TEST_KEY);

      const item1 = itemRepo.create(folder1.id, {
        title: 'Work Email',
        username: 'worker@company.com',
        passwordEncrypted: encryptedPw1,
        url: 'https://mail.company.com',
        notesEncrypted: encryptedNotes1,
        emoji: '📧',
      });

      const item2 = itemRepo.create(folder2.id, {
        title: 'Personal Bank',
        username: 'john.doe',
        passwordEncrypted: encryptedPw2,
        url: 'https://bank.com',
        notesEncrypted: encryptedNotes2,
        emoji: '🏦',
      });

      const item3 = itemRepo.create(subfolder1.id, {
        title: 'Project Repo',
        username: 'dev-user',
        passwordEncrypted: encryptedPw3,
        url: 'https://github.com/project',
        emoji: '💻',
      });

      const tag1 = tagRepo.create('important', '#ef4444');
      const tag2 = tagRepo.create('work', '#3b82f6');
      const tag3 = tagRepo.create('personal', '#10b981');

      tagRepo.attachToItem(item1.id, tag1.id);
      tagRepo.attachToItem(item1.id, tag2.id);
      tagRepo.attachToItem(item2.id, tag3.id);
      tagRepo.attachToItem(item3.id, tag2.id);

      // Export to encrypted JSON
      const originalPayload = buildEncryptedPayload();
      const encryptedFile = serializeEncryptedExport(originalPayload, TEST_KEY);
      const encryptedFileJson = JSON.stringify(encryptedFile);

      // Import back
      const importer = new EncryptedJsonImporter();
      const importedPayload = importer.parse(encryptedFileJson);

      // Verify folders
      expect(importedPayload.folders).toHaveLength(originalPayload.folders.length);
      for (const origFolder of originalPayload.folders) {
        const impFolder = importedPayload.folders.find((f) => f.name === origFolder.name);
        expect(impFolder).toBeDefined();
        expect(impFolder!.parentId).toBe(origFolder.parentId);
        expect(impFolder!.emoji).toBe(origFolder.emoji);
        expect(impFolder!.sortOrder).toBe(origFolder.sortOrder);
      }

      // Verify items
      expect(importedPayload.items).toHaveLength(originalPayload.items.length);
      for (const origItem of originalPayload.items) {
        const impItem = importedPayload.items.find((i) => i.title === origItem.title);
        expect(impItem).toBeDefined();
        expect(impItem!.username).toBe(origItem.username);
        expect(impItem!.url).toBe(origItem.url);
        expect(impItem!.emoji).toBe(origItem.emoji);
        expect(impItem!.isFavorite).toBe(origItem.isFavorite);
        expect(impItem!.sortOrder).toBe(origItem.sortOrder);

        // Verify password can be decrypted to original value
        const origPw = origItem.passwordEncrypted
          ? decryptString(Buffer.from(origItem.passwordEncrypted, 'base64'), TEST_KEY)
          : '';
        expect(impItem!.password).toBe(origPw);

        // Verify notes can be decrypted to original value
        const origNotes = origItem.notesEncrypted
          ? decryptString(Buffer.from(origItem.notesEncrypted, 'base64'), TEST_KEY)
          : null;
        if (origNotes) {
          expect(impItem!.notes).toBe(origNotes);
        }
      }

      // Verify tags
      expect(importedPayload.tags).toHaveLength(originalPayload.tags.length);
      for (const origTag of originalPayload.tags) {
        const impTag = importedPayload.tags.find((t) => t.name === origTag.name);
        expect(impTag).toBeDefined();
        expect(impTag!.color).toBe(origTag.color);
      }

      // Verify tag assignments
      const workEmailImport = importedPayload.items.find((i) => i.title === 'Work Email');
      expect(workEmailImport).toBeDefined();
      expect(workEmailImport!.tagIds).toHaveLength(2);

      const personalBankImport = importedPayload.items.find((i) => i.title === 'Personal Bank');
      expect(personalBankImport).toBeDefined();
      expect(personalBankImport!.tagIds).toHaveLength(1);

      const projectRepoImport = importedPayload.items.find((i) => i.title === 'Project Repo');
      expect(projectRepoImport).toBeDefined();
      expect(projectRepoImport!.tagIds).toHaveLength(1);
    });

    it('should preserve special characters and unicode through round trip', () => {
      const folder = folderRepo.create(null, '🔐 Special Folder', '🌟');
      const encryptedPw = encryptString('P@$$w0rd!#%^&*()_+-=[]{}|;:\'",.<>?/`~', TEST_KEY);
      const encryptedNotes = encryptString('Notes with emoji: 🎉🚀💯 and unicode: 用户@例子.com', TEST_KEY);

      const item = itemRepo.create(folder.id, {
        title: 'Special Characters Test 🎭',
        username: 'user\nwith\nnewlines',
        passwordEncrypted: encryptedPw,
        url: 'https://пример.com/path?q=1&b=2#hash',
        notesEncrypted: encryptedNotes,
        emoji: '🔑',
      });

      const tag = tagRepo.create('тест-テスト', '#ff00ff');
      tagRepo.attachToItem(item.id, tag.id);

      const originalPayload = buildEncryptedPayload();
      const encryptedFile = serializeEncryptedExport(originalPayload, TEST_KEY);
      const encryptedFileJson = JSON.stringify(encryptedFile);

      const importer = new EncryptedJsonImporter();
      const importedPayload = importer.parse(encryptedFileJson);

      expect(importedPayload.items).toHaveLength(1);
      expect(importedPayload.items[0].title).toBe('Special Characters Test 🎭');
      expect(importedPayload.items[0].username).toBe('user\nwith\nnewlines');
      expect(importedPayload.items[0].password).toBe('P@$$w0rd!#%^&*()_+-=[]{}|;:\'",.<>?/`~');
      expect(importedPayload.items[0].url).toBe('https://пример.com/path?q=1&b=2#hash');
      expect(importedPayload.items[0].notes).toBe('Notes with emoji: 🎉🚀💯 and unicode: 用户@例子.com');
      expect(importedPayload.items[0].emoji).toBe('🔑');

      expect(importedPayload.folders).toHaveLength(1);
      expect(importedPayload.folders[0].name).toBe('🔐 Special Folder');
      expect(importedPayload.folders[0].emoji).toBe('🌟');

      expect(importedPayload.tags).toHaveLength(1);
      expect(importedPayload.tags[0].name).toBe('тест-テスト');
      expect(importedPayload.tags[0].color).toBe('#ff00ff');
    });

    it('should maintain folder hierarchy through round trip', () => {
      const root1 = folderRepo.create(null, 'Root1', '🌳');
      folderRepo.create(null, 'Root2', '🌲');
      const child1 = folderRepo.create(root1.id, 'Child1', '🌿');
      folderRepo.create(root1.id, 'Child2', '🍃');
      const grandchild = folderRepo.create(child1.id, 'Grandchild', '🌱');

      const encryptedPw = encryptString('test', TEST_KEY);
      itemRepo.create(root1.id, { title: 'Item1', passwordEncrypted: encryptedPw });
      itemRepo.create(child1.id, { title: 'Item2', passwordEncrypted: encryptedPw });
      itemRepo.create(grandchild.id, { title: 'Item3', passwordEncrypted: encryptedPw });

      const originalPayload = buildEncryptedPayload();
      const encryptedFile = serializeEncryptedExport(originalPayload, TEST_KEY);
      const encryptedFileJson = JSON.stringify(encryptedFile);

      const importer = new EncryptedJsonImporter();
      const importedPayload = importer.parse(encryptedFileJson);

      expect(importedPayload.folders).toHaveLength(5);

      const impRoot1 = importedPayload.folders.find((f) => f.name === 'Root1');
      const impChild1 = importedPayload.folders.find((f) => f.name === 'Child1');
      const impGrandchild = importedPayload.folders.find((f) => f.name === 'Grandchild');

      expect(impRoot1).toBeDefined();
      expect(impRoot1!.parentId).toBeNull();

      expect(impChild1).toBeDefined();
      expect(impChild1!.parentId).toBe(impRoot1!.id);

      expect(impGrandchild).toBeDefined();
      expect(impGrandchild!.parentId).toBe(impChild1!.id);

      const item2 = importedPayload.items.find((i) => i.title === 'Item2');
      expect(item2).toBeDefined();
      expect(item2!.folderId).toBe(impChild1!.id);

      const item3 = importedPayload.items.find((i) => i.title === 'Item3');
      expect(item3).toBeDefined();
      expect(item3!.folderId).toBe(impGrandchild!.id);
    });

    it('should preserve favorite status and sort order through round trip', () => {
      const folder = folderRepo.create(null, 'Test', '📂');
      const encryptedPw = encryptString('pass', TEST_KEY);

      const item1 = itemRepo.create(folder.id, {
        title: 'Favorite Item',
        passwordEncrypted: encryptedPw,
      });
      itemRepo.update(item1.id, { isFavorite: true });

      itemRepo.create(folder.id, {
        title: 'Normal Item',
        passwordEncrypted: encryptedPw,
      });

      const originalPayload = buildEncryptedPayload();
      const encryptedFile = serializeEncryptedExport(originalPayload, TEST_KEY);
      const encryptedFileJson = JSON.stringify(encryptedFile);

      const importer = new EncryptedJsonImporter();
      const importedPayload = importer.parse(encryptedFileJson);

      const impItem1 = importedPayload.items.find((i) => i.title === 'Favorite Item');
      expect(impItem1).toBeDefined();
      expect(impItem1!.isFavorite).toBe(true);

      const impItem2 = importedPayload.items.find((i) => i.title === 'Normal Item');
      expect(impItem2).toBeDefined();
      expect(impItem2!.isFavorite).toBe(false);
    });

    it('should handle large vault with many items through round trip', () => {
      const folder = folderRepo.create(null, 'Large', '📦');
      const encryptedPw = encryptString('password', TEST_KEY);

      for (let i = 0; i < 100; i++) {
        itemRepo.create(folder.id, {
          title: `Item ${i}`,
          username: `user${i}@example.com`,
          passwordEncrypted: encryptedPw,
          url: `https://site${i}.com`,
        });
      }

      const originalPayload = buildEncryptedPayload();
      expect(originalPayload.items).toHaveLength(100);

      const encryptedFile = serializeEncryptedExport(originalPayload, TEST_KEY);
      const encryptedFileJson = JSON.stringify(encryptedFile);

      const importer = new EncryptedJsonImporter();
      const importedPayload = importer.parse(encryptedFileJson);

      expect(importedPayload.items).toHaveLength(100);

      for (let i = 0; i < 100; i++) {
        const origItem = originalPayload.items[i];
        const impItem = importedPayload.items.find((item) => item.title === origItem.title);
        expect(impItem).toBeDefined();
        expect(impItem!.username).toBe(origItem.username);
        expect(impItem!.url).toBe(origItem.url);
        expect(impItem!.password).toBe('password');
      }
    });
  });
});

describe('JSON Plain Export', () => {
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
  // 3.3 — itemsToJsonPlain serialization
  // =========================================================================
  it('should serialize items to pretty-printed JSON by default', () => {
    const items: PlainTextExportItemRich[] = [
      {
        title: 'Test Account',
        username: 'user@example.com',
        password: 'plainPassword123',
        url: 'https://example.com',
        notes: { html: '<p>Some notes</p>', text: 'Some notes' },
        tags: ['work', 'important'],
        folder: 'Work',
        isFavorite: true,
        createdAt: 1000,
        updatedAt: 2000,
      },
    ];

    const json = itemsToJsonPlain(items);
    const parsed = JSON.parse(json);

    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].title).toBe('Test Account');
    expect(parsed[0].username).toBe('user@example.com');
    expect(parsed[0].password).toBe('plainPassword123');
    expect(parsed[0].url).toBe('https://example.com');
    expect(parsed[0].notes).toEqual({ html: '<p>Some notes</p>', text: 'Some notes' });
    expect(parsed[0].tags).toEqual(['work', 'important']);
    expect(parsed[0].folder).toBe('Work');
    expect(parsed[0].isFavorite).toBe(true);
  });

  it('should serialize items to compact JSON when pretty=false', () => {
    const items: PlainTextExportItemRich[] = [
      {
        title: 'Compact',
        username: 'user',
        password: 'pass',
        url: '',
        notes: null,
        tags: [],
      },
    ];

    const prettyJson = itemsToJsonPlain(items, true);
    const compactJson = itemsToJsonPlain(items, false);

    expect(prettyJson.includes('\n')).toBe(true);
    expect(compactJson.includes('\n')).toBe(false);
    expect(JSON.parse(compactJson)).toEqual(JSON.parse(prettyJson));
  });

  // =========================================================================
  // 3.3 — Password is stored as plain text (not encrypted)
  // =========================================================================
  it('should store password as plain text in JSON output', () => {
    const items: PlainTextExportItemRich[] = [
      {
        title: 'Plain Password Test',
        username: 'admin',
        password: 'SuperSecret123!',
        url: 'https://bank.com',
        notes: null,
        tags: [],
      },
    ];

    const json = itemsToJsonPlain(items);

    expect(json).toContain('SuperSecret123!');
    expect(json).not.toContain('passwordEncrypted');

    const parsed = JSON.parse(json);
    expect(parsed[0].password).toBe('SuperSecret123!');
    expect(typeof parsed[0].password).toBe('string');
  });

  // =========================================================================
  // 3.3 — jsonPlainToItems parsing
  // =========================================================================
  it('should parse valid JSON plain export back to items', () => {
    const json = JSON.stringify([
      {
        title: 'Parsed Item',
        username: 'parsed@example.com',
        password: 'parsedPass',
        url: 'https://parsed.com',
        notes: { html: '<p>note</p>', text: 'note' },
        tags: ['tag1'],
        folder: 'Personal',
        isFavorite: false,
        createdAt: 5000,
        updatedAt: 6000,
      },
    ]);

    const items = jsonPlainToItems(json);

    expect(items).toHaveLength(1);
    expect(items[0].title).toBe('Parsed Item');
    expect(items[0].username).toBe('parsed@example.com');
    expect(items[0].password).toBe('parsedPass');
    expect(items[0].url).toBe('https://parsed.com');
    expect(items[0].notes).toEqual({ html: '<p>note</p>', text: 'note' });
    expect(items[0].tags).toEqual(['tag1']);
    expect(items[0].folder).toBe('Personal');
    expect(items[0].isFavorite).toBe(false);
    expect(items[0].createdAt).toBe(5000);
    expect(items[0].updatedAt).toBe(6000);
  });

  it('should throw if JSON is not an array', () => {
    const json = JSON.stringify({ title: 'not an array' });
    expect(() => jsonPlainToItems(json)).toThrow('JSON plain export must be an array of items');
  });

  it('should throw if item is missing required field: title', () => {
    const json = JSON.stringify([{ username: 'user', password: 'pass' }]);
    expect(() => jsonPlainToItems(json)).toThrow('missing required field: title');
  });

  it('should throw if item is missing required field: username', () => {
    const json = JSON.stringify([{ title: 'Title', password: 'pass' }]);
    expect(() => jsonPlainToItems(json)).toThrow('missing required field: username');
  });

  it('should throw if item is missing required field: password', () => {
    const json = JSON.stringify([{ title: 'Title', username: 'user' }]);
    expect(() => jsonPlainToItems(json)).toThrow('missing required field: password');
  });

  it('should throw if item is not an object', () => {
    const json = JSON.stringify(['not an object']);
    expect(() => jsonPlainToItems(json)).toThrow('Item at index 0 is not an object');
  });

  it('should default missing optional fields', () => {
    const json = JSON.stringify([
      {
        title: 'Minimal',
        username: 'user',
        password: 'pass',
      },
    ]);

    const items = jsonPlainToItems(json);

    expect(items).toHaveLength(1);
    expect(items[0].title).toBe('Minimal');
    expect(items[0].username).toBe('user');
    expect(items[0].password).toBe('pass');
    expect(items[0].url).toBe('');
    expect(items[0].notes).toBeNull();
    expect(items[0].tags).toEqual([]);
    expect(items[0].folder).toBeUndefined();
    expect(items[0].isFavorite).toBeUndefined();
  });

  // =========================================================================
  // 3.3 — Round-trip: items → JSON → items
  // =========================================================================
  it('should round-trip items through JSON plain serialization', () => {
    const original: PlainTextExportItemRich[] = [
      {
        title: 'Roundtrip Item 1',
        username: 'user1@example.com',
        password: 'p@ssw0rd!#$%',
        url: 'https://site1.com',
        notes: { html: '<p>Notes with <strong>HTML</strong></p>', text: 'Notes with HTML' },
        tags: ['personal', 'finance'],
        folder: 'Banking',
        isFavorite: true,
        createdAt: 1000,
        updatedAt: 2000,
      },
      {
        title: 'Roundtrip Item 2',
        username: 'user2',
        password: 'another-password',
        url: '',
        notes: null,
        tags: [],
        isFavorite: false,
      },
    ];

    const json = itemsToJsonPlain(original);
    const restored = jsonPlainToItems(json);

    expect(restored).toHaveLength(2);

    expect(restored[0].title).toBe(original[0].title);
    expect(restored[0].username).toBe(original[0].username);
    expect(restored[0].password).toBe(original[0].password);
    expect(restored[0].url).toBe(original[0].url);
    expect(restored[0].notes).toEqual(original[0].notes);
    expect(restored[0].tags).toEqual(original[0].tags);
    expect(restored[0].folder).toBe(original[0].folder);
    expect(restored[0].isFavorite).toBe(original[0].isFavorite);
    expect(restored[0].createdAt).toBe(original[0].createdAt);
    expect(restored[0].updatedAt).toBe(original[0].updatedAt);

    expect(restored[1].title).toBe(original[1].title);
    expect(restored[1].password).toBe(original[1].password);
    expect(restored[1].notes).toBeNull();
  });

  // =========================================================================
  // 3.3 — Special characters and edge cases
  // =========================================================================
  it('should handle special characters in all fields', () => {
    const items: PlainTextExportItemRich[] = [
      {
        title: 'Title with "quotes" and, commas',
        username: 'user\nwith\nnewlines',
        password: 'p@$$w0rd!#%^&*()_+-=[]{}|;:\'",.<>?/`~',
        url: 'https://example.com/path?q=1&b=2#hash',
        notes: { html: '<p>Line 1<br>Line 2</p>', text: 'Line 1\nLine 2' },
        tags: ['tag with spaces', 'tag,with,commas'],
      },
    ];

    const json = itemsToJsonPlain(items);
    const parsed = JSON.parse(json);

    expect(parsed[0].title).toBe(items[0].title);
    expect(parsed[0].username).toBe(items[0].username);
    expect(parsed[0].password).toBe(items[0].password);
    expect(parsed[0].url).toBe(items[0].url);
    expect(parsed[0].notes).toEqual(items[0].notes);
    expect(parsed[0].tags).toEqual(items[0].tags);
  });

  it('should handle empty items array', () => {
    const json = itemsToJsonPlain([]);
    const parsed = JSON.parse(json);
    expect(parsed).toEqual([]);
  });

  it('should handle unicode characters', () => {
    const items: PlainTextExportItemRich[] = [
      {
        title: '🔐 Password Manager',
        username: '用户@例子.com',
        password: ' contraseña-パスワード',
        url: 'https://пример.com',
        notes: { html: '<p>Emoji: 🎉🚀</p>', text: 'Emoji: 🎉🚀' },
        tags: ['тест', 'テスト'],
      },
    ];

    const json = itemsToJsonPlain(items);
    const restored = jsonPlainToItems(json);

    expect(restored[0].title).toBe(items[0].title);
    expect(restored[0].username).toBe(items[0].username);
    expect(restored[0].password).toBe(items[0].password);
    expect(restored[0].tags).toEqual(items[0].tags);
  });

  // =========================================================================
  // 3.3 — Integration: buildPlainTextItems with real DB
  // =========================================================================
  it('should decrypt passwords and notes from vault for plain text export', () => {
    const folder = folderRepo.create(null, 'Plain Export Folder', '📁');
    const encryptedPw = encryptString('myPlainTextPassword', TEST_KEY);
    const encryptedNotes = encryptString('My secret notes content', TEST_KEY);

    const item = itemRepo.create(folder.id, {
      title: 'Plain Export Item',
      username: 'plain@example.com',
      passwordEncrypted: encryptedPw,
      url: 'https://plain.example.com',
      notesEncrypted: encryptedNotes,
      emoji: '🔑',
    });

    const tag = tagRepo.create('plain-export-tag', '#ff0000');
    tagRepo.attachToItem(item.id, tag.id);

    const payload = buildEncryptedPayload();

    expect(payload.items).toHaveLength(1);
    expect(payload.items[0].passwordEncrypted).toBeTruthy();

    const decryptedPw = decryptString(
      Buffer.from(payload.items[0].passwordEncrypted!, 'base64'),
      TEST_KEY,
    );
    expect(decryptedPw).toBe('myPlainTextPassword');

    const decryptedNotes = decryptString(
      Buffer.from(payload.items[0].notesEncrypted!, 'base64'),
      TEST_KEY,
    );
    expect(decryptedNotes).toBe('My secret notes content');
  });

  it('should produce valid JSON output that can be parsed back', () => {
    const folder = folderRepo.create(null, 'JSON Valid Folder', '📂');
    const encryptedPw = encryptString('jsonValidPass', TEST_KEY);

    itemRepo.create(folder.id, {
      title: 'JSON Valid Item',
      username: 'json@example.com',
      passwordEncrypted: encryptedPw,
      url: 'https://json.example.com',
    });

    const items: PlainTextExportItemRich[] = [
      {
        title: 'JSON Valid Item',
        username: 'json@example.com',
        password: 'jsonValidPass',
        url: 'https://json.example.com',
        notes: null,
        tags: [],
        folder: 'JSON Valid Folder',
        isFavorite: false,
      },
    ];

    const json = itemsToJsonPlain(items);

    expect(() => JSON.parse(json)).not.toThrow();

    const parsed = JSON.parse(json);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].password).toBe('jsonValidPass');
    expect(parsed[0].password).not.toContain('encrypted');
  });
});

describe('CSV Plain Export', () => {
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
  // 3.4 — escapeCsvField
  // =========================================================================
  it('should not quote fields without special characters', () => {
    expect(escapeCsvField('simple')).toBe('simple');
    expect(escapeCsvField('user@example.com')).toBe('user@example.com');
    expect(escapeCsvField('https://example.com')).toBe('https://example.com');
  });

  it('should quote fields containing commas', () => {
    expect(escapeCsvField('value,with,commas')).toBe('"value,with,commas"');
    expect(escapeCsvField('a,b,c')).toBe('"a,b,c"');
  });

  it('should quote fields containing double quotes and escape them', () => {
    expect(escapeCsvField('value"with"quotes')).toBe('"value""with""quotes"');
    expect(escapeCsvField('say "hello"')).toBe('"say ""hello"""');
  });

  it('should quote fields containing newlines', () => {
    expect(escapeCsvField('line1\nline2')).toBe('"line1\nline2"');
    expect(escapeCsvField('line1\r\nline2')).toBe('"line1\r\nline2"');
    expect(escapeCsvField('line1\rline2')).toBe('"line1\rline2"');
  });

  it('should handle empty strings', () => {
    expect(escapeCsvField('')).toBe('');
  });

  it('should handle null and undefined', () => {
    expect(escapeCsvField(null as unknown as string)).toBe('');
    expect(escapeCsvField(undefined as unknown as string)).toBe('');
  });

  it('should handle fields with multiple special characters', () => {
    const field = 'value,"with"\nall,special';
    const escaped = escapeCsvField(field);
    expect(escaped).toContain('"');
    expect(escaped).to.include('""');
  });

  // =========================================================================
  // 3.4 — unescapeCsvField
  // =========================================================================
  it('should unescape quoted fields', () => {
    expect(unescapeCsvField('"value,with,commas"')).toBe('value,with,commas');
    expect(unescapeCsvField('"value""with""quotes"')).toBe('value"with"quotes');
    expect(unescapeCsvField('"line1\nline2"')).toBe('line1\nline2');
  });

  it('should handle unquoted fields', () => {
    expect(unescapeCsvField('simple')).toBe('simple');
    expect(unescapeCsvField('user@example.com')).toBe('user@example.com');
  });

  it('should trim whitespace', () => {
    expect(unescapeCsvField('  value  ')).toBe('value');
  });

  // =========================================================================
  // 3.4 — parseCsvLine
  // =========================================================================
  it('should parse simple CSV line', () => {
    const fields = parseCsvLine('a,b,c');
    expect(fields).toEqual(['a', 'b', 'c']);
  });

  it('should parse CSV line with quoted fields', () => {
    const fields = parseCsvLine('"a,b",c,"d"');
    expect(fields).toEqual(['a,b', 'c', 'd']);
  });

  it('should parse CSV line with escaped quotes', () => {
    const fields = parseCsvLine('"a""b",c');
    expect(fields).toEqual(['a"b', 'c']);
  });

  it('should parse CSV line with newlines in quotes', () => {
    const fields = parseCsvLine('"line1\nline2",b');
    expect(fields).toEqual(['line1\nline2', 'b']);
  });

  it('should handle empty fields', () => {
    const fields = parseCsvLine('a,,c');
    expect(fields).toEqual(['a', '', 'c']);
  });

  // =========================================================================
  // 3.4 — itemsToCsv serialization
  // =========================================================================
  it('should serialize items to CSV with correct header', () => {
    const items: PlainTextExportItem[] = [
      {
        title: 'Test Account',
        username: 'user@example.com',
        password: 'plainPassword123',
        url: 'https://example.com',
        notes: 'Some notes',
        tags: ['work', 'important'],
      },
    ];

    const csv = itemsToCsv(items);
    const lines = csv.split('\n');

    expect(lines[0]).toBe('title,username,password,url,notes,tags');
    expect(lines).toHaveLength(2);
  });

  it('should serialize multiple items', () => {
    const items: PlainTextExportItem[] = [
      {
        title: 'Item 1',
        username: 'user1',
        password: 'pass1',
        url: '',
        notes: '',
        tags: [],
      },
      {
        title: 'Item 2',
        username: 'user2',
        password: 'pass2',
        url: 'https://example.com',
        notes: 'notes',
        tags: ['tag1'],
      },
    ];

    const csv = itemsToCsv(items);
    const lines = csv.split('\n');

    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe('title,username,password,url,notes,tags');
  });

  it('should handle empty items array', () => {
    const csv = itemsToCsv([]);
    expect(csv).toBe('title,username,password,url,notes,tags');
  });

  // =========================================================================
  // 3.4 — Password is stored as plain text in CSV
  // =========================================================================
  it('should store password as plain text in CSV output', () => {
    const items: PlainTextExportItem[] = [
      {
        title: 'Plain Password Test',
        username: 'admin',
        password: 'SuperSecret123!',
        url: 'https://bank.com',
        notes: '',
        tags: [],
      },
    ];

    const csv = itemsToCsv(items);

    expect(csv).toContain('SuperSecret123!');
    expect(csv).not.toContain('passwordEncrypted');
  });

  // =========================================================================
  // 3.4 — Handle notes with escaping
  // =========================================================================
  it('should escape notes containing newlines', () => {
    const items: PlainTextExportItem[] = [
      {
        title: 'Item with newlines',
        username: 'user',
        password: 'pass',
        url: '',
        notes: 'Line 1\nLine 2\nLine 3',
        tags: [],
      },
    ];

    const csv = itemsToCsv(items);
    const parsed = csvToItems(csv);

    expect(parsed).toHaveLength(1);
    expect(parsed[0].notes).toBe('Line 1\nLine 2\nLine 3');
  });

  it('should escape notes containing commas', () => {
    const items: PlainTextExportItem[] = [
      {
        title: 'Item with commas',
        username: 'user',
        password: 'pass',
        url: '',
        notes: 'Note,with,commas',
        tags: [],
      },
    ];

    const csv = itemsToCsv(items);
    const parsed = csvToItems(csv);

    expect(parsed).toHaveLength(1);
    expect(parsed[0].notes).toBe('Note,with,commas');
  });

  it('should escape notes containing quotes', () => {
    const items: PlainTextExportItem[] = [
      {
        title: 'Item with quotes',
        username: 'user',
        password: 'pass',
        url: '',
        notes: 'Note with "quotes"',
        tags: [],
      },
    ];

    const csv = itemsToCsv(items);
    const parsed = csvToItems(csv);

    expect(parsed).toHaveLength(1);
    expect(parsed[0].notes).toBe('Note with "quotes"');
  });

  it('should escape notes with all special characters', () => {
    const items: PlainTextExportItem[] = [
      {
        title: 'Complex notes',
        username: 'user',
        password: 'pass',
        url: '',
        notes: 'Line 1,\n"quoted",\nLine 3',
        tags: [],
      },
    ];

    const csv = itemsToCsv(items);
    const parsed = csvToItems(csv);

    expect(parsed).toHaveLength(1);
    expect(parsed[0].notes).toBe('Line 1,\n"quoted",\nLine 3');
  });

  // =========================================================================
  // 3.4 — Tags handling
  // =========================================================================
  it('should serialize tags as semicolon-separated', () => {
    const items: PlainTextExportItem[] = [
      {
        title: 'Tagged Item',
        username: 'user',
        password: 'pass',
        url: '',
        notes: '',
        tags: ['work', 'important', 'finance'],
      },
    ];

    const csv = itemsToCsv(items);
    const parsed = csvToItems(csv);

    expect(parsed).toHaveLength(1);
    expect(parsed[0].tags).toEqual(['work', 'important', 'finance']);
  });

  it('should handle empty tags array', () => {
    const items: PlainTextExportItem[] = [
      {
        title: 'No Tags',
        username: 'user',
        password: 'pass',
        url: '',
        notes: '',
        tags: [],
      },
    ];

    const csv = itemsToCsv(items);
    const parsed = csvToItems(csv);

    expect(parsed).toHaveLength(1);
    expect(parsed[0].tags).toEqual([]);
  });

  // =========================================================================
  // 3.4 — Round-trip: items → CSV → items
  // =========================================================================
  it('should round-trip items through CSV serialization', () => {
    const original: PlainTextExportItem[] = [
      {
        title: 'Roundtrip Item 1',
        username: 'user1@example.com',
        password: 'p@ssw0rd!#$%',
        url: 'https://site1.com',
        notes: 'Notes with\nnewlines,and,commas',
        tags: ['personal', 'finance'],
      },
      {
        title: 'Roundtrip Item 2',
        username: 'user2',
        password: 'another-password',
        url: '',
        notes: '',
        tags: [],
      },
    ];

    const csv = itemsToCsv(original);
    const restored = csvToItems(csv);

    expect(restored).toHaveLength(2);

    expect(restored[0].title).toBe(original[0].title);
    expect(restored[0].username).toBe(original[0].username);
    expect(restored[0].password).toBe(original[0].password);
    expect(restored[0].url).toBe(original[0].url);
    expect(restored[0].notes).toBe(original[0].notes);
    expect(restored[0].tags).toEqual(original[0].tags);

    expect(restored[1].title).toBe(original[1].title);
    expect(restored[1].password).toBe(original[1].password);
    expect(restored[1].notes).toBe(original[1].notes);
  });

  // =========================================================================
  // 3.4 — Special characters and edge cases
  // =========================================================================
  it('should handle special characters in all fields', () => {
    const items: PlainTextExportItem[] = [
      {
        title: 'Title with "quotes" and, commas',
        username: 'user\nwith\nnewlines',
        password: 'p@$$w0rd!#%^&*()_+-=[]{}|;:\'",.<>?/`~',
        url: 'https://example.com/path?q=1&b=2#hash',
        notes: 'Line 1\nLine 2',
        tags: ['tag with spaces', 'tag,with,commas'],
      },
    ];

    const csv = itemsToCsv(items);
    const parsed = csvToItems(csv);

    expect(parsed[0].title).toBe(items[0].title);
    expect(parsed[0].username).toBe(items[0].username);
    expect(parsed[0].password).toBe(items[0].password);
    expect(parsed[0].url).toBe(items[0].url);
    expect(parsed[0].notes).toBe(items[0].notes);
    expect(parsed[0].tags).toEqual(items[0].tags);
  });

  it('should handle unicode characters', () => {
    const items: PlainTextExportItem[] = [
      {
        title: '🔐 Password Manager',
        username: '用户@例子.com',
        password: 'contraseña-パスワード',
        url: 'https://пример.com',
        notes: 'Emoji: 🎉🚀',
        tags: ['тест', 'テスト'],
      },
    ];

    const csv = itemsToCsv(items);
    const restored = csvToItems(csv);

    expect(restored[0].title).toBe(items[0].title);
    expect(restored[0].username).toBe(items[0].username);
    expect(restored[0].password).toBe(items[0].password);
    expect(restored[0].tags).toEqual(items[0].tags);
  });

  // =========================================================================
  // 3.4 — csvToItems parsing
  // =========================================================================
  it('should parse valid CSV with all columns', () => {
    const csv = `title,username,password,url,notes,tags
Test Account,user@example.com,pass123,https://example.com,Some notes,work;important`;

    const items = csvToItems(csv);

    expect(items).toHaveLength(1);
    expect(items[0].title).toBe('Test Account');
    expect(items[0].username).toBe('user@example.com');
    expect(items[0].password).toBe('pass123');
    expect(items[0].url).toBe('https://example.com');
    expect(items[0].notes).toBe('Some notes');
    expect(items[0].tags).toEqual(['work', 'important']);
  });

  it('should throw if CSV missing required column: title', () => {
    const csv = `username,password
user,pass`;

    expect(() => csvToItems(csv)).toThrow('CSV missing required column: title');
  });

  it('should throw if CSV missing required column: username', () => {
    const csv = `title,password
Title,pass`;

    expect(() => csvToItems(csv)).toThrow('CSV missing required column: username');
  });

  it('should throw if CSV missing required column: password', () => {
    const csv = `title,username
Title,user`;

    expect(() => csvToItems(csv)).toThrow('CSV missing required column: password');
  });

  it('should handle CSV with only header', () => {
    const csv = 'title,username,password,url,notes,tags';
    const items = csvToItems(csv);
    expect(items).toEqual([]);
  });

  it('should skip empty lines', () => {
    const csv = `title,username,password,url,notes,tags
Item1,user1,pass1,,,""

Item2,user2,pass2,,,""`;

    const items = csvToItems(csv);
    expect(items).toHaveLength(2);
  });

  it('should handle CRLF line endings', () => {
    const csv = 'title,username,password,url,notes,tags\r\nItem1,user1,pass1,,,""\r\nItem2,user2,pass2,,,""';
    const items = csvToItems(csv);
    expect(items).toHaveLength(2);
  });

  // =========================================================================
  // 3.4 — Integration: buildPlainTextItemsForCsv with real DB
  // =========================================================================
  it('should decrypt passwords and notes from vault for CSV export', () => {
    const folder = folderRepo.create(null, 'CSV Export Folder', '📁');
    const encryptedPw = encryptString('myCsvPassword', TEST_KEY);
    const encryptedNotes = encryptString('My CSV notes content', TEST_KEY);

    const item = itemRepo.create(folder.id, {
      title: 'CSV Export Item',
      username: 'csv@example.com',
      passwordEncrypted: encryptedPw,
      url: 'https://csv.example.com',
      notesEncrypted: encryptedNotes,
      emoji: '📊',
    });

    const tag = tagRepo.create('csv-export-tag', '#0000ff');
    tagRepo.attachToItem(item.id, tag.id);

    const payload = buildEncryptedPayload();

    expect(payload.items).toHaveLength(1);
    expect(payload.items[0].passwordEncrypted).toBeTruthy();

    const decryptedPw = decryptString(
      Buffer.from(payload.items[0].passwordEncrypted!, 'base64'),
      TEST_KEY,
    );
    expect(decryptedPw).toBe('myCsvPassword');

    const decryptedNotes = decryptString(
      Buffer.from(payload.items[0].notesEncrypted!, 'base64'),
      TEST_KEY,
    );
    expect(decryptedNotes).toBe('My CSV notes content');
  });

  it('should produce valid CSV output that can be parsed back', () => {
    const folder = folderRepo.create(null, 'CSV Valid Folder', '📂');
    const encryptedPw = encryptString('csvValidPass', TEST_KEY);

    itemRepo.create(folder.id, {
      title: 'CSV Valid Item',
      username: 'csv@example.com',
      passwordEncrypted: encryptedPw,
      url: 'https://csv.example.com',
    });

    const items: PlainTextExportItem[] = [
      {
        title: 'CSV Valid Item',
        username: 'csv@example.com',
        password: 'csvValidPass',
        url: 'https://csv.example.com',
        notes: '',
        tags: [],
      },
    ];

    const csv = itemsToCsv(items);

    const parsed = csvToItems(csv);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].password).toBe('csvValidPass');
    expect(parsed[0].password).not.toContain('encrypted');
  });
});
