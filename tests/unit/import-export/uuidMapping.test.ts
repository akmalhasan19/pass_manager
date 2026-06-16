import { describe, it, expect } from 'vitest';
import {
  detectCollisions,
  buildImportIdMapping,
  remapFolderReferences,
  remapItemReferences,
  remapTagReferences,
  remapAttachmentReferences,
  resolveFolderId,
  resolveItemId,
  resolveTagId,
  type CollisionReport,
  type UuidMap,
} from '../../../src/main/import-export/uuidMapping';
import type { ExportPayload } from '../../../src/shared/types';

function makePayload(overrides?: Partial<ExportPayload>): ExportPayload {
  return {
    formatVersion: 1,
    metadata: {
      appName: 'SecurePass Manager',
      appVersion: '0.1.0',
      exportedAt: 1000000,
      formatVersion: 1,
      schemaVersion: 1,
      itemCount: 0,
      folderCount: 0,
      tagCount: 0,
      attachmentCount: 0,
    },
    folders: [],
    items: [],
    tags: [],
    attachments: [],
    ...overrides,
  };
}

describe('detectCollisions', () => {
  it('should return empty report when no collisions exist', () => {
    const payload = makePayload({
      folders: [{ id: 'f1', parentId: null, name: 'A', emoji: null, coverImage: null, createdAt: 1, updatedAt: 1, sortOrder: 0 }],
      items: [{ id: 'i1', folderId: 'f1', title: 'T', username: 'u', passwordEncrypted: null, url: '', notesEncrypted: null, emoji: null, coverImage: null, createdAt: 1, updatedAt: 1, isFavorite: false, sortOrder: 0, tagIds: [] }],
      tags: [{ id: 't1', name: 'tag1', color: '#ff0000' }],
    });

    const result = detectCollisions(payload, new Set(), new Set(), new Set());
    expect(result).toEqual({ folders: [], items: [], tags: [] });
  });

  it('should detect folder collisions', () => {
    const payload = makePayload({
      folders: [
        { id: 'f1', parentId: null, name: 'A', emoji: null, coverImage: null, createdAt: 1, updatedAt: 1, sortOrder: 0 },
        { id: 'f2', parentId: null, name: 'B', emoji: null, coverImage: null, createdAt: 1, updatedAt: 1, sortOrder: 0 },
      ],
    });

    const result = detectCollisions(payload, new Set(['f1']), new Set(), new Set());
    expect(result.folders).toEqual(['f1']);
    expect(result.items).toEqual([]);
    expect(result.tags).toEqual([]);
  });

  it('should detect item collisions', () => {
    const payload = makePayload({
      items: [{ id: 'i1', folderId: 'f1', title: 'T', username: 'u', passwordEncrypted: null, url: '', notesEncrypted: null, emoji: null, coverImage: null, createdAt: 1, updatedAt: 1, isFavorite: false, sortOrder: 0, tagIds: [] }],
    });

    const result = detectCollisions(payload, new Set(), new Set(['i1']), new Set());
    expect(result.items).toEqual(['i1']);
  });

  it('should detect tag collisions', () => {
    const payload = makePayload({
      tags: [{ id: 't1', name: 'tag1', color: '#ff0000' }],
    });

    const result = detectCollisions(payload, new Set(), new Set(), new Set(['t1']));
    expect(result.tags).toEqual(['t1']);
  });

  it('should detect mixed collisions', () => {
    const payload = makePayload({
      folders: [{ id: 'f1', parentId: null, name: 'A', emoji: null, coverImage: null, createdAt: 1, updatedAt: 1, sortOrder: 0 }],
      items: [{ id: 'i1', folderId: 'f1', title: 'T', username: 'u', passwordEncrypted: null, url: '', notesEncrypted: null, emoji: null, coverImage: null, createdAt: 1, updatedAt: 1, isFavorite: false, sortOrder: 0, tagIds: [] }],
      tags: [{ id: 't1', name: 'tag1', color: '#ff0000' }],
    });

    const result = detectCollisions(payload, new Set(['f1']), new Set(['i1']), new Set(['t1']));
    expect(result.folders).toEqual(['f1']);
    expect(result.items).toEqual(['i1']);
    expect(result.tags).toEqual(['t1']);
  });
});

