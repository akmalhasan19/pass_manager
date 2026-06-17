import { describe, it, expect } from 'vitest';
import {
  ImporterFactory,
  ImportError,
  ImportFormatError,
  ImportParseError,
  createImportPayload,
  createImportFolder,
  createImportItem,
  createImportTag,
  createImportAttachment,
  makeImportPayload,
  type Importer,
} from '../../../src/main/import-export/importer';
import type { ImportFormat } from '../../../src/shared/types';

describe('createImportPayload', () => {
  it('should return an empty payload', () => {
    const payload = createImportPayload();
    expect(payload).toEqual({
      folders: [],
      items: [],
      tags: [],
      attachments: [],
    });
  });
});

describe('createImportFolder', () => {
  it('should create a folder with required name', () => {
    const folder = createImportFolder({ name: 'Test Folder' });
    expect(folder.name).toBe('Test Folder');
    expect(folder.parentId).toBeNull();
    expect(folder.emoji).toBeNull();
    expect(folder.sortOrder).toBe(0);
    expect(folder.id).toBe('');
    expect(typeof folder.createdAt).toBe('number');
    expect(typeof folder.updatedAt).toBe('number');
  });

  it('should apply overrides', () => {
    const folder = createImportFolder({
      id: 'f1',
      name: 'Folder',
      parentId: 'p1',
      emoji: '📁',
      sortOrder: 5,
    });
    expect(folder.id).toBe('f1');
    expect(folder.parentId).toBe('p1');
    expect(folder.emoji).toBe('📁');
    expect(folder.sortOrder).toBe(5);
  });
});

describe('createImportItem', () => {
  it('should create an item with required fields', () => {
    const item = createImportItem({
      title: 'Test',
      username: 'user',
      password: 'pass',
    });
    expect(item.title).toBe('Test');
    expect(item.username).toBe('user');
    expect(item.password).toBe('pass');
    expect(item.url).toBe('');
    expect(item.notes).toBeNull();
    expect(item.isFavorite).toBe(false);
    expect(item.tagIds).toEqual([]);
    expect(item.id).toBe('');
  });

  it('should apply overrides', () => {
    const item = createImportItem({
      id: 'i1',
      folderId: 'f1',
      title: 'Title',
      username: 'user',
      password: 'secret',
      url: 'https://example.com',
      notes: 'some notes',
      isFavorite: true,
      sortOrder: 3,
      tagIds: ['t1', 't2'],
    });
    expect(item.id).toBe('i1');
    expect(item.folderId).toBe('f1');
    expect(item.url).toBe('https://example.com');
    expect(item.notes).toBe('some notes');
    expect(item.isFavorite).toBe(true);
    expect(item.sortOrder).toBe(3);
    expect(item.tagIds).toEqual(['t1', 't2']);
  });
});

describe('createImportTag', () => {
  it('should create a tag with required name', () => {
    const tag = createImportTag({ name: 'important' });
    expect(tag.name).toBe('important');
    expect(tag.color).toBe('#6366f1');
    expect(tag.id).toBe('');
  });

  it('should apply overrides', () => {
    const tag = createImportTag({ id: 't1', name: 'work', color: '#ff0000' });
    expect(tag.id).toBe('t1');
    expect(tag.color).toBe('#ff0000');
  });
});

describe('createImportAttachment', () => {
  it('should create an attachment with required fields', () => {
    const buf = Buffer.from('test data');
    const att = createImportAttachment({ fileName: 'doc.pdf', rawData: buf });
    expect(att.fileName).toBe('doc.pdf');
    expect(att.rawData).toBe(buf);
    expect(att.fileSize).toBe(buf.length);
    expect(att.mimeType).toBe('application/octet-stream');
    expect(att.itemId).toBeNull();
    expect(att.folderId).toBeNull();
  });

  it('should apply overrides', () => {
    const buf = Buffer.from('data');
    const att = createImportAttachment({
      id: 'a1',
      itemId: 'i1',
      fileName: 'img.png',
      mimeType: 'image/png',
      rawData: buf,
      fileSize: 999,
    });
    expect(att.id).toBe('a1');
    expect(att.itemId).toBe('i1');
    expect(att.fileSize).toBe(999);
  });
});

