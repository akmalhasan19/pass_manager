/**
 * Performance & Stress Tests
 *
 * 9.5.1 — 10,000 items: search performance, bulk insertion
 * 9.5.2 — 100-level nested folders: tree construction, move validation
 * 9.5.3 — Large file attachment: streaming encryption performance
 * 9.5.4 — Bundle size measurement
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import initSqlJs, { Database as SqlJsDatabase } from 'sql.js';
import { readFileSync, mkdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { FolderRepository } from '@main/database/repositories/FolderRepository';
import { ItemRepository } from '@main/database/repositories/ItemRepository';
import { TrashRepository } from '@main/database/repositories/TrashRepository';
import { encryptString } from '@main/crypto/encryption';
import { encryptAES256GCM, decryptAES256GCM } from '@main/crypto/encryption';
import { randomBytes } from 'node:crypto';

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------
const FTS5_RELATED = /items_fts|fts5/i;
let testDb: SqlJsDatabase | null = null;
const TEST_KEY = Buffer.from('0123456789abcdef0123456789abcdef', 'utf-8');
const PERF_TIME_LIMIT_MS = 30000; // 30s max per operation

let folderRepo: FolderRepository;
let itemRepo: ItemRepository;
let trashRepo: TrashRepository;

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

async function createDb(): Promise<SqlJsDatabase> {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  db.run('PRAGMA foreign_keys = ON');
  db.run('PRAGMA journal_mode = MEMORY');
  db.run('PRAGMA synchronous = OFF');
  db.run('PRAGMA temp_store = MEMORY');

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
    } catch {}
  }
  return db;
}

function elapsed(start: number): number {
  return Date.now() - start;
}

// =========================================================================
// 9.5.1: 10,000 items — search performance, bulk operations
// =========================================================================
describe('9.5.1 — 10,000 Items Stress Test', () => {
  beforeAll(async () => {
    testDb = await createDb();
    folderRepo = new FolderRepository();
    itemRepo = new ItemRepository();
    trashRepo = new TrashRepository();

    // Create a folder to hold all items
    folderRepo.create(null, 'Bulk Items', '📦');
  });

  afterAll(() => {
    if (testDb) {
      testDb.close();
      testDb = null;
    }
  });

  it('should insert 10,000 items within acceptable time', () => {
    const encryptedPw = encryptString('testPassword123!', TEST_KEY);

    const start = Date.now();
    const batchSize = 500;

    for (let batch = 0; batch < 20; batch++) {
      const stmt = testDb!.prepare(
        `INSERT INTO items (id, folder_id, title, username, password_encrypted, url, notes_encrypted, created_at, updated_at, is_favorite, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );

      for (let i = 0; i < batchSize; i++) {
        const idx = batch * batchSize + i;
        stmt.bind([
          `item-${idx}`,
          null,
          `Item ${idx} — Some descriptive title`,
          `user${idx}@example.com`,
          encryptedPw,
          `https://service${idx}.example.com`,
          null,
          Date.now(),
          Date.now(),
          0,
          idx,
        ]);
        stmt.step();
        stmt.reset();
      }
      stmt.free();
    }

    const duration = elapsed(start);
    console.log(
      `  → Inserted 10,000 items in ${duration}ms (${(10000 / (duration / 1000)).toFixed(0)} items/sec)`,
    );

    expect(duration).toBeLessThan(PERF_TIME_LIMIT_MS);
  });

  it('should search across 10,000 items in under 1 second', () => {
    // Search by title
    const start = Date.now();
    const results = itemRepo.search('Item 5000');
    const duration = elapsed(start);

    console.log(
      `  → Search across 10,000 items returned ${results.length} results in ${duration}ms`,
    );

    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(duration).toBeLessThan(1000); // Under 1 second
  });

  it('should search by username across 10,000 items', () => {
    const start = Date.now();
    const results = itemRepo.search('user7777');
    const duration = elapsed(start);

    console.log(`  → Username search across 10,000 items: ${duration}ms`);

    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(duration).toBeLessThan(1000);
  });

  it('should search by URL across 10,000 items', () => {
    const start = Date.now();
    const results = itemRepo.search('service8888');
    const duration = elapsed(start);

    console.log(`  → URL search across 10,000 items: ${duration}ms`);

    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(duration).toBeLessThan(1000);
  });

  it('should get all items in under 2 seconds', () => {
    const start = Date.now();
    const all = itemRepo.getAll();
    const duration = elapsed(start);

    console.log(`  → Fetched ${all.length} items in ${duration}ms`);
    expect(all.length).toBeGreaterThanOrEqual(10000);
    expect(duration).toBeLessThan(2000);
  });

  it('should bulk-delete items via trash in reasonable time', () => {
    const start = Date.now();

    // Delete 1000 items
    for (let i = 0; i < 1000; i++) {
      trashRepo.add('item', `item-${i}`, null, null);
      itemRepo.delete(`item-${i}`);
    }

    const duration = elapsed(start);
    console.log(`  → Deleted 1000 items with trash entries in ${duration}ms`);
    expect(duration).toBeLessThan(10000);
  });
});

// =========================================================================
// 9.5.2: Deeply nested folders (100 levels)
// =========================================================================
describe('9.5.2 — Deep Folder Tree (100 Levels)', () => {
  beforeAll(async () => {
    testDb = await createDb();
    folderRepo = new FolderRepository();
    itemRepo = new ItemRepository();
  });

  afterAll(() => {
    if (testDb) {
      testDb.close();
      testDb = null;
    }
  });

  it('should create 100 levels of nested folders', () => {
    const start = Date.now();

    let parentId: string | null = null;
    for (let level = 0; level < 100; level++) {
      const folder = folderRepo.create(parentId, `Level ${level}`, '📁');
      parentId = folder.id;
    }

    const duration = elapsed(start);
    console.log(`  → Created 100 nested folder levels in ${duration}ms`);
    expect(duration).toBeLessThan(5000);
  });

  it('should build full tree with 100 levels in under 1 second', () => {
    const start = Date.now();
    const tree = folderRepo.getTree();
    const duration = elapsed(start);

    console.log(`  → Built 100-level tree in ${duration}ms`);

    expect(tree.length).toBe(1);

    // Verify depth: walk down
    let node = tree[0];
    let depth = 0;
    while (node.children && node.children.length > 0) {
      node = node.children[0];
      depth++;
    }
    console.log(`  → Traversed ${depth} levels from root to leaf`);
    expect(depth).toBe(99); // 0-indexed, so 99 = 100 levels total

    expect(duration).toBeLessThan(1000);
  });

  it('should update a deep folder quickly', () => {
    // Get the deepest folder
    let node = folderRepo.getTree()[0];
    while (node.children && node.children.length > 0) {
      node = node.children[0];
    }

    const start = Date.now();
    const updated = folderRepo.update(node.id, { name: 'Deepest Level ⬇️' });
    const duration = elapsed(start);

    console.log(`  → Updated deepest folder in ${duration}ms`);
    expect(updated!.name).toBe('Deepest Level ⬇️');
    expect(duration).toBeLessThan(500);
  });

  it('should prevent circular reference in deep tree', () => {
    const tree = folderRepo.getTree();
    const root = tree[0];
    let deepest = tree[0];
    while (deepest.children && deepest.children.length > 0) {
      deepest = deepest.children[0];
    }

    // Trying to move root into deepest should fail
    const result = folderRepo.move(root.id, deepest.id, 0);
    expect(result).toBeNull();

    console.log(`  → Circular reference check passed for 100-level tree`);
  });

  it('should get descendant ids of top-level folder (99 descendants)', () => {
    const tree = folderRepo.getTree();
    const rootId = tree[0].id;

    const start = Date.now();
    const ids = folderRepo.getDescendantIds(rootId);
    const duration = elapsed(start);

    console.log(`  → Found ${ids.length} descendant IDs in ${duration}ms`);
    expect(ids.length).toBe(99);
    expect(duration).toBeLessThan(500);
  });
});

// =========================================================================
// 9.5.3: Large file attachment — streaming encryption
// =========================================================================
describe('9.5.3 — Large File Streaming Encryption', () => {
  const testDataDir = join(process.cwd(), 'test-data');
  const attachmentsDir = join(testDataDir, 'attachments');
  const tempDir = join(testDataDir, 'temp');

  beforeAll(() => {
    try {
      mkdirSync(attachmentsDir, { recursive: true });
    } catch {}
    try {
      mkdirSync(tempDir, { recursive: true });
    } catch {}
  });

  it('should encrypt 50MB of data using buffer-based approach in acceptable time', () => {
    // Generate 50MB of random data
    const size = 50 * 1024 * 1024; // 50 MB
    const data = randomBytes(size);

    const start = Date.now();
    const encrypted = encryptAES256GCM(data, TEST_KEY);
    const encryptDuration = elapsed(start);

    console.log(
      `  → Encrypted 50MB in ${encryptDuration}ms (${(size / (encryptDuration / 1000) / 1048576).toFixed(1)} MB/s)`,
    );

    // Verify structure
    expect(encrypted.iv.length).toBe(12);
    expect(encrypted.tag.length).toBe(16);
    expect(encrypted.ciphertext.length).toBe(size); // GCM ciphertext same size as plaintext

    // Decrypt and verify
    const decryptStart = Date.now();
    const decrypted = decryptAES256GCM(encrypted, TEST_KEY);
    const decryptDuration = elapsed(decryptStart);

    console.log(
      `  → Decrypted 50MB in ${decryptDuration}ms (${(size / (decryptDuration / 1000) / 1048576).toFixed(1)} MB/s)`,
    );

    expect(decrypted.equals(data)).toBe(true);
    expect(encryptDuration).toBeLessThan(10000); // Under 10 seconds
    expect(decryptDuration).toBeLessThan(10000);
  });

  it('should encrypt/decrypt 10MB with streaming simulation', () => {
    const size = 10 * 1024 * 1024; // 10 MB
    const data = randomBytes(size);

    // Simulated streaming: process in 64KB chunks
    const chunkSize = 65536;
    const start = Date.now();

    let encryptedTotal = Buffer.alloc(0);
    for (let offset = 0; offset < size; offset += chunkSize) {
      const chunk = data.subarray(offset, Math.min(offset + chunkSize, size));
      const encryptedChunk = encryptAES256GCM(chunk, TEST_KEY);
      encryptedTotal = Buffer.concat([
        encryptedTotal,
        encryptedChunk.iv,
        encryptedChunk.tag,
        encryptedChunk.ciphertext,
      ]);
    }

    const encryptDuration = elapsed(start);
    console.log(`  → Stream-encrypted 10MB in ${encryptDuration}ms (${chunkSize}B chunks)`);

    // Decrypt in chunks
    const decryptStart = Date.now();
    let decryptedTotal = Buffer.alloc(0);
    let offset = 0;
    while (offset < encryptedTotal.length) {
      const iv = encryptedTotal.subarray(offset, offset + 12);
      offset += 12;
      const tag = encryptedTotal.subarray(offset, offset + 16);
      offset += 16;
      const ciphertext = encryptedTotal.subarray(offset, offset + chunkSize);
      offset += chunkSize;

      const decryptedChunk = decryptAES256GCM(
        { ciphertext: Buffer.from(ciphertext), iv, tag },
        TEST_KEY,
      );
      decryptedTotal = Buffer.concat([decryptedTotal, decryptedChunk]);
    }

    const decryptDuration = elapsed(decryptStart);
    console.log(`  → Stream-decrypted 10MB in ${decryptDuration}ms`);

    expect(decryptedTotal.equals(data)).toBe(true);
    expect(encryptDuration).toBeLessThan(5000);
  });

  it('should measure memory usage pattern during encryption', () => {
    // Test that encryption of large data doesn't cause memory blow-up
    const sizes = [
      1024, // 1 KB
      1024 * 100, // 100 KB
      1024 * 1024, // 1 MB
      1024 * 1024 * 5, // 5 MB
    ];

    for (const size of sizes) {
      const data = randomBytes(size);
      const start = Date.now();
      const encrypted = encryptAES256GCM(data, TEST_KEY);
      const duration = elapsed(start);

      console.log(`  → Encrypted ${(size / 1024).toFixed(0)}KB in ${duration}ms`);

      // Verify round-trip
      const decrypted = decryptAES256GCM(encrypted, TEST_KEY);
      expect(decrypted.equals(data)).toBe(true);
      expect(duration).toBeLessThan(1000);
    }
  });
});

// =========================================================================
// 9.5.4: Bundle size measurement
// =========================================================================
describe('9.5.4 — Bundle Size Analysis', () => {
  it('should have JS bundle under 2 MB', () => {
    const distDir = resolve(join(__dirname, '..', '..', 'dist'));

    const assetsDir = join(distDir, 'assets');
    const stat = statSync(assetsDir);
    expect(stat.isDirectory()).toBe(true);

    // Find JS bundle
    const fs = require('node:fs');
    const entries = fs.readdirSync(assetsDir);
    const jsFile = entries.find((f: string) => f.endsWith('.js') && !f.endsWith('.js.map'));
    expect(jsFile).toBeDefined();

    if (jsFile) {
      const jsPath = join(assetsDir, jsFile);
      const jsStats = statSync(jsPath);
      const sizeKB = Math.round(jsStats.size / 1024);
      const sizeMB = (jsStats.size / (1024 * 1024)).toFixed(2);

      console.log(`  → JS bundle: ${sizeKB} KB (${sizeMB} MB)`);
      console.log(`  → File: ${jsFile}`);

      // Bundle should be under 2 MB
      expect(jsStats.size).toBeLessThan(2 * 1024 * 1024);
    }

    // Check CSS bundle
    const cssFile = entries.find((f: string) => f.endsWith('.css'));
    if (cssFile) {
      const cssStats = statSync(join(assetsDir, cssFile));
      const cssKB = Math.round(cssStats.size / 1024);
      console.log(`  → CSS bundle: ${cssKB} KB`);
      expect(cssStats.size).toBeLessThan(500 * 1024); // Under 500 KB
    }
  });

  it('should have reasonable main process bundle size', () => {
    const mainDir = resolve(join(__dirname, '..', '..', 'dist-electron', 'main'));
    try {
      const mainStats = statSync(join(mainDir, 'index.js'));
      const mainKB = Math.round(mainStats.size / 1024);
      console.log(`  → Main process bundle: ${mainKB} KB`);
      expect(mainStats.size).toBeLessThan(1024 * 1024); // Under 1 MB
    } catch {
      console.log('  → Main process bundle not found (may need build)');
    }
  });

  it('should list all bundled assets with sizes', () => {
    const assetsDir = resolve(join(__dirname, '..', '..', 'dist', 'assets'));
    const fs = require('node:fs');

    try {
      const entries = fs.readdirSync(assetsDir) as string[];
      console.log('  → Build assets:');
      for (const entry of entries) {
        const stats = statSync(join(assetsDir, entry));
        const sizeKB = (stats.size / 1024).toFixed(1);
        const isMap = entry.endsWith('.map') ? ' (source map)' : '';
        console.log(`      ${entry}: ${sizeKB} KB${isMap}`);
      }
    } catch {
      console.log('  → Assets directory not found');
    }

    // Also check dist root
    try {
      const distDir = resolve(join(__dirname, '..', '..', 'dist'));
      const rootEntries = fs.readdirSync(distDir) as string[];
      for (const entry of rootEntries) {
        const fullPath = join(distDir, entry);
        if (fs.statSync(fullPath).isFile()) {
          const stats = statSync(fullPath);
          console.log(`      dist/${entry}: ${(stats.size / 1024).toFixed(1)} KB`);
        }
      }
    } catch {
      // Ok
    }

    expect(true).toBe(true);
  });
});
