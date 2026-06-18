/**
 * Native Messaging Host Manifest
 *
 * Generates and manages the native messaging host manifest JSON required by
 * Chrome, Firefox, and Edge to locate and communicate with the Electron app.
 *
 * The manifest is a JSON file with the following structure:
 * {
 *   "name": "com.securepass.manager",
 *   "description": "SecurePass Manager Native Messaging Host",
 *   "path": "/absolute/path/to/executable",
 *   "type": "stdio",
 *   "allowed_origins": ["chrome-extension://<ID>/"]
 * }
 *
 * @module native-host/manifest
 */

import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { logger } from '../../shared/logger';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Canonical native messaging host name (must match browser extension ID references). */
export const NATIVE_HOST_NAME = 'com.securepass.manager';

/** Human-readable description for the manifest. */
export const NATIVE_HOST_DESCRIPTION = 'SecurePass Manager Native Messaging Host';

/** Communication type — always stdio for native messaging. */
export const NATIVE_HOST_TYPE = 'stdio' as const;

/** Supported browser extension ID placeholder prefix. */
export const CHROME_EXTENSION_PREFIX = 'chrome-extension://';
export const FIREFOX_EXTENSION_PREFIX = 'moz-extension://';
export const EDGE_EXTENSION_PREFIX = 'chrome-extension://';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Native messaging host manifest structure.
 * Compliant with Chrome/Firefox/Edge native messaging host manifest spec.
 */
export interface NativeHostManifest {
  /** Unique host identifier (reverse-domain format). */
  name: string;
  /** Human-readable description. */
  description: string;
  /** Absolute path to the native messaging host executable. */
  path: string;
  /** Communication type — must be "stdio". */
  type: typeof NATIVE_HOST_TYPE;
  /** List of allowed extension origins that may connect. */
  allowed_origins: string[];
}

/** Supported browser identifiers for manifest registration. */
export type BrowserId = 'chrome' | 'firefox' | 'edge';

/** Platform identifiers matching Node.js `process.platform`. */
export type PlatformId = 'win32' | 'darwin' | 'linux';

/** Options for generating a manifest. */
export interface ManifestOptions {
  /** Absolute path to the host executable (Electron app or helper binary). */
  hostPath: string;
  /** List of extension IDs to allow (full origin strings or bare IDs). */
  allowedExtensionIds: string[];
  /** Optional description override. */
  description?: string;
}

// ---------------------------------------------------------------------------
// Manifest Generation
// ---------------------------------------------------------------------------

/**
 * Generates a native messaging host manifest.
 *
 * @param options - Manifest configuration.
 * @returns A valid NativeHostManifest object.
 * @throws Error if hostPath is empty or no extension IDs are provided.
 */
export function generateManifest(options: ManifestOptions): NativeHostManifest {
  const { hostPath, allowedExtensionIds, description } = options;

  if (!hostPath || hostPath.trim().length === 0) {
    throw new Error('Host executable path must be a non-empty string.');
  }

  if (!allowedExtensionIds || allowedExtensionIds.length === 0) {
    throw new Error('At least one allowed extension ID must be provided.');
  }

  // Normalize extension IDs to full origin format
  const allowedOrigins = allowedExtensionIds.map(normalizeExtensionOrigin);

  return {
    name: NATIVE_HOST_NAME,
    description: description ?? NATIVE_HOST_DESCRIPTION,
    path: hostPath,
    type: NATIVE_HOST_TYPE,
    allowed_origins: allowedOrigins,
  };
}

/**
 * Normalizes a bare extension ID into a full origin string.
 *
 * - If already a full origin (starts with `chrome-extension://` or `moz-extension://`), returns as-is.
 * - Otherwise, wraps it with `chrome-extension://<id>/`.
 *
 * @param id - Bare extension ID or full origin string.
 * @returns Normalized origin string.
 */
export function normalizeExtensionOrigin(id: string): string {
  const trimmed = id.trim();

  if (
    trimmed.startsWith(CHROME_EXTENSION_PREFIX) ||
    trimmed.startsWith(FIREFOX_EXTENSION_PREFIX)
  ) {
    return trimmed;
  }

  // Bare ID — wrap with chrome-extension:// prefix
  return `${CHROME_EXTENSION_PREFIX}${trimmed}/`;
}

// ---------------------------------------------------------------------------
// Platform-Specific Path Resolution
// ---------------------------------------------------------------------------

/**
 * Returns the platform-specific directory where the native messaging host
 * manifest should be installed for a given browser.
 *
 * @param platform - Target platform (defaults to current platform).
 * @param browser - Target browser.
 * @returns Absolute directory path for the manifest.
 */
