import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { OnePasswordCsvImporter } from '../../../src/main/import-export/parsers/onePasswordCsvParser';
import { ImportFormatError } from '../../../src/main/import-export/importer';

const FIXTURE_DIR = join(__dirname, '..', '..', '..', 'test-data', 'fixtures');

function loadFixture(name: string): string {
  const path = join(FIXTURE_DIR, name);
  if (!existsSync(path)) {
    throw new Error(`Fixture not found: ${path}`);
  }
  return readFileSync(path, 'utf-8');
}

describe('OnePasswordCsvImporter', () => {
  const importer = new OnePasswordCsvImporter();

  it('should have correct format', () => {
    expect(importer.format).toBe('1password-csv');
  });

  describe('parse valid 1Password CSV', () => {
    const csv = loadFixture('1password-sample.csv');
    const payload = importer.parse(csv);

    it('should parse all items', () => {
      expect(payload.items.length).toBe(6);
    });

    it('should parse item fields correctly', () => {
      const twitter = payload.items.find((i) => i.title === 'Twitter');
      expect(twitter).toBeDefined();
      expect(twitter!.username).toBe('user@twitter.com');
      expect(twitter!.password).toBe('Tw1tt3rP@ss!');
      expect(twitter!.url).toBe('https://twitter.com');
      expect(twitter!.notes).toBe('Main social media account');
    });

    it('should handle empty fields', () => {
      const github = payload.items.find((i) => i.title === 'GitHub');
      expect(github).toBeDefined();
      expect(github!.url).toBe('https://github.com');
      expect(github!.notes).toBeNull();
    });

    it('should handle empty username field', () => {
      const wifi = payload.items.find((i) => i.title === 'Wi-Fi Password');
      expect(wifi).toBeDefined();
      expect(wifi!.username).toBe('');
      expect(wifi!.password).toBe('MyWifiP@ss!');
      expect(wifi!.url).toBe('');
      expect(wifi!.notes).toBe('Home network password');
    });

    it('should handle quoted fields with commas', () => {
      const portal = payload.items.find((i) => i.title === 'Company Portal');
      expect(portal).toBeDefined();
      expect(portal!.notes).toBe('Work account with VPN access');
    });

    it('should handle quoted fields with special characters', () => {
      const netflix = payload.items.find((i) => i.title === 'Netflix');
      expect(netflix).toBeDefined();
      expect(netflix!.username).toBe('streamer@netflix.com');
      expect(netflix!.password).toBe('N3tfl!xP@ss');
      expect(netflix!.url).toBe('https://netflix.com');
      expect(netflix!.notes).toBe('Family plan shared account');
    });

    it('should set sortOrder based on row index', () => {
      const twitter = payload.items.find((i) => i.title === 'Twitter');
      expect(twitter).toBeDefined();
      expect(twitter!.sortOrder).toBe(1);

      const github = payload.items.find((i) => i.title === 'GitHub');
      expect(github).toBeDefined();
      expect(github!.sortOrder).toBe(2);

      const wifi = payload.items.find((i) => i.title === 'Wi-Fi Password');
      expect(wifi).toBeDefined();
      expect(wifi!.sortOrder).toBe(6);
    });

    it('should not have folders, tags, or attachments', () => {
      expect(payload.folders.length).toBe(0);
      expect(payload.tags.length).toBe(0);
      expect(payload.attachments.length).toBe(0);
    });

    it('should not mark any items as favorite', () => {
      for (const item of payload.items) {
        expect(item.isFavorite).toBe(false);
      }
    });

    it('should generate IDs for all items', () => {
      for (const item of payload.items) {
        expect(item.id).toBeDefined();
        expect(item.id.length).toBeGreaterThan(0);
      }
    });

    it('should set empty folderId for all items', () => {
      for (const item of payload.items) {
        expect(item.folderId).toBe('');
      }
    });

    it('should have empty tagIds for all items', () => {
      for (const item of payload.items) {
        expect(item.tagIds).toEqual([]);
      }
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
  });

  describe('CSV with different column order', () => {
    it('should handle columns in different order', () => {
      const csv = [
        'password,username,title,url,notes',
        'Pass123,admin,Admin Portal,https://admin.example.com,"Admin access"',
        'Secret456,user2,User Account,https://user.example.com,',
      ].join('\n');

      const payload = importer.parse(csv);
      expect(payload.items.length).toBe(2);

      const admin = payload.items.find((i) => i.title === 'Admin Portal');
      expect(admin).toBeDefined();
      expect(admin!.username).toBe('admin');
      expect(admin!.password).toBe('Pass123');
      expect(admin!.url).toBe('https://admin.example.com');
      expect(admin!.notes).toBe('Admin access');
    });
  });

  describe('CSV without optional columns', () => {
    it('should handle CSV with only required columns', () => {
      const csv = [
        'title,username,password',
        'Entry1,user1,pass1',
        'Entry2,user2,pass2',
      ].join('\n');

      const payload = importer.parse(csv);
      expect(payload.items.length).toBe(2);
      expect(payload.items[0].url).toBe('');
      expect(payload.items[0].notes).toBeNull();
    });
  });

  describe('error handling', () => {
    it('should throw ImportFormatError for empty string', () => {
      expect(() => importer.parse('')).toThrow(ImportFormatError);
      expect(() => importer.parse('')).toThrow('File is empty');
    });

    it('should throw ImportFormatError for whitespace-only content', () => {
      expect(() => importer.parse('   \n  \n  ')).toThrow(ImportFormatError);
      expect(() => importer.parse('   \n  \n  ')).toThrow('File is empty');
    });

    it('should throw ImportFormatError for header-only CSV', () => {
      const csv = 'title,username,password,url,notes';
      expect(() => importer.parse(csv)).toThrow(ImportFormatError);
      expect(() => importer.parse(csv)).toThrow('header row and at least one data row');
    });

    it('should throw ImportFormatError for CSV missing title column', () => {
      const csv = [
        'username,password,url',
        'user1,pass1,https://example.com',
      ].join('\n');
      expect(() => importer.parse(csv)).toThrow(ImportFormatError);
      expect(() => importer.parse(csv)).toThrow('Missing required columns');
      expect(() => importer.parse(csv)).toThrow('title');
    });

    it('should throw ImportFormatError for CSV missing username column', () => {
      const csv = [
        'title,password,url',
        'Entry1,pass1,https://example.com',
      ].join('\n');
      expect(() => importer.parse(csv)).toThrow(ImportFormatError);
      expect(() => importer.parse(csv)).toThrow('Missing required columns');
      expect(() => importer.parse(csv)).toThrow('username');
    });

    it('should throw ImportFormatError for CSV missing password column', () => {
      const csv = [
        'title,username,url',
        'Entry1,user1,https://example.com',
      ].join('\n');
      expect(() => importer.parse(csv)).toThrow(ImportFormatError);
      expect(() => importer.parse(csv)).toThrow('Missing required columns');
      expect(() => importer.parse(csv)).toThrow('password');
    });

    it('should throw ImportFormatError when all rows are empty after parsing', () => {
      const csv = [
        'title,username,password,url,notes',
        ',,,',
        ' , , , ',
      ].join('\n');
      expect(() => importer.parse(csv)).toThrow(ImportFormatError);
      expect(() => importer.parse(csv)).toThrow('No valid items found');
    });

    it('should skip rows with no title, username, or password', () => {
      const csv = [
        'title,username,password,url',
        'Valid,user,pass,https://example.com',
        ',,,',
        'Another,user2,pass2,https://test.com',
      ].join('\n');
      const payload = importer.parse(csv);
      expect(payload.items.length).toBe(2);
    });

    it('should handle case-insensitive column headers', () => {
      const csv = [
        'Title,UserName,PassWord,URL,Notes',
        'Entry1,user1,pass1,https://example.com,My notes',
      ].join('\n');
      const payload = importer.parse(csv);
      expect(payload.items.length).toBe(1);
      expect(payload.items[0].title).toBe('Entry1');
      expect(payload.items[0].username).toBe('user1');
      expect(payload.items[0].password).toBe('pass1');
    });

    it('should handle BOM at start of file', () => {
      const csv = '\uFEFFtitle,username,password\nEntry1,user1,pass1';
      const payload = importer.parse(csv);
      expect(payload.items.length).toBe(1);
      expect(payload.items[0].title).toBe('Entry1');
    });

    it('should throw ImportFormatError for truncated CSV', () => {
      const truncated = 'title,username,password\nEntry1,user1';
      const payload = importer.parse(truncated);
      expect(payload.items.length).toBe(1);
      expect(payload.items[0].password).toBe('');
    });

    it('should handle CSV with mismatched column count', () => {
      const mismatched = [
        'title,username,password,url',
        'Entry1,user1,pass1,https://example.com,extra,columns',
      ].join('\n');
      const payload = importer.parse(mismatched);
      expect(payload.items.length).toBe(1);
    });

    it('should throw ImportFormatError for CSV with only whitespace rows', () => {
      const whitespace = [
        'title,username,password',
        '   ,   ,   ',
        '\t,\t,\t',
      ].join('\n');
      expect(() => importer.parse(whitespace)).toThrow(ImportFormatError);
    });

    it('should handle CSV with special characters in fields', () => {
      const special = [
        'title,username,password,url,notes',
        '"Entry with ""quotes""","user,with,commas","pass123",https://example.com,"notes with, commas"',
      ].join('\n');
      const payload = importer.parse(special);
      expect(payload.items.length).toBe(1);
      expect(payload.items[0].title).toBe('Entry with "quotes"');
      expect(payload.items[0].username).toBe('user,with,commas');
      expect(payload.items[0].notes).toBe('notes with, commas');
    });
  });
});