describe('buildImportIdMapping', () => {
  it('should keep original IDs when no collisions', () => {
    const payload = makePayload({
      folders: [{ id: 'f1', parentId: null, name: 'A', emoji: null, coverImage: null, createdAt: 1, updatedAt: 1, sortOrder: 0 }],
      items: [{ id: 'i1', folderId: 'f1', title: 'T', username: 'u', passwordEncrypted: null, url: '', notesEncrypted: null, emoji: null, coverImage: null, createdAt: 1, updatedAt: 1, isFavorite: false, sortOrder: 0, tagIds: [] }],
      tags: [{ id: 't1', name: 'tag1', color: '#ff0000' }],
    });
    const collisions: CollisionReport = { folders: [], items: [], tags: [] };

    const map = buildImportIdMapping(payload, collisions);

    expect(map.folders.get('f1')).toBe('f1');
    expect(map.items.get('i1')).toBe('i1');
    expect(map.tags.get('t1')).toBe('t1');
  });

  it('should generate new IDs for colliding entities', () => {
    const payload = makePayload({
      folders: [{ id: 'f1', parentId: null, name: 'A', emoji: null, coverImage: null, createdAt: 1, updatedAt: 1, sortOrder: 0 }],
      items: [{ id: 'i1', folderId: 'f1', title: 'T', username: 'u', passwordEncrypted: null, url: '', notesEncrypted: null, emoji: null, coverImage: null, createdAt: 1, updatedAt: 1, isFavorite: false, sortOrder: 0, tagIds: [] }],
      tags: [{ id: 't1', name: 'tag1', color: '#ff0000' }],
    });
    const collisions: CollisionReport = { folders: ['f1'], items: ['i1'], tags: ['t1'] };

    const map = buildImportIdMapping(payload, collisions);

    expect(map.folders.get('f1')).not.toBe('f1');
    expect(map.folders.get('f1')).toBeDefined();
    expect(map.folders.get('f1')!.length).toBeGreaterThan(0);

    expect(map.items.get('i1')).not.toBe('i1');
    expect(map.items.get('i1')).toBeDefined();

    expect(map.tags.get('t1')).not.toBe('t1');
    expect(map.tags.get('t1')).toBeDefined();
  });

  it('should generate unique new IDs for each collision', () => {
    const payload = makePayload({
      folders: [
        { id: 'f1', parentId: null, name: 'A', emoji: null, coverImage: null, createdAt: 1, updatedAt: 1, sortOrder: 0 },
        { id: 'f2', parentId: null, name: 'B', emoji: null, coverImage: null, createdAt: 1, updatedAt: 1, sortOrder: 0 },
      ],
    });
    const collisions: CollisionReport = { folders: ['f1', 'f2'], items: [], tags: [] };

    const map = buildImportIdMapping(payload, collisions);

    const newId1 = map.folders.get('f1')!;
    const newId2 = map.folders.get('f2')!;
    expect(newId1).not.toBe(newId2);
  });

  it('should handle empty payload', () => {
    const payload = makePayload();
    const collisions: CollisionReport = { folders: [], items: [], tags: [] };

    const map = buildImportIdMapping(payload, collisions);

    expect(map.folders.size).toBe(0);
    expect(map.items.size).toBe(0);
    expect(map.tags.size).toBe(0);
  });
});

describe('resolveFolderId / resolveItemId / resolveTagId', () => {
  const map: UuidMap = {
    folders: new Map([['old_f1', 'new_f1']]),
    items: new Map([['old_i1', 'new_i1']]),
    tags: new Map([['old_t1', 'new_t1']]),
  };

  it('should resolve mapped folder IDs', () => {
    expect(resolveFolderId('old_f1', map)).toBe('new_f1');
  });

  it('should return original folder ID if not mapped', () => {
    expect(resolveFolderId('unknown_f', map)).toBe('unknown_f');
  });

  it('should resolve mapped item IDs', () => {
    expect(resolveItemId('old_i1', map)).toBe('new_i1');
  });

  it('should return original item ID if not mapped', () => {
    expect(resolveItemId('unknown_i', map)).toBe('unknown_i');
  });

  it('should resolve mapped tag IDs', () => {
    expect(resolveTagId('old_t1', map)).toBe('new_t1');
  });

  it('should return original tag ID if not mapped', () => {
    expect(resolveTagId('unknown_t', map)).toBe('unknown_t');
  });
});

