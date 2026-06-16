import { getDatabase } from '../connection';
import { TrashEntry } from '../../../shared/types';
import { nanoid } from 'nanoid';
import { assertValidId } from '../../../shared/sqlSafety';

export class TrashRepository {
  add(
    originalType: 'folder' | 'item',
    originalId: string,
    originalParentId: string | null,
    dataEncrypted: ArrayBuffer | null,
  ): void {
    const db = getDatabase();
    if (!db) throw new Error('Database not open');

    const id = nanoid();
    const now = Date.now();

    db.run(
      `INSERT INTO trash (id, original_type, original_id, original_parent_id, data_encrypted, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [id, originalType, originalId, originalParentId, dataEncrypted, now],
    );
  }

  getAll(): TrashEntry[] {
    const db = getDatabase();
    if (!db) throw new Error('Database not open');

    const stmt = db.prepare('SELECT * FROM trash ORDER BY deleted_at DESC');
    const entries: TrashEntry[] = [];

    while (stmt.step()) {
      const row = stmt.getAsObject() as Record<string, unknown>;
      entries.push({
        id: row.id as string,
        originalType: row.original_type as 'folder' | 'item',
        originalId: row.original_id as string,
        originalParentId: (row.original_parent_id as string) ?? null,
        dataEncrypted: row.data_encrypted as ArrayBuffer,
        deletedAt: row.deleted_at as number,
      });
    }

    stmt.free();
    return entries;
  }

  getById(id: string): TrashEntry | null {
    assertValidId(id, 'trash entry');
    const db = getDatabase();
    if (!db) throw new Error('Database not open');

    const stmt = db.prepare('SELECT * FROM trash WHERE id = ?');
    stmt.bind([id]);

    if (stmt.step()) {
      const row = stmt.getAsObject() as Record<string, unknown>;
      stmt.free();
      return {
        id: row.id as string,
        originalType: row.original_type as 'folder' | 'item',
        originalId: row.original_id as string,
        originalParentId: (row.original_parent_id as string) ?? null,
        dataEncrypted: row.data_encrypted as ArrayBuffer,
        deletedAt: row.deleted_at as number,
      };
    }

    stmt.free();
    return null;
  }

  remove(id: string): void {
    assertValidId(id, 'trash entry');
    const db = getDatabase();
    if (!db) throw new Error('Database not open');
    db.run('DELETE FROM trash WHERE id = ?', [id]);
  }

  removeByOriginalId(originalId: string): void {
    assertValidId(originalId, 'original ID');
    const db = getDatabase();
    if (!db) throw new Error('Database not open');
    db.run('DELETE FROM trash WHERE original_id = ?', [originalId]);
  }

  empty(): void {
    const db = getDatabase();
    if (!db) throw new Error('Database not open');
    db.run('DELETE FROM trash');
  }

  purgeOlderThan(ageMs: number): void {
    const db = getDatabase();
    if (!db) throw new Error('Database not open');

    const cutoff = Date.now() - ageMs;
    db.run('DELETE FROM trash WHERE deleted_at < ?', [cutoff]);
  }
}
