import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  installNativeHost,
  uninstallNativeHost,
  getNativeHostStatus,
  SUPPORTED_BROWSERS,
} from '../../../src/main/native-host/installer';
import { getManifestPath, NATIVE_HOST_NAME } from '../../../src/main/native-host/manifest';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const TEST_EXTENSION_IDS = ['abcdefghijklmnopqrstuvwxyzabcdef'];

// We use an actual file path on the test system to simulate the host executable.
// /bin/sh or /bin/echo exist on Linux/macOS; on Windows we use a known file.
function getTestHostPath(): string {
  if (process.platform === 'win32') {
    return join(process.env.WINDIR || 'C:\\Windows', 'System32', 'cmd.exe');
  }
  return '/bin/sh';
}

// ---------------------------------------------------------------------------
// installNativeHost
// ---------------------------------------------------------------------------

describe('installNativeHost', () => {
  // Ensure clean state before tests
  beforeEach(() => {
    uninstallNativeHost({ platform: 'linux' });
  });

  afterEach(() => {
    uninstallNativeHost({ platform: 'linux' });
  });

  it('should install with explicit host path on Linux', () => {
    const hostPath = getTestHostPath();
    const result = installNativeHost({
      hostPath,
      allowedExtensionIds: TEST_EXTENSION_IDS,
      browsers: ['chrome'],
      platform: 'linux',
    });

    expect(result.allSucceeded).toBe(true);
    expect(result.hostPath).toBe(hostPath);
    expect(result.errors).toHaveLength(0);
    expect(result.browsers.chrome.success).toBe(true);
    expect(result.browsers.chrome.manifestPath).toContain(NATIVE_HOST_NAME);
  });

  it('should install for multiple browsers on Linux', () => {
    const hostPath = getTestHostPath();
    const result = installNativeHost({
      hostPath,
      allowedExtensionIds: TEST_EXTENSION_IDS,
      platform: 'linux',
    });

    expect(result.allSucceeded).toBe(true);
    for (const browser of SUPPORTED_BROWSERS) {
      expect(result.browsers[browser].success).toBe(true);
    }

    // Cleanup
    uninstallNativeHost({ platform: 'linux' });
  });

  it('should fail gracefully when host path does not exist', () => {
    const result = installNativeHost({
      hostPath: '/nonexistent/path/to/executable',
      allowedExtensionIds: TEST_EXTENSION_IDS,
      browsers: ['chrome'],
      platform: 'linux',
    });

    expect(result.allSucceeded).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain('not found');
  });

  it('should handle idempotent re-install', () => {
    const hostPath = getTestHostPath();
    const options = {
      hostPath,
      allowedExtensionIds: TEST_EXTENSION_IDS,
      browsers: ['chrome'] as const,
      platform: 'linux' as const,
    };

    const result1 = installNativeHost(options);
    expect(result1.allSucceeded).toBe(true);

    const result2 = installNativeHost(options);
    expect(result2.allSucceeded).toBe(true);

    // Cleanup
    uninstallNativeHost({ browsers: ['chrome'], platform: 'linux' });
  });

  it('should report errors per browser', () => {
    const hostPath = getTestHostPath();
    const result = installNativeHost({
      hostPath,
      allowedExtensionIds: TEST_EXTENSION_IDS,
      browsers: ['chrome', 'firefox'],
      platform: 'linux',
    });

    expect(result.allSucceeded).toBe(true);
    expect(result.browsers.chrome.success).toBe(true);
    expect(result.browsers.firefox.success).toBe(true);

    // Cleanup
    uninstallNativeHost({ platform: 'linux' });
  });
});

// ---------------------------------------------------------------------------
// uninstallNativeHost
// ---------------------------------------------------------------------------

describe('uninstallNativeHost', () => {
  it('should uninstall from Linux browsers', () => {
    // First install
    installNativeHost({
      hostPath: getTestHostPath(),
      allowedExtensionIds: TEST_EXTENSION_IDS,
      browsers: ['chrome'],
      platform: 'linux',
    });

    const result = uninstallNativeHost({ browsers: ['chrome'], platform: 'linux' });
    expect(result.allSucceeded).toBe(true);
    expect(result.browsers.chrome).toBe(true);
  });

  it('should handle uninstalling non-existent host', () => {
    const result = uninstallNativeHost({ browsers: ['chrome'], platform: 'linux' });
    expect(typeof result.allSucceeded).toBe('boolean');
  });
});

// ---------------------------------------------------------------------------
// getNativeHostStatus
// ---------------------------------------------------------------------------

describe('getNativeHostStatus', () => {
  it('should report not installed when no manifest exists', () => {
    // Ensure clean state
    uninstallNativeHost({ platform: 'linux' });

    const status = getNativeHostStatus({ platform: 'linux' });
    expect(status.anyInstalled).toBe(false);
    expect(status.browsers.chrome.registered).toBe(false);
  });

  it('should report installed after install', () => {
    installNativeHost({
      hostPath: getTestHostPath(),
      allowedExtensionIds: TEST_EXTENSION_IDS,
      browsers: ['chrome'],
      platform: 'linux',
    });

    const status = getNativeHostStatus({ browsers: ['chrome'], platform: 'linux' });
    expect(status.anyInstalled).toBe(true);
    expect(status.browsers.chrome.registered).toBe(true);

    // Cleanup
    uninstallNativeHost({ browsers: ['chrome'], platform: 'linux' });
  });
});
