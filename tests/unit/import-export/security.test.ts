import { describe, it, expect } from 'vitest';
import { KeePassXmlImporter } from '../../../src/main/import-export/parsers/keepassXmlParser';
import { GenericCsvImporter } from '../../../src/main/import-export/parsers/genericCsvParser';
import { OnePasswordCsvImporter } from '../../../src/main/import-export/parsers/onePasswordCsvParser';
import { BitwardenJsonImporter } from '../../../src/main/import-export/parsers/bitwardenJsonParser';
import { ImportParseError, ImportFormatError } from '../../../src/main/import-export/importer';
import {
  sanitizeString,
  sanitizeUrl,
  sanitizeItem,
  sanitizeFolder,
  sanitizeTag,
  sanitizePayload,
} from '../../../src/main/import-export/sanitizer';
import type { ImportItem, ImportFolder, ImportTag, ImportPayload } from '../../../src/shared/types';

describe('Sanitizer Unit Tests', () => {
  describe('sanitizeString', () => {
    it('should strip HTML script tags from string', () => {
      expect(sanitizeString('<script>alert("xss")</script>')).toBe('alert("xss")');
    });

    it('should strip HTML img onerror tags', () => {
      expect(sanitizeString('<img src=x onerror=alert(1)>')).toBe('');
    });

    it('should strip HTML tags but preserve inner text', () => {
      expect(sanitizeString('<b>Hello</b> World')).toBe('Hello World');
    });

    it('should strip nested HTML tags', () => {
      expect(sanitizeString('<div><p>Nested</p></div>')).toBe('Nested');
    });

    it('should strip event handler attributes in tags', () => {
      expect(sanitizeString('<a onclick="steal()">Click</a>')).toBe('Click');
    });

    it('should strip iframe tags', () => {
      expect(sanitizeString('<iframe src="evil.com"></iframe>')).toBe('');
    });

    it('should remove null bytes and control characters', () => {
      expect(sanitizeString('Hello\x00World')).toBe('HelloWorld');
      expect(sanitizeString('Test\x01\x02\x03Data')).toBe('TestData');
    });

    it('should preserve clean strings unchanged', () => {
      expect(sanitizeString('Clean Title')).toBe('Clean Title');
      expect(sanitizeString('user@example.com')).toBe('user@example.com');
    });

    it('should handle empty string', () => {
      expect(sanitizeString('')).toBe('');
    });

    it('should strip SVG-based XSS', () => {
      expect(sanitizeString('<svg onload=alert(1)>')).toBe('');
    });

    it('should strip style tags, leaving CSS content as harmless plain text', () => {
      const result = sanitizeString('<style>body{background:url("https://evil.com/steal?cookie=")}</style>');
      expect(result).not.toContain('<style>');
      expect(result).not.toContain('</style>');
      expect(result).toBe('body{background:url("https://evil.com/steal?cookie=")}');
    });
  });

  describe('sanitizeUrl', () => {
    it('should block javascript: URL scheme', () => {
      expect(sanitizeUrl('javascript:alert(1)')).toBe('');
    });

    it('should block javascript: with spaces', () => {
      expect(sanitizeUrl('javascript :alert(1)')).toBe('');
    });

    it('should block data: URL scheme', () => {
      expect(sanitizeUrl('data:text/html,<script>alert(1)</script>')).toBe('');
    });

    it('should block vbscript: URL scheme', () => {
      expect(sanitizeUrl('vbscript:MsgBox("xss")')).toBe('');
    });

    it('should preserve safe http URLs', () => {
      expect(sanitizeUrl('https://example.com/login')).toBe('https://example.com/login');
    });

    it('should preserve ftp URLs', () => {
      expect(sanitizeUrl('ftp://files.example.com')).toBe('ftp://files.example.com');
    });

    it('should remove control characters from URLs', () => {
      expect(sanitizeUrl('https://example.com\x00/evil')).toBe('https://example.com/evil');
    });

    it('should handle empty string', () => {
      expect(sanitizeUrl('')).toBe('');
    });
  });

  describe('sanitizeItem', () => {
    const baseItem: ImportItem = {
      id: 'test-id',
      folderId: 'folder-1',
      title: 'Test Item',
      username: 'user@test.com',
      password: 'P@ssw0rd',
      url: 'https://example.com',
      notes: null,
      emoji: null,
      coverImage: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      isFavorite: false,
      sortOrder: 0,
      tagIds: [],
    };

    it('should sanitize XSS in title field', () => {
      const item: ImportItem = { ...baseItem, title: '<script>alert("xss")</script>Malicious' };
      const sanitized = sanitizeItem(item);
      expect(sanitized.title).toBe('alert("xss")Malicious');
      expect(sanitized.title).not.toContain('<script>');
    });

    it('should sanitize XSS in username field', () => {
      const item: ImportItem = { ...baseItem, username: '<img src=x onerror=alert(1)>user' };
      const sanitized = sanitizeItem(item);
      expect(sanitized.username).not.toContain('<img');
      expect(sanitized.username).not.toContain('onerror');
    });

    it('should preserve password field as-is (no sanitization)', () => {
      const item: ImportItem = { ...baseItem, password: 'P@ss<word>123' };
      const sanitized = sanitizeItem(item);
      expect(sanitized.password).toBe('P@ss<word>123');
    });

    it('should sanitize javascript: URLs in url field', () => {
      const item: ImportItem = { ...baseItem, url: 'javascript:alert(document.cookie)' };
      const sanitized = sanitizeItem(item);
      expect(sanitized.url).toBe('');
    });

    it('should sanitize XSS in notes field', () => {
      const item: ImportItem = { ...baseItem, notes: '<iframe src="evil.com">Important note</iframe>' };
      const sanitized = sanitizeItem(item);
      expect(sanitized.notes).toBe('Important note');
      expect(sanitized.notes).not.toContain('<iframe');
    });

    it('should handle null notes', () => {
      const item: ImportItem = { ...baseItem, notes: null };
      const sanitized = sanitizeItem(item);
      expect(sanitized.notes).toBeNull();
    });

    it('should not alter non-string fields', () => {
      const sanitized = sanitizeItem(baseItem);
      expect(sanitized.id).toBe(baseItem.id);
      expect(sanitized.folderId).toBe(baseItem.folderId);
      expect(sanitized.isFavorite).toBe(baseItem.isFavorite);
      expect(sanitized.sortOrder).toBe(baseItem.sortOrder);
      expect(sanitized.tagIds).toEqual(baseItem.tagIds);
    });
  });

  describe('sanitizeFolder', () => {
    it('should sanitize XSS in folder name', () => {
      const folder: ImportFolder = {
        id: 'f1',
        parentId: null,
        name: '<script>evil()</script>Finance',
        emoji: null,
        coverImage: null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        sortOrder: 0,
      };
      const sanitized = sanitizeFolder(folder);
      expect(sanitized.name).toBe('evil()Finance');
      expect(sanitized.name).not.toContain('<script>');
    });
  });

  describe('sanitizeTag', () => {
    it('should sanitize XSS in tag name', () => {
      const tag: ImportTag = { id: 't1', name: '<img onerror=alert(1)>work', color: '#ff0000' };
      const sanitized = sanitizeTag(tag);
      expect(sanitized.name).toBe('work');
      expect(sanitized.name).not.toContain('<img');
    });
  });

  describe('sanitizePayload', () => {
    it('should sanitize all items, folders, and tags in payload', () => {
      const payload: ImportPayload = {
        folders: [
          {
            id: 'f1',
            parentId: null,
            name: '<b>Banking</b>',
            emoji: null,
            coverImage: null,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            sortOrder: 0,
          },
        ],
        items: [
          {
            id: 'i1',
            folderId: 'f1',
            title: '<script>alert(1)</script>Title',
            username: 'user',
            password: 'pass',
            url: 'javascript:evil()',
            notes: '<iframe src="evil">notes</iframe>',
            emoji: null,
            coverImage: null,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            isFavorite: false,
            sortOrder: 0,
            tagIds: [],
          },
        ],
        tags: [
          { id: 't1', name: '<a onclick=steal()>tag</a>', color: '#000' },
        ],
        attachments: [],
      };

      const sanitized = sanitizePayload(payload);

      expect(sanitized.folders[0].name).toBe('Banking');
      expect(sanitized.items[0].title).toBe('alert(1)Title');
      expect(sanitized.items[0].url).toBe('');
      expect(sanitized.items[0].notes).toBe('notes');
      expect(sanitized.tags[0].name).toBe('tag');
    });
  });
});

