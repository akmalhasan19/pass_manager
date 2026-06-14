import { getDatabase } from '../connection';
import { Tag } from '../../../shared/types';
import { nanoid } from 'nanoid';

export class TagRepository {
  create(name: string, color: string = '#6366f1'): Tag {
    const db = getDatabase();
    if (!db) throw new Error('Database not open');

    const id = nanoid();
    db.run('INSERT INTO tags (id, name, color) VALUES (?, ?, ?)', [id, name, color]);
    return { id, name, color };
  }

  getAll(): Tag[] {
    const db = getDatabase();
    if (!db) throw new Error('Database not open');

    const stmt = db.prepare('SELECT * FROM tags ORDER BY name ASC');
    const tags: Tag[] = [];

    while (stmt.step()) {
      const row = stmt.getAsObject() as Record<string, unknown>;
      tags.push({
        id: row.id as string,
        name: row.name as string,
        color: (row.color as string) ?? '#6366f1',
      });
    }

    stmt.free();
    return tags;
  }

  getById(id: string): Tag | null {
    const db = getDatabase();
    if (!db) throw new Error('Database not open');

    const stmt = db.prepare('SELECT * FROM tags WHERE id = ?');
    stmt.bind([id]);

    if (stmt.step()) {
      const row = stmt.getAsObject() as Record<string, unknown>;
      stmt.free();
      return {
        id: row.id as string,
        name: row.name as string,
        color: (row.color as string) ?? '#6366f1',
      };
    }

    stmt.free();
    return null;
  }

  findByName(name: string): Tag | null {
    const db = getDatabase();
    if (!db) throw new Error('Database not open');

    const stmt = db.prepare('SELECT * FROM tags WHERE name = ?');
    stmt.bind([name]);

    if (stmt.step()) {
      const row = stmt.getAsObject() as Record<string, unknown>;
      stmt.free();
      return {
        id: row.id as string,
        name: row.name as string,
        color: (row.color as string) ?? '#6366f1',
      };
    }

    stmt.free();
    return null;
  }

  attachToItem(itemId: string, tagId: string): void {
    const db = getDatabase();
    if (!db) throw new Error('Database not open');
    db.run('INSERT OR IGNORE INTO item_tags (item_id, tag_id) VALUES (?, ?)', [itemId, tagId]);
  }

  detachFromItem(itemId: string, tagId: string): void {
    const db = getDatabase();
    if (!db) throw new Error('Database not open');
    db.run('DELETE FROM item_tags WHERE item_id = ? AND tag_id = ?', [itemId, tagId]);
  }

  getByItem(itemId: string): Tag[] {
    const db = getDatabase();
    if (!db) throw new Error('Database not open');

    const stmt = db.prepare(
      `SELECT tags.* FROM tags
       JOIN item_tags ON tags.id = item_tags.tag_id
       WHERE item_tags.item_id = ?
       ORDER BY tags.name ASC`,
    );
    stmt.bind([itemId]);

    const tags: Tag[] = [];
    while (stmt.step()) {
      const row = stmt.getAsObject() as Record<string, unknown>;
      tags.push({
        id: row.id as string,
        name: row.name as string,
        color: (row.color as string) ?? '#6366f1',
      });
    }

    stmt.free();
    return tags;
  }

  delete(id: string): void {
    const db = getDatabase();
    if (!db) throw new Error('Database not open');

    db.run('DELETE FROM item_tags WHERE tag_id = ?', [id]);
    db.run('DELETE FROM tags WHERE id = ?', [id]);
  }
}
