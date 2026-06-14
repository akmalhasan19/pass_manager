import initSqlJs, { Database as SqlJsDatabase } from 'sql.js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const FTS5_RELATED = /items_fts|fts5/i;

let SQL: Awaited<ReturnType<typeof initSqlJs>> | null = null;
let db: SqlJsDatabase | null = null;

export async function createTestDatabase(): Promise<SqlJsDatabase> {
  if (!SQL) {
    SQL = await initSqlJs();
  }

  db = new SQL.Database();
  db.run('PRAGMA foreign_keys = ON');
  db.run('PRAGMA journal_mode = MEMORY');

  const schemaPath = join(__dirname, '..', '..', 'src', 'main', 'database', 'schema.sql');
  const schema = readFileSync(schemaPath, 'utf-8');

  const noComments = schema
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n');

  const statements = noComments
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((s) => s + ';');

  for (const stmt of statements) {
    if (FTS5_RELATED.test(stmt)) continue;
    try {
      db.run(stmt);
    } catch {
      // Skip statements that fail (e.g., FTS5-dependent triggers)
    }
  }

  return db;
}

export function destroyTestDatabase(): void {
  if (db) {
    try { db.close(); } catch { /* ignore */ }
    db = null;
  }
  SQL = null;
}
