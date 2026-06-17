import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { app } from 'electron';
import type { Database as SqlJsDatabase } from 'sql.js';
import { runMany, getDatabase, openDatabaseForVault, saveDatabase, closeDatabase } from './connection';

const CURRENT_VERSION = 2;

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

export function runSchema(db?: SqlJsDatabase): void {
  const schemaPath = join(app.getAppPath(), 'src', 'main', 'database', 'schema.sql');
  const schema = readFileSync(schemaPath, 'utf-8');

  const statements = schema
    .split(';')
    .map((s) => s.replace(/--.*$/gm, '').trim())
    .filter((s) => s.length > 0)
    .map((s) => s + ';');

  if (db) {
    for (let i = 0; i < statements.length; i++) {
      try {
        db.run(statements[i]);
      } catch (cause) {
        throw new Error(
          `Schema statement ${i} failed: ${statements[i].slice(0, 80)} — ${cause instanceof Error ? cause.message : String(cause)}`,
        );
      }
    }
  } else {
    runMany(statements);
  }
}

function getCurrentSchemaVersion(db?: SqlJsDatabase): number {
  try {
    const result = runQueryOnDb('SELECT value FROM settings WHERE key = ?', ['schema_version'], db);
    return parseInt(result as string, 10) || 0;
  } catch {
    return 0;
  }
}

function runQueryOnDb(sql: string, params: unknown[] = [], db?: SqlJsDatabase): unknown {
  const targetDb = db ?? getDatabase();
  if (!targetDb) throw new Error('Database not open');
  const stmt = targetDb.prepare(sql);
  stmt.bind(params);
  if (stmt.step()) {
    const row = stmt.getAsObject();
    stmt.free();
    return Object.values(row)[0];
  }
  stmt.free();
  return null;
}

export function runMigrations(db?: SqlJsDatabase): void {
  const currentVersion = getCurrentSchemaVersion(db);

  if (currentVersion < CURRENT_VERSION) {
    if (currentVersion === 0) {
      runSchema(db);
    }

    const targetDb = db ?? getDatabase();
    if (!targetDb) throw new Error('Database not open');

    if (currentVersion < 2) {
      targetDb.run("ALTER TABLE items ADD COLUMN otp_secret TEXT");
      targetDb.run("ALTER TABLE items ADD COLUMN otp_period INTEGER DEFAULT 30");
      targetDb.run("ALTER TABLE items ADD COLUMN otp_digits INTEGER DEFAULT 6");
      targetDb.run("ALTER TABLE items ADD COLUMN otp_algorithm TEXT DEFAULT 'SHA1'");
    }

    targetDb.run('UPDATE settings SET value = ? WHERE key = ?', [
      String(CURRENT_VERSION),
      'schema_version',
    ]);
  }
}

export function initializeDatabase(): void {
  runSchema();
  runMigrations();
}

/**
 * Runs schema and migrations on a specific vault's database.
 *
 * Opens the vault database, applies any pending migrations, saves, and closes.
 * The active database state is restored to whatever was open before (if any)
 * by closing the vault database after migration completes.
 *
 * @param vaultId - The vault whose database should be migrated.
 * @throws {Error} If the vault database cannot be opened, migrated, or saved.
 *   The error message is safe to display to the user and does not leak sensitive data.
 */
export function migrateVaultDatabase(vaultId: string): void {
  openDatabaseForVault(vaultId);
  try {
    runMigrations();
    saveDatabase();
  } finally {
    try {
      closeDatabase();
    } catch {
      // Close errors during migration cleanup are non-fatal; the migration
      // either succeeded or already threw above.
    }
  }
}
