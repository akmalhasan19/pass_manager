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
import type { ImportFormat, ImportPayload, CsvColumn } from '../../../shared/types';

export type CsvColumnMapping = Partial<Record<CsvColumn, string>>;

const REQUIRED_COLUMNS: CsvColumn[] = ['title', 'username', 'password'];

const SECUREPASS_FIELD_LABELS: Record<CsvColumn, string> = {
  title: 'Title',
  username: 'Username',
  password: 'Password',
  url: 'URL',
  notes: 'Notes',
  tags: 'Tags',
};

function validateMapping(mapping: CsvColumnMapping): void {
  const missingRequired = REQUIRED_COLUMNS.filter((col) => !mapping[col]);

  if (missingRequired.length > 0) {
    throw new ImportFormatError(
      `Missing required column mappings: ${missingRequired.map((c) => SECUREPASS_FIELD_LABELS[c]).join(', ')}. These fields must be mapped to a CSV column.`,
      { missingRequired, mapping },
    );
  }

  const mappedValues = Object.values(mapping).filter(Boolean) as string[];
  const seen = new Set<string>();
  for (const val of mappedValues) {
    if (seen.has(val)) {
      throw new ImportFormatError(
        `Duplicate CSV column mapping: "${val}" is mapped to multiple SecurePass fields. Each CSV column can only be used once.`,
        { duplicateColumn: val, mapping },
      );
    }
    seen.add(val);
  }
}

function parseTags(value: string): string[] {
  if (!value || value.trim().length === 0) return [];
  return value
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
}

export class GenericCsvImporter implements Importer {
  readonly format: ImportFormat = 'generic-csv';
  private columnMapping: CsvColumnMapping | null = null;

  setColumnMapping(mapping: CsvColumnMapping): void {
    validateMapping(mapping);
    this.columnMapping = { ...mapping };
  }

  parse(content: string): ImportPayload {
    if (!this.columnMapping) {
      throw new ImportFormatError(
        'Column mapping not set. Call setColumnMapping() before parse().',
      );
    }

    const mapping = this.columnMapping;

    if (!content || content.trim().length === 0) {
      throw new ImportFormatError(
        'File is empty. Please select a valid CSV file.',
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
    const normalizedHeaders = headerFields.map((h) => h.toLowerCase().trim());

    const columnIndexMap = new Map<CsvColumn, number>();
    for (const [field, csvColumnName] of Object.entries(mapping)) {
      if (!csvColumnName) continue;
      const normalized = csvColumnName.toLowerCase().trim();
      const idx = normalizedHeaders.indexOf(normalized);
      if (idx === -1) {
        throw new ImportFormatError(
          `CSV column "${csvColumnName}" (mapped to ${SECUREPASS_FIELD_LABELS[field as CsvColumn]}) not found in the file header. Available columns: ${headerFields.join(', ')}`,
          { missingColumn: csvColumnName, availableColumns: headerFields, field },
        );
      }
      columnIndexMap.set(field as CsvColumn, idx);
    }

    const payload = createImportPayload();

    for (let i = 1; i < nonEmptyLines.length; i++) {
      const fields = parseCsvLine(nonEmptyLines[i]);

      if (fields.length === 0 || fields.every((f) => f.trim() === '')) {
        continue;
      }

      const getField = (col: CsvColumn): string | undefined => {
        const idx = columnIndexMap.get(col);
        if (idx === undefined || idx >= fields.length) return undefined;
        return fields[idx].trim();
      };

      const title = getField('title') || '';
      const username = getField('username') || '';
      const password = getField('password') || '';

      if (!title && !username && !password) {
        continue;
      }

      const url = getField('url') || '';
      const notes = getField('notes') || null;
      const tagsRaw = getField('tags') || '';
      const tagIds: string[] = [];

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
          tagIds,
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

export function createGenericCsvImporter(
  mapping?: CsvColumnMapping,
): Importer {
  const importer = new GenericCsvImporter();
  if (mapping) {
    importer.setColumnMapping(mapping);
  }
  return importer;
}
