import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { Database as SqlJsDatabase } from 'sql.js';
import { createTestDatabase, destroyTestDatabase } from '../../helpers/testDatabase';
import { FolderRepository } from '@main/database/repositories/FolderRepository';
import { ItemRepository } from '@main/database/repositories/ItemRepository';
import { TagRepository } from '@main/database/repositories/TagRepository';
import { TrashRepository } from '@main/database/repositories/TrashRepository';
import { FileAttachmentRepository } from '@main/database/repositories/FileAttachmentRepository';

// ---------------------------------------------------------------------------
// Mock the connection module so repositories use our in-memory database
// ---------------------------------------------------------------------------
const { getTestDb, setTestDb } = vi.hoisted(() => {
  let db: SqlJsDatabase | null = null;
  return {
    getTestDb: () => db,
    setTestDb: (d: SqlJsDatabase | null) => { db = d; },
  };
});

vi.mock('@main/database/connection', () => ({
  getDatabase: () => getTestDb(),
  initializeSqlJs: vi.fn().mockResolvedValue(undefined),
  isDatabaseOpen: () => true,
  saveDatabase: vi.fn(),
  closeDatabase: vi.fn(),
  openDatabase: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const folderRepo = new FolderRepository();
const itemRepo = new ItemRepository();
const tagRepo = new TagRepository();
const trashRepo = new TrashRepository();
const attachmentRepo = new FileAttachmentRepository();

const encryptedBlob = new Uint8Array([1, 2, 3, 4, 5]);
const encryptedBlob2 = new Uint8Array([10, 20, 30]);

function clearTables(db: SqlJsDatabase): void {
  db.run('DELETE FROM item_tags');
  db.run('DELETE FROM attachments');
  db.run('DELETE FROM items');
  db.run('DELETE FROM trash');
  db.run('DELETE FROM tags');
  db.run('DELETE FROM folders');
  db.run('DELETE FROM settings');
  db.run(`INSERT OR IGNORE INTO settings (key, value) VALUES ('schema_version', '1')`);
}

// ---------------------------------------------------------------------------
// All repository integration tests
// ---------------------------------------------------------------------------
describe('Repository integration tests', () => {
  let db: SqlJsDatabase;

  beforeAll(async () => {
    db = await createTestDatabase();
    setTestDb(db);
  });

  afterAll(() => {
    setTestDb(null);
    destroyTestDatabase();
  });

  beforeEach(() => {
    clearTables(db);
  });

  // =========================================================================
  // FolderRepository
  // =========================================================================
  describe('FolderRepository', () => {
    it('should create a root folder with null parent', () => {
      const folder = folderRepo.create(null, 'My Passwords', '🔐');
      expect(folder.id).toBeDefined();
      expect(folder.name).toBe('My Passwords');
      expect(folder.emoji).toBe('🔐');
      expect(folder.parentId).toBeNull();
      expect(folder.createdAt).toBeGreaterThan(0);
      expect(folder.updatedAt).toBeGreaterThan(0);
      expect(folder.sortOrder).toBe(0);
    });

    it('should create a child folder', () => {
      const parent = folderRepo.create(null, 'Parent');
      const child = folderRepo.create(parent.id, 'Child', '📁');
      expect(child.parentId).toBe(parent.id);
      expect(child.name).toBe('Child');
      expect(child.emoji).toBe('📁');
    });

    it('should auto-increment sort_order for siblings', () => {
      const parent = folderRepo.create(null, 'Root');
      const a = folderRepo.create(parent.id, 'A');
      const b = folderRepo.create(parent.id, 'B');
      const c = folderRepo.create(parent.id, 'C');
      expect(a.sortOrder).toBe(0);
      expect(b.sortOrder).toBe(1);
      expect(c.sortOrder).toBe(2);
    });

    it('should get folder by id', () => {
      const created = folderRepo.create(null, 'Target');
      const found = folderRepo.getById(created.id);
      expect(found).not.toBeNull();
      expect(found!.id).toBe(created.id);
      expect(found!.name).toBe('Target');
    });

    it('should return null for non-existent folder id', () => {
      expect(folderRepo.getById('non-existent')).toBeNull();
    });

    it('should return flat list of all folders', () => {
      const root = folderRepo.create(null, 'Root');
      const child = folderRepo.create(root.id, 'Child');
      const flat = folderRepo.getFlatList();
      expect(flat).toHaveLength(2);
      expect(flat.map((f) => f.id)).toContain(root.id);
      expect(flat.map((f) => f.id)).toContain(child.id);
    });

    it('should return empty list when no folders exist', () => {
      expect(folderRepo.getFlatList()).toHaveLength(0);
    });

    it('should build hierarchical tree via getTree', () => {
      const root = folderRepo.create(null, 'Root', '🏠');
      const child1 = folderRepo.create(root.id, 'Child 1', '📁');
      const child2 = folderRepo.create(root.id, 'Child 2', '📂');
      const grandchild = folderRepo.create(child1.id, 'Grandchild', '📄');
      const tree = folderRepo.getTree();

      expect(tree).toHaveLength(1);
      expect(tree[0].id).toBe(root.id);
      expect(tree[0].children).toHaveLength(2);
      expect(tree[0].children![0].id).toBe(child1.id);
      expect(tree[0].children![1].id).toBe(child2.id);
      expect(tree[0].children![0].children).toHaveLength(1);
      expect(tree[0].children![0].children![0].id).toBe(grandchild.id);
    });

    it('should return empty tree when no folders exist', () => {
      expect(folderRepo.getTree()).toHaveLength(0);
    });

    it('should update folder name', () => {
      const folder = folderRepo.create(null, 'Old Name');
      const updated = folderRepo.update(folder.id, { name: 'New Name' });
      expect(updated!.name).toBe('New Name');
      expect(updated!.updatedAt).toBeGreaterThanOrEqual(folder.updatedAt);
    });

    it('should update folder emoji', () => {
      const folder = folderRepo.create(null, 'Test', '📁');
      const updated = folderRepo.update(folder.id, { emoji: '🔒' });
      expect(updated!.emoji).toBe('🔒');
    });

    it('should update folder coverImage', () => {
      const folder = folderRepo.create(null, 'Test');
      const updated = folderRepo.update(folder.id, { coverImage: '/path/to/cover.jpg' });
      expect(updated!.coverImage).toBe('/path/to/cover.jpg');
    });

    it('should update folder sortOrder', () => {
      const folder = folderRepo.create(null, 'Test');
      const updated = folderRepo.update(folder.id, { sortOrder: 42 });
      expect(updated!.sortOrder).toBe(42);
    });

    it('should return same folder when updating with no changes', () => {
      const folder = folderRepo.create(null, 'Test');
      const updated = folderRepo.update(folder.id, {});
      expect(updated!.id).toBe(folder.id);
      expect(updated!.name).toBe('Test');
    });

    it('should move folder to a new parent', () => {
      const parent = folderRepo.create(null, 'Parent');
      const child = folderRepo.create(parent.id, 'Child');
      const newParent = folderRepo.create(null, 'New Parent');
      const moved = folderRepo.move(child.id, newParent.id, 0);
      expect(moved!.parentId).toBe(newParent.id);
    });

    it('should move folder to root (null parent)', () => {
      const parent = folderRepo.create(null, 'Parent');
      const child = folderRepo.create(parent.id, 'Child');
      const moved = folderRepo.move(child.id, null, 0);
      expect(moved!.parentId).toBeNull();
    });

    it('should prevent circular reference (moving parent into child)', () => {
      const parent = folderRepo.create(null, 'Parent');
      const child = folderRepo.create(parent.id, 'Child');
      const grandchild = folderRepo.create(child.id, 'Grandchild');
      const result = folderRepo.move(parent.id, grandchild.id, 0);
      expect(result).toBeNull();
    });

    it('should prevent moving folder to itself', () => {
      const folder = folderRepo.create(null, 'Self');
      const result = folderRepo.move(folder.id, folder.id, 0);
      expect(result).toBeNull();
    });

    it('should delete a leaf folder', () => {
      const folder = folderRepo.create(null, 'To Delete');
      folderRepo.delete(folder.id);
      expect(folderRepo.getById(folder.id)).toBeNull();
    });

    it('should cascade delete folder with children', () => {
      const parent = folderRepo.create(null, 'Parent');
      const child = folderRepo.create(parent.id, 'Child');
      const grandchild = folderRepo.create(child.id, 'Grandchild');
      folderRepo.delete(parent.id);
      expect(folderRepo.getById(parent.id)).toBeNull();
      expect(folderRepo.getById(child.id)).toBeNull();
      expect(folderRepo.getById(grandchild.id)).toBeNull();
    });

    it('should cascade delete items when deleting folder', () => {
      const folder = folderRepo.create(null, 'Folder With Items');
      const item = itemRepo.create(folder.id, { title: 'Test Item' });
      folderRepo.delete(folder.id);
      expect(itemRepo.getById(item.id)).toBeNull();
    });

    it('should get descendant ids recursively', () => {
      const root = folderRepo.create(null, 'Root');
      const child = folderRepo.create(root.id, 'Child');
      const grandchild = folderRepo.create(child.id, 'Grandchild');
      const ids = folderRepo.getDescendantIds(root.id);
      expect(ids).toHaveLength(2);
      expect(ids).toContain(child.id);
      expect(ids).toContain(grandchild.id);
    });

    it('should return empty array for leaf descendants', () => {
      const folder = folderRepo.create(null, 'Leaf');
      expect(folderRepo.getDescendantIds(folder.id)).toHaveLength(0);
    });

    it('should search folders by name', () => {
      const folder = folderRepo.create(null, 'My Bank Account');
      const results = folderRepo.searchByName('bank');
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0].id).toBe(folder.id);
    });

    it('should return empty array when search yields no matches', () => {
      folderRepo.create(null, 'Something');
      expect(folderRepo.searchByName('zzzzz')).toHaveLength(0);
    });
  });

  // =========================================================================
  // ItemRepository
  // =========================================================================
  describe('ItemRepository', () => {
    let folderId: string;

    beforeEach(() => {
      const folder = folderRepo.create(null, 'Item Test Folder');
      folderId = folder.id;
    });

    it('should create an item with required fields', () => {
      const item = itemRepo.create(folderId, { title: 'Test Item' });
      expect(item.id).toBeDefined();
      expect(item.title).toBe('Test Item');
      expect(item.folderId).toBe(folderId);
      expect(item.username).toBe('');
      expect(item.url).toBe('');
      expect(item.isFavorite).toBe(false);
      expect(item.createdAt).toBeGreaterThan(0);
      expect(item.updatedAt).toBeGreaterThan(0);
    });

    it('should create an item with all optional fields', () => {
      const item = itemRepo.create(folderId, {
        title: 'Full Item',
        username: 'user@example.com',
        passwordEncrypted: encryptedBlob,
        url: 'https://example.com',
        notesEncrypted: encryptedBlob2,
        emoji: '📧',
        coverImage: '/covers/email.jpg',
      });
      expect(item.title).toBe('Full Item');
      expect(item.username).toBe('user@example.com');
      expect(item.url).toBe('https://example.com');
      expect(item.emoji).toBe('📧');
      expect(item.coverImage).toBe('/covers/email.jpg');
    });

    it('should get item by id', () => {
      const created = itemRepo.create(folderId, { title: 'Find Me' });
      const found = itemRepo.getById(created.id);
      expect(found).not.toBeNull();
      expect(found!.id).toBe(created.id);
      expect(found!.title).toBe('Find Me');
    });

    it('should return null for non-existent item id', () => {
      expect(itemRepo.getById('non-existent')).toBeNull();
    });

    it('should get items by folder', () => {
      itemRepo.create(folderId, { title: 'A' });
      itemRepo.create(folderId, { title: 'B' });
      const items = itemRepo.getByFolder(folderId);
      expect(items).toHaveLength(2);
    });

    it('should return empty array for folder with no items', () => {
      expect(itemRepo.getByFolder(folderId)).toHaveLength(0);
    });

    it('should update item title', () => {
      const item = itemRepo.create(folderId, { title: 'Original' });
      const updated = itemRepo.update(item.id, { title: 'Updated' });
      expect(updated!.title).toBe('Updated');
    });

    it('should update item username', () => {
      const item = itemRepo.create(folderId, { title: 'T' });
      const updated = itemRepo.update(item.id, { username: 'new@user.com' });
      expect(updated!.username).toBe('new@user.com');
    });

    it('should update item encrypted password', () => {
      const item = itemRepo.create(folderId, { title: 'T' });
      const updated = itemRepo.update(item.id, { passwordEncrypted: encryptedBlob });
      expect(updated!.passwordEncrypted).toBeDefined();
    });

    it('should update item URL', () => {
      const item = itemRepo.create(folderId, { title: 'T' });
      const updated = itemRepo.update(item.id, { url: 'https://updated.com' });
      expect(updated!.url).toBe('https://updated.com');
    });

    it('should update item encrypted notes', () => {
      const item = itemRepo.create(folderId, { title: 'T' });
      const updated = itemRepo.update(item.id, { notesEncrypted: encryptedBlob2 });
      expect(updated!.notesEncrypted).toBeDefined();
    });

    it('should update item emoji', () => {
      const item = itemRepo.create(folderId, { title: 'T' });
      const updated = itemRepo.update(item.id, { emoji: '⭐' });
      expect(updated!.emoji).toBe('⭐');
    });

    it('should update item coverImage', () => {
      const item = itemRepo.create(folderId, { title: 'T' });
      const updated = itemRepo.update(item.id, { coverImage: '/covers/new.jpg' });
      expect(updated!.coverImage).toBe('/covers/new.jpg');
    });

    it('should update isFavorite flag', () => {
      const item = itemRepo.create(folderId, { title: 'T' });
      const updated = itemRepo.update(item.id, { isFavorite: true });
      expect(updated!.isFavorite).toBe(true);
    });

    it('should update sortOrder', () => {
      const item = itemRepo.create(folderId, { title: 'T' });
      const updated = itemRepo.update(item.id, { sortOrder: 99 });
      expect(updated!.sortOrder).toBe(99);
    });

    it('should return same item when updating with no changes', () => {
      const item = itemRepo.create(folderId, { title: 'T' });
      const updated = itemRepo.update(item.id, {});
      expect(updated!.id).toBe(item.id);
      expect(updated!.title).toBe('T');
    });

    it('should delete item and cascade to attachments and tags', () => {
      const item = itemRepo.create(folderId, { title: 'To Delete' });
      const tag = tagRepo.create('delete-tag');
      tagRepo.attachToItem(item.id, tag.id);
      attachmentRepo.create(item.id, null, 'file.txt', 'text/plain', 100, '/store/file.txt');
      itemRepo.delete(item.id);
      expect(itemRepo.getById(item.id)).toBeNull();
      expect(tagRepo.getByItem(item.id)).toHaveLength(0);
      expect(attachmentRepo.getByItem(item.id)).toHaveLength(0);
    });

    it('should get items by folder id list', () => {
      const f2 = folderRepo.create(null, 'Folder 2');
      const i1 = itemRepo.create(folderId, { title: 'A' });
      const i2 = itemRepo.create(f2.id, { title: 'B' });
      const items = itemRepo.getByFolderIdList([folderId, f2.id]);
      expect(items).toHaveLength(2);
      expect(items.map((i) => i.id)).toContain(i1.id);
      expect(items.map((i) => i.id)).toContain(i2.id);
    });

    it('should return empty array for empty folder id list', () => {
      expect(itemRepo.getByFolderIdList([])).toHaveLength(0);
    });

    it('should get all items', () => {
      itemRepo.create(folderId, { title: 'A' });
      itemRepo.create(folderId, { title: 'B' });
      const all = itemRepo.getAll();
      expect(all).toHaveLength(2);
    });

    it('should search items by title', () => {
      itemRepo.create(folderId, { title: 'My Gmail Account' });
      const results = itemRepo.search('gmail');
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0].title.toLowerCase()).toContain('gmail');
    });

    it('should search items by username', () => {
      itemRepo.create(folderId, { title: 'Service', username: 'john.doe@example.com' });
      const results = itemRepo.search('john.doe');
      expect(results.length).toBeGreaterThanOrEqual(1);
    });

    it('should search items by URL', () => {
      itemRepo.create(folderId, { title: 'Site', url: 'https://github.com' });
      const results = itemRepo.search('github');
      expect(results.length).toBeGreaterThanOrEqual(1);
    });

    it('should return empty array when search yields no matches', () => {
      itemRepo.create(folderId, { title: 'Something' });
      expect(itemRepo.search('zzzzz')).toHaveLength(0);
    });
  });

  // =========================================================================
  // TagRepository
  // =========================================================================
  describe('TagRepository', () => {
    it('should create a tag with default color', () => {
      const tag = tagRepo.create('important');
      expect(tag.id).toBeDefined();
      expect(tag.name).toBe('important');
      expect(tag.color).toBe('#6366f1');
    });

    it('should create a tag with custom color', () => {
      const tag = tagRepo.create('urgent', '#ef4444');
      expect(tag.color).toBe('#ef4444');
    });

    it('should throw on duplicate tag name', () => {
      tagRepo.create('unique');
      expect(() => tagRepo.create('unique')).toThrow();
    });

    it('should get all tags', () => {
      tagRepo.create('a');
      tagRepo.create('b');
      const tags = tagRepo.getAll();
      expect(tags).toHaveLength(2);
    });

    it('should get tag by id', () => {
      const created = tagRepo.create('findable');
      const found = tagRepo.getById(created.id);
      expect(found).not.toBeNull();
      expect(found!.name).toBe('findable');
    });

    it('should return null for non-existent tag id', () => {
      expect(tagRepo.getById('non-existent')).toBeNull();
    });

    it('should find tag by name', () => {
      tagRepo.create('searchable');
      const found = tagRepo.findByName('searchable');
      expect(found).not.toBeNull();
    });

    it('should return null for non-existent tag name', () => {
      expect(tagRepo.findByName('zzzzz')).toBeNull();
    });

    it('should attach a tag to an item', () => {
      const folder = folderRepo.create(null, 'F');
      const item = itemRepo.create(folder.id, { title: 'T' });
      const tag = tagRepo.create('attached');
      tagRepo.attachToItem(item.id, tag.id);
      const itemTags = tagRepo.getByItem(item.id);
      expect(itemTags).toHaveLength(1);
      expect(itemTags[0].name).toBe('attached');
    });

    it('should be idempotent when attaching same tag twice', () => {
      const folder = folderRepo.create(null, 'F');
      const item = itemRepo.create(folder.id, { title: 'T' });
      const tag = tagRepo.create('dup');
      tagRepo.attachToItem(item.id, tag.id);
      tagRepo.attachToItem(item.id, tag.id);
      expect(tagRepo.getByItem(item.id)).toHaveLength(1);
    });

    it('should detach a tag from an item', () => {
      const folder = folderRepo.create(null, 'F');
      const item = itemRepo.create(folder.id, { title: 'T' });
      const tag = tagRepo.create('detach-me');
      tagRepo.attachToItem(item.id, tag.id);
      tagRepo.detachFromItem(item.id, tag.id);
      expect(tagRepo.getByItem(item.id)).toHaveLength(0);
    });

    it('should not throw when detaching non-existent tag', () => {
      const folder = folderRepo.create(null, 'F');
      const item = itemRepo.create(folder.id, { title: 'T' });
      expect(() => tagRepo.detachFromItem(item.id, 'non-existent')).not.toThrow();
    });

    it('should get tags by item', () => {
      const folder = folderRepo.create(null, 'F');
      const item = itemRepo.create(folder.id, { title: 'T' });
      const tag1 = tagRepo.create('tag1');
      const tag2 = tagRepo.create('tag2');
      tagRepo.attachToItem(item.id, tag1.id);
      tagRepo.attachToItem(item.id, tag2.id);
      const tags = tagRepo.getByItem(item.id);
      expect(tags).toHaveLength(2);
      expect(tags.map((t) => t.name)).toContain('tag1');
      expect(tags.map((t) => t.name)).toContain('tag2');
    });

    it('should return empty array for item with no tags', () => {
      const folder = folderRepo.create(null, 'F');
      const item = itemRepo.create(folder.id, { title: 'T' });
      expect(tagRepo.getByItem(item.id)).toHaveLength(0);
    });

    it('should delete a tag and clean up item_tags', () => {
      const folder = folderRepo.create(null, 'F');
      const item = itemRepo.create(folder.id, { title: 'T' });
      const tag = tagRepo.create('remove-me');
      tagRepo.attachToItem(item.id, tag.id);
      tagRepo.delete(tag.id);
      expect(tagRepo.getById(tag.id)).toBeNull();
      expect(tagRepo.getByItem(item.id)).toHaveLength(0);
    });

    it('should not throw when deleting non-existent tag', () => {
      expect(() => tagRepo.delete('non-existent')).not.toThrow();
    });
  });

  // =========================================================================
  // TrashRepository
  // =========================================================================
  describe('TrashRepository', () => {
    it('should add a folder trash entry', () => {
      trashRepo.add('folder', 'folder-1', null, null);
      const all = trashRepo.getAll();
      expect(all).toHaveLength(1);
      expect(all[0].originalType).toBe('folder');
      expect(all[0].originalId).toBe('folder-1');
      expect(all[0].originalParentId).toBeNull();
      expect(all[0].deletedAt).toBeGreaterThan(0);
    });

    it('should add an item trash entry with data', () => {
      trashRepo.add('item', 'item-1', 'parent-1', encryptedBlob);
      const all = trashRepo.getAll();
      expect(all).toHaveLength(1);
      expect(all[0].originalType).toBe('item');
      expect(all[0].originalId).toBe('item-1');
      expect(all[0].originalParentId).toBe('parent-1');
    });

    it('should get all trash entries ordered by deletedAt desc', async () => {
      trashRepo.add('item', 'old', null, null);
      await new Promise((r) => setTimeout(r, 5));
      trashRepo.add('item', 'new', null, null);
      const all = trashRepo.getAll();
      expect(all).toHaveLength(2);
      expect(all[0].originalId).toBe('new');
    });

    it('should return empty array when trash is empty', () => {
      expect(trashRepo.getAll()).toHaveLength(0);
    });

    it('should get trash entry by id', () => {
      trashRepo.add('item', 'example', null, null);
      const all = trashRepo.getAll();
      const found = trashRepo.getById(all[0].id);
      expect(found).not.toBeNull();
      expect(found!.originalId).toBe('example');
    });

    it('should return null for non-existent trash id', () => {
      expect(trashRepo.getById('non-existent')).toBeNull();
    });

    it('should remove a trash entry by id', () => {
      trashRepo.add('item', 'remove-me', null, null);
      const entry = trashRepo.getAll()[0];
      trashRepo.remove(entry.id);
      expect(trashRepo.getAll()).toHaveLength(0);
    });

    it('should remove trash entries by original id', () => {
      trashRepo.add('folder', 'orig-1', null, null);
      trashRepo.removeByOriginalId('orig-1');
      expect(trashRepo.getAll()).toHaveLength(0);
    });

    it('should empty all trash', () => {
      trashRepo.add('item', 'a', null, null);
      trashRepo.add('item', 'b', null, null);
      trashRepo.empty();
      expect(trashRepo.getAll()).toHaveLength(0);
    });

    it('should purge entries older than a given age', async () => {
      trashRepo.add('item', 'old-entry', null, null);
      await new Promise((r) => setTimeout(r, 5));
      expect(trashRepo.getAll()).toHaveLength(1);
      trashRepo.purgeOlderThan(0);
      expect(trashRepo.getAll()).toHaveLength(0);
    });

    it('should keep entries newer than purge age', () => {
      trashRepo.add('item', 'new-entry', null, null);
      trashRepo.purgeOlderThan(86_400_000); // 1 day in ms
      expect(trashRepo.getAll()).toHaveLength(1);
    });
  });

  // =========================================================================
  // FileAttachmentRepository
  // =========================================================================
  describe('FileAttachmentRepository', () => {
    it('should create an attachment linked to an item', () => {
      const folder = folderRepo.create(null, 'F');
      const item = itemRepo.create(folder.id, { title: 'T' });
      const attachment = attachmentRepo.create(
        item.id,
        null,
        'passwords.pdf',
        'application/pdf',
        42_000,
        '/store/passwords.pdf',
      );
      expect(attachment.id).toBeDefined();
      expect(attachment.fileName).toBe('passwords.pdf');
      expect(attachment.mimeType).toBe('application/pdf');
      expect(attachment.fileSize).toBe(42_000);
      expect(attachment.storagePath).toBe('/store/passwords.pdf');
      expect(attachment.itemId).toBe(item.id);
      expect(attachment.folderId).toBeNull();
    });

    it('should create an attachment linked to a folder', () => {
      const folder = folderRepo.create(null, 'F');
      const attachment = attachmentRepo.create(
        null,
        folder.id,
        'folder_note.txt',
        'text/plain',
        100,
        '/store/folder_note.txt',
      );
      expect(attachment.folderId).toBe(folder.id);
      expect(attachment.itemId).toBeNull();
    });

    it('should get attachment by id', () => {
      const folder = folderRepo.create(null, 'F');
      const item = itemRepo.create(folder.id, { title: 'T' });
      const created = attachmentRepo.create(item.id, null, 'f.txt', 'text/plain', 1, '/store/f.txt');
      const found = attachmentRepo.getById(created.id);
      expect(found).not.toBeNull();
      expect(found!.id).toBe(created.id);
      expect(found!.fileName).toBe('f.txt');
    });

    it('should return null for non-existent attachment id', () => {
      expect(attachmentRepo.getById('non-existent')).toBeNull();
    });

    it('should get attachments by item', () => {
      const folder = folderRepo.create(null, 'F');
      const item = itemRepo.create(folder.id, { title: 'T' });
      attachmentRepo.create(item.id, null, 'a.txt', 'text/plain', 1, '/store/a.txt');
      attachmentRepo.create(item.id, null, 'b.txt', 'text/plain', 2, '/store/b.txt');
      const attachments = attachmentRepo.getByItem(item.id);
      expect(attachments).toHaveLength(2);
    });

    it('should return empty array for item with no attachments', () => {
      const folder = folderRepo.create(null, 'F');
      const item = itemRepo.create(folder.id, { title: 'T' });
      expect(attachmentRepo.getByItem(item.id)).toHaveLength(0);
    });

    it('should delete attachment and return its data', () => {
      const folder = folderRepo.create(null, 'F');
      const item = itemRepo.create(folder.id, { title: 'T' });
      const created = attachmentRepo.create(item.id, null, 'del.txt', 'text/plain', 1, '/store/del.txt');
      const deleted = attachmentRepo.delete(created.id);
      expect(deleted).not.toBeNull();
      expect(deleted!.id).toBe(created.id);
      expect(attachmentRepo.getById(created.id)).toBeNull();
    });

    it('should return null when deleting non-existent attachment', () => {
      const result = attachmentRepo.delete('non-existent');
      expect(result).toBeNull();
    });
  });
});
