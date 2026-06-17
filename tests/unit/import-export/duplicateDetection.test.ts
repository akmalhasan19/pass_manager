import { describe, it, expect } from 'vitest';
import {
  detectDuplicates,
  buildExistingItemRefs,
  applyResolutionMap,
  type ExistingItemRef,
} from '../../../src/main/import-export/duplicateDetection';
import { createImportItem } from '../../../src/main/import-export/importer';
import type {
  ImportItem,
  ImportPayload,
  DuplicateResolutionMap,
} from '../../../src/shared/types';

function makeItem(
  overrides: Partial<ImportItem> & { title: string; username: string; password: string },
): ImportItem {
  return createImportItem(overrides);
}

function makeExisting(id: string, title: string, url: string): ExistingItemRef {
  return { id, title, url };
}

describe('detectDuplicates', () => {
  it('should return empty report when no duplicates', () => {
    const importItems = [
      makeItem({ title: 'A', username: 'u1', password: 'p1', url: 'https://a.com' }),
      makeItem({ title: 'B', username: 'u2', password: 'p2', url: 'https://b.com' }),
    ];
    const existing = [
      makeExisting('e1', 'C', 'https://c.com'),
      makeExisting('e2', 'D', 'https://d.com'),
    ];

    const report = detectDuplicates(importItems, existing);
    expect(report.duplicates).toHaveLength(0);
    expect(report.totalImportItems).toBe(2);
    expect(report.uniqueItems).toBe(2);
  });

  it('should detect duplicates by title + url combination', () => {
    const importItems = [
      makeItem({ title: 'Twitter', username: 'u1', password: 'p1', url: 'https://twitter.com' }),
      makeItem({ title: 'GitHub', username: 'u2', password: 'p2', url: 'https://github.com' }),
    ];
    const existing = [
      makeExisting('e1', 'Twitter', 'https://twitter.com'),
    ];

    const report = detectDuplicates(importItems, existing);
    expect(report.duplicates).toHaveLength(1);
    expect(report.duplicates[0].importItemIndex).toBe(0);
    expect(report.duplicates[0].importItemTitle).toBe('Twitter');
    expect(report.duplicates[0].existingItemId).toBe('e1');
    expect(report.uniqueItems).toBe(1);
  });

  it('should be case-insensitive for title and url', () => {
    const importItems = [
      makeItem({ title: 'TWITTER', username: 'u1', password: 'p1', url: 'HTTPS://TWITTER.COM' }),
    ];
    const existing = [
      makeExisting('e1', 'twitter', 'https://twitter.com'),
    ];

    const report = detectDuplicates(importItems, existing);
    expect(report.duplicates).toHaveLength(1);
  });

  it('should detect multiple duplicates', () => {
    const importItems = [
      makeItem({ title: 'A', username: 'u1', password: 'p1', url: 'https://a.com' }),
      makeItem({ title: 'B', username: 'u2', password: 'p2', url: 'https://b.com' }),
      makeItem({ title: 'C', username: 'u3', password: 'p3', url: 'https://c.com' }),
    ];
    const existing = [
      makeExisting('e1', 'A', 'https://a.com'),
      makeExisting('e2', 'B', 'https://b.com'),
    ];

    const report = detectDuplicates(importItems, existing);
    expect(report.duplicates).toHaveLength(2);
    expect(report.totalImportItems).toBe(3);
    expect(report.uniqueItems).toBe(1);
  });

  it('should not consider different urls as duplicates even if same title', () => {
    const importItems = [
      makeItem({ title: 'My Account', username: 'u1', password: 'p1', url: 'https://site1.com' }),
    ];
    const existing = [
      makeExisting('e1', 'My Account', 'https://site2.com'),
    ];

    const report = detectDuplicates(importItems, existing);
    expect(report.duplicates).toHaveLength(0);
  });

  it('should handle empty import items', () => {
    const report = detectDuplicates([], [makeExisting('e1', 'A', 'https://a.com')]);
    expect(report.duplicates).toHaveLength(0);
    expect(report.totalImportItems).toBe(0);
    expect(report.uniqueItems).toBe(0);
  });

  it('should handle empty existing items', () => {
    const items = [
      makeItem({ title: 'A', username: 'u', password: 'p', url: 'https://a.com' }),
    ];
    const report = detectDuplicates(items, []);
    expect(report.duplicates).toHaveLength(0);
  });
});