describe('CSV Import XSS Sanitization', () => {
  describe('1Password CSV with XSS payload in title', () => {
    const importer = new OnePasswordCsvImporter();

    it('should sanitize XSS script tags from title field', () => {
      const csv = `title,username,password,url,notes,tags
"<script>alert(""xss"")</script>Bank Account",user@example.com,MyP@ss123,https://bank.com,"Important account",finance`;

      const payload = importer.parse(csv);
      const item = payload.items[0];

      expect(item.title).not.toContain('<script>');
      expect(item.title).not.toContain('</script>');
      expect(item.title).toContain('alert');
      expect(item.title).toBe('alert("xss")Bank Account');
    });

    it('should sanitize XSS img onerror from title field', () => {
      const csv = `title,username,password,url,notes,tags
"<img src=x onerror=alert(1)>Site",user,pass,https://site.com,,`;

      const payload = importer.parse(csv);
      const item = payload.items[0];

      expect(item.title).not.toContain('<img');
      expect(item.title).not.toContain('onerror');
      expect(item.title).toBe('Site');
    });

    it('should sanitize XSS from notes field', () => {
      const csv = `title,username,password,url,notes,tags
Test,user,pass,https://test.com,"<iframe src=""evil.com"">check this</iframe>",`;

      const payload = importer.parse(csv);
      const item = payload.items[0];

      expect(item.notes).not.toContain('<iframe');
      expect(item.notes).toContain('check this');
    });

    it('should sanitize javascript: URLs from url field', () => {
      const csv = `title,username,password,url,notes,tags
Test,user,pass,javascript:alert(document.cookie),,`;

      const payload = importer.parse(csv);
      const item = payload.items[0];

      expect(item.url).toBe('');
      expect(item.url).not.toContain('javascript:');
    });

    it('should sanitize SVG-based XSS from title', () => {
      const csv = `title,username,password,url,notes,tags
"<svg/onload=alert(1)>Entry",user,pass,,,`;

      const payload = importer.parse(csv);
      const item = payload.items[0];

      expect(item.title).not.toContain('<svg');
      expect(item.title).not.toContain('onload');
    });
  });

  describe('Generic CSV with XSS payload', () => {
    it('should sanitize XSS from mapped columns', () => {
      const importer = new GenericCsvImporter();
      importer.setColumnMapping({
        title: 'Name',
        username: 'User',
        password: 'Pass',
        url: 'Website',
        notes: 'Info',
      });

      const csv = `Name,User,Pass,Website,Info
"<script>steal()</script>Account",admin,s3cret,javascript:evil(),"<b>bold note</b>"`;

      const payload = importer.parse(csv);
      const item = payload.items[0];

      expect(item.title).not.toContain('<script>');
      expect(item.title).toBe('steal()Account');
      expect(item.url).toBe('');
      expect(item.notes).toBe('bold note');
    });
  });

  describe('Bitwarden JSON with XSS payload', () => {
    const importer = new BitwardenJsonImporter();

    it('should sanitize XSS from item name', () => {
      const json = JSON.stringify({
        encrypted: false,
        folders: [],
        items: [
          {
            id: 'bw1',
            name: '<script>alert("xss")</script>Gmail',
            login: { username: 'user@gmail.com', password: 'pass123' },
            type: 1,
          },
        ],
      });

      const payload = importer.parse(json);
      const item = payload.items[0];

      expect(item.title).not.toContain('<script>');
      expect(item.title).toBe('alert("xss")Gmail');
    });

    it('should sanitize XSS from notes field', () => {
      const json = JSON.stringify({
        encrypted: false,
        folders: [],
        items: [
          {
            id: 'bw2',
            name: 'Site',
            login: { username: 'user', password: 'pass' },
            notes: '<img src=x onerror=alert(1)>Recovery info',
            type: 1,
          },
        ],
      });

      const payload = importer.parse(json);
      const item = payload.items[0];

      expect(item.notes).not.toContain('<img');
      expect(item.notes).not.toContain('onerror');
      expect(item.notes).toContain('Recovery info');
    });
  });
});

