import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../shared/ipcChannels';
import type { SearchResultItem, Folder } from '../../shared/types';
import { FolderRepository } from '../database/repositories/FolderRepository';
import { ItemRepository } from '../database/repositories/ItemRepository';
import { TagRepository } from '../database/repositories/TagRepository';
import { isDatabaseOpen, getDatabase } from '../database/connection';

const folderRepo = new FolderRepository();
const itemRepo = new ItemRepository();
const tagRepo = new TagRepository();

function buildBreadcrumb(folderId: string | null, flatFolders: Map<string, Folder>): string {
  const parts: string[] = [];
  let currentId: string | null = folderId;

  while (currentId) {
    const f = flatFolders.get(currentId);
    if (!f) break;
    parts.unshift(f.name);
    currentId = f.parentId;
  }

  return parts.length > 0 ? parts.join(' > ') : 'Home';
}

export function registerSearchHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.ITEM_SEARCH, (_event, { query }: { query: string }) => {
    try {
      if (!isDatabaseOpen()) {
        return { success: false, error: 'Database is not open.' };
      }

      if (!query || query.trim().length === 0) {
        return { success: true, data: [] };
      }

      const trimmedQuery = query.trim();
      const results: SearchResultItem[] = [];

      const allFolders = folderRepo.getFlatList();
      const folderMap = new Map<string, Folder>();
      for (const f of allFolders) {
        folderMap.set(f.id, f);
      }

      const matchedFolders = folderRepo.searchByName(trimmedQuery);
      for (const folder of matchedFolders) {
        results.push({
          type: 'folder',
          id: folder.id,
          title: folder.name,
          subtitle: `${folder.emoji ?? ''} Folder`.trim(),
          emoji: folder.emoji,
          breadcrumb: buildBreadcrumb(folder.parentId, folderMap),
        });
      }

      const matchedItems = itemRepo.search(trimmedQuery);
      for (const item of matchedItems) {
        results.push({
          type: 'item',
          id: item.id,
          title: item.title,
          subtitle: item.username || item.url || 'No details',
          emoji: item.emoji,
          breadcrumb: buildBreadcrumb(item.folderId, folderMap),
        });
      }

      results.sort((a, b) => {
        const typeOrder: Record<string, number> = { folder: 0, item: 1, tag: 2 };
        const aOrder = typeOrder[a.type] ?? 0;
        const bOrder = typeOrder[b.type] ?? 0;
        if (aOrder !== bOrder) return aOrder - bOrder;
        return a.title.localeCompare(b.title);
      });

      const sliced = results.slice(0, 20);
      return { success: true, data: sliced };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  });

  ipcMain.handle(IPC_CHANNELS.ITEM_SEARCH_BY_TAG, (_event, { tagId }: { tagId: string }) => {
    try {
      if (!isDatabaseOpen()) {
        return { success: false, error: 'Database is not open.' };
      }

      const tag = tagRepo.getById(tagId);
      if (!tag) {
        return { success: false, error: 'Tag not found.' };
      }

      const db = getDatabase();
      if (!db) {
        return { success: false, error: 'Database not available.' };
      }

      const stmt = db.prepare(
        `SELECT items.* FROM items
           JOIN item_tags ON items.id = item_tags.item_id
           WHERE item_tags.tag_id = ?
           ORDER BY items.sort_order ASC`,
      );
      stmt.bind([tagId]);

      const itemIds: string[] = [];
      while (stmt.step()) {
        const row = stmt.getAsObject() as { id: string };
        itemIds.push(row.id);
      }
      stmt.free();

      const allFolders = folderRepo.getFlatList();
      const folderMap = new Map<string, Folder>();
      for (const f of allFolders) {
        folderMap.set(f.id, f);
      }

      const results: SearchResultItem[] = [];
      for (const itemId of itemIds) {
        const item = itemRepo.getById(itemId);
        if (!item) continue;

        results.push({
          type: 'item',
          id: item.id,
          title: item.title,
          subtitle: `#${tag.name} — ${item.username || item.url || 'No details'}`,
          emoji: item.emoji,
          breadcrumb: buildBreadcrumb(item.folderId, folderMap),
        });
      }

      return { success: true, data: results };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  });
}
