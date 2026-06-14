import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { app } from 'electron';
import { runMany } from './connection';

const CURRENT_VERSION = 1;

export function getAuthPath(): string {
  const userDataPath = app?.getPath?.('userData') ?? join(process.cwd(), 'data');
  if (!existsSync(userDataPath)) {
    mkdirSync(userDataPath, { recursive: true });
  }
  return join(userDataPath, 'auth.json');
}

export function getVaultPath(): string {
  const userDataPath = app?.getPath?.('userData') ?? join(process.cwd(), 'data');
  return join(userDataPath, 'vault.enc');
}

export function dbExists(): boolean {
  const vaultPath = getVaultPath();
  return existsSync(vaultPath);
}

export function authFileExists(): boolean {
  const authPath = getAuthPath();
  return existsSync(authPath);
}

export function isInitialized(): boolean {
  return dbExists();
}

export function runSchema(): void {
  const schemaPath = join(__dirname, 'schema.sql');
  const schema = readFileSync(schemaPath, 'utf-8');

  const statements = schema
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !s.startsWith('--'))
    .map((s) => s + ';');

  runMany(statements);
}

function getCurrentSchemaVersion(): number {
  try {
    const result = runQuery('SELECT value FROM settings WHERE key = ?', ['schema_version']);
    return parseInt(result as string, 10) || 0;
  } catch {
    return 0;
  }
}

function runQuery(sql: string, params: unknown[] = []): unknown {
  const { getDatabase } = require('./connection');
  const db = getDatabase();
  if (!db) throw new Error('Database not open');
  const stmt = db.prepare(sql);
  stmt.bind(params);
  if (stmt.step()) {
    const row = stmt.getAsObject();
    stmt.free();
    return Object.values(row)[0];
  }
  stmt.free();
  return null;
}

export function runMigrations(): void {
  const currentVersion = getCurrentSchemaVersion();

  if (currentVersion < CURRENT_VERSION) {
    if (currentVersion === 0) {
      runSchema();
    }

    // Future migrations go here:
    // if (currentVersion < 2) { ... }
    // if (currentVersion < 3) { ... }

    const { getDatabase } = require('./connection');
    const db = getDatabase();
    if (!db) throw new Error('Database not open');

    db.run('UPDATE settings SET value = ? WHERE key = ?', [
      String(CURRENT_VERSION),
      'schema_version',
    ]);
  }
}

export function initializeDatabase(): void {
  runSchema();
  runMigrations();
}
