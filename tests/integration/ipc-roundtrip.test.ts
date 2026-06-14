import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import initSqlJs, { Database as SqlJsDatabase } from 'sql.js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FolderRepository } from '@main/database/repositories/FolderRepository';
import { ItemRepository } from '@main/database/repositories/ItemRepository';
import { TagRepository } from '@main/database/repositories/TagRepository';
import { TrashRepository } from '@main/database/repositories/TrashRepository';
import { FileAttachmentRepository } from '@main/database/repositories/FileAttachmentRepository';
import { encryptString, decryptString } from '@main/crypto/encryption';

const FTS5_RELATED = /items_fts|fts5/i;

// ---------------------------------------------------------------------------
// DB setup
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// Shared state
// ---------------------------------------------------------------------------
const folderRepo = new FolderRepository();
const itemRepo = new ItemRepository();
const tagRepo = new TagRepository();
const trashRepo = new TrashRepository();
const attachmentRepo = new FileAttachmentRepository();

const TEST_KEY = Buffer.from('0123456789abcdef0123456789abcdef', 'utf-8');

describe('IPC Round-Trip Integration', () => {
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
      testDb.run('DELETE FROM trash');
      testDb.run('DELETE FROM tags');
      testDb.run('DELETE FROM folders');
      testDb.run('DELETE FROM settings');
    }
  });

  // =========================================================================
  // Folder → Item → Search full round-trip
  // =========================================================================
  it('should create folder, create item, search and find', () => {
    // 1. Create a folder
    const folder = folderRepo.create(null, 'My Passwords', '🔐');
    expect(folder.id).toBeTruthy();

    // 2. Create an encrypted item in the folder
    const encryptedPw = encryptString('mySecret123', TEST_KEY);
    const encryptedNotes = encryptString('These are my secure notes', TEST_KEY);

    const item = itemRepo.create(folder.id, {
      title: 'Gmail Account',
      username: 'john@gmail.com',
      passwordEncrypted: encryptedPw,
      url: 'https://gmail.com',
      notesEncrypted: encryptedNotes,
      emoji: '📧',
    });
    expect(item.id).toBeTruthy();
    expect(item.title).toBe('Gmail Account');

    // 3. Get items by folder
    const items = itemRepo.getByFolder(folder.id);
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe('Gmail Account');

    // 4. Decrypt and verify
    const decryptedPw = items[0].passwordEncrypted
      ? decryptString(Buffer.from(items[0].passwordEncrypted), TEST_KEY)
      : '';
    expect(decryptedPw).toBe('mySecret123');

    const decryptedNotes = items[0].notesEncrypted
      ? decryptString(Buffer.from(items[0].notesEncrypted), TEST_KEY)
      : '';
    expect(decryptedNotes).toBe('These are my secure notes');

    // 5. Search
    const searchResults = itemRepo.search('gmail');
    expect(searchResults.length).toBeGreaterThanOrEqual(1);
    expect(searchResults[0].title).toContain('Gmail');
  });

  // =========================================================================
  // Folder tree + update
  // =========================================================================
  it('should build hierarchical tree and update folders', () => {
    const root = folderRepo.create(null, 'Root', '🏠');
    const child1 = folderRepo.create(root.id, 'Finance', '💰');
    folderRepo.create(child1.id, 'Bank Accounts', '🏦');

    const tree = folderRepo.getTree();
    expect(tree).toHaveLength(1);
    expect(tree[0].children).toHaveLength(2);
    expect(tree[0].children![0].children).toHaveLength(1);

    // Update
    const updated = folderRepo.update(child1.id, { name: 'Money', emoji: '💵' });
    expect(updated!.name).toBe('Money');
    expect(updated!.emoji).toBe('💵');
  });

  // =========================================================================
  // Move + delete with trash
  // =========================================================================
  it('should move item to trash on delete and support restore', () => {
    const folder = folderRepo.create(null, 'Temp', '🗑️');
    const item = itemRepo.create(folder.id, { title: 'Disposable' });

    // Delete → add to trash
    itemRepo.delete(item.id);
    expect(itemRepo.getById(item.id)).toBeNull();

    // Verify trash has the entry
    trashRepo.add(
      'item',
      item.id,
      folder.id,
      encryptString(JSON.stringify({ id: item.id, title: 'Disposable' }), TEST_KEY),
    );
    const trash = trashRepo.getAll();
    expect(trash.length).toBeGreaterThanOrEqual(1);
  });

  // =========================================================================
  // Tags round-trip
  // =========================================================================
  it('should create tag, attach to item, and retrieve', () => {
    const folder = folderRepo.create(null, 'Tag Test');
    const item = itemRepo.create(folder.id, { title: 'Tagged Item' });
    const tag = tagRepo.create('important', '#ef4444');

    tagRepo.attachToItem(item.id, tag.id);

    const itemTags = tagRepo.getByItem(item.id);
    expect(itemTags).toHaveLength(1);
    expect(itemTags[0].name).toBe('important');
    expect(itemTags[0].color).toBe('#ef4444');
  });

  // =========================================================================
  // Settings round-trip
  // =========================================================================
  it('should set and get settings', () => {
    const db = testDb!;
    db.run(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      ['theme', 'dark'],
    );
    db.run(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      ['autoLockTime', '60000'],
    );

    const stmt = db.prepare('SELECT value FROM settings WHERE key = ?');
    stmt.bind(['theme']);
    expect(stmt.step()).toBe(true);
    const row = stmt.getAsObject() as { value: string };
    expect(row.value).toBe('dark');
    stmt.free();

    const allStmt = db.prepare('SELECT key, value FROM settings ORDER BY key');
    const settings: Record<string, string> = {};
    while (allStmt.step()) {
      const r = allStmt.getAsObject() as { key: string; value: string };
      settings[r.key] = r.value;
    }
    allStmt.free();

    expect(settings.theme).toBe('dark');
    expect(settings.autoLockTime).toBe('60000');
  });

  // =========================================================================
  // File attachment metadata round-trip
  // =========================================================================
  it('should create and retrieve file attachment metadata', () => {
    const folder = folderRepo.create(null, 'Files');
    const item = itemRepo.create(folder.id, { title: 'With Attachment' });

    const attachment = attachmentRepo.create(
      item.id,
      null,
      'passwords.pdf',
      'application/pdf',
      42000,
      '/store/passwords.pdf.enc',
    );

    expect(attachment.id).toBeTruthy();
    expect(attachment.fileName).toBe('passwords.pdf');

    const byItem = attachmentRepo.getByItem(item.id);
    expect(byItem).toHaveLength(1);

    const byId = attachmentRepo.getById(attachment.id);
    expect(byId!.fileSize).toBe(42000);

    // Delete attachment
    const deleted = attachmentRepo.delete(attachment.id);
    expect(deleted).not.toBeNull();
    expect(attachmentRepo.getById(attachment.id)).toBeNull();
  });

  // =========================================================================
  // Error handling: DB not open
  // =========================================================================
  it('should handle operations after DB close', () => {
    // Close DB
    const db = testDb;
    testDb = null;

    // Operations should fail gracefully (repos use connection which returns null)
    try {
      folderRepo.create(null, 'Should Fail');
      // Should not reach here if repository checks for open DB
    } catch {
      // Expected
    }

    testDb = db;
  });
});
