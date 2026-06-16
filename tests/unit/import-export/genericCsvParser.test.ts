import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { GenericCsvImporter, createGenericCsvImporter } from '../../../src/main/import-export/parsers/genericCsvParser';
import { ImportFormatError, ImportParseError } from '../../../src/main/import-export/importer';
import type { CsvColumnMapping } from '../../../src/shared/types';

const FIXTURE_DIR = join(__dirname, '..', '..', '..', 'test-data', 'fixtures');

function loadFixture(name: string): string {
  const path = join(FIXTURE_DIR, name);
  if (!existsSync(path)) {
    throw new Error(`Fixture not found: ${path}`);
  }
  return readFileSync(path, 'utf-8');
}

describe('GenericCsvImporter', () => {
  it('should have correct format', () => {
    const importer = new GenericCsvImporter();
    expect(importer.format).toBe('generic-csv');
  });

  describe('parse with custom column mapping', () => {
    const csv = loadFixture('generic-sample.csv');

    const mapping: CsvColumnMapping = {
      title: 'Site Name',
      username: 'User Login',
      password: 'Pass',
      url: 'Website',
      notes: 'Notes',
      tags: 'Labels',
    };

    const importer = createGenericCsvImporter(mapping);
    const payload = importer.parse(csv);

    it('should parse all items', () => {
      expect(payload.items.length).toBe(6);
    });

    it('should extract fields using custom mapping', () => {
      const twitter = payload.items.find((i) => i.title === 'Twitter');
      expect(twitter).toBeDefined();
      expect(twitter!.username).toBe('user@twitter.com');
      expect(twitter!.password).toBe('Tw1tt3rP@ss!');
      expect(twitter!.url).toBe('https://twitter.com');
      expect(twitter!.notes).toBe('Main social media account');
    });

    it('should handle empty optional fields', () => {
      const github = payload.items.find((i) => i.title === 'GitHub');
      expect(github).toBeDefined();
      expect(github!.url).toBe('https://github.com');
      expect(github!.notes).toBeNull();
    });

    it('should handle empty password field', () => {
      const wifi = payload.items.find((i) => i.title === 'Wi-Fi');
      expect(wifi).toBeDefined();
      expect(wifi!.username).toBe('');
      expect(wifi!.password).toBe('MyWifiP@ss!');
      expect(wifi!.url).toBe('');
      expect(wifi!.notes).toBe('Home network');
    });

    it('should handle quoted fields with commas', () => {
      const portal = payload.items.find((i) => i.title === 'Company Portal');
      expect(portal).toBeDefined();
      expect(portal!.notes).toBe('Work account with VPN');
    });

    it('should handle quoted fields with special characters', () => {
      const netflix = payload.items.find((i) => i.title === 'Netflix');
      expect(netflix).toBeDefined();
      expect(netflix!.username).toBe('streamer@netflix.com');
      expect(netflix!.password).toBe('N3tfl!xP@ss');
      expect(netflix!.url).toBe('https://netflix.com');
      expect(netflix!.notes).toBe('Family plan');
    });

    it('should set sortOrder based on row index', () => {
      const twitter = payload.items.find((i) => i.title === 'Twitter');
      expect(twitter).toBeDefined();
      expect(twitter!.sortOrder).toBe(1);
    });

    it('should generate IDs for all items', () => {
      for (const item of payload.items) {
        expect(item.id).toBeDefined();
        expect(item.id.length).toBeGreaterThan(0);
      }
    });

    it('should not create folders, tags, or attachments', () => {
      expect(payload.folders.length).toBe(0);
      expect(payload.tags.length).toBe(0);
      expect(payload.attachments.length).toBe(0);
    });
  });

  describe('setColumnMapping validation', () => {
    it('should throw ImportFormatError for missing required mapping', () => {
      const importer = new GenericCsvImporter();
      expect(() =>
        importer.setColumnMapping({ url: 'Website' }),
      ).toThrow(ImportFormatError);
      expect(() =>
        importer.setColumnMapping({ url: 'Website' }),
      ).toThrow('Missing required column mappings');
    });

    it('should throw ImportFormatError for duplicate column mapping', () => {
      const importer = new GenericCsvImporter();
      expect(() =>
        importer.setColumnMapping({
          title: 'Name',
          username: 'Name',
          password: 'Pass',
        }),
      ).toThrow(ImportFormatError);
      expect(() =>
        importer.setColumnMapping({
          title: 'Name',
          username: 'Name',
          password: 'Pass',
        }),
      ).toThrow('Duplicate CSV column mapping');
    });

    it('should throw ImportFormatError when parsing without mapping', () => {
      const importer = new GenericCsvImporter();
      expect(() => importer.parse('a,b,c\n1,2,3')).toThrow(ImportFormatError);
      expect(() => importer.parse('a,b,c\n1,2,3')).toThrow(
        'Column mapping not set',
      );
    });

    it('should throw ImportFormatError when mapped column not found in CSV', () => {
      const importer = new GenericCsvImporter();
      importer.setColumnMapping({
        title: 'Title',
        username: 'Username',
        password: 'Password',
      });
      expect(() => importer.parse('Name,Login,Pass\nx,y,z')).toThrow(
        ImportFormatError,
      );
      expect(() => importer.parse('Name,Login,Pass\nx,y,z')).toThrow(
        'not found in the file header',
      );
    });
  });

  describe('createGenericCsvImporter', () => {
    it('should accept mapping via factory function', () => {
      const csv = 'Title,Username,Password\nA,u,p';
      const importer = createGenericCsvImporter({
        title: 'Title',
        username: 'Username',
        password: 'Password',
      });
      const payload = importer.parse(csv);
      expect(payload.items.length).toBe(1);
      expect(payload.items[0].title).toBe('A');
    });

    it('should create importer without mapping', () => {
      const importer = createGenericCsvImporter();
      expect(() => importer.parse('a,b,c\n1,2,3')).toThrow(ImportFormatError);
    });
  });

  describe('error handling', () => {
    it('should throw ImportFormatError for empty string', () => {
      const importer = createGenericCsvImporter({
        title: 't',
        username: 'u',
        password: 'p',
      });
      expect(() => importer.parse('')).toThrow(ImportFormatError);
    });

    it('should throw ImportFormatError for header-only CSV', () => {
      const importer = createGenericCsvImporter({
        title: 't',
        username: 'u',
        password: 'p',
      });
      expect(() => importer.parse('t,u,p')).toThrow(ImportFormatError);
    });

    it('should throw ImportFormatError for empty data rows', () => {
      const importer = createGenericCsvImporter({
        title: 't',
        username: 'u',
        password: 'p',
      });
      expect(() => importer.parse('t,u,p\n,,\n , , ')).toThrow(
        ImportFormatError,
      );
    });

    it('should skip rows with no data', () => {
      const csv = 't,u,p\nA,x,y\n,,\nB,z,w';
      const importer = createGenericCsvImporter({
        title: 't',
        username: 'u',
        password: 'p',
      });
      const payload = importer.parse(csv);
      expect(payload.items.length).toBe(2);
    });
  });
});
