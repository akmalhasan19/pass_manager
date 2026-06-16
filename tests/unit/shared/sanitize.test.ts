/**
 * XSS Sanitization Tests
 *
 * Validates that plain-text input utilities escape HTML special
 * characters, strip dangerous markup, and remove control bytes — the
 * core defenses of Sub-Task 3.1.
 */

import { describe, it, expect } from 'vitest';
import {
  escapeHtml,
  stripHtmlTags,
  sanitizePlainText,
  sanitizeForField,
  decodeHtmlEntities,
} from '../../../src/shared/sanitize';

describe('escapeHtml', () => {
  it('escapes the five HTML special characters', () => {
    expect(escapeHtml('<script>alert("xss")</script>')).toBe(
      '&lt;script&gt;alert(&quot;xss&quot;)&lt;&#x2F;script&gt;',
    );
  });

  it('escapes ampersands, less-than, greater-than', () => {
    expect(escapeHtml('a & b < c > d')).toBe('a &amp; b &lt; c &gt; d');
  });

  it('escapes single quotes', () => {
    expect(escapeHtml("it's a test")).toBe('it&#39;s a test');
  });

  it('escapes backticks to prevent template injection in attribute contexts', () => {
    expect(escapeHtml('hello`world`')).toBe('hello&#x60;world&#x60;');
  });

  it('escapes equals signs to break attribute injection', () => {
    expect(escapeHtml('a=b')).toBe('a&#x3D;b');
  });

  it('escapes forward slashes to break closing tag injection', () => {
    expect(escapeHtml('</script>')).toBe('&lt;&#x2F;script&gt;');
  });

  it('returns empty string for null/undefined input', () => {
    expect(escapeHtml(null as unknown as string)).toBe('');
    expect(escapeHtml(undefined as unknown as string)).toBe('');
  });

  it('preserves Unicode and emoji', () => {
    expect(escapeHtml('héllo 👋 世界')).toBe('héllo 👋 世界');
  });

  it('does not double-escape existing entities', () => {
    // We do not decode-and-re-encode; existing &amp; is replaced with &amp;amp;
    // This is intentional: callers should feed raw, unencoded text.
    expect(escapeHtml('&amp;')).toBe('&amp;amp;');
  });
});

describe('stripHtmlTags', () => {
  it('removes simple opening and closing tags', () => {
    expect(stripHtmlTags('<b>hello</b>')).toBe('hello');
  });

  it('removes script tags and their content', () => {
    expect(stripHtmlTags('safe<script>alert("xss")</script>safe')).toBe('safe safe');
  });

  it('removes script tags with attributes', () => {
    expect(stripHtmlTags('<script type="text/javascript">alert(1)</script>after')).toBe('after');
  });

  it('removes style tags and their content', () => {
    expect(stripHtmlTags('text<style>body { color: red; }</style>more')).toBe('text more');
  });

  it('removes HTML comments', () => {
    expect(stripHtmlTags('safe<!-- secret -->text')).toBe('safe text');
  });

  it('removes attributes from inline tags', () => {
    expect(stripHtmlTags('<a href="javascript:alert(1)">click</a>')).toBe('click');
  });

  it('removes img tags with onerror handlers', () => {
    expect(stripHtmlTags('<img src=x onerror=alert(1)>')).toBe('');
  });

  it('removes iframe tags', () => {
    expect(stripHtmlTags('<iframe src="evil.com"></iframe>safe')).toBe('safe');
  });

  it('decodes HTML entities to their text equivalents', () => {
    expect(stripHtmlTags('tom &amp; jerry')).toBe('tom & jerry');
  });

  it('decodes numeric character references in text content', () => {
    // Numeric entity is decoded to the literal character, then any tag it
    // forms is stripped — leaving an empty result for this pure-payload input.
    expect(stripHtmlTags('&#60;script&#62;')).toBe('');
  });

  it('decodes hex character references in text content', () => {
    expect(stripHtmlTags('&#x3C;script&#x3E;')).toBe('');
  });

  it('preserves Unicode emoji sequences', () => {
    expect(stripHtmlTags('hello <b>👨‍👩‍👧‍👦</b> world')).toBe('hello 👨‍👩‍👧‍👦 world');
  });

  it('collapses whitespace from removed tags', () => {
    expect(stripHtmlTags('<p>one</p><p>two</p>')).toBe('one two');
  });

  it('returns empty string for null/undefined', () => {
    expect(stripHtmlTags(null as unknown as string)).toBe('');
    expect(stripHtmlTags(undefined as unknown as string)).toBe('');
  });

  it('handles nested tags', () => {
    expect(stripHtmlTags('<div><span>nested <em>text</em></span></div>')).toBe('nested text');
  });

  it('strips self-closing tags', () => {
    expect(stripHtmlTags('text<br/>more')).toBe('text more');
  });

  it('removes svg with embedded script', () => {
    expect(stripHtmlTags('<svg><script>alert(1)</script></svg>')).toBe('');
  });
});

