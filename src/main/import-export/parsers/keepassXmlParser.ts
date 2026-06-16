import { XMLParser } from 'fast-xml-parser';
import { nanoid } from 'nanoid';
import {
  createImportPayload,
  createImportFolder,
  makeImportPayload,
  ImportFormatError,
  ImportParseError,
  type Importer,
} from '../importer';
import type { ImportFormat, ImportFolder } from '../../../shared/types';

const KEEPASS_KNOWN_KEYS = new Set([
  'Title',
  'UserName',
  'Password',
  'URL',
  'Notes',
]);

interface KeepassStringField {
  Key: string;
  Value?: { '#text'?: string; '@_Protected'?: string } | string;
}

interface KeepassTimes {
  LastMod?: string;
  Creation?: string;
}

interface KeepassEntry {
  UUID?: string;
  String?: KeepassStringField | KeepassStringField[];
  Times?: KeepassTimes;
}

interface KeepassGroup {
  UUID?: string;
  Name?: string;
  Entry?: KeepassEntry | KeepassEntry[];
  Group?: KeepassGroup | KeepassGroup[];
}

interface KeepassRoot {
  Group?: KeepassGroup | KeepassGroup[];
}

interface KeepassFile {
  Meta?: Record<string, unknown>;
  Root?: KeepassRoot;
}

function ensureArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function extractStringValue(field: KeepassStringField): string {
  if (!field.Value) return '';
  if (typeof field.Value === 'string') return field.Value;
  if (field.Value['#text']) return field.Value['#text'];
  return '';
}

function parseTimestamp(ts: string | undefined): number {
  if (!ts) return Date.now();
  const d = new Date(ts);
  return isNaN(d.getTime()) ? Date.now() : d.getTime();
}

function decodeUuid(uuid: string | undefined): string {
  if (!uuid) return nanoid();
  try {
    const cleaned = uuid.replace(/-/g, '');
    const bytes = Buffer.from(cleaned, 'hex');
    if (bytes.length === 16) {
      return bytes.toString('base64').replace(/[/+=]/g, '_').slice(0, 21);
    }
  } catch {}
  return nanoid();
}

function parseEntry(entry: KeepassEntry, folderId: string): {
  title: string;
  username: string;
  password: string;
  url: string;
  notes: string;
  customFields: string;
  timestamps: { createdAt: number; updatedAt: number };
} {
  const result = {
    title: '',
    username: '',
    password: '',
    url: '',
    notes: '',
    customFields: '',
    timestamps: { createdAt: Date.now(), updatedAt: Date.now() },
  };

  const fields = ensureArray(entry.String);
  for (const field of fields) {
    const key = field.Key;
    const value = extractStringValue(field);

    if (key === 'Title') result.title = value;
    else if (key === 'UserName') result.username = value;
    else if (key === 'Password') result.password = value;
    else if (key === 'URL') result.url = value;
    else if (key === 'Notes') result.notes = value;
  }

  const customParts: string[] = [];
  for (const field of fields) {
    const key = field.Key;
    const value = extractStringValue(field);
    if (!KEEPASS_KNOWN_KEYS.has(key) && value) {
      customParts.push(`${key}: ${value}`);
    }
  }
  result.customFields = customParts.join('\n');

  if (entry.Times) {
    result.timestamps.createdAt = parseTimestamp(entry.Times.Creation);
    result.timestamps.updatedAt = parseTimestamp(entry.Times.LastMod);
  }

  return result;
}

function parseGroup(
  group: KeepassGroup,
  parentFolderId: string | null,
  folderOrder: { current: number },
): { folders: ImportFolder[]; items: ReturnType<typeof createImportPayload>['items'] } {
  const folders: ImportFolder[] = [];
  const items: ReturnType<typeof createImportPayload>['items'] = [];

  const folderId = decodeUuid(group.UUID);
  const folderName = group.Name || 'Unnamed Folder';

  folders.push(
    createImportFolder({
      id: folderId,
      parentId: parentFolderId,
      name: folderName,
      sortOrder: folderOrder.current++,
    }),
  );

  const entries = ensureArray(group.Entry);
  for (const entry of entries) {
    const parsed = parseEntry(entry, folderId);
    const itemId = decodeUuid(entry.UUID);

    let combinedNotes = parsed.notes;
    if (parsed.customFields) {
      combinedNotes = combinedNotes
        ? `${combinedNotes}\n\n--- Custom Fields ---\n${parsed.customFields}`
        : `--- Custom Fields ---\n${parsed.customFields}`;
    }

    items.push({
      id: itemId,
      folderId,
      title: parsed.title || 'Untitled Entry',
      username: parsed.username,
      password: parsed.password,
      url: parsed.url,
      notes: combinedNotes || null,
      emoji: null,
      coverImage: null,
      createdAt: parsed.timestamps.createdAt,
      updatedAt: parsed.timestamps.updatedAt,
      isFavorite: false,
      sortOrder: 0,
      tagIds: [],
    });
  }

  const subGroups = ensureArray(group.Group);
  for (const subGroup of subGroups) {
    const subResult = parseGroup(subGroup, folderId, folderOrder);
    folders.push(...subResult.folders);
    items.push(...subResult.items);
  }

  return { folders, items };
}

export class KeePassXmlImporter implements Importer {
  readonly format: ImportFormat = 'keepass-xml';

  parse(content: string): import('../../../shared/types').ImportPayload {
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      textNodeName: '#text',
      trimValues: true,
    });

    let parsed: { KeePassFile?: KeepassFile };
    try {
      parsed = parser.parse(content) as { KeePassFile?: KeepassFile };
    } catch (cause) {
      throw new ImportParseError(
        `Invalid XML in KeePass file: ${cause instanceof Error ? cause.message : 'Malformed XML'}`,
        undefined,
        { cause },
      );
    }

    const keepassFile = parsed.KeePassFile;
    if (!keepassFile || typeof keepassFile !== 'object') {
      throw new ImportFormatError(
        'Not a valid KeePass XML file. Missing root element <KeePassFile>.',
      );
    }

    const root = (keepassFile as KeepassFile).Root;
    if (!root || typeof root !== 'object') {
      throw new ImportFormatError(
        'Invalid KeePass XML file. Missing <Root> element.',
      );
    }

    const payload = createImportPayload();
    const folderOrder = { current: 0 };

    const topGroups = ensureArray(root.Group);
    for (const group of topGroups) {
      const result = parseGroup(group, null, folderOrder);
      payload.folders.push(...result.folders);
      payload.items.push(...result.items);
    }

    return makeImportPayload(payload);
  }
}

export function createKeePassXmlImporter(): Importer {
  return new KeePassXmlImporter();
}
