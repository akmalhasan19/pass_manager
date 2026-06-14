import { getDatabase } from '../connection';
import { Attachment } from '../../../shared/types';
import { nanoid } from 'nanoid';

export class FileAttachmentRepository {
  create(
    itemId: string | null,
    folderId: string | null,
    fileName: string,
    mimeType: string,
    fileSize: number,
    storagePath: string,
  ): Attachment {
    const db = getDatabase();
    if (!db) throw new Error('Database not open');

    const id = nanoid();
    const now = Date.now();

    db.run(
      `INSERT INTO attachments (id, item_id, folder_id, file_name, mime_type, file_size, storage_path, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, itemId, folderId, fileName, mimeType, fileSize, storagePath, now],
    );

    return this.getById(id)!;
  }

  getById(id: string): Attachment | null {
    const db = getDatabase();
    if (!db) throw new Error('Database not open');

    const stmt = db.prepare('SELECT * FROM attachments WHERE id = ?');
    stmt.bind([id]);

    if (stmt.step()) {
      const row = stmt.getAsObject() as Record<string, unknown>;
      stmt.free();
      return {
        id: row.id as string,
        itemId: (row.item_id as string) ?? null,
        folderId: (row.folder_id as string) ?? null,
        fileName: row.file_name as string,
        mimeType: (row.mime_type as string) ?? 'application/octet-stream',
        fileSize: row.file_size as number,
        storagePath: row.storage_path as string,
        createdAt: row.created_at as number,
      };
    }

    stmt.free();
    return null;
  }

  getByItem(itemId: string): Attachment[] {
    const db = getDatabase();
    if (!db) throw new Error('Database not open');

    const stmt = db.prepare(
      'SELECT * FROM attachments WHERE item_id = ? ORDER BY created_at ASC',
    );
    stmt.bind([itemId]);

    const attachments: Attachment[] = [];
    while (stmt.step()) {
      const row = stmt.getAsObject() as Record<string, unknown>;
      attachments.push({
        id: row.id as string,
        itemId: (row.item_id as string) ?? null,
        folderId: (row.folder_id as string) ?? null,
        fileName: row.file_name as string,
        mimeType: (row.mime_type as string) ?? 'application/octet-stream',
        fileSize: row.file_size as number,
        storagePath: row.storage_path as string,
        createdAt: row.created_at as number,
      });
    }

    stmt.free();
    return attachments;
  }

  delete(id: string): Attachment | null {
    const attachment = this.getById(id);
    if (!attachment) return null;

    const db = getDatabase();
    if (!db) throw new Error('Database not open');

    db.run('DELETE FROM attachments WHERE id = ?', [id]);
    return attachment;
  }
}