describe('remapFolderReferences', () => {
  it('should remap folder IDs and parentId references', () => {
    const folders: ExportPayload['folders'] = [
      { id: 'f1', parentId: null, name: 'Root', emoji: null, coverImage: null, createdAt: 1, updatedAt: 1, sortOrder: 0 },
      { id: 'f2', parentId: 'f1', name: 'Child', emoji: null, coverImage: null, createdAt: 1, updatedAt: 1, sortOrder: 0 },
    ];
    const map: UuidMap = {
      folders: new Map([['f1', 'new_f1'], ['f2', 'new_f2']]),
      items: new Map(),
      tags: new Map(),
    };

    const result = remapFolderReferences(folders, map);

    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('new_f1');
    expect(result[0].parentId).toBeNull();
    expect(result[1].id).toBe('new_f2');
    expect(result[1].parentId).toBe('new_f1');
  });

  it('should preserve parentId null for root folders', () => {
    const folders: ExportPayload['folders'] = [
      { id: 'f1', parentId: null, name: 'Root', emoji: null, coverImage: null, createdAt: 1, updatedAt: 1, sortOrder: 0 },
    ];
    const map: UuidMap = {
      folders: new Map([['f1', 'new_f1']]),
      items: new Map(),
      tags: new Map(),
    };

    const result = remapFolderReferences(folders, map);
    expect(result[0].parentId).toBeNull();
  });

  it('should handle folders without ID mapping (pass-through)', () => {
    const folders: ExportPayload['folders'] = [
      { id: 'f1', parentId: null, name: 'Root', emoji: null, coverImage: null, createdAt: 1, updatedAt: 1, sortOrder: 0 },
    ];
    const map: UuidMap = {
      folders: new Map(),
      items: new Map(),
      tags: new Map(),
    };

    const result = remapFolderReferences(folders, map);
    expect(result[0].id).toBe('f1');
  });
});

describe('remapItemReferences', () => {
  it('should remap item IDs, folderId and tagIds', () => {
    const items: ExportPayload['items'] = [
      { id: 'i1', folderId: 'f1', title: 'T', username: 'u', passwordEncrypted: null, url: '', notesEncrypted: null, emoji: null, coverImage: null, createdAt: 1, updatedAt: 1, isFavorite: false, sortOrder: 0, tagIds: ['t1', 't2'] },
    ];
    const map: UuidMap = {
      folders: new Map([['f1', 'new_f1']]),
      items: new Map([['i1', 'new_i1']]),
      tags: new Map([['t1', 'new_t1'], ['t2', 'new_t2']]),
    };

    const result = remapItemReferences(items, map);

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('new_i1');
    expect(result[0].folderId).toBe('new_f1');
    expect(result[0].tagIds).toEqual(['new_t1', 'new_t2']);
  });

  it('should preserve tagIds order', () => {
    const items: ExportPayload['items'] = [
      { id: 'i1', folderId: 'f1', title: 'T', username: 'u', passwordEncrypted: null, url: '', notesEncrypted: null, emoji: null, coverImage: null, createdAt: 1, updatedAt: 1, isFavorite: false, sortOrder: 0, tagIds: ['t3', 't1', 't2'] },
    ];
    const map: UuidMap = {
      folders: new Map([['f1', 'new_f1']]),
      items: new Map([['i1', 'new_i1']]),
      tags: new Map([['t1', 'nt1'], ['t2', 'nt2'], ['t3', 'nt3']]),
    };

    const result = remapItemReferences(items, map);
    expect(result[0].tagIds).toEqual(['nt3', 'nt1', 'nt2']);
  });

  it('should handle empty tagIds', () => {
    const items: ExportPayload['items'] = [
      { id: 'i1', folderId: 'f1', title: 'T', username: 'u', passwordEncrypted: null, url: '', notesEncrypted: null, emoji: null, coverImage: null, createdAt: 1, updatedAt: 1, isFavorite: false, sortOrder: 0, tagIds: [] },
    ];
    const map: UuidMap = {
      folders: new Map([['f1', 'new_f1']]),
      items: new Map([['i1', 'new_i1']]),
      tags: new Map(),
    };

    const result = remapItemReferences(items, map);
    expect(result[0].tagIds).toEqual([]);
  });
});

