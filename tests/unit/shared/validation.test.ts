import { describe, it, expect } from 'vitest';
import {
  validateField,
  validateCharacters,
  sanitizeAndValidateField,
  sanitizeUrl,
  normalizeForComparison,
  normalizeBase32Secret,
  fixBase32Padding,
  sanitizeBase32Secret,
  validateTotpSecret,
  validateTotpConfig,
  sanitizeTotpConfig,
  isValidBase32,
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

describe('fixBase32Padding', () => {
  it('does nothing for already-padded secret (multiple of 8)', () => {
    expect(fixBase32Padding('JBSWY3DP')).toBe('JBSWY3DP');
    expect(fixBase32Padding('JBSWY3DPEE======')).toBe('JBSWY3DPEE======');
  });

  it('adds correct padding for 21-char secret (needs ===)', () => {
    expect(fixBase32Padding('JBSWY3DPEB2WY3DPEB2XA')).toBe('JBSWY3DPEB2WY3DPEB2XA===');
  });

  it('adds single padding for 7-char secret', () => {
    expect(fixBase32Padding('JBSWY3D')).toBe('JBSWY3D=');
  });

  it('adds 6 padding chars for 2-char secret', () => {
    expect(fixBase32Padding('JB')).toBe('JB======');
  });

  it('adds 4 padding chars for 4-char secret', () => {
    expect(fixBase32Padding('JBSW')).toBe('JBSW====');
  });

  it('adds 3 padding chars for 5-char secret', () => {
    expect(fixBase32Padding('JBSWY')).toBe('JBSWY===');
  });

  it('adds 1 padding char for 7-char secret', () => {
    expect(fixBase32Padding('JBSWY3D')).toBe('JBSWY3D=');
  });
});

describe('normalizeBase32Secret', () => {
  it('strips spaces from secret', () => {
    expect(normalizeBase32Secret('JBSW Y3DP')).toBe('JBSWY3DP');
  });

  it('strips hyphens from secret', () => {
    expect(normalizeBase32Secret('JBSW-Y3DP-EB3A-5X2G')).toBe('JBSWY3DPEB3A5X2G');
  });

  it('strips underscores from secret', () => {
    expect(normalizeBase32Secret('JBSW_Y3DP')).toBe('JBSWY3DP');
  });

  it('converts lowercase to uppercase', () => {
    expect(normalizeBase32Secret('jbswy3dp')).toBe('JBSWY3DP');
  });

  it('strips mixed separators and uppercases', () => {
    expect(normalizeBase32Secret('jbsw-y3dp_eb3a:5x2g')).toBe('JBSWY3DPEB3A5X2G');
  });

  it('adds missing padding', () => {
    expect(normalizeBase32Secret('JBSWY3DPEB2WY3DPEB2XA')).toBe('JBSWY3DPEB2WY3DPEB2XA===');
  });

  it('replaces existing padding with correct padding', () => {
    expect(normalizeBase32Secret('JBSWY3DP=')).toBe('JBSWY3DP');
    expect(normalizeBase32Secret('JBSWY3DPEB2WY3DPEB2XA=====')).toBe('JBSWY3DPEB2WY3DPEB2XA===');
  });

  it('preserves non-base32 characters for later validation', () => {
    expect(normalizeBase32Secret('JBSW!@#Y3DP')).toBe('JBSW!@#Y3DP=====');
  });

  it('strips tabs and newlines', () => {
    expect(normalizeBase32Secret('JBSW\nY3DP\tEB3A')).toBe('JBSWY3DPEB3A====');
  });

  it('returns empty string for empty input', () => {
    expect(normalizeBase32Secret('')).toBe('');
    expect(normalizeBase32Secret(null as unknown as string)).toBe('');
    expect(normalizeBase32Secret(undefined as unknown as string)).toBe('');
  });

  it('handles fully padded valid secret without modification', () => {
    expect(normalizeBase32Secret('JBSWY3DP')).toBe('JBSWY3DP');
  });

});

describe('sanitizeBase32Secret', () => {
  it('returns sanitized secret and null error for valid input', () => {
    const result = sanitizeBase32Secret('JBSWY3DPEB3A5X2G');
    expect(result.sanitized).toBe('JBSWY3DPEB3A5X2G');
    expect(result.error).toBeNull();
  });

  it('normalizes secret before returning', () => {
    const result = sanitizeBase32Secret('jbsw y3dp eb3a 5x2g');
    expect(result.sanitized).toBe('JBSWY3DPEB3A5X2G');
    expect(result.error).toBeNull();
  });

  it('returns error for empty input', () => {
    const result = sanitizeBase32Secret('');
    expect(result.sanitized).toBe('');
    expect(result.error).toBe('validation.required');
  });

  it('returns error for whitespace-only input', () => {
    const result = sanitizeBase32Secret('   ');
    expect(result.sanitized).toBe('');
    expect(result.error).toBe('validation.required');
  });

  it('returns error for too-short secret', () => {
    const result = sanitizeBase32Secret('JBSW');
    expect(result.sanitized).toBe('JBSW====');
    expect(result.error).toBe('validation.otpSecretTooShort');
  });

  it('returns error for input with no valid base32 chars', () => {
    const result = sanitizeBase32Secret('!!!@@@###');
    expect(result.sanitized).toBe('!!!@@@###=======');
    expect(result.error).toBe('validation.invalidBase32');
  });

  it('returns error for invalid base32 characters', () => {
    const result = sanitizeBase32Secret('JBSWY3DPEB2WY3DPEB2X!'); // '!' is not in base32 alphabet
    expect(result.error).toBe('validation.invalidBase32');
  });

  it('accepts 16-char secret (minimum length)', () => {
    const result = sanitizeBase32Secret('JBSWY3DPEB2WY3DP'); // 16 chars after padding removal
    expect(result.error).toBeNull();
    expect(result.sanitized).toBe('JBSWY3DPEB2WY3DP');
  });

  it('accepts null input gracefully', () => {
    const result = sanitizeBase32Secret(null as unknown as string);
    expect(result.sanitized).toBe('');
    expect(result.error).toBe('validation.required');
  });
});

describe('validateTotpSecret (updated to use normalizeBase32Secret)', () => {
  it('accepts valid secret with spaces', () => {
    expect(validateTotpSecret('JBSW Y3DP EB3A 5X2G')).toBeNull();
  });

  it('accepts valid secret with hyphens', () => {
    expect(validateTotpSecret('JBSW-Y3DP-EB3A-5X2G')).toBeNull();
  });

  it('accepts lowercase secret', () => {
    expect(validateTotpSecret('jbswy3dpeb3a5x2g')).toBeNull();
  });

  it('rejects empty string', () => {
    expect(validateTotpSecret('')).toBe('validation.required');
  });

  it('rejects too-short secret', () => {
    expect(validateTotpSecret('JBSW')).toBe('validation.otpSecretTooShort');
  });

  it('rejects secret with invalid characters', () => {
    expect(validateTotpSecret('JBSWY3DPEB2WY3DPEB2X!')).toBe('validation.invalidBase32');
  });
});

describe('validateTotpConfig', () => {
  it('returns null for valid config with defaults', () => {
    expect(validateTotpConfig({ secret: 'JBSWY3DPEB3A5X2G', period: 30, digits: 6, algorithm: 'SHA1' })).toBeNull();
  });

  it('returns null for valid config with custom values', () => {
    expect(validateTotpConfig({ secret: 'JBSWY3DPEB3A5X2G', period: 60, digits: 8, algorithm: 'SHA256' })).toBeNull();
    expect(validateTotpConfig({ secret: 'JBSWY3DPEB3A5X2G', period: 30, digits: 6, algorithm: 'SHA512' })).toBeNull();
  });

  it('rejects invalid period (zero)', () => {
    const result = validateTotpConfig({ secret: 'JBSWY3DPEB3A5X2G', period: 0, digits: 6, algorithm: 'SHA1' });
    expect(result).toBe('validation.invalidOtpPeriod');
  });

  it('rejects invalid period (negative)', () => {
    const result = validateTotpConfig({ secret: 'JBSWY3DPEB3A5X2G', period: -1, digits: 6, algorithm: 'SHA1' });
    expect(result).toBe('validation.invalidOtpPeriod');
  });

  it('rejects invalid period (non-integer)', () => {
    const result = validateTotpConfig({ secret: 'JBSWY3DPEB3A5X2G', period: 30.5, digits: 6, algorithm: 'SHA1' });
    expect(result).toBe('validation.invalidOtpPeriod');
  });

  it('rejects invalid digits', () => {
    const result = validateTotpConfig({ secret: 'JBSWY3DPEB3A5X2G', period: 30, digits: 5, algorithm: 'SHA1' });
    expect(result).toBe('validation.invalidOtpDigits');
  });

  it('rejects invalid algorithm', () => {
    const result = validateTotpConfig({ secret: 'JBSWY3DPEB3A5X2G', period: 30, digits: 6, algorithm: 'SHA224' });
    expect(result).toBe('validation.invalidOtpAlgorithm');
  });
});

describe('sanitizeTotpConfig', () => {
  it('sanitizes and validates complete valid config', () => {
    const result = sanitizeTotpConfig({ secret: 'JBSWY3DPEB3A5X2G', period: 30, digits: 6, algorithm: 'SHA1' });
    expect(result.error).toBeNull();
    expect(result.sanitized.secret).toBe('JBSWY3DPEB3A5X2G');
    expect(result.sanitized.period).toBe(30);
    expect(result.sanitized.digits).toBe(6);
    expect(result.sanitized.algorithm).toBe('SHA1');
  });

  it('fills in defaults for missing optional fields', () => {
    const result = sanitizeTotpConfig({ secret: 'JBSWY3DPEB3A5X2G' });
    expect(result.error).toBeNull();
    expect(result.sanitized.period).toBe(30);
    expect(result.sanitized.digits).toBe(6);
    expect(result.sanitized.algorithm).toBe('SHA1');
  });

  it('preserves provided custom values', () => {
    const result = sanitizeTotpConfig({ secret: 'JBSWY3DPEB3A5X2G', period: 60, digits: 8, algorithm: 'SHA256' });
    expect(result.error).toBeNull();
    expect(result.sanitized.period).toBe(60);
    expect(result.sanitized.digits).toBe(8);
    expect(result.sanitized.algorithm).toBe('SHA256');
  });

  it('normalizes secret when filling defaults', () => {
    const result = sanitizeTotpConfig({ secret: 'jbsw y3dp eb3a 5x2g' });
    expect(result.error).toBeNull();
    expect(result.sanitized.secret).toBe('JBSWY3DPEB3A5X2G');
  });

  it('returns error for invalid secret', () => {
    const result = sanitizeTotpConfig({ secret: '!@#$%' });
    expect(result.error).toBe('validation.invalidBase32');
  });

  it('returns error for empty secret', () => {
    const result = sanitizeTotpConfig({ secret: '' });
    expect(result.error).toBe('validation.required');
  });

  it('returns error for invalid period', () => {
    const result = sanitizeTotpConfig({ secret: 'JBSWY3DPEB3A5X2G', period: 0 });
    expect(result.error).toBe('validation.invalidOtpPeriod');
  });

  it('returns error for invalid digits', () => {
    const result = sanitizeTotpConfig({ secret: 'JBSWY3DPEB3A5X2G', digits: 7 });
    expect(result.error).toBe('validation.invalidOtpDigits');
  });

  it('returns error for invalid algorithm', () => {
    const result = sanitizeTotpConfig({ secret: 'JBSWY3DPEB3A5X2G', algorithm: 'MD5' });
    expect(result.error).toBe('validation.invalidOtpAlgorithm');
  });

  it('normalizes algorithm to uppercase', () => {
    const result = sanitizeTotpConfig({ secret: 'JBSWY3DPEB3A5X2G', algorithm: 'sha256' });
    expect(result.error).toBeNull();
    expect(result.sanitized.algorithm).toBe('SHA256');
  });

  it('returns error for too-short secret even with defaults filled', () => {
    const result = sanitizeTotpConfig({ secret: 'JBSW' });
    expect(result.error).toBe('validation.otpSecretTooShort');
  });
});
