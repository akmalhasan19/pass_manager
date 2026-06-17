import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { KeePassXmlImporter } from '../../../src/main/import-export/parsers/keepassXmlParser';
import { ImportFormatError } from '../../../src/main/import-export/importer';

const FIXTURE_DIR = join(__dirname, '..', '..', '..', 'test-data', 'fixtures');

function loadFixture(name: string): string {
  const path = join(FIXTURE_DIR, name);
  if (!existsSync(path)) {
    throw new Error(`Fixture not found: ${path}`);
  }
  return readFileSync(path, 'utf-8');
}

describe('KeePassXmlImporter', () => {
  const importer = new KeePassXmlImporter();

  it('should have correct format', () => {
    expect(importer.format).toBe('keepass-xml');
  });

  describe('parse valid KeePass XML', () => {
    const xml = loadFixture('keepass-sample.xml');
    const payload = importer.parse(xml);

    it('should parse all folders including nested', () => {
      expect(payload.folders.length).toBe(3);
    });

    it('should create root-level folders', () => {
      const rootFolders = payload.folders.filter((f) => f.parentId === null);
      expect(rootFolders.length).toBe(2);

      const names = rootFolders.map((f) => f.name).sort();
      expect(names).toEqual(['Email', 'Internet']);
    });

    it('should create nested subfolders with correct parentId', () => {
      const internetFolder = payload.folders.find((f) => f.name === 'Internet');
      expect(internetFolder).toBeDefined();

      const bankingFolder = payload.folders.find((f) => f.name === 'Banking');
      expect(bankingFolder).toBeDefined();
      expect(bankingFolder!.parentId).toBe(internetFolder!.id);
    });

    it('should parse all entries', () => {
      expect(payload.items.length).toBe(4);
    });

    it('should parse entry fields correctly', () => {
      const exampleCorp = payload.items.find((i) => i.title === 'Example Corp');
      expect(exampleCorp).toBeDefined();
      expect(exampleCorp!.username).toBe('user@example.com');
      expect(exampleCorp!.password).toBe('MySecretP@ss1');
      expect(exampleCorp!.url).toBe('https://example.com/login');
      expect(exampleCorp!.notes).toBe('Primary work account');
    });

    it('should handle entries without Notes field', () => {
      const github = payload.items.find((i) => i.title === 'GitHub');
      expect(github).toBeDefined();
      expect(github!.url).toBe('https://github.com');
      expect(github!.notes).toBeNull();
    });

    it('should handle entries without URL', () => {
      const email = payload.items.find((i) => i.title === 'Personal Email');
      expect(email).toBeDefined();
      expect(email!.url).toBe('');
      expect(email!.username).toBe('me@outlook.com');
      expect(email!.password).toBe('EmailPass!456');
    });

    it('should assign items to correct folders', () => {
      const internetFolder = payload.folders.find((f) => f.name === 'Internet');
      const bankingFolder = payload.folders.find((f) => f.name === 'Banking');
      const emailFolder = payload.folders.find((f) => f.name === 'Email');

      expect(internetFolder).toBeDefined();
      expect(bankingFolder).toBeDefined();
      expect(emailFolder).toBeDefined();

      const internetItems = payload.items.filter((i) => i.folderId === internetFolder!.id);
      expect(internetItems.length).toBe(2);

      const bankingItems = payload.items.filter((i) => i.folderId === bankingFolder!.id);
      expect(bankingItems.length).toBe(1);

      const emailItems = payload.items.filter((i) => i.folderId === emailFolder!.id);
      expect(emailItems.length).toBe(1);
    });

    it('should parse timestamps', () => {
      const exampleCorp = payload.items.find((i) => i.title === 'Example Corp');
      expect(exampleCorp).toBeDefined();
      expect(exampleCorp!.createdAt).toBeGreaterThan(0);
      expect(exampleCorp!.updatedAt).toBeGreaterThan(0);
      expect(exampleCorp!.updatedAt).toBeGreaterThanOrEqual(exampleCorp!.createdAt);
    });

    it('should handle custom fields by appending to notes', () => {
      const nationalBank = payload.items.find((i) => i.title === 'National Bank');
      expect(nationalBank).toBeDefined();
      expect(nationalBank!.notes).toContain('CustomField1');
      expect(nationalBank!.notes).toContain('Account #12345');
      expect(nationalBank!.notes).toContain('CustomField2');
      expect(nationalBank!.notes).toContain('Security Word: ocean');
    });

    it('should generate stable IDs for folders', () => {
      for (const folder of payload.folders) {
        expect(folder.id).toBeDefined();
        expect(folder.id.length).toBeGreaterThan(0);
      }
    });

    it('should generate stable IDs for items', () => {
      for (const item of payload.items) {
        expect(item.id).toBeDefined();
        expect(item.id.length).toBeGreaterThan(0);
      }
    });

    it('should sort folders with sortOrder', () => {
      for (let i = 1; i < payload.folders.length; i++) {
        expect(payload.folders[i].sortOrder).toBeGreaterThanOrEqual(
          payload.folders[i - 1].sortOrder,
        );
      }
    });

    it('should not have empty notes on items with custom fields', () => {
      const nationalBank = payload.items.find((i) => i.title === 'National Bank');
      expect(nationalBank).toBeDefined();
      expect(nationalBank!.notes).toBeTruthy();
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
    it('should throw ImportFormatError for XML without KeePassFile root', () => {
      const xml = '<?xml version="1.0"?><NotKeePass><Data /></NotKeePass>';
      expect(() => importer.parse(xml)).toThrow(ImportFormatError);
      expect(() => importer.parse(xml)).toThrow(
        'Missing root element <KeePassFile>',
      );
    });

    it('should throw ImportFormatError for empty KeePassFile', () => {
      const xml = '<?xml version="1.0"?><KeePassFile></KeePassFile>';
      expect(() => importer.parse(xml)).toThrow(ImportFormatError);
    });

    it('should throw ImportFormatError for XML with Root but no entries', () => {
      const xml = `<?xml version="1.0"?>
        <KeePassFile>
          <Meta><Generator>Test</Generator></Meta>
          <Root></Root>
        </KeePassFile>`;
      expect(() => importer.parse(xml)).toThrow(ImportFormatError);
      expect(() => importer.parse(xml)).toThrow(
        'Missing <Root> element',
      );
    });

    it('should handle empty string', () => {
      expect(() => importer.parse('')).toThrow(ImportFormatError);
      expect(() => importer.parse('')).toThrow(
        'Missing root element <KeePassFile>',
      );
    });

    it('should throw ImportFormatError for XML with invalid structure', () => {
      const invalid = '<?xml version="1.0"?><KeePassFile><Invalid></Invalid></KeePassFile>';
      expect(() => importer.parse(invalid)).toThrow(ImportFormatError);
    });

    it('should throw for completely invalid XML', () => {
      const notXml = 'This is not XML at all';
      expect(() => importer.parse(notXml)).toThrow();
    });

    it('should throw for XML with binary/corrupt content', () => {
      const corrupt = '<?xml version="1.0"?><KeePassFile>\x00\x01\x02\x03</KeePassFile>';
      expect(() => importer.parse(corrupt)).toThrow();
    });
  });
});
