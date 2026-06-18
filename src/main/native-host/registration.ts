/**
 * Platform-Specific Native Messaging Host Registration
 *
 * Handles writing the native messaging host manifest to the correct
 * platform-specific location and, on Windows, registering the corresponding
 * registry key so browsers can discover the host.
 *
 * SUPPORTED PLATFORMS:
 * - Windows: Writes manifest file + sets registry key under HKCU
 * - macOS:   Writes manifest file to ~/Library/Application Support/<browser>/
 * - Linux:   Writes manifest file to ~/.config/<browser>/
 *
 * @module native-host/registration
 */

import { writeFileSync, readFileSync, unlinkSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  NATIVE_HOST_NAME,
  getManifestDirectory,
  getManifestPath,
  serializeManifest,
  validateManifest,
  type NativeHostManifest,
  type BrowserId,
  type PlatformId,
} from './manifest';
import { logger } from '../../shared/logger';

// ---------------------------------------------------------------------------
// Windows Registry Constants
// ---------------------------------------------------------------------------

/** Registry hive for current user. */
const REG_HKCU = 'HKEY_CURRENT_USER';

/**
 * Returns the Windows registry key path for a given browser.
 *
 * Chrome:  HKCU\Software\Google\Chrome\NativeMessagingHosts\com.securepass.manager
 * Edge:    HKCU\Software\Microsoft\Edge\NativeMessagingHosts\com.securepass.manager
 * Firefox: HKCU\Software\Mozilla\NativeMessagingHosts\com.securepass.manager
 */
export function getRegistryKeyPath(browser?: BrowserId): string {
  const browserKey = getBrowserRegistryKey(browser);
  return `${REG_HKCU}\\${browserKey}\\NativeMessagingHosts\\${NATIVE_HOST_NAME}`;
}

/**
 * Returns the browser-specific registry subkey under HKCU\Software.
 */
function getBrowserRegistryKey(browser?: BrowserId): string {
  switch (browser) {
    case 'chrome':
      return 'Google\\Chrome';
    case 'edge':
      return 'Microsoft\\Edge';
    case 'firefox':
      return 'Mozilla';
    default:
      return 'Google\\Chrome';
  }
}

// ---------------------------------------------------------------------------
// Manifest File Operations
// ---------------------------------------------------------------------------

/**
 * Ensures the manifest directory exists, creating it recursively if needed.
 *
 * @param platform - Target platform.
 * @param browser - Target browser.
 */
function ensureManifestDirectory(platform?: PlatformId, browser?: BrowserId): void {
  const dir = getManifestDirectory(platform, browser);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
    logger.info('Created native messaging host directory', { dir, platform, browser });
  }
}

/**
 * Writes the manifest JSON file to disk.
 *
 * @param manifest - The manifest object to write.
 * @param platform - Target platform.
 * @param browser - Target browser.
 * @returns The absolute path where the manifest was written.
 */
export function writeManifestFile(
  manifest: NativeHostManifest,
  platform?: PlatformId,
  browser?: BrowserId,
): string {
  const manifestPath = getManifestPath(platform, browser);
  ensureManifestDirectory(platform, browser);

  const json = serializeManifest(manifest);
  writeFileSync(manifestPath, json, 'utf-8');

  logger.info('Native messaging host manifest written', {
    path: manifestPath,
    hostName: manifest.name,
    platform,
    browser,
  });

  return manifestPath;
}

/**
 * Reads and parses an existing manifest file.
 *
 * @param platform - Target platform.
 * @param browser - Target browser.
 * @returns The parsed manifest, or null if the file doesn't exist or is invalid.
 */
export function readManifestFile(
  platform?: PlatformId,
  browser?: BrowserId,
): NativeHostManifest | null {
  const manifestPath = getManifestPath(platform, browser);

  if (!existsSync(manifestPath)) {
    return null;
  }

  try {
    const content = readFileSync(manifestPath, 'utf-8');
    const data = JSON.parse(content);
    const result = validateManifest(data);

    if (!result.ok) {
      logger.warn('Existing manifest file is invalid', {
        path: manifestPath,
        error: result.error,
      });
      return null;
    }

    return result.manifest;
  } catch (cause) {
    logger.error('Failed to read manifest file', {
      path: manifestPath,
      cause: cause instanceof Error ? cause.message : String(cause),
    });
    return null;
  }
}

/**
 * Removes the manifest file from disk.
 *
 * @param platform - Target platform.
 * @param browser - Target browser.
 * @returns true if the file was removed, false if it didn't exist.
 */
export function removeManifestFile(
  platform?: PlatformId,
  browser?: BrowserId,
): boolean {
  const manifestPath = getManifestPath(platform, browser);

  if (!existsSync(manifestPath)) {
    return false;
  }

  try {
    unlinkSync(manifestPath);
    logger.info('Native messaging host manifest removed', {
      path: manifestPath,
    });
    return true;
  } catch (cause) {
    logger.error('Failed to remove manifest file', {
      path: manifestPath,
      cause: cause instanceof Error ? cause.message : String(cause),
    });
    return false;
  }
}

// ---------------------------------------------------------------------------
// Windows Registry Operations
// ---------------------------------------------------------------------------

