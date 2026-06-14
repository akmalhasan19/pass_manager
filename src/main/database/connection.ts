import initSqlJs, { Database as SqlJsDatabase } from 'sql.js';
import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { app } from 'electron';
import {
  DatabaseError,
  DatabaseNotOpenError,
  DatabaseCorruptedError,
  DatabaseIOError,
  DatabaseNotInitializedError,
} from '../../shared/types';

const SQL_INIT_ERRORS = {
  WASM_NOT_FOUND: 'SQL.js WASM binary not found',
  INIT_FAILED: 'SQL.js initialization failed',
} as const;

const DB_FILE_ERRORS = {
  PERMISSION_DENIED: 'Permission denied accessing database file',
  DISK_FULL: 'No disk space available for database',
  FILE_NOT_FOUND: 'Database file not found',
  LOCKED: 'Database file is locked by another process',
} as const;

let db: SqlJsDatabase | null = null;
let dbPath: string | null = null;
let SQL: Awaited<ReturnType<typeof initSqlJs>> | null = null;

export async function initializeSqlJs(): Promise<void> {
  if (SQL) return;

  try {
    const wasmPath = join(__dirname, '..', '..', '..', 'public', 'sql-wasm.wasm');
    SQL = await initSqlJs({
      locateFile: () => wasmPath,
    });
  } catch (cause) {
    const isWasm = cause instanceof Error && cause.message?.includes('WASM');
    throw new DatabaseError(
      isWasm ? SQL_INIT_ERRORS.WASM_NOT_FOUND : SQL_INIT_ERRORS.INIT_FAILED,
      'SQL_INIT_ERROR',
      { cause: cause instanceof Error ? cause.message : String(cause) },
    );
  }
}

export function getDbPath(): string {
  if (dbPath) return dbPath;
  const userDataPath = app?.getPath?.('userData') ?? join(process.cwd(), 'data');
  if (!existsSync(userDataPath)) {
    try {
      mkdirSync(userDataPath, { recursive: true });
    } catch (cause) {
      throw new DatabaseIOError(
        'mkdir',
        userDataPath,
        cause instanceof Error ? cause.message : String(cause),
      );
    }
  }
  dbPath = join(userDataPath, 'securepass.db');
  return dbPath;
}

export function createDatabase(): SqlJsDatabase {
  if (!SQL) {
    throw new DatabaseNotInitializedError();
  }
  return new SQL.Database();
}

export function openDatabase(filePath?: string): SqlJsDatabase {
  const path = filePath ?? getDbPath();

  if (!SQL) {
    throw new DatabaseNotInitializedError();
  }

  if (db) {
    try {
      closeDatabase();
    } catch {
      db = null;
    }
  }

  if (existsSync(path)) {
    let fileBuffer: Buffer;
    try {
      fileBuffer = readFileSync(path);
    } catch (cause) {
      if (cause instanceof Error) {
        if ((cause as NodeJS.ErrnoException).code === 'EACCES') {
          throw new DatabaseIOError('read', path, DB_FILE_ERRORS.PERMISSION_DENIED);
        }
        if ((cause as NodeJS.ErrnoException).code === 'ENOENT') {
          throw new DatabaseIOError('read', path, DB_FILE_ERRORS.FILE_NOT_FOUND);
        }
      }
      throw new DatabaseIOError('read', path, cause);
    }

    if (fileBuffer.length === 0) {
      db = new SQL.Database();
    } else {
      try {
        db = new SQL.Database(fileBuffer);
      } catch (cause) {
        throw new DatabaseCorruptedError(path, cause);
      }
    }
  } else {
    db = new SQL.Database();
  }

  dbPath = path;
  return db;
}

