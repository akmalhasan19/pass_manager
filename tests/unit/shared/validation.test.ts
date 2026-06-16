import { describe, it, expect } from 'vitest';
import {
  validateField,
  validateCharacters,
  sanitizeAndValidateField,
  sanitizeUrl,
  normalizeForComparison,
} from '../../../src/shared/validation';
import { MAX_FIELD_LENGTHS } from '../../../src/shared/constants';

describe('validateField - max length boundaries', () => {
  const fields: Array<{ field: Parameters<typeof validateField>[0]; max: number }> = [
    { field: 'folderName', max: MAX_FIELD_LENGTHS.FOLDER_NAME },
    { field: 'itemTitle', max: MAX_FIELD_LENGTHS.ITEM_TITLE },
    { field: 'username', max: MAX_FIELD_LENGTHS.USERNAME },
    { field: 'password', max: MAX_FIELD_LENGTHS.PASSWORD },
    { field: 'url', max: MAX_FIELD_LENGTHS.URL },
    { field: 'notes', max: MAX_FIELD_LENGTHS.NOTES },
    { field: 'tagName', max: MAX_FIELD_LENGTHS.TAG_NAME },
  ];

  for (const { field, max } of fields) {
    describe(field, () => {
      it(`allows exactly ${max} characters`, () => {
        const value = 'a'.repeat(max);
        expect(validateField(field, value)).toBeNull();
      });

      it(`rejects ${max + 1} characters`, () => {
        const value = 'a'.repeat(max + 1);
        expect(validateField(field, value)).toBe('validation.maxLength');
      });

      it('allows 0 characters (empty string)', () => {
        expect(validateField(field, '')).toBeNull();
      });

      if (field === 'folderName' || field === 'itemTitle') {
        it('rejects whitespace-only value', () => {
          expect(validateField(field, '   ')).toBe('validation.whitespaceOnly');
        });
      } else if (field === 'url') {
        it('rejects whitespace-only raw URL (invalid URL)', () => {
          expect(validateField(field, '   ')).toBe('validation.urlWarning');
        });
        it('accepts whitespace-only URL after sanitization (trimmed to empty)', () => {
          const { sanitized, errorKey } = sanitizeAndValidateField(field, '   ');
          expect(sanitized).toBe('');
          expect(errorKey).toBeNull();
        });
      } else {
        it('allows whitespace-only value', () => {
          expect(validateField(field, '   ')).toBeNull();
        });
      }
    });
  }
});

describe('validateField - URL format', () => {
  it('accepts valid http URL', () => {
    expect(validateField('url', 'http://example.com')).toBeNull();
  });

  it('accepts valid https URL', () => {
    expect(validateField('url', 'https://example.com/path?query=1')).toBeNull();
  });

  it('accepts URL without protocol (auto-prefixed https)', () => {
    expect(validateField('url', 'example.com')).toBeNull();
  });

  it('accepts localhost URL', () => {
    expect(validateField('url', 'http://localhost:3000')).toBeNull();
  });

  it('accepts URL with international domain', () => {
    expect(validateField('url', 'https://münchen.de')).toBeNull();
  });

  it('rejects completely invalid URL string', () => {
    expect(validateField('url', 'not a valid url')).toBe('validation.urlWarning');
  });

  it('rejects javascript: pseudo-URL', () => {
    expect(validateField('url', 'javascript:alert(1)')).toBe('validation.urlWarning');
  });

  it('rejects data: URL', () => {
    expect(validateField('url', 'data:text/html,<script>alert(1)</script>')).toBe(
      'validation.urlWarning',
    );
  });

  it('allows empty URL', () => {
    expect(validateField('url', '')).toBeNull();
  });
});

describe('validateField - username/email format (loose validation)', () => {
  it('accepts valid email address', () => {
    expect(validateField('username', 'user@example.com')).toBeNull();
  });

  it('accepts email with plus sign', () => {
    expect(validateField('username', 'user+tag@example.com')).toBeNull();
  });

  it('accepts arbitrary username (not email)', () => {
    expect(validateField('username', 'my_user_123')).toBeNull();
  });

  it('accepts username with special characters', () => {
    expect(validateField('username', 'user@domain!#%')).toBeNull();
  });

  it('accepts empty username', () => {
    expect(validateField('username', '')).toBeNull();
  });
});

