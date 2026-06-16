import type {
  PlainTextExportItem,
  PlainTextExportItemRich,
  CsvColumn,
} from '@shared/types';
import { CSV_COLUMNS } from '@shared/types';

export function escapeCsvField(field: string): string {
  if (field === null || field === undefined) {
    return '';
  }

  const str = String(field);
  const needsQuoting =
    str.includes(',') ||
    str.includes('"') ||
    str.includes('\n') ||
    str.includes('\r');

  if (!needsQuoting) {
    return str;
  }

  const escaped = str.replace(/"/g, '""');
  return `"${escaped}"`;
}

export function unescapeCsvField(field: string): string {
  if (field === null || field === undefined) {
    return '';
  }

  let str = String(field);

  if (str.startsWith('"') && str.endsWith('"')) {
    str = str.slice(1, -1);
    str = str.replace(/""/g, '"');
  } else {
    str = str.trim();
  }

  return str;
}

export function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;
  let i = 0;

  while (i < line.length) {
    const char = line[i];

    if (char === '"') {
      if (inQuotes && i + 1 < line.length && line[i + 1] === '"') {
        current += '"';
        i += 2;
      } else if (!inQuotes && current === '') {
        inQuotes = true;
        i++;
      } else if (inQuotes) {
        inQuotes = false;
        i++;
      } else {
        current += char;
        i++;
      }
    } else if (char === ',' && !inQuotes) {
      fields.push(current);
      current = '';
      i++;
    } else {
      current += char;
      i++;
    }
  }

  fields.push(current);
  return fields.map(unescapeCsvField);
}

export function parseCsvRecords(csv: string): string[][] {
  const records: string[][] = [];
  let currentRecord: string[] = [];
  let currentField = '';
  let inQuotes = false;
  let i = 0;

  while (i < csv.length) {
    const char = csv[i];

    if (char === '"') {
      if (inQuotes && i + 1 < csv.length && csv[i + 1] === '"') {
        currentField += '"';
        i += 2;
      } else if (!inQuotes && currentField === '') {
        inQuotes = true;
        i++;
      } else if (inQuotes) {
        inQuotes = false;
        i++;
      } else {
        currentField += char;
        i++;
      }
    } else if (char === ',' && !inQuotes) {
      currentRecord.push(currentField);
      currentField = '';
      i++;
    } else if ((char === '\n' || char === '\r') && !inQuotes) {
      currentRecord.push(currentField);
      currentField = '';
      if (currentRecord.length > 0 && currentRecord.some((f) => f.trim() !== '')) {
        records.push(currentRecord);
      }
      currentRecord = [];
      if (char === '\r' && i + 1 < csv.length && csv[i + 1] === '\n') {
        i += 2;
      } else {
        i++;
      }
    } else {
      currentField += char;
      i++;
    }
  }

  if (currentField !== '' || currentRecord.length > 0) {
    currentRecord.push(currentField);
    if (currentRecord.length > 0 && currentRecord.some((f) => f.trim() !== '')) {
      records.push(currentRecord);
    }
  }

  return records.map((record) => record.map(unescapeCsvField));
}

export function itemsToCsv(items: PlainTextExportItem[]): string {
  const header = CSV_COLUMNS.join(',');
  const rows = items.map((item) => {
    const values = CSV_COLUMNS.map((col) => {
      if (col === 'tags') {
        return escapeCsvField(item.tags.join(';'));
      }
      return escapeCsvField(item[col] ?? '');
    });
    return values.join(',');
  });

  return [header, ...rows].join('\n');
}

export function csvToItems(csv: string): PlainTextExportItem[] {
  const records = parseCsvRecords(csv);

  if (records.length === 0) {
    return [];
  }

  const headerFields = records[0];
  const columnMap = new Map<CsvColumn, number>();

  headerFields.forEach((field, index) => {
    const normalized = field.toLowerCase().trim() as CsvColumn;
    if (CSV_COLUMNS.includes(normalized)) {
      columnMap.set(normalized, index);
    }
  });

  const requiredColumns: CsvColumn[] = ['title', 'username', 'password'];
  for (const col of requiredColumns) {
    if (!columnMap.has(col)) {
      throw new Error(`CSV missing required column: ${col}`);
    }
  }

  const items: PlainTextExportItem[] = [];

  for (let i = 1; i < records.length; i++) {
    const fields = records[i];

    if (fields.length === 0 || fields.every((f) => f.trim() === '')) {
      continue;
    }

    const title = fields[columnMap.get('title')!] ?? '';
    const username = fields[columnMap.get('username')!] ?? '';
    const password = fields[columnMap.get('password')!] ?? '';
    const url = columnMap.has('url') ? fields[columnMap.get('url')!] ?? '' : '';
    const notes = columnMap.has('notes') ? fields[columnMap.get('notes')!] ?? '' : '';
    const tagsStr = columnMap.has('tags') ? fields[columnMap.get('tags')!] ?? '' : '';
    const tags = tagsStr
      .split(';')
      .map((t) => t.trim())
      .filter((t) => t.length > 0);

    items.push({ title, username, password, url, notes, tags });
  }

  return items;
}

export function itemsToJsonPlain(
  items: PlainTextExportItemRich[],
  pretty: boolean = true,
): string {
  return pretty ? JSON.stringify(items, null, 2) : JSON.stringify(items);
}

export function jsonPlainToItems(json: string): PlainTextExportItemRich[] {
  const parsed = JSON.parse(json);

  if (!Array.isArray(parsed)) {
    throw new Error('JSON plain export must be an array of items');
  }

  return parsed.map((item, index) => {
    if (typeof item !== 'object' || item === null) {
      throw new Error(`Item at index ${index} is not an object`);
    }

    if (typeof item.title !== 'string') {
      throw new Error(`Item at index ${index} missing required field: title`);
    }

    if (typeof item.username !== 'string') {
      throw new Error(`Item at index ${index} missing required field: username`);
    }

    if (typeof item.password !== 'string') {
      throw new Error(`Item at index ${index} missing required field: password`);
    }

    return {
      title: item.title,
      username: item.username,
      password: item.password,
      url: item.url ?? '',
      notes: item.notes ?? null,
      tags: Array.isArray(item.tags) ? item.tags : [],
      folder: item.folder,
      isFavorite: item.isFavorite,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    };
  });
}
