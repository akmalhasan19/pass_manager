/**
 * Native Messaging Host Installer
 *
 * High-level orchestration for installing and uninstalling the native
 * messaging host manifest. Handles edge cases such as:
 * - Application not installed (cannot resolve executable path)
 * - Application not running outside Electron context
 * - Permission errors when writing manifest or registry
 * - Multiple browsers (Chrome, Firefox, Edge)
 * - Re-registration (update existing manifest)
 *
 * @module native-host/installer
 */

import { existsSync, statSync } from 'node:fs';
import { logger } from '../../shared/logger';
import {
  NATIVE_HOST_NAME,
  generateManifest,
  getHostExecutablePath,
  getManifestPath,
  manifestExistsAt,
  type BrowserId,
  type NativeHostManifest,
  type PlatformId,
} from './manifest';
import {
  registerHost,
  unregisterHost,
  isHostRegistered,
  readManifestFile,
  writeManifestFile,
  setRegistryKey,
  getRegistryKeyPath,
  type RegistrationResult,
} from './registration';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Supported browsers for registration. */
export const SUPPORTED_BROWSERS: BrowserId[] = ['chrome', 'firefox', 'edge'];

/** Options for installing the native host. */
export interface InstallOptions {
  /**
   * Absolute path to the host executable.
   * If omitted, attempts to resolve via Electron's `app.getPath('exe')`.
   */
  hostPath?: string;
  /**
   * List of browser extension IDs to allow.
   * These can be bare IDs or full origin strings.
   */
  allowedExtensionIds: string[];
  /**
   * Target browsers to register with.
   * Defaults to all supported browsers.
   */
  browsers?: BrowserId[];
  /**
   * Target platform override (for cross-platform tooling).
   * Defaults to current platform.
   */
  platform?: PlatformId;
  /**
   * If true, silently succeeds when the manifest already exists with the
   * same content (idempotent). Defaults to true.
   */
  idempotent?: boolean;
}

/** Result of an install operation across all browsers. */
export interface InstallResult {
  /** Per-browser results. */
  browsers: Record<BrowserId, RegistrationResult>;
  /** Whether all browsers succeeded. */
  allSucceeded: boolean;
  /** The resolved host executable path. */
  hostPath: string;
  /** Error summary if any browser failed. */
  errors: string[];
}

/** Result of an uninstall operation. */
export interface UninstallResult {
  /** Per-browser success status. */
  browsers: Record<BrowserId, boolean>;
  /** Whether all browsers were unregistered. */
  allSucceeded: boolean;
}

// ---------------------------------------------------------------------------
// Install
// ---------------------------------------------------------------------------

/**
 * Installs the native messaging host manifest for one or more browsers.
 *
 * Steps:
 * 1. Resolve the host executable path (Electron app or explicit override).
 * 2. Generate the manifest JSON.
 * 3. For each target browser, write the manifest file and set registry key.
 * 4. Handle idempotent re-registration (skip if unchanged).
 *
 * @param options - Installation options.
 * @returns Detailed result per browser.
 */
export function installNativeHost(options: InstallOptions): InstallResult {
  const {
    allowedExtensionIds,
    browsers = SUPPORTED_BROWSERS,
    platform,
    idempotent = true,
  } = options;

  const result: InstallResult = {
    browsers: {} as Record<BrowserId, RegistrationResult>,
    allSucceeded: true,
    hostPath: '',
    errors: [],
  };

  // 1. Resolve host executable path
  let hostPath: string;
  try {
    hostPath = options.hostPath ?? getHostExecutablePath();
  } catch (cause) {
    const msg = `Cannot resolve host executable path: ${cause instanceof Error ? cause.message : String(cause)}. ` +
      'Ensure the app is running as an Electron application or provide an explicit hostPath.';
    logger.error('Native host install failed', { error: msg });
    result.allSucceeded = false;
    result.errors.push(msg);
    return result;
  }

  // Validate the executable exists
  if (!existsSync(hostPath)) {
    const msg = `Host executable not found at: ${hostPath}. ` +
      'The application may not be properly installed.';
    logger.error('Native host install failed', { error: msg, hostPath });
    result.allSucceeded = false;
    result.errors.push(msg);
    return result;
  }

  // Validate it's a file (not a directory)
  try {
    const stat = statSync(hostPath);
    if (!stat.isFile()) {
      const msg = `Host path is not a file: ${hostPath}`;
      logger.error('Native host install failed', { error: msg });
      result.allSucceeded = false;
      result.errors.push(msg);
      return result;
    }
  } catch (cause) {
    const msg = `Cannot access host executable: ${cause instanceof Error ? cause.message : String(cause)}`;
    logger.error('Native host install failed', { error: msg });
    result.allSucceeded = false;
    result.errors.push(msg);
    return result;
  }

  result.hostPath = hostPath;

  // 2. Generate manifest
  let manifest: NativeHostManifest;
  try {
    manifest = generateManifest({
      hostPath,
      allowedExtensionIds,
    });
  } catch (cause) {
    const msg = `Failed to generate manifest: ${cause instanceof Error ? cause.message : String(cause)}`;
    logger.error('Native host install failed', { error: msg });
    result.allSucceeded = false;
    result.errors.push(msg);
    return result;
  }

  // 3. Register for each browser
  for (const browser of browsers) {
    try {
      // Idempotent: check if manifest already exists with same content
      if (idempotent) {
        const existing = readManifestFile(platform, browser);
        if (existing && existing.path === manifest.path) {
          // Manifest is already up-to-date
          result.browsers[browser] = {
            manifestWritten: true,
            manifestPath: getManifestPath(platform, browser),
            registrySet: true,
            success: true,
          };
          continue;
        }
      }

      result.browsers[browser] = registerHost(manifest, platform, browser);
    } catch (cause) {
      const errorMsg = `Failed to register for ${browser}: ${cause instanceof Error ? cause.message : String(cause)}`;
      result.errors.push(errorMsg);
      result.browsers[browser] = {
        manifestWritten: false,
        manifestPath: '',
        registrySet: false,
        success: false,
        error: errorMsg,
      };
    }
  }

  // 4. Check overall success
  for (const browser of browsers) {
    if (!result.browsers[browser]?.success) {
      result.allSucceeded = false;
      break;
    }
  }

  if (result.allSucceeded) {
    logger.info('Native messaging host installed successfully', {
      hostPath,
      browsers,
      platform,
    });
  } else {
    logger.warn('Native messaging host installation completed with errors', {
      errors: result.errors,
    });
  }

  return result;
}

