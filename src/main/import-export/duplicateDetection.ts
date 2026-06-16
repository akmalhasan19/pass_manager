import type {
  ImportItem,
  ImportPayload,
  DuplicateInfo,
  DuplicateReport,
  DuplicateResolution,
  DuplicateResolutionMap,
  Item,
} from '../../shared/types';

export interface ExistingItemRef {
  id: string;
  title: string;
  url: string;
}

export function detectDuplicates(
  importItems: ImportItem[],
  existingItems: ExistingItemRef[],
): DuplicateReport {
  const duplicates: DuplicateInfo[] = [];

  const existingMap = new Map<string, ExistingItemRef[]>();
  for (const existing of existingItems) {
    const key = buildKey(existing.title, existing.url);
    const list = existingMap.get(key) ?? [];
    list.push(existing);
    existingMap.set(key, list);
  }

  for (let i = 0; i < importItems.length; i++) {
    const item = importItems[i];
    const key = buildKey(item.title, item.url);
    const matches = existingMap.get(key);

    if (matches && matches.length > 0) {
      for (const match of matches) {
        duplicates.push({
          importItemIndex: i,
          importItemTitle: item.title,
          importItemUrl: item.url,
          existingItemId: match.id,
          existingItemTitle: match.title,
          existingItemUrl: match.url,
        });
      }
    }
  }

  return {
    duplicates,
    totalImportItems: importItems.length,
    uniqueItems: importItems.length - new Set(duplicates.map((d) => d.importItemIndex)).size,
  };
}

function buildKey(title: string, url: string): string {
  return `${title.toLowerCase().trim()}|${url.toLowerCase().trim()}`;
}

export function buildExistingItemRefs(dbItems: Item[]): ExistingItemRef[] {
  return dbItems.map((item) => ({
    id: item.id,
    title: item.title,
    url: item.url,
  }));
}

export function applyResolutionMap(
  payload: ImportPayload,
  resolutionMap: DuplicateResolutionMap,
): ImportPayload {
  const { items, globalResolution, perItemResolutions } = resolutionMap;

  const duplicateIndexes = new Set(items.map((d) => d.importItemIndex));
  const resolutionByIndex = new Map<number, DuplicateResolution>();

  for (const [indexStr, resolution] of Object.entries(perItemResolutions)) {
    resolutionByIndex.set(Number(indexStr), resolution);
  }

  const modifiedItems: ImportItem[] = [];
  const skippedIndexes = new Set<number>();

  for (const dup of items) {
    const resolution = resolutionByIndex.get(dup.importItemIndex) ?? globalResolution;

    switch (resolution) {
      case 'skip':
        skippedIndexes.add(dup.importItemIndex);
        break;
      case 'rename':
        break;
      case 'replace':
        break;
    }
  }

  for (let i = 0; i < payload.items.length; i++) {
    if (skippedIndexes.has(i)) continue;

    const item = { ...payload.items[i] };
    const resolution = resolutionByIndex.get(i) ?? globalResolution;
    const dup = items.find((d) => d.importItemIndex === i);

    if (resolution === 'rename' && dup) {
      item.title = appendSuffix(item.title, payload.items);
    }

    modifiedItems.push(item);
  }

  return {
    folders: [...payload.folders],
    items: modifiedItems,
    tags: [...payload.tags],
    attachments: [...payload.attachments],
  };
}

function appendSuffix(title: string, allItems: ImportItem[]): string {
  const existingTitles = new Set(allItems.map((i) => i.title.toLowerCase()));
  let counter = 2;
  let newTitle = `${title} (${counter})`;
  while (existingTitles.has(newTitle.toLowerCase())) {
    counter++;
    newTitle = `${title} (${counter})`;
  }
  return newTitle;
}