describe('XML Import XXE Protection', () => {
  const importer = new KeePassXmlImporter();

  it('should reject XML with DOCTYPE declaration', () => {
    const xxeXml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE KeePassFile [
  <!ENTITY xxe SYSTEM "file:///etc/passwd">
]>
<KeePassFile>
  <Root>
    <Group>
      <UUID>abcdef1234567890abcdef1234567890</UUID>
      <Name>Test</Name>
      <Entry>
        <UUID>11223344556677889900aabbccddeeff</UUID>
        <String><Key>Title</Key><Value>&xxe;</Value></String>
        <String><Key>UserName</Key><Value>user</Value></String>
        <String><Key>Password</Key><Value>pass</Value></String>
      </Entry>
    </Group>
  </Root>
</KeePassFile>`;

    expect(() => importer.parse(xxeXml)).toThrow(ImportParseError);
    expect(() => importer.parse(xxeXml)).toThrow('DTD/DOCTYPE');
  });

  it('should reject XML with ENTITY declaration', () => {
    const entityXml = `<?xml version="1.0"?>
<!ENTITY xxe SYSTEM "file:///etc/shadow">
<KeePassFile>
  <Root>
    <Group>
      <UUID>abcdef1234567890abcdef1234567890</UUID>
      <Name>Evil</Name>
      <Entry>
        <UUID>11223344556677889900aabbccddeeff</UUID>
        <String><Key>Title</Key><Value>&xxe;</Value></String>
        <String><Key>UserName</Key><Value>user</Value></String>
        <String><Key>Password</Key><Value>pass</Value></String>
      </Entry>
    </Group>
  </Root>
</KeePassFile>`;

    expect(() => importer.parse(entityXml)).toThrow(ImportParseError);
  });

  it('should reject billion laughs attack (entity expansion)', () => {
    const billionLaughs = `<?xml version="1.0"?>
<!DOCTYPE lolz [
  <!ENTITY lol "lol">
  <!ENTITY lol2 "&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;">
  <!ENTITY lol3 "&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;">
]>
<KeePassFile>
  <Root>
    <Group>
      <UUID>abcdef1234567890abcdef1234567890</UUID>
      <Name>&lol3;</Name>
      <Entry>
        <UUID>11223344556677889900aabbccddeeff</UUID>
        <String><Key>Title</Key><Value>Test</Value></String>
        <String><Key>UserName</Key><Value>user</Value></String>
        <String><Key>Password</Key><Value>pass</Value></String>
      </Entry>
    </Group>
  </Root>
</KeePassFile>`;

    expect(() => importer.parse(billionLaughs)).toThrow(ImportParseError);
  });

  it('should accept valid KeePass XML without DTD', () => {
    const validXml = `<?xml version="1.0" encoding="UTF-8"?>
<KeePassFile>
  <Root>
    <Group>
      <UUID>abcdef1234567890abcdef1234567890</UUID>
      <Name>Valid</Name>
      <Entry>
        <UUID>11223344556677889900aabbccddeeff</UUID>
        <String><Key>Title</Key><Value>My Entry</Value></String>
        <String><Key>UserName</Key><Value>user</Value></String>
        <String><Key>Password</Key><Value>pass</Value></String>
      </Entry>
    </Group>
  </Root>
</KeePassFile>`;

    const payload = importer.parse(validXml);
    expect(payload.items.length).toBe(1);
    expect(payload.items[0].title).toBe('My Entry');
  });

  it('should sanitize XSS in parsed XML entry fields', () => {
    const xssXml = `<?xml version="1.0" encoding="UTF-8"?>
<KeePassFile>
  <Root>
    <Group>
      <UUID>abcdef1234567890abcdef1234567890</UUID>
      <Name>&lt;script&gt;evil()&lt;/script&gt;Finance</Name>
      <Entry>
        <UUID>11223344556677889900aabbccddeeff</UUID>
        <String><Key>Title</Key><Value>&lt;script&gt;alert(1)&lt;/script&gt;Bank</Value></String>
        <String><Key>UserName</Key><Value>user</Value></String>
        <String><Key>Password</Key><Value>pass</Value></String>
        <String><Key>URL</Key><Value>javascript:steal()</Value></String>
        <String><Key>Notes</Key><Value>&lt;iframe src=x&gt;info&lt;/iframe&gt;</Value></String>
      </Entry>
    </Group>
  </Root>
</KeePassFile>`;

    const payload = importer.parse(xssXml);

    const item = payload.items[0];
    expect(item.title).not.toContain('<script>');
    expect(item.url).toBe('');
    expect(item.notes).not.toContain('<iframe');

    const folder = payload.folders[0];
    expect(folder.name).not.toContain('<script>');
  });

  it('should not resolve external entities even if somehow bypassed', () => {
    const externalRefXml = `<?xml version="1.0" encoding="UTF-8"?>
<KeePassFile>
  <Root>
    <Group>
      <UUID>abcdef1234567890abcdef1234567890</UUID>
      <Name>Test</Name>
      <Entry>
        <UUID>11223344556677889900aabbccddeeff</UUID>
        <String><Key>Title</Key><Value>Normal Entry</Value></String>
        <String><Key>UserName</Key><Value>user</Value></String>
        <String><Key>Password</Key><Value>pass</Value></String>
        <String><Key>Notes</Key><Value>file:///etc/passwd should not be read</Value></String>
      </Entry>
    </Group>
  </Root>
</KeePassFile>`;

    const payload = importer.parse(externalRefXml);
    expect(payload.items[0].notes).toContain('file:///etc/passwd should not be read');
  });
});
