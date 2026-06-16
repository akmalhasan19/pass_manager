import { nanoid } from 'nanoid';
import {
  createImportPayload,
  createImportItem,
  makeImportPayload,
  ImportFormatError,
  ImportParseError,
  type Importer,
} from '../importer';
import { parseCsvLine } from '../plainTextFormats';
import type { ImportFormat, ImportPayload } from '../../../shared/types';

const ONEPASSWORD_EXPECTED_COLUMNS = [
  'title',
  'username',
  'password',
  'url',
  'notes',
  'tags',
] as const;

type OnePasswordColumn = (typeof ONEPASSWORD_EXPECTED_COLUMNS)[number];

function normalizeHeader(raw: string): string {
  return raw.toLowerCase().trim();
}

function parseTagsField(raw: string): string[] {
  if (!raw || raw.trim().length === 0) return [];

  return raw
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
}

export class OnePasswordCsvImporter implements Importer {
  readonly format: ImportFormat = '1password-csv';

  parse(content: string): ImportPayload {
    if (!content || content.trim().length === 0) {
      throw new ImportFormatError(
        'File is empty. Please select a valid 1Password CSV file.',
      );
    }

    const lines = content.split(/\r?\n/);
    const nonEmptyLines = lines.filter((line) => line.trim().length > 0);

    if (nonEmptyLines.length < 2) {
      throw new ImportFormatError(
        'CSV file must have a header row and at least one data row.',
      );
    }

    const headerFields = parseCsvLine(nonEmptyLines[0]);
    const normalizedHeaders = headerFields.map(normalizeHeader);

    const columnMap = new Map<OnePasswordColumn, number>();
    for (const col of ONEPASSWORD_EXPECTED_COLUMNS) {
      const idx = normalizedHeaders.indexOf(col);
      if (idx !== -1) {
        columnMap.set(col, idx);
      }
    }

    const requiredColumns: OnePasswordColumn[] = ['title', 'username', 'password'];
    const missingColumns = requiredColumns.filter((col) => !columnMap.has(col));

    if (missingColumns.length > 0) {
      throw new ImportFormatError(
        `Missing required columns in CSV header: ${missingColumns.join(', ')}. Expected columns: ${ONEPASSWORD_EXPECTED_COLUMNS.join(', ')}. Found: ${normalizedHeaders.join(', ')}`,
        { missingColumns, foundColumns: normalizedHeaders },
      );
    }

    const payload = createImportPayload();

    for (let i = 1; i < nonEmptyLines.length; i++) {
      const fields = parseCsvLine(nonEmptyLines[i]);

      if (fields.length === 0 || fields.every((f) => f.trim() === '')) {
        continue;
      }

      const titleIdx = columnMap.get('title')!;
      const usernameIdx = columnMap.get('username')!;
      const passwordIdx = columnMap.get('password')!;

      const title = fields[titleIdx]?.trim() || '';
      const username = fields[usernameIdx]?.trim() || '';
      const password = fields[passwordIdx]?.trim() || '';

      if (!title && !username && !password) {
        continue;
      }

      const url = columnMap.has('url') ? fields[columnMap.get('url')!]?.trim() || '' : '';
      const notes = columnMap.has('notes') ? fields[columnMap.get('notes')!]?.trim() || null : null;
      const tagsRaw = columnMap.has('tags') ? fields[columnMap.get('tags')!] || '' : '';

      payload.items.push(
        createImportItem({
          id: nanoid(),
          title: title || 'Untitled Entry',
          username,
          password,
          url,
          notes: notes || null,
          emoji: null,
          coverImage: null,
          isFavorite: false,
          sortOrder: i,
          tagIds: [],
        }),
      );
    }

    if (payload.items.length === 0) {
      throw new ImportFormatError(
        'No valid items found in the CSV file after parsing.',
      );
    }

    return makeImportPayload(payload);
  }
}

export function createOnePasswordCsvImporter(): Importer {
  return new OnePasswordCsvImporter();
}
