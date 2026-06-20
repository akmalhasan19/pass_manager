export const APP_NAME = 'SecurePass Manager';
export const APP_VERSION = '0.1.0';

export const DEFAULT_AUTO_LOCK_TIME = 5 * 60 * 1000;
export const MIN_PASSWORD_LENGTH = 4;
export const MAX_PASSWORD_LENGTH = 128;
export const DEFAULT_PASSWORD_LENGTH = 20;

export const PASSWORD_HEALTH_WEAK_THRESHOLD = 12;
export const PASSWORD_HEALTH_OLD_DAYS = 90;

export const TRASH_AUTO_PURGE_DAYS = 30;

export const SIDEBAR_WIDTH = 260;
export const SIDEBAR_COLLAPSED_WIDTH = 56;
export const QUICK_FIND_MAX_RESULTS = 20;

export const MAX_FIELD_LENGTHS = {
  FOLDER_NAME: 100,
  ITEM_TITLE: 255,
  USERNAME: 500,
  PASSWORD: 4096,
  URL: 2048,
  NOTES: 100000,
  TAG_NAME: 50,
  MAX_TAGS_PER_ITEM: 10,
  VAULT_NAME: 100,
  VAULT_DESCRIPTION: 500,
} as const;

export const VAULT_REGISTRY_VERSION = 1;

/** Current version of the KDF metadata format.
 *  v1: Flat-format KDF params (kdfIterations, kdfMemory, kdfParallelism).
 *      Absence of this field implies legacy pre-v1 format (same layout).
 *  v2: Adds migratedAt timestamp for Argon2id migration audit trail.
 */
export const KDF_VERSION = 2;

/** RFC 6238 OTP default values */
export const OTP_DEFAULTS = {
  PERIOD: 30,
  DIGITS: 6,
  ALGORITHM: 'SHA1',
} as const;

/** Valid TOTP period values in seconds */
export const OTP_VALID_PERIODS = [30, 60] as const;

/** Valid TOTP digit lengths */
export const OTP_VALID_DIGITS = [6, 8] as const;

/** Valid HMAC algorithms per RFC 6238 */
export const OTP_VALID_ALGORITHMS = ['SHA1', 'SHA256', 'SHA512'] as const;

/** Union type of valid TOTP algorithms */
export type TotpAlgorithm = (typeof OTP_VALID_ALGORITHMS)[number];

// ---------------------------------------------------------------------------
// Browser Extension Security
// ---------------------------------------------------------------------------

/** Browser extension origin prefixes by browser. */
export const EXTENSION_ORIGIN_PREFIXES = {
  chrome: 'chrome-extension://',
  firefox: 'moz-extension://',
  edge: 'chrome-extension://',
} as const;

/**
 * Whitelisted browser extension IDs.
 *
 * Only extensions with these IDs are authorized to communicate with the host.
 * In production, these are the published Chrome Web Store / Firefox Add-on IDs.
 * For development, add the unpacked extension ID here.
 *
 * Format: bare ID (e.g. "abcdefghijklmnopabcdefghijklmnop") or
 *         full origin (e.g. "chrome-extension://abcdefghijklmnop/").
 */
export const ALLOWED_EXTENSION_IDS: readonly string[] = [
  // Production Chrome Web Store ID (replace with actual published ID)
  'securepass-chrome-extension-placeholder',
  // Production Firefox Add-on ID
  'securepass-firefox-extension-placeholder',
];

/** Maximum age of a handshake initiation message in milliseconds (30 seconds). */
export const HANDSHAKE_INIT_MAX_AGE_MS = 30_000;

/** Extension validation error messages. */
export const EXTENSION_ERRORS = {
  UNAUTHORIZED: 'Extension ID is not authorized. Check the whitelist configuration.',
  MISSING_EXTENSION_ID: 'Extension must provide its ID during handshake.',
  INVALID_EXTENSION_ID: 'Invalid extension ID format.',
} as const;
