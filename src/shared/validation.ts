import { MAX_FIELD_LENGTHS } from './constants';
import { sanitizeForField, type SanitizableField } from './sanitize';

/**
 * Character validation utilities for form input.
 * Supports Unicode/emoji while blocking dangerous control characters.
 */

/**
 * ASCII control characters \x00-\x1F (C0 controls) excluding newline (\n=0x0A) and tab (\t=0x09).
 * Intentionally matches control characters for security validation.
 */
// eslint-disable-next-line no-control-regex
const CONTROL_CHAR_REGEX = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

/** All C0 control characters including newline (\n=0x0A) and tab (\t=0x09) */
// eslint-disable-next-line no-control-regex
const ALL_CONTROL_CHAR_REGEX = /[\u0000-\u001F\u007F]/g;

function hasControlCharacters(value: string): boolean {
  CONTROL_CHAR_REGEX.lastIndex = 0;
  return CONTROL_CHAR_REGEX.test(value);
}

/**
 * Check if value contains only printable Unicode characters.
 * Allows all printable characters including emoji, CJK, RTL, etc.
 * Blocks only ASCII control characters (\x00-\x1F, \x7F).
 */
function containsOnlyPrintable(value: string): boolean {
  ALL_CONTROL_CHAR_REGEX.lastIndex = 0;
  return !ALL_CONTROL_CHAR_REGEX.test(value);
}

export interface ValidationError {
  field: string;
  messageKey: string;
  params?: Record<string, unknown>;
}

export type ValidationField =
  | 'folderName'
  | 'itemTitle'
  | 'username'
  | 'password'
  | 'url'
  | 'notes'
  | 'tagName'
  | 'vaultName';

export type { SanitizableField };

/**
 * Validates a field value for character restrictions.
 * Returns a validation error key if invalid, null if valid.
 *
 * Rules:
 * - folderName / itemTitle / tagName: Allow Unicode/emoji. Block control characters.
 * - username: Allow all printable Unicode. Block control characters.
 * - password: Allow all printable Unicode. Block control characters.
 * - url: Allow printable characters. Validate URL format.
 * - notes: Allow all printable Unicode. Allow newline and tab. Block other control characters.
 */
export function validateCharacters(field: ValidationField, value: string): string | null {
  if (value.length === 0) return null;

  switch (field) {
    case 'folderName':
    case 'itemTitle':
    case 'tagName':
    case 'vaultName': {
      if (hasControlCharacters(value)) {
        return 'validation.invalidCharacters';
      }
      return null;
    }

    case 'username':
    case 'password': {
      if (hasControlCharacters(value)) {
        return 'validation.invalidCharacters';
      }
      return null;
    }

    case 'url': {
      if (hasControlCharacters(value)) {
        return 'validation.invalidCharacters';
      }
      return null;
    }

    case 'notes': {
      if (hasControlCharacters(value)) {
        return 'validation.invalidCharacters';
      }
      return null;
    }

    default:
      return null;
  }
}

/**
 * Validates URL encoding. Returns the properly encoded URL or null if invalid.
 * Handles international domain names and special characters.
 */
export function sanitizeUrl(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) return '';

  let url = trimmed;
  if (!url.match(/^https?:\/\//i)) {
    url = `https://${url}`;
  }

  try {
    const parsed = new URL(url);
    return parsed.href;
  } catch {
    return trimmed;
  }
}

/**
 * Full field validation combining length and character checks.
 * Returns a validation error key if invalid, null if valid.
 */
export function validateField(field: ValidationField, value: string): string | null {
  const limits: Partial<Record<ValidationField, number>> = {
    folderName: MAX_FIELD_LENGTHS.FOLDER_NAME,
    itemTitle: MAX_FIELD_LENGTHS.ITEM_TITLE,
    username: MAX_FIELD_LENGTHS.USERNAME,
    password: MAX_FIELD_LENGTHS.PASSWORD,
    url: MAX_FIELD_LENGTHS.URL,
    notes: MAX_FIELD_LENGTHS.NOTES,
    tagName: MAX_FIELD_LENGTHS.TAG_NAME,
    vaultName: MAX_FIELD_LENGTHS.VAULT_NAME,
  };

  const max = limits[field];
  if (max !== undefined && value.length > max) {
    return 'validation.maxLength';
  }

  const charError = validateCharacters(field, value);
  if (charError) {
    return charError;
  }

  if (
    (field === 'folderName' || field === 'itemTitle') &&
    value.trim().length === 0 &&
    value.length > 0
  ) {
    return 'validation.whitespaceOnly';
  }

  if (field === 'url' && value.length > 0) {
    const urlToTest = value.startsWith('http') ? value : `https://${value}`;
    try {
      new URL(urlToTest);
    } catch {
      return 'validation.urlWarning';
    }
  }

  return null;
}

/**
 * Strips control characters from a value while preserving newlines and tabs.
 */
export function stripControlChars(value: string): string {
  return value.replace(CONTROL_CHAR_REGEX, '');
}

/**
 * Sanitize a value for a given plain-text field. Strips HTML tags and
 * decodes entities so the stored value contains only the visible text
 * (no executable markup). The result is safe to pass through
 * `validateField` and to persist to the database.
 *
 * For `notes` (rich text) and other non-plain-text fields, this is a
 * no-op — the caller must sanitize rich text via DOMPurify (handled in
 * Sub-Task 3.2).
 */
export function sanitizeField(field: ValidationField, value: string): string {
  if (field === 'notes') {
    return value ?? '';
  }
  return sanitizeForField(field as SanitizableField, value);
}

/**
 * Sanitize a value and then validate it. Returns both the sanitized
 * value and the validation error key (or null). Use this at every input
 * boundary so plain-text fields cannot contain HTML markup.
 */
export function sanitizeAndValidateField(
  field: ValidationField,
  value: string,
): { sanitized: string; errorKey: string | null } {
  const sanitized = sanitizeField(field, value);
  const errorKey = validateField(field, sanitized);
  return { sanitized, errorKey };
}

/**
 * Strips all control characters including newlines and tabs.
 */
export function stripAllControlChars(value: string): string {
  return value.replace(ALL_CONTROL_CHAR_REGEX, '');
}

/**
 * Normalizes a folder/item name for comparison (trim + lowercase + NFC normalization).
 * Used for duplicate detection.
 */
export function normalizeForComparison(value: string): string {
  return value.trim().toLowerCase().normalize('NFC');
}

// Names that are confusing or reserved after trimming.
const CONFUSING_VAULT_NAMES = new Set(['.', '..', '...', '~']);

/**
 * Comprehensive vault name validation.
 *
 * Rules:
 * - Must be non-empty after trimming whitespace.
 * - Maximum 100 characters after trimming.
 * - Must not contain ASCII control characters.
 * - Must not be a confusing name like `.` or `..`.
 *
 * @returns A validation error key if invalid, null if valid.
 */
export function validateVaultName(name: string): string | null {
  if (name === null || name === undefined) return 'validation.required';

  const trimmed = name.trim();

  if (trimmed.length === 0) {
    return 'validation.required';
  }

  if (trimmed.length > MAX_FIELD_LENGTHS.VAULT_NAME) {
    return 'validation.maxLength';
  }

  if (hasControlCharacters(trimmed)) {
    return 'validation.invalidCharacters';
  }

  if (CONFUSING_VAULT_NAMES.has(trimmed)) {
    return 'validation.invalidVaultName';
  }

  return null;
}