describe('remapTagReferences', () => {
  it('should remap tag IDs', () => {
    const tags: ExportPayload['tags'] = [
      { id: 't1', name: 'tag1', color: '#ff0000' },
      { id: 't2', name: 'tag2', color: '#00ff00' },
    ];
    const map: UuidMap = {
      folders: new Map(),
      items: new Map(),
      tags: new Map([['t1', 'new_t1'], ['t2', 'new_t2']]),
    };

    const result = remapTagReferences(tags, map);

    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('new_t1');
    expect(result[0].name).toBe('tag1');
    expect(result[1].id).toBe('new_t2');
    expect(result[1].name).toBe('tag2');
  });

  it('should preserve tag metadata', () => {
    const tags: ExportPayload['tags'] = [
      { id: 't1', name: 'Important', color: '#ff6600' },
    ];
    const map: UuidMap = {
      folders: new Map(),
      items: new Map(),
      tags: new Map([['t1', 'new_t1']]),
    };

    const result = remapTagReferences(tags, map);
    expect(result[0].name).toBe('Important');
    expect(result[0].color).toBe('#ff6600');
  });
});

describe('remapAttachmentReferences', () => {
  it('should generate new IDs for attachments and remap references', () => {
    const attachments: ExportPayload['attachments'] = [
      { id: 'a1', itemId: 'i1', folderId: null, fileName: 'doc.pdf', mimeType: 'application/pdf', fileSize: 100, dataEncrypted: 'base64data', createdAt: 1 },
      { id: 'a2', itemId: null, folderId: 'f1', fileName: 'img.png', mimeType: 'image/png', fileSize: 200, dataEncrypted: 'base64data', createdAt: 2 },
    ];
    const map: UuidMap = {
      folders: new Map([['f1', 'new_f1']]),
      items: new Map([['i1', 'new_i1']]),
      tags: new Map(),
    };

    const result = remapAttachmentReferences(attachments, map);

    expect(result).toHaveLength(2);
    expect(result[0].id).not.toBe('a1');
    expect(result[0].id).toBeDefined();
    expect(result[0].itemId).toBe('new_i1');
    expect(result[0].folderId).toBeNull();

    expect(result[1].id).not.toBe('a2');
    expect(result[1].itemId).toBeNull();
    expect(result[1].folderId).toBe('new_f1');
  });

  it('should preserve attachment metadata', () => {
    const attachments: ExportPayload['attachments'] = [
      { id: 'a1', itemId: 'i1', folderId: null, fileName: 'report.pdf', mimeType: 'application/pdf', fileSize: 5000, dataEncrypted: 'encdata', createdAt: 100 },
    ];
    const map: UuidMap = {
      folders: new Map(),
      items: new Map([['i1', 'new_i1']]),
      tags: new Map(),
    };

    const result = remapAttachmentReferences(attachments, map);
    expect(result[0].fileName).toBe('report.pdf');
    expect(result[0].mimeType).toBe('application/pdf');
    expect(result[0].fileSize).toBe(5000);
    expect(result[0].dataEncrypted).toBe('encdata');
    expect(result[0].createdAt).toBe(100);
  });

  it('should handle null itemId and folderId', () => {
    const attachments: ExportPayload['attachments'] = [
      { id: 'a1', itemId: null, folderId: null, fileName: 'orphan.bin', mimeType: 'application/octet-stream', fileSize: 0, dataEncrypted: '', createdAt: 0 },
    ];
    const map: UuidMap = {
      folders: new Map(),
      items: new Map(),
      tags: new Map(),
    };

    const result = remapAttachmentReferences(attachments, map);
    expect(result[0].itemId).toBeNull();
    expect(result[0].folderId).toBeNull();
  });
});
