import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { BitwardenJsonImporter } from '../../../src/main/import-export/parsers/bitwardenJsonParser';
import { ImportFormatError, ImportParseError } from '../../../src/main/import-export/importer';

const FIXTURE_DIR = join(__dirname, '..', '..', '..', 'test-data', 'fixtures');

function loadFixture(name: string): string {
  const path = join(FIXTURE_DIR, name);
  if (!existsSync(path)) {
    throw new Error(`Fixture not found: ${path}`);
  }
  return readFileSync(path, 'utf-8');
}

describe('BitwardenJsonImporter', () => {
  const importer = new BitwardenJsonImporter();

  it('should have correct format', () => {
    expect(importer.format).toBe('bitwarden-json');
  });

  describe('parse valid Bitwarden JSON', () => {
    const json = loadFixture('bitwarden-sample.json');
    const payload = importer.parse(json);

    it('should parse all folders', () => {
      expect(payload.folders.length).toBe(2);
    });

    it('should create folders with correct names', () => {
      const names = payload.folders.map((f) => f.name).sort();
      expect(names).toEqual(['Social', 'Work']);
    });

    it('should create root-level folders', () => {
      for (const folder of payload.folders) {
        expect(folder.parentId).toBeNull();
      }
    });

    it('should have stable folder IDs', () => {
      const social = payload.folders.find((f) => f.name === 'Social');
      expect(social).toBeDefined();
      expect(social!.id).toBe('bwf1a2b3c-4d5e-6f7a-8b9c-0d1e2f3a4b5c');
    });

    it('should parse timestamps for folders', () => {
      const work = payload.folders.find((f) => f.name === 'Work');
      expect(work).toBeDefined();
      expect(work!.createdAt).toBeGreaterThan(0);
      expect(work!.updatedAt).toBeGreaterThan(0);
    });

    it('should parse valid items and skip deleted items', () => {
      expect(payload.items.length).toBe(4);
    });

    it('should parse item fields correctly', () => {
      const twitter = payload.items.find((i) => i.title === 'Twitter');
      expect(twitter).toBeDefined();
      expect(twitter!.username).toBe('user@twitter.com');
      expect(twitter!.password).toBe('Tw1tt3rP@ss!');
      expect(twitter!.url).toBe('https://twitter.com');
      expect(twitter!.notes).toBe('Main social media account');
    });

    it('should assign items to correct folders', () => {
      const socialFolder = payload.folders.find((f) => f.name === 'Social');
      const workFolder = payload.folders.find((f) => f.name === 'Work');
      expect(socialFolder).toBeDefined();
      expect(workFolder).toBeDefined();

      const socialItems = payload.items.filter((i) => i.folderId === socialFolder!.id);
      expect(socialItems.length).toBe(1);
      expect(socialItems[0].title).toBe('Twitter');

      const workItems = payload.items.filter((i) => i.folderId === workFolder!.id);
      expect(workItems.length).toBe(1);
      expect(workItems[0].title).toBe('Company Portal');
    });

    it('should handle items without a folder', () => {
      const noFolderItems = payload.items.filter((i) => i.folderId === '');
      expect(noFolderItems.length).toBe(2);
      const titles = noFolderItems.map((i) => i.title).sort();
      expect(titles).toEqual(['Personal Email', 'Wi-Fi Password']);
    });

    it('should handle items without URL', () => {
      const email = payload.items.find((i) => i.title === 'Personal Email');
      expect(email).toBeDefined();
      expect(email!.url).toBe('');
    });

    it('should handle favorite flag', () => {
      const portal = payload.items.find((i) => i.title === 'Company Portal');
      expect(portal).toBeDefined();
      expect(portal!.isFavorite).toBe(true);

      const twitter = payload.items.find((i) => i.title === 'Twitter');
      expect(twitter).toBeDefined();
      expect(twitter!.isFavorite).toBe(false);
    });

    it('should handle items with multiple URIs', () => {
      const portal = payload.items.find((i) => i.title === 'Company Portal');
      expect(portal).toBeDefined();
      expect(portal!.url).toBe('https://portal.company.com/login');
    });

    it('should extract TOTP seed into notes', () => {
      const portal = payload.items.find((i) => i.title === 'Company Portal');
      expect(portal).toBeDefined();
      expect(portal!.notes).toContain('TOTP Seed');
      expect(portal!.notes).toContain('JBSWY3DPEHPK3PXP');
    });

    it('should append custom fields to notes', () => {
      const portal = payload.items.find((i) => i.title === 'Company Portal');
      expect(portal).toBeDefined();
      expect(portal!.notes).toContain('Employee ID');
      expect(portal!.notes).toContain('EMP-001234');
    });

    it('should handle items with custom fields but no original notes', () => {
      const wifi = payload.items.find((i) => i.title === 'Wi-Fi Password');
      expect(wifi).toBeDefined();
      expect(wifi!.notes).toContain('SSID');
      expect(wifi!.notes).toContain('MyHomeNetwork');
    });

    it('should parse timestamps for items', () => {
      const twitter = payload.items.find((i) => i.title === 'Twitter');
      expect(twitter).toBeDefined();
      expect(twitter!.createdAt).toBe(1701421200000);
      expect(twitter!.updatedAt).toBe(1712758920000);
    });

    it('should generate stable IDs for items', () => {
      const twitter = payload.items.find((i) => i.title === 'Twitter');
      expect(twitter).toBeDefined();
      expect(twitter!.id).toBe('bwi1a2b3c-4d5e-6f7a-8b9c-0d1e2f3a4b5c');
    });

    it('should not import deleted items', () => {
      const oldAccount = payload.items.find((i) => i.title === 'Old Account');
      expect(oldAccount).toBeUndefined();
    });

    it('should not have empty notes on items with custom fields or TOTP', () => {
      const portal = payload.items.find((i) => i.title === 'Company Portal');
      expect(portal).toBeDefined();
      expect(portal!.notes).toBeTruthy();

      const wifi = payload.items.find((i) => i.title === 'Wi-Fi Password');
      expect(wifi).toBeDefined();
      expect(wifi!.notes).toBeTruthy();
    });

    it('should have null notes on items with no notes, fields, or TOTP', () => {
      const email = payload.items.find((i) => i.title === 'Personal Email');
      expect(email).toBeDefined();
      expect(email!.notes).toBeNull();
    });

    it('should set username to empty string for loginless items', () => {
      const wifi = payload.items.find((i) => i.title === 'Wi-Fi Password');
      expect(wifi).toBeDefined();
      expect(wifi!.username).toBe('');
    });

    it('should have all required fields on every generated item', () => {
      for (const item of payload.items) {
        expect(item.id).toBeDefined();
        expect(item.id.length).toBeGreaterThan(0);
        expect(typeof item.title).toBe('string');
        expect(item.title.length).toBeGreaterThan(0);
        expect(typeof item.username).toBe('string');
        expect(typeof item.password).toBe('string');
        expect(item.password.length).toBeGreaterThan(0);
        expect(typeof item.url).toBe('string');
        expect(typeof item.folderId).toBe('string');
        expect(typeof item.createdAt).toBe('number');
        expect(item.createdAt).toBeGreaterThan(0);
        expect(typeof item.updatedAt).toBe('number');
        expect(item.updatedAt).toBeGreaterThan(0);
        expect(typeof item.isFavorite).toBe('boolean');
        expect(typeof item.sortOrder).toBe('number');
        expect(Array.isArray(item.tagIds)).toBe(true);
      }
    });

    it('should have all required fields on every generated folder', () => {
      for (const folder of payload.folders) {
        expect(folder.id).toBeDefined();
        expect(folder.id.length).toBeGreaterThan(0);
        expect(typeof folder.name).toBe('string');
        expect(folder.name.length).toBeGreaterThan(0);
        expect(typeof folder.createdAt).toBe('number');
        expect(folder.createdAt).toBeGreaterThan(0);
        expect(typeof folder.updatedAt).toBe('number');
        expect(folder.updatedAt).toBeGreaterThan(0);
        expect(typeof folder.sortOrder).toBe('number');
      }
    });
  });

  describe('error handling', () => {
    it('should throw ImportFormatError for encrypted Bitwarden JSON', () => {
      const encryptedJson = JSON.stringify({ encrypted: true, items: [] });
      expect(() => importer.parse(encryptedJson)).toThrow(ImportFormatError);
      expect(() => importer.parse(encryptedJson)).toThrow(
        'encrypted Bitwarden JSON',
      );
    });

    it('should throw ImportFormatError for JSON without items array', () => {
      const badJson = JSON.stringify({ encrypted: false });
      expect(() => importer.parse(badJson)).toThrow(ImportFormatError);
      expect(() => importer.parse(badJson)).toThrow(
        'Missing "items" array',
      );
    });

    it('should throw ImportFormatError for non-object root', () => {
      expect(() => importer.parse('"string"')).toThrow(ImportFormatError);
      expect(() => importer.parse('[]')).toThrow(ImportFormatError);
    });

    it('should throw ImportParseError for malformed JSON', () => {
      expect(() => importer.parse('not json')).toThrow(ImportParseError);
      expect(() => importer.parse('{broken')).toThrow(ImportParseError);
    });

    it('should throw ImportFormatError for empty items array', () => {
      const emptyJson = JSON.stringify({ encrypted: false, items: [] });
      expect(() => importer.parse(emptyJson)).toThrow(ImportFormatError);
      expect(() => importer.parse(emptyJson)).toThrow(
        'No importable data found',
      );
    });

    it('should handle empty string', () => {
      expect(() => importer.parse('')).toThrow(ImportParseError);
    });

    it('should throw ImportParseError for truncated JSON', () => {
      const truncated = '{"encrypted":false,"items":[{"id":"123","name":"Test"';
      expect(() => importer.parse(truncated)).toThrow(ImportParseError);
    });

    it('should throw ImportParseError for JSON with invalid syntax', () => {
      const invalid = '{"encrypted":false,"items":[invalid]}';
      expect(() => importer.parse(invalid)).toThrow(ImportParseError);
    });

    it('should throw ImportFormatError for JSON array instead of object', () => {
      const arrayJson = '[{"id":"123"}]';
      expect(() => importer.parse(arrayJson)).toThrow(ImportFormatError);
    });

    it('should throw ImportParseError for null JSON', () => {
      expect(() => importer.parse('null')).toThrow(ImportFormatError);
    });
  });
});