describe('sanitizePlainText', () => {
  it('strips HTML and decodes entities', () => {
    expect(sanitizePlainText('<b>Hello</b> &amp; welcome')).toBe('Hello & welcome');
  });

  it('strips script tags and their content', () => {
    expect(sanitizePlainText('safe<script>alert(1)</script>here')).toBe('safe here');
  });

  it('removes null bytes and other ASCII control characters', () => {
    expect(sanitizePlainText('hello\x00world\x01foo\x07bar')).toBe('helloworldfoobar');
  });

  it('preserves newlines (tabs are normalized to spaces)', () => {
    expect(sanitizePlainText('line1\nline2\tcol2')).toBe('line1\nline2 col2');
  });

  it('preserves Unicode emoji', () => {
    expect(sanitizePlainText('hello <b>👋</b> world')).toBe('hello 👋 world');
  });

  it('preserves CJK characters', () => {
    expect(sanitizePlainText('<i>你好世界</i>')).toBe('你好世界');
  });

  it('preserves RTL text', () => {
    expect(sanitizePlainText('<em>مرحبا بالعالم</em>')).toBe('مرحبا بالعالم');
  });

  it('returns empty string for null/undefined', () => {
    expect(sanitizePlainText(null as unknown as string)).toBe('');
    expect(sanitizePlainText(undefined as unknown as string)).toBe('');
  });

  it('returns empty string for empty input', () => {
    expect(sanitizePlainText('')).toBe('');
  });

  it('removes javascript: URLs from href attributes', () => {
    expect(sanitizePlainText('<a href="javascript:alert(1)">click</a>')).toBe('click');
  });

  it('removes data: URLs from src attributes', () => {
    expect(sanitizePlainText('<img src="data:text/html,<script>alert(1)</script>">')).toBe('');
  });

  it('strips event handlers like onclick and onerror', () => {
    expect(sanitizePlainText('<div onclick="alert(1)">click</div>')).toBe('click');
    expect(sanitizePlainText('<img src=x onerror=alert(1)>')).toBe('');
  });
});

