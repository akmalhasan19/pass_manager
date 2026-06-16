/**
 * XSS prevention utilities for plain-text user input.
 *
 * These helpers complement the existing `validation.ts` module. They are
 * applied at the input boundary (renderer side and IPC handlers) so that
 * untrusted user input never contains HTML tags or unescaped HTML special
 * characters when stored or rendered.
 *
 * The renderer uses React's JSX `{value}` rendering for user data which
 * automatically escapes `<`, `>`, `&`, `"`, and `'` to their HTML entity
 * equivalents. These utilities are still important because:
 *
 *   1. They sanitize at the storage boundary (e.g., a user pasting a folder
 *      name like `<img src=x onerror=alert(1)>` should not have the tag
 *      stored; the visible text should be the sanitized result).
 *   2. They provide defense in depth — even if a future refactor moves to
 *      `innerHTML`, the data itself does not contain executable HTML.
 *   3. They normalize tricky Unicode/HTML edge cases consistently.
 */

const HTML_ESCAPE_MAP: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
  '/': '&#x2F;',
  '`': '&#x60;',
  '=': '&#x3D;',
};

/**
 * Escape the five HTML special characters (`<`, `>`, `&`, `"`, `'`) — plus
 * the slash, backtick, and equals sign which are commonly used in
 * attribute-based XSS payloads — into their entity references.
 *
 * Use this when injecting untrusted strings into HTML body or attribute
 * contexts. React's JSX does this automatically for `{}` interpolations, but
 * raw `dangerouslySetInnerHTML` and other DOM sinks require manual escaping.
 */
export function escapeHtml(value: string): string {
  if (value === null || value === undefined) return '';
  return String(value).replace(/[&<>"'`=/]/g, (ch) => HTML_ESCAPE_MAP[ch] ?? ch);
}

/**
 * Remove every HTML tag from a string, leaving only the visible text
 * content. Script/style blocks are stripped along with their contents to
 * defeat injection vectors like `<script>alert(1)</script>`.
 *
 * HTML entities are decoded back to their text equivalents (e.g.
 * `&amp;` -> `&`, `&lt;` -> `<`) so the user sees the literal text they
 * intended rather than the encoded form.
 *
 * Whitespace is normalized: each removed tag is treated as a single
 * space, and runs of horizontal whitespace are collapsed.
 */
export function stripHtmlTags(value: string): string {
  if (value === null || value === undefined) return '';
  let result = String(value);

  result = result.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ');
  result = result.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ');

  result = result.replace(/<!--[\s\S]*?-->/g, ' ');

  result = decodeHtmlEntities(result);

  result = result.replace(/<\/?[a-zA-Z][^>]*>/g, ' ');

  result = result.replace(/[ \t\f\v]+/g, ' ');
  result = result.replace(/\s*\n\s*/g, '\n');
  result = result.trim();

  return result;
}

/**
 * Sanitize a value for use as plain text input (title, username, folder
 * name, tag name, etc.). Strips any HTML markup, decodes common HTML
 * entities, and removes null bytes / other control characters that
 * `validation.ts` does not allow.
 *
 * The result is safe to:
 *   - store in the database as the visible value,
 *   - render via React JSX (it contains no HTML markup), and
 *   - use as input to `validateField`.
 */
export function sanitizePlainText(value: string): string {
  if (value === null || value === undefined) return '';
  if (value === '') return '';

  const stripped = stripHtmlTags(value);
  // eslint-disable-next-line no-control-regex
  const noControls = stripped.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
  return noControls;
}

/**
 * Decode a small set of common HTML entities to their text equivalents.
 * Useful when the visible text should match what the user originally
 * intended, e.g. `&amp;` -> `&`.
 */
export function decodeHtmlEntities(value: string): string {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&#x([0-9a-fA-F]+);?/g, (_, hex: string) => {
      const code = Number.parseInt(hex, 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : '';
    })
    .replace(/&#(\d+);?/g, (_, dec: string) => {
      const code = Number.parseInt(dec, 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : '';
    })
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

/**
 * Field types that this sanitizer knows about. Mirrors
 * `ValidationField` in `validation.ts` but only covers the fields that
 * accept plain text.
 */
export type SanitizableField =
  | 'folderName'
  | 'itemTitle'
  | 'username'
  | 'password'
  | 'url'
  | 'tagName';

/**
 * Apply field-specific sanitization to a value before it is validated or
 * persisted. The returned value is safe to pass through `validateField`
 * and to store in the database.
 *
 * Behavior per field:
 *   - `folderName`, `itemTitle`, `tagName`, `username`:
 *       strip HTML tags and control characters via `sanitizePlainText`.
 *   - `password`:
 *       passwords may contain any printable characters and quotes; they
 *       are passed through unchanged.
 *   - `url`:
 *       strip HTML tags but keep the URL intact; `sanitizeUrl` (in
 *       `validation.ts`) is the canonical entry point for full URL
 *       normalization.
 */
export function sanitizeForField(field: SanitizableField, value: string): string {
  if (value === null || value === undefined) return '';
  if (value === '') return '';

  switch (field) {
    case 'folderName':
    case 'itemTitle':
    case 'tagName':
    case 'username':
      return sanitizePlainText(value);
    case 'password':
      return String(value);
    case 'url':
      return sanitizePlainText(value);
    default:
      return sanitizePlainText(value);
  }
}
