import { nanoid } from 'nanoid';
import type { ExportPayload } from '../../shared/types';

export interface UuidMap {
  folders: Map<string, string>;
  items: Map<string, string>;
  tags: Map<string, string>;
}

export interface CollisionReport {
  folders: string[];
  items: string[];
  tags: string[];
}

export function createUuidMap(): UuidMap {
  return {
    folders: new Map(),
    items: new Map(),
    tags: new Map(),
  };
}

export function detectCollisions(
  payload: ExportPayload,
  existingFolderIds: Set<string>,
  existingItemIds: Set<string>,
  existingTagIds: Set<string>,
): CollisionReport {
  const collisions: CollisionReport = {
    folders: [],
    items: [],
    tags: [],
  };

  for (const folder of payload.folders) {
    if (existingFolderIds.has(folder.id)) {
      collisions.folders.push(folder.id);
    }
  }

  for (const item of payload.items) {
    if (existingItemIds.has(item.id)) {
      collisions.items.push(item.id);
    }
  }

  for (const tag of payload.tags) {
    if (existingTagIds.has(tag.id)) {
      collisions.tags.push(tag.id);
    }
  }

  return collisions;
}

export function buildImportIdMapping(
  payload: ExportPayload,
  collisions: CollisionReport,
): UuidMap {
  const map = createUuidMap();

  const collisionFolderSet = new Set(collisions.folders);
  const collisionItemSet = new Set(collisions.items);
  const collisionTagSet = new Set(collisions.tags);

  for (const folder of payload.folders) {
    map.folders.set(folder.id, collisionFolderSet.has(folder.id) ? nanoid() : folder.id);
  }

  for (const item of payload.items) {
    map.items.set(item.id, collisionItemSet.has(item.id) ? nanoid() : item.id);
  }

  for (const tag of payload.tags) {
    map.tags.set(tag.id, collisionTagSet.has(tag.id) ? nanoid() : tag.id);
  }

  return map;
}

export function resolveFolderId(folderId: string, map: UuidMap): string {
  return map.folders.get(folderId) ?? folderId;
}

export function resolveItemId(itemId: string, map: UuidMap): string {
  return map.items.get(itemId) ?? itemId;
}

export function resolveTagId(tagId: string, map: UuidMap): string {
  return map.tags.get(tagId) ?? tagId;
}

export function remapFolderReferences(
  folders: ExportPayload['folders'],
  map: UuidMap,
): ExportPayload['folders'] {
  return folders.map((folder) => ({
    ...folder,
    id: resolveFolderId(folder.id, map),
    parentId: folder.parentId ? resolveFolderId(folder.parentId, map) : null,
  }));
}

export function remapItemReferences(
  items: ExportPayload['items'],
  map: UuidMap,
): ExportPayload['items'] {
  return items.map((item) => ({
    ...item,
    id: resolveItemId(item.id, map),
    folderId: resolveFolderId(item.folderId, map),
    tagIds: item.tagIds.map((tagId) => resolveTagId(tagId, map)),
  }));
}

export function remapTagReferences(
  tags: ExportPayload['tags'],
  map: UuidMap,
): ExportPayload['tags'] {
  return tags.map((tag) => ({
    ...tag,
    id: resolveTagId(tag.id, map),
  }));
}

export function remapAttachmentReferences(
  attachments: ExportPayload['attachments'],
  map: UuidMap,
): ExportPayload['attachments'] {
  return attachments.map((att) => ({
    ...att,
    id: nanoid(),
    itemId: att.itemId ? resolveItemId(att.itemId, map) : null,
    folderId: att.folderId ? resolveFolderId(att.folderId, map) : null,
  }));
}