/**
 * Sets the Windows registry key to point to the manifest file.
 *
 * This is required for Chrome and Edge on Windows. Firefox uses its own
 * registry path.
 *
 * @param manifestPath - Absolute path to the manifest JSON file.
 * @param browser - Target browser.
 * @returns true if the registry key was set successfully.
 */
export function setRegistryKey(manifestPath: string, browser?: BrowserId): boolean {
  if (process.platform !== 'win32') {
    logger.debug('Registry key operation skipped (not Windows)', { platform: process.platform });
    return true;
  }

  const keyPath = getRegistryKeyPath(browser);

  try {
    // Use reg.exe to set the default value of the key to the manifest path
    // This tells Chrome/Edge where to find the manifest file
    execFileSync('reg', ['add', keyPath, '/ve', '/t', 'REG_SZ', '/d', manifestPath, '/f'], {
      timeout: 10_000,
      windowsHide: true,
    });

    logger.info('Windows registry key set', { keyPath, manifestPath, browser });
    return true;
  } catch (cause) {
    logger.error('Failed to set Windows registry key', {
      keyPath,
      cause: cause instanceof Error ? cause.message : String(cause),
    });
    return false;
  }
}

/**
 * Removes the Windows registry key for the native messaging host.
 *
 * @param browser - Target browser.
 * @returns true if the key was removed successfully or didn't exist.
 */
export function removeRegistryKey(browser?: BrowserId): boolean {
  if (process.platform !== 'win32') {
    return true;
  }

  const keyPath = getRegistryKeyPath(browser);

  try {
    execFileSync('reg', ['delete', keyPath, '/f'], {
      timeout: 10_000,
      windowsHide: true,
    });

    logger.info('Windows registry key removed', { keyPath, browser });
    return true;
  } catch (cause) {
    // Error code 2 = key doesn't exist, which is fine
    const err = cause as { status?: number };
    if (err.status === 2) {
      return true;
    }

    logger.error('Failed to remove Windows registry key', {
      keyPath,
      cause: cause instanceof Error ? cause.message : String(cause),
    });
    return false;
  }
}

/**
 * Checks if the Windows registry key exists for the native messaging host.
 *
 * @param browser - Target browser.
 * @returns true if the key exists.
 */
export function registryKeyExists(browser?: BrowserId): boolean {
  if (process.platform !== 'win32') {
    return false;
  }

  const keyPath = getRegistryKeyPath(browser);

  try {
    execFileSync('reg', ['query', keyPath], {
      timeout: 10_000,
      windowsHide: true,
    });
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Combined Registration
// ---------------------------------------------------------------------------

/**
 * Result of a registration operation.
 */
export interface RegistrationResult {
  /** Whether the manifest file was written successfully. */
  manifestWritten: boolean;
  /** Absolute path to the manifest file. */
  manifestPath: string;
  /** Whether the registry key was set (Windows only; true on other platforms). */
  registrySet: boolean;
  /** Whether the operation was fully successful. */
  success: boolean;
  /** Error message if the operation failed. */
  error?: string;
}

/**
 * Registers the native messaging host for a specific browser.
 *
 * This writes the manifest file and (on Windows) sets the registry key.
 *
 * @param manifest - The manifest to register.
 * @param platform - Target platform.
 * @param browser - Target browser.
 * @returns Registration result with details.
 */
export function registerHost(
  manifest: NativeHostManifest,
  platform?: PlatformId,
  browser?: BrowserId,
): RegistrationResult {
  const targetPlatform = platform ?? process.platform;
  const result: RegistrationResult = {
    manifestWritten: false,
    manifestPath: '',
    registrySet: false,
    success: false,
  };

  try {
    // 1. Write manifest file
    result.manifestPath = writeManifestFile(manifest, platform, browser);
    result.manifestWritten = true;

    // 2. Set registry key (Windows only)
    if (targetPlatform === 'win32') {
      result.registrySet = setRegistryKey(result.manifestPath, browser);
    } else {
      result.registrySet = true; // No registry on non-Windows
    }

    result.success = result.manifestWritten && result.registrySet;
  } catch (cause) {
    result.error = cause instanceof Error ? cause.message : String(cause);
    logger.error('Host registration failed', { cause: result.error });
  }

  return result;
}

/**
 * Unregisters the native messaging host for a specific browser.
 *
 * This removes the manifest file and (on Windows) the registry key.
 *
 * @param platform - Target platform.
 * @param browser - Target browser.
 * @returns true if both the file and registry key were removed.
 */
export function unregisterHost(
  platform?: PlatformId,
  browser?: BrowserId,
): boolean {
  const targetPlatform = platform ?? process.platform;
  const fileRemoved = removeManifestFile(platform, browser);

  let registryRemoved = true;
  if (targetPlatform === 'win32') {
    registryRemoved = removeRegistryKey(browser);
  }

  return fileRemoved || registryRemoved;
}

/**
 * Checks if the native messaging host is registered for a specific browser.
 *
 * @param platform - Target platform.
 * @param browser - Target browser.
 * @returns true if the manifest file exists (and registry key exists on Windows).
 */
export function isHostRegistered(
  platform?: PlatformId,
  browser?: BrowserId,
): boolean {
  const targetPlatform = platform ?? process.platform;
  const manifestExists = existsSync(getManifestPath(platform, browser));

  if (targetPlatform === 'win32') {
    return manifestExists && registryKeyExists(browser);
  }

  return manifestExists;
}