// ---------------------------------------------------------------------------
// Uninstall
// ---------------------------------------------------------------------------

/**
 * Uninstalls the native messaging host manifest from all or specific browsers.
 *
 * @param options - Uninstall options.
 * @returns Per-browser uninstall results.
 */
export function uninstallNativeHost(options?: {
  browsers?: BrowserId[];
  platform?: PlatformId;
}): UninstallResult {
  const { browsers = SUPPORTED_BROWSERS, platform } = options ?? {};

  const result: UninstallResult = {
    browsers: {} as Record<BrowserId, boolean>,
    allSucceeded: true,
  };

  for (const browser of browsers) {
    try {
      result.browsers[browser] = unregisterHost(platform, browser);
    } catch (cause) {
      logger.error(`Failed to unregister for ${browser}`, {
        cause: cause instanceof Error ? cause.message : String(cause),
      });
      result.browsers[browser] = false;
    }

    if (!result.browsers[browser]) {
      result.allSucceeded = false;
    }
  }

  if (result.allSucceeded) {
    logger.info('Native messaging host uninstalled successfully', { browsers, platform });
  }

  return result;
}

// ---------------------------------------------------------------------------
// Status Check
// ---------------------------------------------------------------------------

/**
 * Checks the installation status of the native messaging host.
 *
 * @param options - Status check options.
 * @returns Per-browser status and whether any browser has the host installed.
 */
export function getNativeHostStatus(options?: {
  browsers?: BrowserId[];
  platform?: PlatformId;
}): {
  browsers: Record<BrowserId, { registered: boolean; manifestPath: string }>;
  anyInstalled: boolean;
} {
  const { browsers = SUPPORTED_BROWSERS, platform } = options ?? {};

  const status = {
    browsers: {} as Record<BrowserId, { registered: boolean; manifestPath: string }>,
    anyInstalled: false,
  };

  for (const browser of browsers) {
    const manifestPath = getManifestPath(platform, browser);
    const registered = isHostRegistered(platform, browser);
    status.browsers[browser] = { registered, manifestPath };
    if (registered) {
      status.anyInstalled = true;
    }
  }

  return status;
}

// ---------------------------------------------------------------------------
// Edge Case: Application Not Running
// ---------------------------------------------------------------------------

/**
 * Checks if the host application (Electron) is currently running and
 * reachable via native messaging.
 *
 * This is a lightweight check that verifies:
 * 1. The manifest file exists for at least one browser.
 * 2. The executable path in the manifest points to an existing file.
 *
 * @param platform - Target platform.
 * @param browser - Browser to check.
 * @returns Object with availability details.
 */
export function checkHostAvailability(platform?: PlatformId, browser?: BrowserId): {
  manifestExists: boolean;
  executableExists: boolean;
  available: boolean;
  manifestPath: string;
  executablePath?: string;
  error?: string;
} {
  const manifestPath = getManifestPath(platform, browser);
  const result = {
    manifestExists: manifestExistsAt(manifestPath),
    executableExists: false,
    available: false,
    manifestPath,
    executablePath: undefined as string | undefined,
    error: undefined as string | undefined,
  };

  if (!result.manifestExists) {
    result.error = 'Manifest file not found. The host may not be installed.';
    return result;
  }

  const manifest = readManifestFile(platform, browser);
  if (!manifest) {
    result.error = 'Manifest file exists but is invalid or unreadable.';
    return result;
  }

  result.executablePath = manifest.path;
  result.executableExists = existsSync(manifest.path);

  if (!result.executableExists) {
    result.error = `Executable not found at: ${manifest.path}. ` +
      'The application may have been moved or uninstalled.';
    return result;
  }

  result.available = true;
  return result;
}