export function getManifestDirectory(platform?: PlatformId, browser?: BrowserId): string {
  const plat = platform ?? (process.platform as PlatformId);
  const browserDir = getBrowserConfigDir(browser);

  switch (plat) {
    case 'win32':
      return join(
        process.env.APPDATA || join(process.env.USERPROFILE || '', 'AppData', 'Roaming'),
        browserDir,
        'NativeMessagingHosts',
      );

    case 'darwin':
      return join(
        process.env.HOME || '/Users',
        'Library',
        'Application Support',
        browserDir,
        'NativeMessagingHosts',
      );

    case 'linux':
      return join(
        process.env.HOME || '/home',
        '.config',
        browserDir,
        'NativeMessagingHosts',
      );

    default:
      throw new Error(`Unsupported platform: ${plat}`);
  }
}

/**
 * Returns the full manifest file path (directory + filename).
 *
 * @param platform - Target platform.
 * @param browser - Target browser.
 * @returns Absolute file path for the manifest JSON.
 */
export function getManifestPath(platform?: PlatformId, browser?: BrowserId): string {
  return join(getManifestDirectory(platform, browser), `${NATIVE_HOST_NAME}.json`);
}

/**
 * Returns the browser-specific config directory name.
 *
 * @param browser - Browser identifier.
 * @returns Directory name used in the platform-specific path.
 */
function getBrowserConfigDir(browser?: BrowserId): string {
  switch (browser) {
    case 'chrome':
      return 'google-chrome';
    case 'firefox':
      return 'mozilla';
    case 'edge':
      return 'microsoft-edge';
    default:
      // Default to Chrome for generic usage
      return 'google-chrome';
  }
}

/**
 * Resolves the absolute path to the host executable.
 *
 * In production, this is the packaged Electron app. During development,
 * it may point to the Electron binary.
 *
 * @param appPath - Optional override (e.g., from `app.getPath('exe')`).
 * @returns Absolute path to the host executable.
 */
export function getHostExecutablePath(appPath?: string): string {
  if (appPath && appPath.trim().length > 0) {
    return appPath;
  }

  // In Electron, app.getPath('exe') returns the path to the running executable
  try {
    // Dynamic import to avoid issues when testing outside Electron
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const electron = require('electron');
    const electronApp = electron?.app;
    if (electronApp?.getPath) {
      return electronApp.getPath('exe');
    }
  } catch {
    // Not in Electron context — fall through to error
  }

  throw new Error(
    'Unable to determine host executable path. ' +
      'Provide an explicit path or run within Electron.',
  );
}

/**
 * Checks whether a manifest file already exists at the specified path.
 *
 * @param manifestPath - Path to check.
 * @returns true if the file exists.
 */
export function manifestExistsAt(manifestPath: string): boolean {
  return existsSync(manifestPath);
}

/**
 * Serializes a manifest to pretty-printed JSON.
 *
 * @param manifest - The manifest object.
 * @returns JSON string with 2-space indentation.
 */
export function serializeManifest(manifest: NativeHostManifest): string {
  return JSON.stringify(manifest, null, 2);
}

/**
 * Validates a manifest object for required fields and correct types.
 *
 * @param data - Unknown data to validate.
 * @returns An object with `ok: true` and the validated manifest, or `ok: false` with an error message.
 */
export function validateManifest(data: unknown): { ok: true; manifest: NativeHostManifest } | { ok: false; error: string } {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return { ok: false, error: 'Manifest must be a non-null JSON object.' };
  }

  const obj = data as Record<string, unknown>;

  if (typeof obj.name !== 'string' || obj.name.trim().length === 0) {
    return { ok: false, error: 'Manifest "name" must be a non-empty string.' };
  }

  if (typeof obj.description !== 'string') {
    return { ok: false, error: 'Manifest "description" must be a string.' };
  }

  if (typeof obj.path !== 'string' || obj.path.trim().length === 0) {
    return { ok: false, error: 'Manifest "path" must be a non-empty string.' };
  }

  if (obj.type !== NATIVE_HOST_TYPE) {
    return { ok: false, error: `Manifest "type" must be "${NATIVE_HOST_TYPE}", got "${obj.type}".` };
  }

  if (!Array.isArray(obj.allowed_origins)) {
    return { ok: false, error: 'Manifest "allowed_origins" must be an array.' };
  }

  for (const origin of obj.allowed_origins) {
    if (typeof origin !== 'string') {
      return { ok: false, error: 'Each entry in "allowed_origins" must be a string.' };
    }
  }

  const manifest: NativeHostManifest = {
    name: obj.name as string,
    description: obj.description as string,
    path: obj.path as string,
    type: NATIVE_HOST_TYPE,
    allowed_origins: obj.allowed_origins as string[],
  };

  return { ok: true, manifest };
}
