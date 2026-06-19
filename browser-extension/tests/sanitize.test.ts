// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import {
  sanitizeUrl,
  sanitizeDomain,
  escapeHtml,
  stripHtmlTags,
  truncateString,
  sanitizeDisplayTitle,
  sanitizeUsername,
  sanitizeFormField,
  isValidTabUrl,
} from '../src/shared/sanitize';

// ---------------------------------------------------------------------------
// sanitizeUrl
// ---------------------------------------------------------------------------

describe('sanitizeUrl', () => {
  it('should accept valid https URLs', () => {
    expect(sanitizeUrl('https://github.com/login')).toBe('https://github.com/login');
    expect(sanitizeUrl('https://example.com/path?query=1')).toBe('https://example.com/path?query=1');
  });

  it('should accept valid http URLs', () => {
    expect(sanitizeUrl('http://example.com')).toBe('http://example.com/');
  });

  it('should reject javascript: URLs', () => {
    expect(sanitizeUrl('javascript:alert(1)')).toBeNull();
  });

  it('should reject data: URLs', () => {
    expect(sanitizeUrl('data:text/html,<script>alert(1)</script>')).toBeNull();
  });

  it('should reject file: URLs', () => {
    expect(sanitizeUrl('file:///etc/passwd')).toBeNull();
  });

  it('should reject chrome: URLs', () => {
    expect(sanitizeUrl('chrome://settings')).toBeNull();
  });

  it('should reject ftp: URLs', () => {
    expect(sanitizeUrl('ftp://example.com')).toBeNull();
  });

  it('should reject URLs with credentials', () => {
    expect(sanitizeUrl('https://user:pass@example.com')).toBeNull();
  });

  it('should reject empty strings', () => {
    expect(sanitizeUrl('')).toBeNull();
  });

  it('should reject null/undefined', () => {
    expect(sanitizeUrl(null as unknown as string)).toBeNull();
    expect(sanitizeUrl(undefined as unknown as string)).toBeNull();
  });

  it('should reject non-string input', () => {
    expect(sanitizeUrl(123 as unknown as string)).toBeNull();
  });

  it('should reject overly long URLs', () => {
    const longUrl = 'https://example.com/' + 'a'.repeat(2100);
    expect(sanitizeUrl(longUrl)).toBeNull();
  });

  it('should reject malformed URLs', () => {
    expect(sanitizeUrl('not a url')).toBeNull();
    expect(sanitizeUrl('://missing-scheme')).toBeNull();
  });

  it('should trim whitespace', () => {
    expect(sanitizeUrl('  https://example.com  ')).toBe('https://example.com/');
  });

  it('should reject URLs with empty hostname', () => {
    expect(sanitizeUrl('https://')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// sanitizeDomain
// ---------------------------------------------------------------------------

describe('sanitizeDomain', () => {
  it('should extract hostname from valid URL', () => {
    expect(sanitizeDomain('https://github.com/login')).toBe('github.com');
  });

  it('should strip www prefix', () => {
    expect(sanitizeDomain('https://www.github.com')).toBe('github.com');
  });

  it('should lowercase the domain', () => {
    expect(sanitizeDomain('https://GitHub.COM')).toBe('github.com');
  });

  it('should return null for invalid URLs', () => {
    expect(sanitizeDomain('javascript:alert(1)')).toBeNull();
    expect(sanitizeDomain('')).toBeNull();
    expect(sanitizeDomain('not a url')).toBeNull();
  });

  it('should handle URLs with paths and queries', () => {
    expect(sanitizeDomain('https://example.com/path?q=1')).toBe('example.com');
  });
});

// ---------------------------------------------------------------------------
// escapeHtml
// ---------------------------------------------------------------------------

describe('escapeHtml', () => {
  it('should escape HTML special characters', () => {
    expect(escapeHtml('<script>alert("xss")</script>')).toBe(
      '&lt;script&gt;alert("xss")&lt;/script&gt;',
    );
  });

  it('should escape ampersand', () => {
    expect(escapeHtml('a & b')).toBe('a &amp; b');
  });

  it('should handle single quotes (jsdom textContent behavior)', () => {
    // jsdom's textContent → innerHTML does not escape single quotes
    const result = escapeHtml("it's");
    expect(result).toBe("it's");
  });

  it('should handle empty string', () => {
    expect(escapeHtml('')).toBe('');
  });

  it('should handle null/undefined gracefully', () => {
    expect(escapeHtml(null as unknown as string)).toBe('');
    expect(escapeHtml(undefined as unknown as string)).toBe('');
  });

  it('should handle numbers', () => {
    expect(escapeHtml(123 as unknown as string)).toBe('123');
  });

  it('should pass through safe strings unchanged', () => {
    expect(escapeHtml('hello world')).toBe('hello world');
  });
});

// ---------------------------------------------------------------------------
// stripHtmlTags
// ---------------------------------------------------------------------------

describe('stripHtmlTags', () => {
  it('should remove HTML tags', () => {
    expect(stripHtmlTags('<p>Hello</p>')).toBe('Hello');
  });

  it('should remove nested tags', () => {
    expect(stripHtmlTags('<div><span>Hello</span> <b>World</b></div>')).toBe('Hello World');
  });

  it('should handle empty string', () => {
    expect(stripHtmlTags('')).toBe('');
  });

  it('should handle null/undefined', () => {
    expect(stripHtmlTags(null as unknown as string)).toBe('');
    expect(stripHtmlTags(undefined as unknown as string)).toBe('');
  });

  it('should pass through plain text unchanged', () => {
    expect(stripHtmlTags('no tags here')).toBe('no tags here');
  });

  it('should remove self-closing tags', () => {
    expect(stripHtmlTags('line<br/>break')).toBe('linebreak');
  });
});

// ---------------------------------------------------------------------------
// truncateString
// ---------------------------------------------------------------------------

describe('truncateString', () => {
  it('should not truncate short strings', () => {
    expect(truncateString('hello', 10)).toBe('hello');
  });

  it('should truncate long strings with ellipsis', () => {
    // truncateString slices to (maxLength - 3) chars + "..."
    // For maxLength=8, 'hello world' → 'hello...' (5 chars + ...)
    expect(truncateString('hello world', 8)).toBe('hello...');
  });

  it('should use default maxLength of 500', () => {
    const long = 'a'.repeat(600);
    const result = truncateString(long);
    expect(result.length).toBe(500);
    expect(result.endsWith('...')).toBe(true);
  });

  it('should handle empty string', () => {
    expect(truncateString('')).toBe('');
  });

  it('should handle null/undefined', () => {
    expect(truncateString(null as unknown as string)).toBe('');
    expect(truncateString(undefined as unknown as string)).toBe('');
  });

  it('should return exact string when length equals maxLength', () => {
    const str = 'a'.repeat(10);
    expect(truncateString(str, 10)).toBe(str);
  });
});

// ---------------------------------------------------------------------------
// sanitizeDisplayTitle
// ---------------------------------------------------------------------------

describe('sanitizeDisplayTitle', () => {
  it('should strip HTML tags', () => {
    expect(sanitizeDisplayTitle('<b>My Site</b>')).toBe('My Site');
  });

  it('should remove non-printable characters', () => {
    expect(sanitizeDisplayTitle('Hello\x00\x01World')).toBe('HelloWorld');
  });

  it('should normalize whitespace', () => {
    expect(sanitizeDisplayTitle('Hello   World')).toBe('Hello World');
  });

  it('should truncate long titles', () => {
    const longTitle = 'a'.repeat(600);
    const result = sanitizeDisplayTitle(longTitle);
    expect(result.length).toBeLessThanOrEqual(500);
  });

  it('should handle empty/null input', () => {
    expect(sanitizeDisplayTitle('')).toBe('');
    expect(sanitizeDisplayTitle(null as unknown as string)).toBe('');
  });

  it('should normalize whitespace including tabs and newlines', () => {
    // sanitizeDisplayTitle normalizes \s+ (tabs, newlines, multiple spaces) to single space
    expect(sanitizeDisplayTitle('Hello\tWorld')).toBe('Hello World');
    expect(sanitizeDisplayTitle('Hello\nWorld')).toBe('Hello World');
    expect(sanitizeDisplayTitle('Hello   World')).toBe('Hello World');
  });
});

// ---------------------------------------------------------------------------
// sanitizeUsername
// ---------------------------------------------------------------------------

describe('sanitizeUsername', () => {
  it('should strip HTML tags', () => {
    // stripHtmlTags removes <script>xss</script>, leaving "xss" + "user" = "xssuser"
    expect(sanitizeUsername('<script>xss</script>user')).toBe('xssuser');
  });

  it('should remove non-printable characters', () => {
    expect(sanitizeUsername('user\x00name')).toBe('username');
  });

  it('should trim whitespace', () => {
    expect(sanitizeUsername('  user  ')).toBe('user');
  });

  it('should truncate long usernames', () => {
    const long = 'a'.repeat(300);
    const result = sanitizeUsername(long);
    expect(result.length).toBeLessThanOrEqual(200);
  });

  it('should handle empty/null input', () => {
    expect(sanitizeUsername('')).toBe('');
    expect(sanitizeUsername(null as unknown as string)).toBe('');
  });
});

// ---------------------------------------------------------------------------
// sanitizeFormField
// ---------------------------------------------------------------------------

describe('sanitizeFormField', () => {
  it('should return trimmed non-empty value', () => {
    expect(sanitizeFormField('  hello  ')).toBe('hello');
  });

  it('should return null for empty string', () => {
    expect(sanitizeFormField('')).toBeNull();
  });

  it('should return null for whitespace-only string', () => {
    expect(sanitizeFormField('   ')).toBeNull();
  });

  it('should return null for null/undefined', () => {
    expect(sanitizeFormField(null as unknown as string)).toBeNull();
    expect(sanitizeFormField(undefined as unknown as string)).toBeNull();
  });

  it('should remove control characters', () => {
    expect(sanitizeFormField('hello\x00world')).toBe('helloworld');
  });

  it('should return null for overly long values', () => {
    const long = 'a'.repeat(5000);
    expect(sanitizeFormField(long)).toBeNull();
  });

  it('should keep printable unicode', () => {
    expect(sanitizeFormField('日本語テスト')).toBe('日本語テスト');
  });
});

// ---------------------------------------------------------------------------
// isValidTabUrl
// ---------------------------------------------------------------------------

describe('isValidTabUrl', () => {
  it('should accept valid http/https URLs', () => {
    expect(isValidTabUrl('https://github.com')).toBe(true);
    expect(isValidTabUrl('http://example.com')).toBe(true);
  });

  it('should reject chrome:// URLs', () => {
    expect(isValidTabUrl('chrome://settings')).toBe(false);
  });

  it('should reject about: URLs', () => {
    expect(isValidTabUrl('about:blank')).toBe(false);
  });

  it('should reject edge:// URLs', () => {
    expect(isValidTabUrl('edge://settings')).toBe(false);
  });

  it('should reject undefined', () => {
    expect(isValidTabUrl(undefined)).toBe(false);
  });

  it('should reject javascript: URLs', () => {
    expect(isValidTabUrl('javascript:alert(1)')).toBe(false);
  });
});
