import { getDatabase } from '../connection';
import { Item } from '../../../shared/types';
import { nanoid } from 'nanoid';
import { normalizeForComparison } from '../../../shared/validation';

export class ItemRepository {
  create(
    folderId: string,
    fields: {
      title: string;
      username?: string;
      passwordEncrypted?: ArrayBuffer | null;
      url?: string;
      notesEncrypted?: ArrayBuffer | null;
      emoji?: string | null;
      coverImage?: string | null;
    },
  ): Item {
    const db = getDatabase();
    if (!db) throw new Error('Database not open');

    const id = nanoid();
    const now = Date.now();

    const stmt = db.prepare(
      'SELECT COALESCE(MAX(sort_order), -1) as max_order FROM items WHERE folder_id = ?',
    );
    stmt.bind([folderId]);
    let maxOrder = -1;
    if (stmt.step()) {
      maxOrder = (stmt.getAsObject().max_order as number) + 1;
    }
    stmt.free();

    db.run(
      `INSERT INTO items (id, folder_id, title, username, password_encrypted, url, notes_encrypted, emoji, cover_image, created_at, updated_at, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        folderId,
        fields.title,
        fields.username ?? '',
        fields.passwordEncrypted ?? null,
        fields.url ?? '',
        fields.notesEncrypted ?? null,
        fields.emoji ?? null,
        fields.coverImage ?? null,
        now,
        now,
        maxOrder + 1,
      ],
    );

    return this.getById(id)!;
  }

  getById(id: string): Item | null {
    const db = getDatabase();
    if (!db) throw new Error('Database not open');

    const stmt = db.prepare('SELECT * FROM items WHERE id = ?');
    stmt.bind([id]);

    if (stmt.step()) {
      const row = stmt.getAsObject() as Record<string, unknown>;
      stmt.free();
      return this.rowToItem(row);
    }

    stmt.free();
    return null;
  }

  getByFolder(folderId: string): Item[] {
    const db = getDatabase();
    if (!db) throw new Error('Database not open');

    const stmt = db.prepare('SELECT * FROM items WHERE folder_id = ? ORDER BY sort_order ASC');
    stmt.bind([folderId]);

    const items: Item[] = [];
    while (stmt.step()) {
      const row = stmt.getAsObject() as Record<string, unknown>;
      items.push(this.rowToItem(row));
    }

    stmt.free();
    return items;
  }

  update(
    id: string,
    fields: Partial<{
      title: string;
      username: string;
      passwordEncrypted: ArrayBuffer | null;
      url: string;
      notesEncrypted: ArrayBuffer | null;
      emoji: string | null;
      coverImage: string | null;
      isFavorite: boolean;
      sortOrder: number;
    }>,
  ): Item | null {
    const db = getDatabase();
    if (!db) throw new Error('Database not open');

    const sets: string[] = [];
    const params: unknown[] = [];
    const now = Date.now();

    if (fields.title !== undefined) {
      sets.push('title = ?');
      params.push(fields.title);
    }
    if (fields.username !== undefined) {
      sets.push('username = ?');
      params.push(fields.username);
    }
    if (fields.passwordEncrypted !== undefined) {
      sets.push('password_encrypted = ?');
      params.push(fields.passwordEncrypted);
    }
    if (fields.url !== undefined) {
      sets.push('url = ?');
      params.push(fields.url);
    }
    if (fields.notesEncrypted !== undefined) {
      sets.push('notes_encrypted = ?');
      params.push(fields.notesEncrypted);
    }
    if (fields.emoji !== undefined) {
      sets.push('emoji = ?');
      params.push(fields.emoji);
    }
    if (fields.coverImage !== undefined) {
      sets.push('cover_image = ?');
      params.push(fields.coverImage);
    }
    if (fields.isFavorite !== undefined) {
      sets.push('is_favorite = ?');
      params.push(fields.isFavorite ? 1 : 0);
    }
    if (fields.sortOrder !== undefined) {
      sets.push('sort_order = ?');
      params.push(fields.sortOrder);
    }

    if (sets.length === 0) return this.getById(id);

    sets.push('updated_at = ?');
    params.push(now);
    params.push(id);

    db.run(`UPDATE items SET ${sets.join(', ')} WHERE id = ?`, params);
    return this.getById(id);
  }

  delete(id: string): void {
    const db = getDatabase();
    if (!db) throw new Error('Database not open');

    db.run('DELETE FROM attachments WHERE item_id = ?', [id]);
    db.run('DELETE FROM item_tags WHERE item_id = ?', [id]);
    db.run('DELETE FROM items WHERE id = ?', [id]);
  }

  getByFolderIdList(folderIds: string[]): Item[] {
    if (folderIds.length === 0) return [];

    const db = getDatabase();
    if (!db) throw new Error('Database not open');

    const placeholders = folderIds.map(() => '?').join(',');
    const stmt = db.prepare(
      `SELECT * FROM items WHERE folder_id IN (${placeholders}) ORDER BY sort_order ASC`,
    );
    stmt.bind(folderIds);

    const items: Item[] = [];
    while (stmt.step()) {
      const row = stmt.getAsObject() as Record<string, unknown>;
      items.push(this.rowToItem(row));
    }

    stmt.free();
    return items;
  }

  getAll(): Item[] {
    const db = getDatabase();
    if (!db) throw new Error('Database not open');

    const stmt = db.prepare('SELECT * FROM items ORDER BY updated_at DESC');
    const items: Item[] = [];

    while (stmt.step()) {
      const row = stmt.getAsObject() as Record<string, unknown>;
      items.push(this.rowToItem(row));
    }

    stmt.free();
    return items;
  }

  search(query: string): Item[] {
    const db = getDatabase();
    if (!db) throw new Error('Database not open');

    const items: Item[] = [];
    const seen = new Set<string>();

    const searchInTable = (sql: string, params: unknown[]) => {
      const stmt = db.prepare(sql);
      stmt.bind(params);

      while (stmt.step()) {
        const row = stmt.getAsObject() as Record<string, unknown>;
        const id = row.id as string;
        if (!seen.has(id)) {
          seen.add(id);
          items.push(this.rowToItem(row));
        }
      }

      stmt.free();
    };

    const pattern = `%${query}%`;
    searchInTable('SELECT * FROM items WHERE title LIKE ? ORDER BY sort_order ASC LIMIT 20', [
      pattern,
    ]);
    searchInTable('SELECT * FROM items WHERE username LIKE ? ORDER BY sort_order ASC LIMIT 10', [
      pattern,
    ]);
    searchInTable('SELECT * FROM items WHERE url LIKE ? ORDER BY sort_order ASC LIMIT 10', [
      pattern,
    ]);

    if (query.length > 2) {
      try {
        searchInTable(
          `SELECT items.* FROM items
           JOIN item_tags ON items.id = item_tags.item_id
           JOIN tags ON item_tags.tag_id = tags.id
           WHERE tags.name LIKE ?
           ORDER BY items.sort_order ASC LIMIT 10`,
          [pattern],
        );
      } catch {
        // Tags table might not have matching entries
      }
    }

    return items.slice(0, 20);
  }

  /**
   * Check if an item with the same title (case-insensitive) exists in the same folder.
   * Uses normalizeForComparison for Unicode-aware comparison.
   * @param folderId - The folder ID to check within
   * @param title - The item title to check
   * @param excludeId - Optional item ID to exclude (for rename operations)
   * @returns true if a duplicate exists, false otherwise
   */
  existsByFolderIdAndTitle(
    folderId: string,
    title: string,
    excludeId?: string,
  ): boolean {
    const db = getDatabase();
    if (!db) throw new Error('Database not open');

    const normalizedInput = normalizeForComparison(title);
    const stmt = db.prepare('SELECT id, title FROM items WHERE folder_id = ?');
    stmt.bind([folderId]);

    let duplicateFound = false;
    while (stmt.step()) {
      const row = stmt.getAsObject() as { id: string; title: string };
      if (excludeId && row.id === excludeId) continue;
      if (normalizeForComparison(row.title) === normalizedInput) {
        duplicateFound = true;
        break;
      }
    }
    stmt.free();

    return duplicateFound;
  }

  private rowToItem(row: Record<string, unknown>): Item {
    return {
      id: row.id as string,
      folderId: row.folder_id as string,
      title: row.title as string,
      username: (row.username as string) ?? '',
      passwordEncrypted: (row.password_encrypted as ArrayBuffer) ?? null,
      url: (row.url as string) ?? '',
      notesEncrypted: (row.notes_encrypted as ArrayBuffer) ?? null,
      emoji: (row.emoji as string) ?? null,
      coverImage: (row.cover_image as string) ?? null,
      createdAt: row.created_at as number,
      updatedAt: row.updated_at as number,
      isFavorite: (row.is_favorite as number) === 1,
      sortOrder: (row.sort_order as number) ?? 0,
    };
  }
}
