/**
 * Sub-Task 5.3: SQL Injection Tests
 *
 * Verifies that common SQL injection payloads are handled safely by the
 * repository layer. Every user-supplied value must reach the database only
 * through bound parameters (`?` placeholders), never through string
 * concatenation. The tests spy on the actual sql.js database methods to
 * inspect the SQL strings and parameters that are sent to the engine.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { Database as SqlJsDatabase } from 'sql.js';
import { createTestDatabase, destroyTestDatabase } from '../../helpers/testDatabase';
import { FolderRepository } from '@main/database/repositories/FolderRepository';
import { ItemRepository } from '@main/database/repositories/ItemRepository';
import { TagRepository } from '@main/database/repositories/TagRepository';
import { commonSqlInjectionPayloads } from '../../fixtures/sql-injection-payloads';

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

interface QuerySpy {
  runCalls: Array<{ sql: string; params: unknown[] }>;
  prepareCalls: Array<{ sql: string }>;
  bindCalls: Array<{ sql: string; params: unknown[] }>;
}

function withQuerySpy<T>(db: SqlJsDatabase, callback: (spy: QuerySpy) => T): T {
  const originalRun = db.run.bind(db);
  const originalPrepare = db.prepare.bind(db);
  const runCalls: Array<{ sql: string; params: unknown[] }> = [];
  const prepareCalls: Array<{ sql: string }> = [];
  const bindCalls: Array<{ sql: string; params: unknown[] }> = [];
  const bindSpies: Array<ReturnType<typeof vi.spyOn>> = [];

  const runSpy = vi.spyOn(db, 'run').mockImplementation((sql: string, params?: unknown[]) => {
    runCalls.push({ sql, params: params ?? [] });
    return originalRun(sql, params);
  });

  const prepareSpy = vi.spyOn(db, 'prepare').mockImplementation((sql: string) => {
    prepareCalls.push({ sql });
    const stmt = originalPrepare(sql);
    const originalBind = stmt.bind.bind(stmt);
    const bindSpy = vi.spyOn(stmt, 'bind').mockImplementation((params?: unknown[]) => {
      bindCalls.push({ sql, params: params ?? [] });
      return originalBind(params);
    });
    bindSpies.push(bindSpy);
    return stmt;
  });

  try {
    return callback({ runCalls, prepareCalls, bindCalls });
  } finally {
    runSpy.mockRestore();
    prepareSpy.mockRestore();
    for (const bindSpy of bindSpies) {
      bindSpy.mockRestore();
    }
  }
}

function assertPayloadOnlyInParams(spy: QuerySpy, payload: string): void {
  const allSql = [
    ...spy.runCalls.map((call) => call.sql),
    ...spy.prepareCalls.map((call) => call.sql),
  ];

  for (const sql of allSql) {
    expect(sql).not.toContain(payload);
  }

  const allParams = [
    ...spy.runCalls.flatMap((call) => call.params),
    ...spy.bindCalls.flatMap((call) => call.params),
  ];

  expect(allParams.some((param) => param === payload)).toBe(true);
}

function getTableNames(db: SqlJsDatabase): string[] {
  const stmt = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name");
  const names: string[] = [];
  while (stmt.step()) {
    names.push((stmt.getAsObject().name as string).toLowerCase());
  }
  stmt.free();
  return names;
}

function clearTables(db: SqlJsDatabase): void {
  db.run('DELETE FROM item_tags');
  db.run('DELETE FROM attachments');
  db.run('DELETE FROM items');
  db.run('DELETE FROM trash');
  db.run('DELETE FROM tags');
  db.run('DELETE FROM folders');
  db.run("INSERT OR IGNORE INTO settings (key, value) VALUES ('schema_version', '1')");
}

describe('SQL injection payload fixtures', () => {
  it('contains the three payloads required by Sub-Task 5.3', () => {
    const ids = commonSqlInjectionPayloads.map((payload) => payload.id);
    expect(ids).toContain('or-true');
    expect(ids).toContain('drop-table-comment');
    expect(ids).toContain('delete-statement');
  });
});

describe('SQL injection resistance — repository layer', () => {
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

  it('creates folders with malicious names without altering SQL', () => {
    for (const payload of commonSqlInjectionPayloads) {
      clearTables(db);
      withQuerySpy(db, (spy) => {
        const folder = folderRepo.create(null, payload.raw);
        expect(folder.name).toBe(payload.raw);
        assertPayloadOnlyInParams(spy, payload.raw);
      });
      expect(getTableNames(db)).toContain('folders');
      expect(getTableNames(db)).toContain('items');
    }
  });

  it('creates items with malicious title, username, and URL without altering SQL', () => {
    for (const payload of commonSqlInjectionPayloads) {
      clearTables(db);
      const folder = folderRepo.create(null, 'Safe Folder');
      withQuerySpy(db, (spy) => {
        const item = itemRepo.create(folder.id, {
          title: payload.raw,
          username: payload.raw,
          url: payload.raw,
        });
        expect(item.title).toBe(payload.raw);
        expect(item.username).toBe(payload.raw);
        expect(item.url).toBe(payload.raw);
        assertPayloadOnlyInParams(spy, payload.raw);
      });
      expect(getTableNames(db)).toContain('items');
      expect(itemRepo.getAll()).toHaveLength(1);
    }
  });

  it('updates folders with malicious names without altering SQL', () => {
    for (const payload of commonSqlInjectionPayloads) {
      clearTables(db);
      const folder = folderRepo.create(null, 'Safe Folder');
      withQuerySpy(db, (spy) => {
        const updated = folderRepo.update(folder.id, { name: payload.raw });
        expect(updated?.name).toBe(payload.raw);
        assertPayloadOnlyInParams(spy, payload.raw);
      });
    }
  });

  it('updates items with malicious titles without altering SQL', () => {
    for (const payload of commonSqlInjectionPayloads) {
      clearTables(db);
      const folder = folderRepo.create(null, 'Safe Folder');
      const item = itemRepo.create(folder.id, { title: 'Safe Item' });
      withQuerySpy(db, (spy) => {
        const updated = itemRepo.update(item.id, { title: payload.raw });
        expect(updated?.title).toBe(payload.raw);
        assertPayloadOnlyInParams(spy, payload.raw);
      });
    }
  });

  it('creates tags with malicious names without altering SQL', () => {
    for (const payload of commonSqlInjectionPayloads) {
      clearTables(db);
      withQuerySpy(db, (spy) => {
        const tag = tagRepo.create(payload.raw);
        expect(tag.name).toBe(payload.raw);
        assertPayloadOnlyInParams(spy, payload.raw);
      });
    }
  });

  it('searches folders with malicious queries using LIKE parameters', () => {
    folderRepo.create(null, 'Bank Account');
    for (const payload of commonSqlInjectionPayloads) {
      withQuerySpy(db, (spy) => {
        const results = folderRepo.searchByName(payload.raw);
        expect(results).toHaveLength(0);

        const likePrepares = spy.prepareCalls.filter((call) => call.sql.includes('LIKE'));
        expect(likePrepares.length).toBeGreaterThan(0);
        for (const call of likePrepares) {
          expect(call.sql).toContain('LIKE ?');
          expect(call.sql).not.toContain(payload.raw);
        }

        const likeBinds = spy.bindCalls.filter((call) => call.sql.includes('LIKE'));
        expect(
          likeBinds.some((call) =>
            call.params.some((param) => typeof param === 'string' && param.includes(payload.raw)),
          ),
        ).toBe(true);
      });
    }
  });

  it('searches items with malicious queries using LIKE parameters', () => {
    const folder = folderRepo.create(null, 'F');
    itemRepo.create(folder.id, { title: 'Gmail Account' });
    for (const payload of commonSqlInjectionPayloads) {
      withQuerySpy(db, (spy) => {
        const results = itemRepo.search(payload.raw);
        expect(results).toHaveLength(0);

        const likePrepares = spy.prepareCalls.filter((call) => call.sql.includes('LIKE'));
        expect(likePrepares.length).toBeGreaterThan(0);
        for (const call of likePrepares) {
          expect(call.sql).toContain('LIKE ?');
          expect(call.sql).not.toContain(payload.raw);
        }
      });
    }
  });

  it('rejects malicious IDs before executing any query', () => {
    for (const payload of commonSqlInjectionPayloads) {
      withQuerySpy(db, (spy) => {
        expect(() => folderRepo.getById(payload.raw)).toThrow(/Invalid folder ID/);
        expect(() => itemRepo.getById(payload.raw)).toThrow(/Invalid item ID/);
        expect(() => folderRepo.move(payload.raw, null, 0)).toThrow(/Invalid folder ID/);
        expect(() => itemRepo.getByFolder(payload.raw)).toThrow(/Invalid folder ID/);
        expect(spy.runCalls).toHaveLength(0);
        expect(spy.prepareCalls).toHaveLength(0);
      });
    }
  });

  it('does not drop or corrupt tables when payloads contain DROP/DELETE', () => {
    const requiredTables = [
      'attachments',
      'folders',
      'item_tags',
      'items',
      'settings',
      'tags',
      'trash',
    ];

    for (const payload of commonSqlInjectionPayloads) {
      clearTables(db);
      folderRepo.create(null, payload.raw);
      const folder = folderRepo.create(null, 'Reference');
      itemRepo.create(folder.id, { title: payload.raw, username: payload.raw, url: payload.raw });
      tagRepo.create(payload.raw);

      const tables = getTableNames(db);
      for (const table of requiredTables) {
        expect(tables).toContain(table);
      }

      // The DELETE payload must not have removed the rows we just inserted
      expect(itemRepo.getAll()).toHaveLength(1);
      expect(tagRepo.getAll()).toHaveLength(1);
      expect(folderRepo.getFlatList()).toHaveLength(2);
    }
  });
});
