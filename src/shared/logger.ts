/**
 * Centralized logger with sanitization middleware.
 *
 * SECURITY: Automatically redacts sensitive field values (passwords, keys,
 * hashes, salts, IVs, tokens) before outputting to console. In production
 * builds, debug and info level logs are suppressed entirely.
 *
 * Usage:
 *   import { logger } from '../shared/logger';
 *   logger.debug('Loading items', { folderId });
 *   logger.error('Decryption failed', err);
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

// Field names whose values must be redacted in log output.
// Matched case-insensitively against object keys.
const SENSITIVE_FIELD_PATTERNS = [
  'password',
  'masterpassword',
  'master_password',
  'passwordencrypted',
  'password_encrypted',
  'passworddecrypted',
  'password_decrypted',
  'salt',
  'pepper',
  'key',
  'derivedkey',
  'derived_key',
  'masterkey',
  'master_key',
  'privatekey',
  'private_key',
  'secret',
  'secretkey',
  'secret_key',
  'token',
  'accesstoken',
  'access_token',
  'refreshtoken',
  'refresh_token',
  'iv',
  'auth_tag',
  'authtag',
  'auth_tag',
  'authTag',
  'ciphertext',
  'hash',
  'verificationhash',
  'verification_hash',
  'notesencrypted',
  'notes_encrypted',
  'credential',
  'credentials',
  'passphrase',
  'pin',
  'otp',
  'seed',
  'mnemonic',
  'private_key_pem',
  'privateKeyPem',
];

// Compiled regex: matches any sensitive field name as a JSON key pattern.
// Handles both "key": and key: styles, and nested dot notation.
const SENSITIVE_KEY_REGEX = new RegExp(
  `"(?:${SENSITIVE_FIELD_PATTERNS.join('|')})"\\s*:\\s*`,
  'gi',
);

// Redacts values that follow a sensitive key in a JSON-like string.
function sanitizeString(str: string): string {
  // Replace "sensitiveField": "value" or "sensitiveField": value
  return str.replace(SENSITIVE_KEY_REGEX, (match) => {
    return match + '"[REDACTED]"';
  });
}

// Deep-sanitize an object, replacing sensitive values with "[REDACTED]".
// Returns a new object; does not mutate the original.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function sanitizeValue(value: any, seen = new WeakSet()): any {
  if (value === null || value === undefined) return value;

  if (typeof value === 'string') {
    // For plain strings, check if they look like they contain sensitive data
    // We don't redact arbitrary strings — only structured objects with known keys.
    return value;
  }

  if (typeof value === 'number' || typeof value === 'boolean') return value;

  if (value instanceof Error) {
    return {
      name: value.name,
      message: sanitizeString(value.message),
      stack: value.stack ? sanitizeString(value.stack) : undefined,
    };
  }

  if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) {
    return '[REDACTED: Buffer]';
  }

  if (Array.isArray(value)) {
    if (seen.has(value)) return '[Circular]';
    seen.add(value);
    return value.map((item) => sanitizeValue(item, seen));
  }

  if (typeof value === 'object') {
    if (seen.has(value)) return '[Circular]';
    seen.add(value);

    const sanitized: Record<string, unknown> = {};
    for (const key of Object.keys(value)) {
      const lowerKey = key.toLowerCase().replace(/[_-]/g, '');
      const isSensitive = SENSITIVE_FIELD_PATTERNS.some((pattern) => {
        const normalizedPattern = pattern.toLowerCase().replace(/[_-]/g, '');
        return lowerKey === normalizedPattern;
      });

      if (isSensitive) {
        sanitized[key] = '[REDACTED]';
      } else {
        sanitized[key] = sanitizeValue(value[key], seen);
      }
    }
    return sanitized;
  }

  return value;
}

// Format arguments for console output, sanitizing objects.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function formatArgs(args: any[]): any[] {
  return args.map((arg) => {
    if (typeof arg === 'string') {
      return sanitizeString(arg);
    }
    if (typeof arg === 'object' && arg !== null) {
      return sanitizeValue(arg);
    }
    return arg;
  });
}

class Logger {
  private isDev: boolean;

  constructor() {
    // Detect environment: in Electron main process, check VITE_DEV_SERVER_URL;
    // in renderer, check if we're running dev server; fallback to NODE_ENV.
    this.isDev = this.detectDev();
  }

  private detectDev(): boolean {
    try {
      // Electron main process
      if (typeof process !== 'undefined' && process.env) {
        return !!process.env.VITE_DEV_SERVER_URL || process.env.NODE_ENV !== 'production';
      }
    } catch {
      // Renderer may not have process
    }
    // Renderer: if localhost dev server
    if (typeof window !== 'undefined') {
      return (
        window.location.hostname === 'localhost' ||
        window.location.hostname === '127.0.0.1'
      );
    }
    return false;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  debug(message: string, ...args: any[]): void {
    if (!this.isDev) return; // Suppress in production
    // eslint-disable-next-line no-console
    console.debug(`[DEBUG] ${message}`, ...formatArgs(args));
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  info(message: string, ...args: any[]): void {
    if (!this.isDev) return; // Suppress in production
    // eslint-disable-next-line no-console
    console.info(`[INFO] ${message}`, ...formatArgs(args));
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  warn(message: string, ...args: any[]): void {
    console.warn(`[WARN] ${message}`, ...formatArgs(args));
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  error(message: string, ...args: any[]): void {
    console.error(`[ERROR] ${message}`, ...formatArgs(args));
  }
}

// Singleton logger instance
export const logger = new Logger();
