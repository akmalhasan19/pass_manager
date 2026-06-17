import { MAX_FIELD_LENGTHS, OTP_DEFAULTS, OTP_VALID_DIGITS, OTP_VALID_ALGORITHMS } from './constants';
import type { TotpConfig } from './types';
import type { TotpAlgorithm } from './constants';
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
  | 'vaultName'
  | 'otpSecret';

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

const BASE32_REGEX = /^[A-Z2-7]+=*$/;
const BASE32_CHARS_REGEX = /^[A-Z2-7]+$/;

/**
 * Validates that a string is a valid RFC 4648 base32-encoded secret.
 *
 * Rules:
 * - Must be non-empty.
 * - Must contain only characters from the base32 alphabet (A-Z, 2-7).
 * - Optional padding (`=`) is allowed at the end.
 * - Leading/trailing whitespace is not allowed.
 *
 * @param secret - The base32 string to validate.
 * @returns true if the secret is valid base32, false otherwise.
 */
export function isValidBase32(secret: string): boolean {
  if (!secret || secret.length === 0) return false;
  return BASE32_REGEX.test(secret);
}

/**
 * Adds correct RFC 4648 padding to a base32 string if missing.
 *
 * Base32 encoded strings must have a length that is a multiple of 8.
 * If the input is not padded, this function appends the necessary `=`
 * characters to make it valid.
 *
 * @param secret - The base32 string (already uppercased, no spaces).
 * @returns The base32 string with correct `=` padding.
 */
export function fixBase32Padding(secret: string): string {
  const remainder = secret.length % 8;
  if (remainder === 0) return secret;
  return secret + '='.repeat(8 - remainder);
}

/**
 * Normalizes a raw TOTP secret string for processing and storage.
 *
 * Steps performed:
 * 1. Strips all whitespace (spaces, tabs, newlines).
 * 2. Strips common visual separators (hyphens, underscores, colons, periods).
 * 3. Converts to uppercase (base32 alphabet is case-insensitive per RFC 4648).
 * 4. Removes any existing padding and re-applies correct padding.
 *
 * NOTE: Non-base32 characters are NOT filtered out — they are preserved so
 * that validation functions can detect and reject them. If you need to
 * sanitize AND validate, use `sanitizeBase32Secret()` instead.
 *
 * @param secret - The raw secret input (from user, QR code, paste, etc.).
 * @returns The normalized base32 secret string. Returns empty string if input is empty.
 */
export function normalizeBase32Secret(secret: string): string {
  if (!secret) return '';

  let normalized = secret.replace(/\s+/g, '');
  normalized = normalized.replace(/[-_:.\s]/g, '');
  normalized = normalized.toUpperCase();
  normalized = normalized.replace(/=+$/, '');

  return fixBase32Padding(normalized);
}

/**
 * Validates a TOTP secret string.
 *
 * Rules:
 * - Must be non-empty.
 * - Must be valid base32-encoded.
 * - Must be at least 16 characters (minimum recommended key length).
 * - Strips whitespace and uppercases before validation.
 *
 * @param secret - The raw OTP secret to validate.
 * @returns A validation error key if invalid, null if valid.
 */
export function validateTotpSecret(secret: string): string | null {
  if (!secret || secret.trim().length === 0) {
    return 'validation.required';
  }

  const normalized = normalizeBase32Secret(secret);
  const stripped = normalized.replace(/=+$/, '');

  if (!BASE32_CHARS_REGEX.test(stripped)) {
    return 'validation.invalidBase32';
  }

  if (stripped.length < 16) {
    return 'validation.otpSecretTooShort';
  }

  return null;
}

/**
 * Sanitize and parse a raw TOTP secret, returning the normalized form
 * along with a user-friendly error message if the secret is invalid.
 *
 * This is the primary entry point for processing TOTP secrets from any
 * input source (manual entry, QR code scan, import, etc.). It normalizes
 * the secret and provides descriptive error messages. Non-base32 characters
 * are rejected, not silently filtered.
 *
 * @param secret - The raw secret input.
 * @returns An object with:
 *   - `sanitized`: The normalized base32 secret (empty on failure).
 *   - `error`: A user-facing error key, or null if valid.
 */
export function sanitizeBase32Secret(secret: string): { sanitized: string; error: string | null } {
  if (!secret || secret.trim().length === 0) {
    return { sanitized: '', error: 'validation.required' };
  }

  const normalized = normalizeBase32Secret(secret);
  const stripped = normalized.replace(/=+$/, '');

  if (!BASE32_CHARS_REGEX.test(stripped)) {
    return { sanitized: normalized, error: 'validation.invalidBase32' };
  }

  if (stripped.length < 16) {
    return { sanitized: normalized, error: 'validation.otpSecretTooShort' };
  }

  return { sanitized: normalized, error: null };
}

/**
 * Describes a TOTP config where only `secret` is required;
 * `period`, `digits`, and `algorithm` are optional and will be
 * filled with defaults when missing.
 */
export interface PartialTotpConfig {
  secret: string;
  period?: number;
  digits?: number;
  algorithm?: string;
}

/**
 * Validates a fully-formed TotpConfig's non-secret fields.
 *
 * Checks:
 * - `period` is a positive integer (commonly 30 or 60).
 * - `digits` is one of the supported values.
 * - `algorithm` is one of the supported RFC 6238 HMAC algorithms.
 *
 * @param config - The TotpConfig to validate.
 * @returns A validation error key if invalid, null if valid.
 */
export function validateTotpConfig(config: TotpConfig): string | null {
  if (!Number.isInteger(config.period) || config.period < 1) {
    return 'validation.invalidOtpPeriod';
  }
  if (!OTP_VALID_DIGITS.includes(config.digits as 6 | 8)) {
    return 'validation.invalidOtpDigits';
  }
  if (!OTP_VALID_ALGORITHMS.includes(config.algorithm as TotpAlgorithm)) {
    return 'validation.invalidOtpAlgorithm';
  }
  return null;
}

/**
 * Sanitizes and validates a partial (or full) TOTP configuration.
 *
 * 1. Normalises the secret via `sanitizeBase32Secret`.
 * 2. Fills in defaults for `period`, `digits`, and `algorithm` if not provided.
 * 3. Validates all fields and returns a cleaned TotpConfig or an error key.
 *
 * This is the single entry‑point the IPC handlers should use for any
 * OTP configuration coming from the renderer.
 *
 * @param config - Partial or full TOTP config (only `secret` is required).
 * @returns An object with a sanitized TotpConfig and an optional error key.
 */
export function sanitizeTotpConfig(
  config: PartialTotpConfig,
): { sanitized: TotpConfig; error: string | null } {
  const { sanitized: sanitizedSecret, error: secretError } = sanitizeBase32Secret(config.secret);

  const period = config.period ?? OTP_DEFAULTS.PERIOD;
  const digits = config.digits ?? OTP_DEFAULTS.DIGITS;
  const algorithm = (config.algorithm ?? OTP_DEFAULTS.ALGORITHM).toUpperCase();

  const sanitized: TotpConfig = {
    secret: sanitizedSecret,
    period,
    digits,
    algorithm,
  };

  if (secretError) {
    return { sanitized, error: secretError };
  }

  const configError = validateTotpConfig(sanitized);
  if (configError) {
    return { sanitized, error: configError };
  }

  return { sanitized, error: null };
}
