// @vitest-environment jsdom
/**
 * Sub-Task 5.4: Edge Case Regression Tests
 *
 * Covers three edge-case categories from the planning document:
 *   1. Unicode extremes (emoji sequences, RTL scripts, combining chars).
 *   2. Extreme lengths (100KB notes, 4096-char passwords, distant/deep tags).
 *   3. Memory stress (rapid create/edit/delete cycles with heap monitoring).
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { Database as SqlJsDatabase } from 'sql.js';
import { createTestDatabase, destroyTestDatabase } from '../../helpers/testDatabase';
import { FolderRepository } from '@main/database/repositories/FolderRepository';
import { ItemRepository } from '@main/database/repositories/ItemRepository';
import { TagRepository } from '@main/database/repositories/TagRepository';
import { unicodeEdgeCases } from '../../fixtures/unicode-edge-cases';
import { validateField } from '../../../src/shared/validation';
import { sanitizeRichText, MAX_RICH_TEXT_LENGTH } from '../../../src/shared/sanitizeRichText';
import { MAX_FIELD_LENGTHS } from '../../../src/shared/constants';

// ---------------------------------------------------------------------------
// Mock the connection module so repositories use our in-memory database
// ---------------------------------------------------------------------------
const { getTestDb, setTestDb } = vi.hoisted(() => {
  let db: SqlJsDatabase | null = null;
  return {
    getTestDb: () => db,
    setTestDb: (d: SqlJsDatabase | null) => {
      db = d;
    },
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

const folderRepo = new FolderRepository();
const itemRepo = new ItemRepository();
const tagRepo = new TagRepository();

function clearTables(db: SqlJsDatabase): void {
  db.run('DELETE FROM item_tags');
  db.run('DELETE FROM attachments');
  db.run('DELETE FROM items');
  db.run('DELETE FROM trash');
  db.run('DELETE FROM tags');
  db.run('DELETE FROM folders');
  db.run("INSERT OR IGNORE INTO settings (key, value) VALUES ('schema_version', '1')");
}

function collectGarbage(): void {
  if (typeof global.gc === 'function') {
    global.gc();
  }
}

describe('Unicode extremes', () => {
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

  for (const { name, value } of unicodeEdgeCases) {
    it(`stores and retrieves folder name with ${name}`, () => {
      const folder = folderRepo.create(null, value);
      const found = folderRepo.getById(folder.id);
      expect(found).not.toBeNull();
      expect(found!.name).toBe(value);
    });

    it(`stores and retrieves item title with ${name}`, () => {
      const folder = folderRepo.create(null, 'Unicode Folder');
      const item = itemRepo.create(folder.id, { title: value });
      const found = itemRepo.getById(item.id);
      expect(found).not.toBeNull();
      expect(found!.title).toBe(value);
    });

    it(`stores and retrieves tag name with ${name}`, () => {
      const tag = tagRepo.create(value);
      expect(tag.name).toBe(value);

      const found = tagRepo.findByName(value);
      expect(found).not.toBeNull();
      expect(found!.name).toBe(value);
    });
  }

  it('treats combining and precomposed accents as duplicates', () => {
    const folder = folderRepo.create(null, 'Café');
    expect(folderRepo.existsByParentIdAndName(null, 'Cafe\u0301')).toBe(true);
    expect(folderRepo.existsByParentIdAndName(null, 'Cafe\u0301', folder.id)).toBe(false);
  });

  it('preserves emoji sequences without corrupting surrounding text', () => {
    const folder = folderRepo.create(null, 'Family 👨‍👩‍👧‍👦 Records');
    const found = folderRepo.getById(folder.id);
    expect(found!.name).toBe('Family 👨‍👩‍👧‍👦 Records');
    expect(found!.name).toContain('👨‍👩‍👧‍👦');
  });
});

describe('Extreme length', () => {
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

  it('accepts password at max length 4096 and rejects 4097', () => {
    const maxPassword = 'a'.repeat(MAX_FIELD_LENGTHS.PASSWORD);
    expect(validateField('password', maxPassword)).toBeNull();

    const tooLongPassword = 'a'.repeat(MAX_FIELD_LENGTHS.PASSWORD + 1);
    expect(validateField('password', tooLongPassword)).toBe('validation.maxLength');
  });

  it('accepts notes at max length 100000 and rejects 100001', () => {
    const maxNotes = 'a'.repeat(MAX_FIELD_LENGTHS.NOTES);
    expect(validateField('notes', maxNotes)).toBeNull();

    const tooLongNotes = 'a'.repeat(MAX_FIELD_LENGTHS.NOTES + 1);
    expect(validateField('notes', tooLongNotes)).toBe('validation.maxLength');
  });

  it('sanitizes 100KB raw HTML notes without crashing', () => {
    const longText = 'a'.repeat(MAX_RICH_TEXT_LENGTH);
    const html = `<p>${longText}</p>`;
    const result = sanitizeRichText(html);
    expect(result.length).toBeGreaterThan(0);
    expect(result.length).toBeLessThanOrEqual(MAX_RICH_TEXT_LENGTH + 50);
  });

  it('stores and retrieves item with 100KB encrypted notes', () => {
    const folder = folderRepo.create(null, 'Large Notes');
    const notes = new Uint8Array(MAX_FIELD_LENGTHS.NOTES);
    for (let i = 0; i < notes.length; i++) {
      notes[i] = i % 256;
    }

    const item = itemRepo.create(folder.id, {
      title: 'Big Notes Item',
      notesEncrypted: notes,
    });

    const found = itemRepo.getById(item.id);
    expect(found).not.toBeNull();
    expect(found!.notesEncrypted).not.toBeNull();
    expect((found!.notesEncrypted as ArrayBuffer).byteLength).toBe(notes.byteLength);
  });

  it('stores and retrieves item with 4096-byte encrypted password blob', () => {
    const folder = folderRepo.create(null, 'Long Password');
    const password = new Uint8Array(MAX_FIELD_LENGTHS.PASSWORD);
    for (let i = 0; i < password.length; i++) {
      password[i] = (i * 7) % 256;
    }

    const item = itemRepo.create(folder.id, {
      title: 'Long Password Item',
      passwordEncrypted: password,
    });

    const found = itemRepo.getById(item.id);
    expect(found).not.toBeNull();
    expect(found!.passwordEncrypted).not.toBeNull();
    expect((found!.passwordEncrypted as ArrayBuffer).byteLength).toBe(password.byteLength);
  });

  it('handles deeply nested HTML tags without crashing', () => {
    let nested = 'deep';
    const depth = 500;
    for (let i = 0; i < depth; i++) {
      nested = `<strong>${nested}</strong>`;
    }

    const result = sanitizeRichText(nested);
    expect(result).toContain('deep');
    expect(result.length).toBeLessThanOrEqual(MAX_RICH_TEXT_LENGTH + 50);
  });

  it('handles tags separated by 50000 characters without crashing', () => {
    const middle = 'a'.repeat(50_000);
    const html = `<strong>${middle}</strong>`;
    const result = sanitizeRichText(html);
    expect(result).toContain('<strong>');
    expect(result).toContain('</strong>');
    expect(result).toContain(middle);
  });
});

describe('Memory stress', () => {
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

  it('rapid create/edit/delete cycles do not leak memory', () => {
    const iterations = 300;
    const root = folderRepo.create(null, 'Stress Root');

    collectGarbage();
    const heapBefore = process.memoryUsage().heapUsed;

    for (let i = 0; i < iterations; i++) {
      const folder = folderRepo.create(root.id, `Stress ${i}`);
      folderRepo.update(folder.id, { name: `Updated ${i}` });

      const item = itemRepo.create(folder.id, { title: `Item ${i}` });
      itemRepo.update(item.id, { title: `Updated Item ${i}` });

      itemRepo.delete(item.id);
      folderRepo.delete(folder.id);
    }

    collectGarbage();
    const heapAfter = process.memoryUsage().heapUsed;
    const heapGrowth = heapAfter - heapBefore;

    // Allow generous headroom for test overhead and JS engine heap behaviour.
    // A real leak would cause growth far beyond this threshold.
    const maxGrowthBytes = 64 * 1024 * 1024; // 64 MB
    expect(heapGrowth).toBeLessThan(maxGrowthBytes);

    // Sanity check: no stray records remain
    expect(folderRepo.getFlatList()).toHaveLength(1);
    expect(itemRepo.getAll()).toHaveLength(0);
  });
});