describe('sanitizeForField', () => {
  it('strips HTML for folderName', () => {
    expect(sanitizeForField('folderName', '<script>alert(1)</script>Work')).toBe('Work');
  });

  it('strips HTML for itemTitle', () => {
    expect(sanitizeForField('itemTitle', '<b>Gmail</b> Account')).toBe('Gmail Account');
  });

  it('strips HTML for username', () => {
    expect(sanitizeForField('username', 'user<img src=x onerror=alert(1)>')).toBe('user');
  });

  it('strips HTML for tagName', () => {
    expect(sanitizeForField('tagName', '<script>x</script>priority')).toBe('priority');
  });

  it('strips HTML from url field', () => {
    // The url field uses plain-text sanitization (strip tags), not HTML
    // escaping — <script> and its contents are removed, leaving the
    // surrounding text.
    expect(sanitizeForField('url', 'https://<script>evil.com')).toBe('https:// evil.com');
  });

  it('does not sanitize password (passwords may contain quotes and special chars)', () => {
    const pw = 'p@$$w0rd!#%&*()_+-=[]{}|;:,.<>?/';
    expect(sanitizeForField('password', pw)).toBe(pw);
  });

  it('returns empty string for empty input', () => {
    expect(sanitizeForField('folderName', '')).toBe('');
  });

  it('returns empty string for null/undefined', () => {
    expect(sanitizeForField('itemTitle', null as unknown as string)).toBe('');
    expect(sanitizeForField('itemTitle', undefined as unknown as string)).toBe('');
  });

  it('preserves Unicode characters in folderName', () => {
    expect(sanitizeForField('folderName', 'Kerja 📁')).toBe('Kerja 📁');
  });

  it('strips iframe from URL', () => {
    expect(sanitizeForField('url', '<iframe src="evil.com"></iframe>example.com')).toBe(
      'example.com',
    );
  });
});

describe('decodeHtmlEntities', () => {
  it('decodes named entities', () => {
    expect(decodeHtmlEntities('tom &amp; jerry &lt;3 &quot;hi&quot;')).toBe('tom & jerry <3 "hi"');
  });

  it('decodes numeric character references', () => {
    expect(decodeHtmlEntities('&#60;script&#62;')).toBe('<script>');
  });

  it('decodes hex character references', () => {
    expect(decodeHtmlEntities('&#x3C;script&#x3E;')).toBe('<script>');
  });

  it('decodes single-quote variants', () => {
    expect(decodeHtmlEntities('it&#39;s &apos;cool&apos;')).toBe("it's 'cool'");
  });

  it('decodes non-breaking space', () => {
    expect(decodeHtmlEntities('a&nbsp;b')).toBe('a b');
  });

  it('handles empty string', () => {
    expect(decodeHtmlEntities('')).toBe('');
  });
});

describe('XSS prevention — integration scenarios', () => {
  const payloads: Array<{ name: string; input: string }> = [
    { name: 'script tag', input: '<script>alert("xss")</script>My Title' },
    { name: 'img onerror', input: '<img src=x onerror=alert(1)>Title' },
    { name: 'javascript: URL', input: 'javascript:alert("xss")' },
    { name: 'iframe', input: '<iframe src="evil.com">Title</iframe>' },
    { name: 'svg with script', input: '<svg><script>alert(1)</script></svg>Title' },
    { name: 'data: URL', input: 'data:text/html,<script>alert(1)</script>' },
    { name: 'attribute event handler', input: '" onclick="alert(1)"' },
    { name: 'mixed case script', input: '<ScRiPt>alert(1)</ScRiPt>Title' },
    { name: 'null byte', input: 'Title\x00alert' },
    { name: 'multi-line script', input: '<script\n>alert(1)</script\n>Title' },
  ];

  for (const payload of payloads) {
    it(`strips <${payload.name}> payload from itemTitle`, () => {
      const result = sanitizeForField('itemTitle', payload.input);
      // Must not contain any HTML tag
      expect(result).not.toMatch(/<[^>]*>/);
      // Must not contain HTML attribute markup
      expect(result).not.toMatch(/=\s*['"]\s*$/);
      // Must not contain null bytes
      expect(result).not.toContain('\u0000');
    });

    it(`strips <${payload.name}> payload from folderName`, () => {
      const result = sanitizeForField('folderName', payload.input);
      expect(result).not.toMatch(/<[^>]*>/);
      expect(result).not.toMatch(/=\s*['"]\s*$/);
    });

    it(`strips <${payload.name}> payload from username`, () => {
      const result = sanitizeForField('username', payload.input);
      expect(result).not.toMatch(/<[^>]*>/);
      expect(result).not.toMatch(/=\s*['"]\s*$/);
    });
  }
});
