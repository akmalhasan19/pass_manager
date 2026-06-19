/**
 * Input Sanitization and URL Validation Utilities for SecurePass Manager.
 *
 * Provides defense-in-depth sanitization for all external inputs,
 * including URLs, form fields, and user-generated content.
 *
 * @module shared/sanitize
 */

// ---------------------------------------------------------------------------
// URL Validation
// ---------------------------------------------------------------------------

/** Allowed URL schemes for credential matching and autofill. */
const ALLOWED_URL_SCHEMES = ['http:', 'https:'];

/**
 * Validate and sanitize a URL from extension input.
 *
 * Rules:
 * - Only `http://` and `https://` schemes are allowed.
 * - Rejects `javascript:`, `data:`, `file:`, `chrome:` etc.
 * - Rejects malformed or empty URLs.
 * - Returns the normalized URL string if valid, or null if invalid.
 *
 * @param input - Raw URL string from extension message or page.
 * @returns Sanitized URL string or null.
 */
export function sanitizeUrl(input: string): string | null {
  if (!input || typeof input !== 'string') return null;

  const trimmed = input.trim();
  if (trimmed.length === 0 || trimmed.length > 2048) return null; // length check

  try {
    const parsed = new URL(trimmed);

    // Only allow http and https
    if (!ALLOWED_URL_SCHEMES.includes(parsed.protocol)) {
      return null;
    }

    // Reject URLs with credentials (user:password@host)
    if (parsed.username || parsed.password) {
      return null;
    }

    // Reject URLs with empty hostname
    if (!parsed.hostname || parsed.hostname.length === 0) {
      return null;
    }

    return parsed.href;
  } catch {
    // Invalid URL
    return null;
  }
}

/**
 * Extract and validate the registrable domain from a URL.
 * Only allows http/https URLs.
 *
 * @param input - Raw URL string.
 * @returns The hostname (lowercase, www-prefix removed) or null.
 */
export function sanitizeDomain(input: string): string | null {
  const sanitized = sanitizeUrl(input);
  if (!sanitized) return null;

  try {
    const parsed = new URL(sanitized);
    return parsed.hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// String Sanitization
// ---------------------------------------------------------------------------

/**
 * Escape a string for safe rendering in HTML contexts.
 * Prevents XSS by encoding HTML special characters.
 *
 * This is the canonical function for all extension UI rendering.
 * Use it when inserting user-controlled data into innerHTML or HTML templates.
 *
 * @param str - Raw string input (may contain HTML).
 * @returns HTML-escaped string safe for innerHTML.
 */
export function escapeHtml(str: string): string {
  // Handle null/undefined gracefully
  if (str == null) return '';
  
  const div = document.createElement('div');
  div.textContent = String(str);
  return div.innerHTML;
}

/**
 * Strip HTML tags from a string, returning only text content.
 *
 * @param input - Raw string input that may contain HTML.
 * @returns Plain text with all HTML tags removed.
 */
export function stripHtmlTags(input: string): string {
  if (!input) return '';
  return input.replace(/<[^>]*>/g, '');
}

/**
 * Truncate a string to a maximum length, adding ellipsis if truncated.
 * Prevents excessively long strings from breaking the UI.
 *
 * @param input - String to truncate.
 * @param maxLength - Maximum allowed length (default 500).
 * @returns Truncated string with optional ellipsis.
 */
export function truncateString(input: string, maxLength: number = 500): string {
  if (!input) return '';
  if (input.length <= maxLength) return input;
  return input.slice(0, maxLength - 3) + '...';
}

/**
 * Sanitize a string for use as a display title.
 * Strips HTML, truncates, and removes non-printable characters.
 *
 * @param input - Raw title string.
 * @returns Sanitized title safe for display.
 */
export function sanitizeDisplayTitle(input: string): string {
  if (!input) return '';

  // Strip HTML tags first
  let clean = stripHtmlTags(input);

  // Remove non-printable and control characters (except newlines and tabs)
  clean = clean.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');

  // Normalize whitespace
  clean = clean.replace(/\s+/g, ' ').trim();

  // Truncate
  return truncateString(clean, 500);
}

/**
 * Sanitize a string for use as a username display.
 *
 * @param input - Raw username string.
 * @returns Sanitized username safe for display.
 */
export function sanitizeUsername(input: string): string {
  if (!input) return '';

  // Strip HTML tags
  let clean = stripHtmlTags(input);

  // Remove non-printable characters
  clean = clean.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');

  // Remove leading/trailing whitespace
  clean = clean.trim();

  return truncateString(clean, 200);
}

// ---------------------------------------------------------------------------
// Form Field Validation
// ---------------------------------------------------------------------------

/**
 * Validate a form field value for safe storage and display.
 *
 * @param value - Raw form field value.
 * @returns Sanitized value or null if empty.
 */
export function sanitizeFormField(value: string): string | null {
  if (!value || typeof value !== 'string') return null;

  const trimmed = value.trim();
  if (trimmed.length === 0) return null;

  // Strip control characters but keep printable Unicode
  const clean = trimmed.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');

  // Max reasonable length for a credential field
  if (clean.length > 4096) return null;

  return clean;
}

// ---------------------------------------------------------------------------
// Message Input Validation
// ---------------------------------------------------------------------------

/**
 * Validate that a tab URL from chrome.tabs.query is safe to process.
 *
 * @param url - URL from the tab object.
 * @returns True if the URL is a valid http/https page.
 */
export function isValidTabUrl(url: string | undefined): boolean {
  if (!url) return false;

  // Reject chrome://, about:, edge://, etc.
  if (url.startsWith('chrome://') || url.startsWith('about:') || url.startsWith('edge://')) {
    return false;
  }

  return sanitizeUrl(url) !== null;
}