export function saveDatabase(): void {
  if (!db) {
    throw new DatabaseNotOpenError();
  }

  const path = dbPath;
  if (!path) {
    throw new DatabaseNotOpenError({ detail: 'dbPath is not set' });
  }

  let data: Buffer;
  try {
    const exported = db.export();
    data = Buffer.from(exported);
  } catch (cause) {
    throw new DatabaseError(
      'Failed to export database',
      'DB_EXPORT_ERROR',
      { cause: cause instanceof Error ? cause.message : String(cause) },
    );
  }

  const dir = dirname(path);
  try {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(path, data);
  } catch (cause) {
    if (cause instanceof Error) {
      if ((cause as NodeJS.ErrnoException).code === 'EACCES') {
        throw new DatabaseIOError('write', path, DB_FILE_ERRORS.PERMISSION_DENIED);
      }
      if ((cause as NodeJS.ErrnoException).code === 'ENOSPC') {
        throw new DatabaseIOError('write', path, DB_FILE_ERRORS.DISK_FULL);
      }
      if ((cause as NodeJS.ErrnoException).code === 'EBUSY') {
        throw new DatabaseIOError('write', path, DB_FILE_ERRORS.LOCKED);
      }
    }
    throw new DatabaseIOError('write', path, cause);
  }
}

export function closeDatabase(): void {
  if (!db) return;
  try {
    saveDatabase();
  } catch (cause) {
    db.close();
    db = null;
    throw cause;
  }
  try {
    db.close();
  } catch (cause) {
    db = null;
    throw new DatabaseError(
      'Failed to close database',
      'DB_CLOSE_ERROR',
      { cause: cause instanceof Error ? cause.message : String(cause) },
    );
  }
  db = null;
}

export function getDatabase(): SqlJsDatabase | null {
  return db;
}

export function isDatabaseOpen(): boolean {
  return db !== null && dbPath !== null;
}

export function runQuery(sql: string, params: unknown[] = []): void {
  if (!db) throw new DatabaseNotOpenError();
  try {
    db.run(sql, params);
  } catch (cause) {
    throw new DatabaseError(
      `Query execution failed: ${sql.slice(0, 120)}`,
      'DB_QUERY_ERROR',
      {
        sql: sql.slice(0, 120),
        params,
        cause: cause instanceof Error ? cause.message : String(cause),
      },
    );
  }
}

export function runMany(queries: string[]): void {
  if (!db) throw new DatabaseNotOpenError();
  for (let i = 0; i < queries.length; i++) {
    try {
      db.run(queries[i]);
    } catch (cause) {
      throw new DatabaseError(
        `Batch query failed at index ${i}`,
        'DB_BATCH_QUERY_ERROR',
        {
          index: i,
          sql: queries[i].slice(0, 120),
          cause: cause instanceof Error ? cause.message : String(cause),
        },
      );
    }
  }
}

export function prepare(sql: string) {
  if (!db) throw new DatabaseNotOpenError();
  try {
    return db.prepare(sql);
  } catch (cause) {
    throw new DatabaseError(
      `Failed to prepare statement: ${sql.slice(0, 120)}`,
      'DB_PREPARE_ERROR',
      {
        sql: sql.slice(0, 120),
        cause: cause instanceof Error ? cause.message : String(cause),
      },
    );
  }
}

export function tryRepairDatabase(path: string): boolean {
  try {
    if (existsSync(path)) {
      const backupPath = `${path}.corrupted.${Date.now()}`;
      const fileBuffer = readFileSync(path);
      writeFileSync(backupPath, fileBuffer);
    }
    if (db) {
      try {
        db.close();
      } catch {
      }
      db = null;
    }
    dbPath = null;
    openDatabase(path);
    runMany([
      `PRAGMA schema_version;`,
      `CREATE TABLE IF NOT EXISTS _repair_ok (id INTEGER PRIMARY KEY);`,
      `DROP TABLE IF EXISTS _repair_ok;`,
    ]);
    return true;
  } catch {
    if (db) {
      try { db.close(); } catch {}
      db = null;
    }
    dbPath = null;
    try { unlinkSync(path); } catch {}
    return false;
  }
}

export async function destroyDatabase(path?: string): Promise<void> {
  if (db) {
    try {
      db.close();
    } catch {
    }
    db = null;
  }
  const targetPath = path ?? dbPath;
  if (targetPath && existsSync(targetPath)) {
    try {
      unlinkSync(targetPath);
    } catch (cause) {
      throw new DatabaseIOError('unlink', targetPath, cause);
    }
  }
  dbPath = null;
}
