import { nanoid } from 'nanoid';
import {
  createImportPayload,
  createImportFolder,
  createImportItem,
  createImportTag,
  makeImportPayload,
  ImportFormatError,
  ImportParseError,
  type Importer,
} from '../importer';
import type { ImportFormat, ImportPayload } from '../../../shared/types';

interface BitwardenUri {
  match?: number | null;
  uri?: string;
}

interface BitwardenLogin {
  username?: string;
  password?: string;
  totp?: string | null;
  uris?: BitwardenUri[];
}

interface BitwardenField {
  name: string;
  value: string;
  type: number;
}

interface BitwardenItem {
  id: string;
  organizationId?: string | null;
  folderId?: string | null;
  type?: number;
  reprompt?: number;
  name: string;
  notes?: string | null;
  favorite?: boolean;
  login?: BitwardenLogin;
  fields?: BitwardenField[];
  collectionIds?: string[] | null;
  passwordHistory?: unknown[] | null;
  revisionDate?: string;
  creationDate?: string;
  deletedDate?: string | null;
}

interface BitwardenFolder {
  id: string;
  name: string;
  revisionDate?: string;
}

interface BitwardenExport {
  encrypted: boolean;
  folders?: BitwardenFolder[];
  items: BitwardenItem[];
}

function parseTimestamp(ts: string | undefined): number {
  if (!ts) return Date.now();
  const d = new Date(ts);
  return isNaN(d.getTime()) ? Date.now() : d.getTime();
}

function extractUrl(item: BitwardenItem): string {
  if (!item.login?.uris) return '';
  for (const uri of item.login.uris) {
    if (uri.uri) return uri.uri;
  }
  return '';
}

function extractCustomFields(item: BitwardenItem): string[] {
  if (!item.fields || item.fields.length === 0) return [];
  const parts: string[] = [];
  for (const field of item.fields) {
    if (field.name && field.value) {
      parts.push(`${field.name}: ${field.value}`);
    }
  }
  return parts;
}

function extractTotpNote(item: BitwardenItem): string | null {
  if (!item.login?.totp) return null;
  return `TOTP Seed: ${item.login.totp}`;
}

function buildNotes(item: BitwardenItem): string | null {
  const parts: string[] = [];

  if (item.notes) {
    parts.push(item.notes);
  }

  const customParts = extractCustomFields(item);
  if (customParts.length > 0) {
    parts.push('--- Custom Fields ---');
    parts.push(...customParts);
  }

  const totpNote = extractTotpNote(item);
  if (totpNote) {
    parts.push('--- TOTP ---');
    parts.push(totpNote);
  }

  if (parts.length === 0) return null;
  return parts.join('\n');
}

export class BitwardenJsonImporter implements Importer {
  readonly format: ImportFormat = 'bitwarden-json';

  parse(content: string): ImportPayload {
    let parsed: BitwardenExport;
    try {
      parsed = JSON.parse(content) as BitwardenExport;
    } catch (cause) {
      throw new ImportParseError(
        `Invalid JSON in Bitwarden file: ${cause instanceof Error ? cause.message : 'Malformed JSON'}`,
        undefined,
        { cause },
      );
    }

    if (!parsed || typeof parsed !== 'object') {
      throw new ImportFormatError(
        'Not a valid Bitwarden JSON file. Root element must be an object.',
      );
    }

    if (parsed.encrypted === true) {
      throw new ImportFormatError(
        'Cannot import encrypted Bitwarden JSON. Please export from Bitwarden as unencrypted JSON.',
      );
    }

    if (!Array.isArray(parsed.items)) {
      throw new ImportFormatError(
        'Not a valid Bitwarden JSON file. Missing "items" array.',
      );
    }

    const payload = createImportPayload();

    const folderMap = new Map<string, string>();

    if (Array.isArray(parsed.folders)) {
      for (const bwFolder of parsed.folders) {
        if (!bwFolder.id || !bwFolder.name) continue;

        const folderId = bwFolder.id || nanoid();
        folderMap.set(bwFolder.id, folderId);

        payload.folders.push(
          createImportFolder({
            id: folderId,
            parentId: null,
            name: bwFolder.name,
            createdAt: parseTimestamp(bwFolder.revisionDate),
            updatedAt: parseTimestamp(bwFolder.revisionDate),
          }),
        );
      }
    }

    for (const bwItem of parsed.items) {
      if (!bwItem.name) continue;

      if (bwItem.deletedDate) continue;

      const folderId = bwItem.folderId
        ? folderMap.get(bwItem.folderId) || ''
        : '';

      const itemId = bwItem.id || nanoid();

      const createdAt = parseTimestamp(bwItem.creationDate);
      const updatedAt = parseTimestamp(bwItem.revisionDate);

      payload.items.push(
        createImportItem({
          id: itemId,
          folderId,
          title: bwItem.name,
          username: bwItem.login?.username || '',
          password: bwItem.login?.password || '',
          url: extractUrl(bwItem),
          notes: buildNotes(bwItem),
          emoji: null,
          coverImage: null,
          createdAt,
          updatedAt,
          isFavorite: bwItem.favorite === true,
          sortOrder: 0,
          tagIds: [],
        }),
      );
    }

    return makeImportPayload(payload);
  }
}

export function createBitwardenJsonImporter(): Importer {
  return new BitwardenJsonImporter();
}
