import type {
  ImportPayload,
  ImportFolder,
  ImportItem,
  ImportTag,
  ImportAttachment,
  ImportFormat,
} from '../../shared/types';
import { sanitizePayload } from './sanitizer';

export class ImportError extends Error {
  public readonly code: string;
  public readonly context: Record<string, unknown>;

  constructor(message: string, code: string, context: Record<string, unknown> = {}) {
    super(message);
    this.name = 'ImportError';
    this.code = code;
    this.context = context;
  }
}

export class ImportFormatError extends ImportError {
  constructor(message: string, context: Record<string, unknown> = {}) {
    super(message, 'IMPORT_FORMAT_ERROR', context);
    this.name = 'ImportFormatError';
  }
}

export class ImportParseError extends ImportError {
  constructor(
    message: string,
    public readonly line?: number,
    context: Record<string, unknown> = {},
  ) {
    super(message, 'IMPORT_PARSE_ERROR', { ...context, line });
    this.name = 'ImportParseError';
  }
}

export interface Importer {
  readonly format: ImportFormat;
  parse(content: string): ImportPayload;
}

export function createImportPayload(): ImportPayload {
  return {
    folders: [],
    items: [],
    tags: [],
    attachments: [],
  };
}

export function createImportFolder(
  overrides: Partial<ImportFolder> & { name: string },
): ImportFolder {
  const now = Date.now();
  return {
    id: overrides.id ?? '',
    parentId: overrides.parentId ?? null,
    name: overrides.name,
    emoji: overrides.emoji ?? null,
    coverImage: overrides.coverImage ?? null,
    createdAt: overrides.createdAt ?? now,
    updatedAt: overrides.updatedAt ?? now,
    sortOrder: overrides.sortOrder ?? 0,
  };
}

export function createImportItem(
  overrides: Partial<ImportItem> & { title: string; username: string; password: string },
): ImportItem {
  const now = Date.now();
  return {
    id: overrides.id ?? '',
    folderId: overrides.folderId ?? '',
    title: overrides.title,
    username: overrides.username,
    password: overrides.password,
    url: overrides.url ?? '',
    notes: overrides.notes ?? null,
    emoji: overrides.emoji ?? null,
    coverImage: overrides.coverImage ?? null,
    createdAt: overrides.createdAt ?? now,
    updatedAt: overrides.updatedAt ?? now,
    isFavorite: overrides.isFavorite ?? false,
    sortOrder: overrides.sortOrder ?? 0,
    tagIds: overrides.tagIds ?? [],
  };
}

export function createImportTag(
  overrides: Partial<ImportTag> & { name: string },
): ImportTag {
  return {
    id: overrides.id ?? '',
    name: overrides.name,
    color: overrides.color ?? '#6366f1',
  };
}

export function createImportAttachment(
  overrides: Partial<ImportAttachment> & { fileName: string; rawData: Buffer },
): ImportAttachment {
  return {
    id: overrides.id ?? '',
    itemId: overrides.itemId ?? null,
    folderId: overrides.folderId ?? null,
    fileName: overrides.fileName,
    mimeType: overrides.mimeType ?? 'application/octet-stream',
    fileSize: overrides.fileSize ?? overrides.rawData.length,
    rawData: overrides.rawData,
    createdAt: overrides.createdAt ?? Date.now(),
  };
}

export const importPayloadKeys: (keyof ImportPayload)[] = [
  'folders',
  'items',
  'tags',
  'attachments',
];

function validateNotEmpty(payload: ImportPayload): void {
  const total =
    payload.folders.length +
    payload.items.length +
    payload.tags.length +
    payload.attachments.length;

  if (total === 0) {
    throw new ImportFormatError(
      'No importable data found in the file. Ensure the file contains valid password entries.',
    );
  }
}

function validateItemRequiredFields(item: ImportItem, index: number): void {
  if (!item.title) {
    throw new ImportParseError(
      `Item at index ${index} is missing required field: title`,
      index,
      { field: 'title', item },
    );
  }
}

function validatePayload(payload: ImportPayload): void {
  validateNotEmpty(payload);

  for (let i = 0; i < payload.items.length; i++) {
    validateItemRequiredFields(payload.items[i], i);
  }
}

export function makeImportPayload(
  payload: ImportPayload,
): ImportPayload {
  const sanitized = sanitizePayload(payload);
  validatePayload(sanitized);
  return sanitized;
}

export class ImporterFactory {
  private registry = new Map<ImportFormat, () => Importer>();

  constructor(initialRegistrations?: [ImportFormat, () => Importer][]) {
    if (initialRegistrations) {
      for (const [format, factory] of initialRegistrations) {
        this.registry.set(format, factory);
      }
    }
  }

  register(format: ImportFormat, factory: () => Importer): void {
    this.registry.set(format, factory);
  }

  has(format: ImportFormat): boolean {
    return this.registry.has(format);
  }

  get(format: ImportFormat): Importer {
    const factory = this.registry.get(format);
    if (!factory) {
      throw new ImportFormatError(
        `Unsupported import format: ${format}. Supported formats are: ${Array.from(this.registry.keys()).join(', ')}.`,
        { format },
      );
    }
    return factory();
  }

  supportedFormats(): ImportFormat[] {
    return Array.from(this.registry.keys());
  }
}

export function createDefaultImporterFactory(): ImporterFactory {
  const factory = new ImporterFactory();
  return factory;
}