describe('buildExistingItemRefs', () => {
  it('should convert Item array to ExistingItemRef array', () => {
    const dbItems = [
      { id: '1', title: 'A', url: 'https://a.com' } as unknown as Item,
      { id: '2', title: 'B', url: 'https://b.com' } as unknown as Item,
    ];

    const refs = buildExistingItemRefs(dbItems);
    expect(refs).toHaveLength(2);
    expect(refs[0].id).toBe('1');
    expect(refs[0].title).toBe('A');
    expect(refs[0].url).toBe('https://a.com');
  });
});

describe('applyResolutionMap', () => {
  function makePayload(items: ImportItem[]): ImportPayload {
    return { folders: [], items, tags: [], attachments: [] };
  }

  it('should skip duplicate items when resolution is skip', () => {
    const items = [
      makeItem({ title: 'A', username: 'u', password: 'p', url: 'https://a.com' }),
      makeItem({ title: 'B', username: 'u', password: 'p', url: 'https://b.com' }),
    ];
    const payload = makePayload(items);

    const map: DuplicateResolutionMap = {
      items: [
        {
          importItemIndex: 0,
          importItemTitle: 'A',
          importItemUrl: 'https://a.com',
          existingItemId: 'e1',
          existingItemTitle: 'A',
          existingItemUrl: 'https://a.com',
        },
      ],
      globalResolution: 'skip',
      perItemResolutions: {},
    };

    const result = applyResolutionMap(payload, map);
    expect(result.items).toHaveLength(1);
    expect(result.items[0].title).toBe('B');
  });

  it('should keep all items when resolution is replace', () => {
    const items = [
      makeItem({ title: 'A', username: 'u', password: 'p', url: 'https://a.com' }),
      makeItem({ title: 'B', username: 'u', password: 'p', url: 'https://b.com' }),
    ];
    const payload = makePayload(items);

    const map: DuplicateResolutionMap = {
      items: [
        {
          importItemIndex: 0,
          importItemTitle: 'A',
          importItemUrl: 'https://a.com',
          existingItemId: 'e1',
          existingItemTitle: 'A',
          existingItemUrl: 'https://a.com',
        },
      ],
      globalResolution: 'replace',
      perItemResolutions: {},
    };

    const result = applyResolutionMap(payload, map);
    expect(result.items).toHaveLength(2);
  });

  it('should rename duplicate items by appending suffix', () => {
    const items = [
      makeItem({ title: 'A', username: 'u', password: 'p', url: 'https://a.com' }),
      makeItem({ title: 'B', username: 'u', password: 'p', url: 'https://b.com' }),
    ];
    const payload = makePayload(items);

    const map: DuplicateResolutionMap = {
      items: [
        {
          importItemIndex: 0,
          importItemTitle: 'A',
          importItemUrl: 'https://a.com',
          existingItemId: 'e1',
          existingItemTitle: 'A',
          existingItemUrl: 'https://a.com',
        },
      ],
      globalResolution: 'rename',
      perItemResolutions: {},
    };

    const result = applyResolutionMap(payload, map);
    expect(result.items).toHaveLength(2);
    expect(result.items[0].title).toBe('A (2)');
    expect(result.items[1].title).toBe('B');
  });

  it('should use per-item resolution over global', () => {
    const items = [
      makeItem({ title: 'A', username: 'u', password: 'p', url: 'https://a.com' }),
      makeItem({ title: 'B', username: 'u', password: 'p', url: 'https://b.com' }),
    ];
    const payload = makePayload(items);

    const map: DuplicateResolutionMap = {
      items: [
        {
          importItemIndex: 0,
          importItemTitle: 'A',
          importItemUrl: 'https://a.com',
          existingItemId: 'e1',
          existingItemTitle: 'A',
          existingItemUrl: 'https://a.com',
        },
        {
          importItemIndex: 1,
          importItemTitle: 'B',
          importItemUrl: 'https://b.com',
          existingItemId: 'e2',
          existingItemTitle: 'B',
          existingItemUrl: 'https://b.com',
        },
      ],
      globalResolution: 'skip',
      perItemResolutions: {
        1: 'rename',
      },
    };

    const result = applyResolutionMap(payload, map);
    expect(result.items).toHaveLength(1);
    expect(result.items[0].title).toBe('B (2)');
  });

  it('should handle no duplicates with empty items array', () => {
    const items = [
      makeItem({ title: 'A', username: 'u', password: 'p', url: 'https://a.com' }),
    ];
    const payload = makePayload(items);

    const map: DuplicateResolutionMap = {
      items: [],
      globalResolution: 'skip',
      perItemResolutions: {},
    };

    const result = applyResolutionMap(payload, map);
    expect(result.items).toHaveLength(1);
    expect(result.items[0].title).toBe('A');
  });
});
