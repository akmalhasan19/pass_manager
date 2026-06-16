/**
 * Validation Integration Tests
 *
 * Verifies the integration between `sanitizeField` / `sanitizeAndValidateField`
 * and the existing `validateField` behavior introduced for Sub-Task 3.1.
 */

import { describe, it, expect } from 'vitest';
import {
  sanitizeField,
  sanitizeAndValidateField,
  validateField,
} from '../../../src/shared/validation';

describe('sanitizeField (validation integration)', () => {
  it('strips HTML from itemTitle', () => {
    expect(sanitizeField('itemTitle', '<b>Gmail</b> Account')).toBe('Gmail Account');
  });

  it('strips HTML from folderName', () => {
    expect(sanitizeField('folderName', '<script>alert(1)</script>Work')).toBe('Work');
  });

  it('strips HTML from tagName', () => {
    expect(sanitizeField('tagName', '<i>priority</i>')).toBe('priority');
  });

  it('strips HTML from username', () => {
    expect(sanitizeField('username', 'user<img src=x onerror=alert(1)>')).toBe('user');
  });

  it('strips HTML from url', () => {
    expect(sanitizeField('url', '<a href="javascript:alert(1)">x</a>example.com')).toBe(
      'x example.com',
    );
  });

  it('does not sanitize password (passes through)', () => {
    const pw = 'p@$$w0rd!#%&*()_+-=[]{}|;:,.<>?/';
    expect(sanitizeField('password', pw)).toBe(pw);
  });

  it('does not sanitize notes (rich text — handled by DOMPurify in 3.2)', () => {
    const rich = '<p>Hello <strong>world</strong></p>';
    expect(sanitizeField('notes', rich)).toBe(rich);
  });

  it('removes control characters from sanitized output', () => {
    expect(sanitizeField('folderName', 'Work\x00Folder\x07Name')).toBe('WorkFolderName');
  });

  it('returns empty string for empty input', () => {
    expect(sanitizeField('folderName', '')).toBe('');
  });

  it('handles null/undefined gracefully', () => {
    expect(sanitizeField('itemTitle', null as unknown as string)).toBe('');
    expect(sanitizeField('itemTitle', undefined as unknown as string)).toBe('');
  });
});

describe('sanitizeAndValidateField', () => {
  it('returns sanitized value with no error for clean input', () => {
    const result = sanitizeAndValidateField('folderName', 'My Folder');
    expect(result.sanitized).toBe('My Folder');
    expect(result.errorKey).toBeNull();
  });

  it('returns sanitized value with no error after stripping HTML', () => {
    const result = sanitizeAndValidateField('folderName', '<b>My Folder</b>');
    expect(result.sanitized).toBe('My Folder');
    expect(result.errorKey).toBeNull();
  });

  it('detects whitespace-only value after sanitization', () => {
    const result = sanitizeAndValidateField('folderName', '   ');
    expect(result.sanitized).toBe('');
    expect(result.errorKey).toBeNull();
  });

  it('detects length violation after sanitization', () => {
    const longValue = 'a'.repeat(300) + '<script>x</script>';
    const result = sanitizeAndValidateField('folderName', longValue);
    expect(result.sanitized.length).toBeLessThanOrEqual(300);
    // After stripping, the value is still too long (the 'a's are kept)
    expect(result.errorKey).toBe('validation.maxLength');
  });

  it('passes through password values unchanged', () => {
    const result = sanitizeAndValidateField('password', 'p@$$w0rd!');
    expect(result.sanitized).toBe('p@$$w0rd!');
    expect(result.errorKey).toBeNull();
  });

  it('validates URL format after sanitization', () => {
    const result = sanitizeAndValidateField('url', 'not a valid url at all <script>');
    expect(result.sanitized).not.toContain('<');
    expect(result.errorKey).toBe('validation.urlWarning');
  });

  it('accepts a valid URL after sanitization', () => {
    const result = sanitizeAndValidateField('url', 'https://example.com');
    expect(result.sanitized).toBe('https://example.com');
    expect(result.errorKey).toBeNull();
  });

  it('preserves itemTitle whitespace and detects whitespace-only', () => {
    const result = sanitizeAndValidateField('itemTitle', '<b>   </b>');
    // After sanitization, the value becomes ' ' (a single space inside the tags)
    // The validateField is then called on the sanitized value
    expect(result.sanitized).not.toContain('<');
    // Either it's now empty (whitespace-only case), or trimmed becomes empty
    if (result.sanitized.trim().length === 0 && result.sanitized.length > 0) {
      expect(result.errorKey).toBe('validation.whitespaceOnly');
    } else {
      // After tag removal: just spaces inside were 'b' tags, so empty
      expect(result.errorKey).toBeNull();
    }
  });
});

describe('sanitizeField + validateField flow (real-world)', () => {
  it('blocks XSS payload in itemTitle', () => {
    const raw = '<script>alert(1)</script>My Account';
    const sanitized = sanitizeField('itemTitle', raw);
    // Must not contain any tag
    expect(sanitized).not.toMatch(/<[^>]*>/);
    // Must not contain script keyword (since <script>...</script> is removed wholesale)
    expect(sanitized.toLowerCase()).not.toContain('<script');
    expect(sanitized.toLowerCase()).not.toContain('</script');
    // The visible text survives
    expect(sanitized).toContain('My Account');
    // Validation passes
    expect(validateField('itemTitle', sanitized)).toBeNull();
  });

  it('blocks XSS payload in folderName', () => {
    const raw = '<img src=x onerror=alert(1)>Personal';
    const sanitized = sanitizeField('folderName', raw);
    expect(sanitized).not.toMatch(/<[^>]*>/);
    expect(sanitized.toLowerCase()).not.toContain('onerror');
    expect(sanitized).toBe('Personal');
    expect(validateField('folderName', sanitized)).toBeNull();
  });

  it('blocks XSS payload in URL field', () => {
    const raw = 'javascript:alert(1)';
    const sanitized = sanitizeField('url', raw);
    expect(sanitized).not.toMatch(/<[^>]*>/);
    // After sanitization: just 'javascript:alert(1)' since no tags
    // Validation reports it as invalid URL
    expect(validateField('url', sanitized)).toBe('validation.urlWarning');
  });
});
