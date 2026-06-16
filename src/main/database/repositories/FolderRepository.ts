import { getDatabase } from '../connection';
import { Folder } from '../../../shared/types';
import { nanoid } from 'nanoid';
import { normalizeForComparison } from '../../../shared/validation';

export class FolderRepository {
  create(parentId: string | null, name: string, emoji: string | null = null): Folder {
    const db = getDatabase();
    if (!db) throw new Error('Database not open');

    const id = nanoid();
    const now = Date.now();

    let maxOrder = -1;
    if (parentId) {
      const stmt = db.prepare(
        'SELECT COALESCE(MAX(sort_order), -1) as max_order FROM folders WHERE parent_id = ?',
      );
      stmt.bind([parentId]);
      if (stmt.step()) {
        maxOrder = stmt.getAsObject().max_order as number;
      }
      stmt.free();
    }

    db.run(
      `INSERT INTO folders (id, parent_id, name, emoji, created_at, updated_at, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, parentId, name, emoji, now, now, maxOrder + 1],
    );

    return this.getById(id)!;
  }

  getById(id: string): Folder | null {
    const db = getDatabase();
    if (!db) throw new Error('Database not open');

    const stmt = db.prepare('SELECT * FROM folders WHERE id = ?');
    stmt.bind([id]);

    if (stmt.step()) {
      const row = stmt.getAsObject() as Record<string, unknown>;
      stmt.free();
      return this.rowToFolder(row);
    }

    stmt.free();
    return null;
  }

  getTree(): Folder[] {
    const db = getDatabase();
    if (!db) throw new Error('Database not open');

    const stmt = db.prepare('SELECT * FROM folders ORDER BY sort_order ASC');
    const folders: Folder[] = [];

    while (stmt.step()) {
      const row = stmt.getAsObject() as Record<string, unknown>;
      folders.push(this.rowToFolder(row));
    }

    stmt.free();
    return this.buildTree(folders);
  }

  getFlatList(): Folder[] {
    const db = getDatabase();
    if (!db) throw new Error('Database not open');

    const stmt = db.prepare('SELECT * FROM folders ORDER BY sort_order ASC');
    const folders: Folder[] = [];

    while (stmt.step()) {
      const row = stmt.getAsObject() as Record<string, unknown>;
      folders.push(this.rowToFolder(row));
    }

    stmt.free();
    return folders;
  }

  update(
    id: string,
    fields: Partial<Pick<Folder, 'name' | 'emoji' | 'coverImage' | 'sortOrder'>>,
  ): Folder | null {
    const db = getDatabase();
    if (!db) throw new Error('Database not open');

    const sets: string[] = [];
    const params: unknown[] = [];
    const now = Date.now();

    if (fields.name !== undefined) {
      sets.push('name = ?');
      params.push(fields.name);
    }
    if (fields.emoji !== undefined) {
      sets.push('emoji = ?');
      params.push(fields.emoji);
    }
    if (fields.coverImage !== undefined) {
      sets.push('cover_image = ?');
      params.push(fields.coverImage);
    }
    if (fields.sortOrder !== undefined) {
      sets.push('sort_order = ?');
      params.push(fields.sortOrder);
    }

    if (sets.length === 0) return this.getById(id);

    sets.push('updated_at = ?');
    params.push(now);
    params.push(id);

    db.run(`UPDATE folders SET ${sets.join(', ')} WHERE id = ?`, params);
    return this.getById(id);
  }

  move(id: string, newParentId: string | null, sortOrder: number): Folder | null {
    if (id === newParentId) return null;

    const db = getDatabase();
    if (!db) throw new Error('Database not open');

    if (newParentId) {
      const stmt = db.prepare('SELECT id FROM folders WHERE id = ? AND parent_id = ?');
      stmt.bind([newParentId, id]);

      if (stmt.step()) {
        const result = stmt.getAsObject();
        stmt.free();
        if (result.id) return null;
      }
      stmt.free();
    }

    // Check for circular reference
    if (newParentId) {
      let currentId: string | null = newParentId;
      while (currentId) {
        if (currentId === id) return null;
        const stmt = db.prepare('SELECT parent_id FROM folders WHERE id = ?');
        stmt.bind([currentId]);
        currentId = null;
        if (stmt.step()) {
          const row = stmt.getAsObject() as { parent_id: string | null };
          currentId = row.parent_id;
        }
        stmt.free();
      }
    }

    const now = Date.now();
    db.run('UPDATE folders SET parent_id = ?, sort_order = ?, updated_at = ? WHERE id = ?', [
      newParentId,
      sortOrder,
      now,
      id,
    ]);

    return this.getById(id);
  }

  delete(id: string): void {
    const db = getDatabase();
    if (!db) throw new Error('Database not open');

    const children = this.getDescendantIds(id);
    const allIds = [id, ...children];

    for (const folderId of allIds) {
      db.run('DELETE FROM attachments WHERE folder_id = ?', [folderId]);
      db.run('DELETE FROM item_tags WHERE item_id IN (SELECT id FROM items WHERE folder_id = ?)', [
        folderId,
      ]);
      db.run('DELETE FROM items WHERE folder_id = ?', [folderId]);
      db.run('DELETE FROM folders WHERE id = ?', [folderId]);
    }
  }

  getDescendantIds(folderId: string): string[] {
    const db = getDatabase();
    if (!db) throw new Error('Database not open');

    const result: string[] = [];
    const queue = [folderId];

    while (queue.length > 0) {
      const current = queue.shift()!;
      const stmt = db.prepare('SELECT id FROM folders WHERE parent_id = ?');
      stmt.bind([current]);

      while (stmt.step()) {
        const row = stmt.getAsObject() as { id: string };
        result.push(row.id);
        queue.push(row.id);
      }
      stmt.free();
    }

    return result;
  }

  searchByName(query: string): Folder[] {
    const db = getDatabase();
    if (!db) throw new Error('Database not open');

    const pattern = `%${query}%`;
    const stmt = db.prepare('SELECT * FROM folders WHERE name LIKE ? LIMIT 20');
    stmt.bind([pattern]);

    const results: Folder[] = [];
    while (stmt.step()) {
      const row = stmt.getAsObject() as Record<string, unknown>;
      results.push(this.rowToFolder(row));
    }

    stmt.free();
    return results;
  }

  /**
   * Check if a folder with the same name (case-insensitive) exists in the same parent.
   * Uses normalizeForComparison for Unicode-aware comparison.
   * @param parentId - The parent folder ID (null for root level)
   * @param name - The folder name to check
   * @param excludeId - Optional folder ID to exclude (for rename operations)
   * @returns true if a duplicate exists, false otherwise
   */
  existsByParentIdAndName(
    parentId: string | null,
    name: string,
    excludeId?: string,
  ): boolean {
    const db = getDatabase();
    if (!db) throw new Error('Database not open');

    const normalizedInput = normalizeForComparison(name);
    let stmt;

    if (parentId) {
      stmt = db.prepare('SELECT id, name FROM folders WHERE parent_id = ?');
      stmt.bind([parentId]);
    } else {
      stmt = db.prepare('SELECT id, name FROM folders WHERE parent_id IS NULL');
      stmt.bind([]);
    }

    let duplicateFound = false;
    while (stmt.step()) {
      const row = stmt.getAsObject() as { id: string; name: string };
      if (excludeId && row.id === excludeId) continue;
      if (normalizeForComparison(row.name) === normalizedInput) {
        duplicateFound = true;
        break;
      }
    }
    stmt.free();

    return duplicateFound;
  }

  private getParentChain(folderId: string): string[] {
    const db = getDatabase();
    if (!db) throw new Error('Database not open');

    const chain: string[] = [];
    let currentId: string | null = folderId;

    while (currentId) {
      const stmt = db.prepare('SELECT id, name, parent_id FROM folders WHERE id = ?');
      stmt.bind([currentId]);

      if (stmt.step()) {
        const row = stmt.getAsObject() as { id: string; name: string; parent_id: string | null };
        chain.unshift(row.name);
        currentId = row.parent_id;
      } else {
        currentId = null;
      }

      stmt.free();
    }

    return chain;
  }

  private buildTree(folders: Folder[]): Folder[] {
    const map = new Map<string, Folder>();
    const roots: Folder[] = [];

    for (const folder of folders) {
      map.set(folder.id, { ...folder, children: [] });
    }

    for (const folder of folders) {
      const node = map.get(folder.id)!;
      if (folder.parentId && map.has(folder.parentId)) {
        map.get(folder.parentId)!.children!.push(node);
      } else {
        roots.push(node);
      }
    }

    return roots;
  }

  private rowToFolder(row: Record<string, unknown>): Folder {
    return {
      id: row.id as string,
      parentId: (row.parent_id as string) ?? null,
      name: row.name as string,
      emoji: (row.emoji as string) ?? null,
      coverImage: (row.cover_image as string) ?? null,
      createdAt: row.created_at as number,
      updatedAt: row.updated_at as number,
      sortOrder: (row.sort_order as number) ?? 0,
    };
  }
}