describe('makeImportPayload', () => {
  it('should validate and return a valid payload', () => {
    const payload = createImportPayload();
    payload.items.push(
      createImportItem({ title: 'A', username: 'u', password: 'p' }),
    );
    payload.tags.push(createImportTag({ name: 't1' }));
    payload.folders.push(createImportFolder({ name: 'f1' }));

    const result = makeImportPayload(payload);
    expect(result.items).toHaveLength(1);
    expect(result.tags).toHaveLength(1);
    expect(result.folders).toHaveLength(1);
  });

  it('should throw ImportFormatError for empty payload', () => {
    const payload = createImportPayload();
    expect(() => makeImportPayload(payload)).toThrow(ImportFormatError);
    expect(() => makeImportPayload(payload)).toThrow(
      'No importable data found in the file',
    );
  });

  it('should throw ImportParseError for item missing title', () => {
    const payload = createImportPayload();
    payload.items.push(
      createImportItem({ title: '', username: 'u', password: 'p' }),
    );
    expect(() => makeImportPayload(payload)).toThrow(ImportParseError);
    expect(() => makeImportPayload(payload)).toThrow(
      'missing required field: title',
    );
  });
});

describe('ImporterFactory', () => {
  it('should start empty', () => {
    const factory = new ImporterFactory();
    expect(factory.supportedFormats()).toEqual([]);
  });

  it('should accept initial registrations via constructor', () => {
    const mockImporter: Importer = {
      format: 'generic-csv',
      parse: () => createImportPayload(),
    };
    const factory = new ImporterFactory([['generic-csv', () => mockImporter]]);
    expect(factory.supportedFormats()).toEqual(['generic-csv']);
  });

  it('should throw ImportFormatError for unregistered format', () => {
    const factory = new ImporterFactory();
    expect(() => factory.get('keepass-xml')).toThrow(ImportFormatError);
    expect(() => factory.get('keepass-xml')).toThrow('Unsupported import format');
  });

  it('should throw ImportFormatError for unknown format', () => {
    const factory = new ImporterFactory();
    expect(() => factory.get('unknown-format' as ImportFormat)).toThrow(
      ImportFormatError,
    );
    expect(() => factory.get('unknown-format' as ImportFormat)).toThrow(
      'Unsupported import format',
    );
  });

  it('should allow registering a custom importer', () => {
    const factory = new ImporterFactory();
    const mockImporter: Importer = {
      format: 'generic-csv',
      parse: (_content: string) => {
        const payload = createImportPayload();
        payload.items.push(
          createImportItem({ title: 'Custom', username: 'u', password: 'p' }),
        );
        return payload;
      },
    };

    factory.register('generic-csv', () => mockImporter);

    const importer = factory.get('generic-csv');
    expect(importer).toBe(mockImporter);

    const result = importer.parse('some csv content');
    expect(result.items).toHaveLength(1);
    expect(result.items[0].title).toBe('Custom');
  });

  it('should override existing format registration', () => {
    const factory = new ImporterFactory();
    const first: Importer = {
      format: 'generic-csv',
      parse: () => createImportPayload(),
    };
    const second: Importer = {
      format: 'generic-csv',
      parse: () => {
        const p = createImportPayload();
        p.tags.push(createImportTag({ name: 'new' }));
        return p;
      },
    };

    factory.register('generic-csv', () => first);
    factory.register('generic-csv', () => second);
    expect(factory.get('generic-csv')).toBe(second);
  });

  it('should throw ImportFormatError when parsing with unregistered format', () => {
    const factory = new ImporterFactory();
    const result = factory.has('pdf' as ImportFormat);
    expect(result).toBe(false);

    expect(() => factory.get('pdf' as ImportFormat)).toThrow(ImportFormatError);
  });

  it('should have fresh instance per get() call when factory returns new importer', () => {
    const factory = new ImporterFactory();
    let callCount = 0;

    factory.register('generic-csv', () => {
      callCount++;
      return {
        format: 'generic-csv' as ImportFormat,
        parse: () => createImportPayload(),
      };
    });

    factory.get('generic-csv');
    factory.get('generic-csv');
    expect(callCount).toBe(2);
  });
});

describe('Error types', () => {
  it('ImportError should have proper name and code', () => {
    const err = new ImportError('Test error', 'TEST_CODE', { key: 'val' });
    expect(err.name).toBe('ImportError');
    expect(err.code).toBe('TEST_CODE');
    expect(err.context).toEqual({ key: 'val' });
  });

  it('ImportFormatError should be instance of ImportError', () => {
    const err = new ImportFormatError('Bad format', { fmt: 'xml' });
    expect(err).toBeInstanceOf(ImportError);
    expect(err.name).toBe('ImportFormatError');
    expect(err.code).toBe('IMPORT_FORMAT_ERROR');
  });

  it('ImportParseError should have line number', () => {
    const err = new ImportParseError('Parse failed', 42, { field: 'title' });
    expect(err).toBeInstanceOf(ImportError);
    expect(err.name).toBe('ImportParseError');
    expect(err.code).toBe('IMPORT_PARSE_ERROR');
    expect(err.line).toBe(42);
  });
});