describe('validateCharacters', () => {
  it('blocks control characters in folderName', () => {
    expect(validateCharacters('folderName', 'Test\x00Name')).toBe('validation.invalidCharacters');
  });

  it('blocks control characters in itemTitle', () => {
    expect(validateCharacters('itemTitle', 'Test\x07Name')).toBe('validation.invalidCharacters');
  });

  it('blocks control characters in username', () => {
    expect(validateCharacters('username', 'user\x01name')).toBe('validation.invalidCharacters');
  });

  it('blocks control characters in password', () => {
    expect(validateCharacters('password', 'pass\x0Bword')).toBe('validation.invalidCharacters');
  });

  it('blocks control characters in url', () => {
    expect(validateCharacters('url', 'https://example\x00.com')).toBe(
      'validation.invalidCharacters',
    );
  });

  it('allows newlines and tabs in notes', () => {
    expect(validateCharacters('notes', 'Line1\nLine2\tTab')).toBeNull();
  });

  it('blocks control characters other than newline/tab in notes', () => {
    expect(validateCharacters('notes', 'Test\x00Note')).toBe('validation.invalidCharacters');
  });

  it('allows empty string for all fields', () => {
    expect(validateCharacters('folderName', '')).toBeNull();
    expect(validateCharacters('itemTitle', '')).toBeNull();
    expect(validateCharacters('username', '')).toBeNull();
    expect(validateCharacters('password', '')).toBeNull();
    expect(validateCharacters('url', '')).toBeNull();
    expect(validateCharacters('notes', '')).toBeNull();
    expect(validateCharacters('tagName', '')).toBeNull();
  });

  it('allows Unicode and emoji in folderName', () => {
    expect(validateCharacters('folderName', 'Kerja 📁')).toBeNull();
  });

  it('allows RTL text in itemTitle', () => {
    expect(validateCharacters('itemTitle', 'مرحبا')).toBeNull();
  });
});

describe('sanitizeUrl', () => {
  it('returns empty string for empty input', () => {
    expect(sanitizeUrl('')).toBe('');
  });

  it('returns empty string for whitespace-only input', () => {
    expect(sanitizeUrl('   ')).toBe('');
  });

  it('adds https:// prefix if missing', () => {
    expect(sanitizeUrl('example.com')).toBe('https://example.com/');
  });

  it('preserves existing http:// prefix', () => {
    expect(sanitizeUrl('http://example.com')).toBe('http://example.com/');
  });

  it('preserves existing https:// prefix', () => {
    expect(sanitizeUrl('https://example.com')).toBe('https://example.com/');
  });

  it('returns original trimmed value for invalid URL', () => {
    expect(sanitizeUrl('not a url')).toBe('not a url');
  });
});

describe('normalizeForComparison', () => {
  it('trims whitespace', () => {
    expect(normalizeForComparison('  Hello  ')).toBe('hello');
  });

  it('lowercases text', () => {
    expect(normalizeForComparison('Hello')).toBe('hello');
  });

  it('normalizes composed vs decomposed Unicode (NFC)', () => {
    const composed = 'Café'; // precomposed é
    const decomposed = 'Cafe\u0301'; // e + combining accent
    expect(normalizeForComparison(composed)).toBe(normalizeForComparison(decomposed));
    expect(normalizeForComparison(composed)).toBe('café');
  });

  it('handles different casing as same after normalization', () => {
    expect(normalizeForComparison('Work')).toBe(normalizeForComparison('work'));
    expect(normalizeForComparison('WORK')).toBe(normalizeForComparison('work'));
  });

  it('handles whitespace-only differences', () => {
    expect(normalizeForComparison('Work ')).toBe(normalizeForComparison('Work'));
    expect(normalizeForComparison(' Work')).toBe(normalizeForComparison('Work'));
  });

  it('handles mixed case and whitespace', () => {
    expect(normalizeForComparison('  Work ')).toBe(normalizeForComparison('work'));
  });

  it('handles empty string', () => {
    expect(normalizeForComparison('')).toBe('');
  });

  it('handles Unicode emoji', () => {
    expect(normalizeForComparison('Folder 📁')).toBe('folder 📁');
  });
});
