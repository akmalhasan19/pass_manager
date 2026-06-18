import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, existsSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  NATIVE_HOST_NAME,
  NATIVE_HOST_DESCRIPTION,
  NATIVE_HOST_TYPE,
  CHROME_EXTENSION_PREFIX,
  FIREFOX_EXTENSION_PREFIX,
  generateManifest,
  normalizeExtensionOrigin,
  getManifestDirectory,
  getManifestPath,
  serializeManifest,
  validateManifest,
} from '../../../src/main/native-host/manifest';
import type { BrowserId, PlatformId } from '../../../src/main/native-host/manifest';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const TEST_EXTENSION_IDS = ['abcdefghijklmnopqrstuvwxyzabcdef'];
const TEST_EXTENSION_ORIGINS = [`${CHROME_EXTENSION_PREFIX}${TEST_EXTENSION_IDS[0]}/`];
const FAKE_HOST_PATH = '/usr/bin/securepass-manager';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

describe('Native Host Manifest Constants', () => {
  it('should have correct host name', () => {
    expect(NATIVE_HOST_NAME).toBe('com.securepass.manager');
  });

  it('should have correct description', () => {
    expect(NATIVE_HOST_DESCRIPTION).toBe('SecurePass Manager Native Messaging Host');
  });

  it('should have stdio type', () => {
    expect(NATIVE_HOST_TYPE).toBe('stdio');
  });

  it('should have correct extension prefixes', () => {
    expect(CHROME_EXTENSION_PREFIX).toBe('chrome-extension://');
    expect(FIREFOX_EXTENSION_PREFIX).toBe('moz-extension://');
  });
});

// ---------------------------------------------------------------------------
// generateManifest
// ---------------------------------------------------------------------------

describe('generateManifest', () => {
  it('should generate a valid manifest with bare extension ID', () => {
    const manifest = generateManifest({
      hostPath: FAKE_HOST_PATH,
      allowedExtensionIds: TEST_EXTENSION_IDS,
    });

    expect(manifest.name).toBe(NATIVE_HOST_NAME);
    expect(manifest.description).toBe(NATIVE_HOST_DESCRIPTION);
    expect(manifest.path).toBe(FAKE_HOST_PATH);
    expect(manifest.type).toBe(NATIVE_HOST_TYPE);
    expect(manifest.allowed_origins).toHaveLength(1);
    expect(manifest.allowed_origins[0]).toBe(TEST_EXTENSION_ORIGINS[0]);
  });

  it('should generate a valid manifest with full origin string', () => {
    const manifest = generateManifest({
      hostPath: FAKE_HOST_PATH,
      allowedExtensionIds: [TEST_EXTENSION_ORIGINS[0]],
    });

    expect(manifest.allowed_origins[0]).toBe(TEST_EXTENSION_ORIGINS[0]);
  });

  it('should support multiple extension IDs', () => {
    const ids = ['ext111111111111111111', 'ext222222222222222222'];
    const manifest = generateManifest({
      hostPath: FAKE_HOST_PATH,
      allowedExtensionIds: ids,
    });

    expect(manifest.allowed_origins).toHaveLength(2);
    expect(manifest.allowed_origins[0]).toBe(`${CHROME_EXTENSION_PREFIX}${ids[0]}/`);
    expect(manifest.allowed_origins[1]).toBe(`${CHROME_EXTENSION_PREFIX}${ids[1]}/`);
  });

  it('should allow custom description', () => {
    const manifest = generateManifest({
      hostPath: FAKE_HOST_PATH,
      allowedExtensionIds: TEST_EXTENSION_IDS,
      description: 'Custom description',
    });

    expect(manifest.description).toBe('Custom description');
  });

  it('should throw on empty host path', () => {
    expect(() =>
      generateManifest({ hostPath: '', allowedExtensionIds: TEST_EXTENSION_IDS }),
    ).toThrow('Host executable path must be a non-empty string.');
  });

  it('should throw on whitespace-only host path', () => {
    expect(() =>
      generateManifest({ hostPath: '   ', allowedExtensionIds: TEST_EXTENSION_IDS }),
    ).toThrow('Host executable path must be a non-empty string.');
  });

  it('should throw on empty extension IDs', () => {
    expect(() =>
      generateManifest({ hostPath: FAKE_HOST_PATH, allowedExtensionIds: [] }),
    ).toThrow('At least one allowed extension ID must be provided.');
  });

  it('should throw on undefined extension IDs', () => {
    expect(() =>
      generateManifest({ hostPath: FAKE_HOST_PATH, allowedExtensionIds: undefined as never }),
    ).toThrow('At least one allowed extension ID must be provided.');
  });
});

// ---------------------------------------------------------------------------
// normalizeExtensionOrigin
// ---------------------------------------------------------------------------

describe('normalizeExtensionOrigin', () => {
  it('should wrap bare ID with chrome-extension prefix', () => {
    const result = normalizeExtensionOrigin('abcdefghijklmnop');
    expect(result).toBe(`${CHROME_EXTENSION_PREFIX}abcdefghijklmnop/`);
  });

  it('should keep chrome-extension:// prefix as-is', () => {
    const input = `${CHROME_EXTENSION_PREFIX}abcdefghijklmnop/`;
    expect(normalizeExtensionOrigin(input)).toBe(input);
  });

  it('should keep moz-extension:// prefix as-is', () => {
    const input = `${FIREFOX_EXTENSION_PREFIX}abcdefghijklmnop/`;
    expect(normalizeExtensionOrigin(input)).toBe(input);
  });

  it('should trim whitespace', () => {
    const result = normalizeExtensionOrigin('  abcdefghijklmnop  ');
    expect(result).toBe(`${CHROME_EXTENSION_PREFIX}abcdefghijklmnop/`);
  });
});

// ---------------------------------------------------------------------------
// getManifestDirectory / getManifestPath
// ---------------------------------------------------------------------------

describe('getManifestDirectory', () => {
  it('should return correct path for Windows Chrome', () => {
    const dir = getManifestDirectory('win32', 'chrome');
    expect(dir).toContain('NativeMessagingHosts');
    expect(dir).toContain('google-chrome');
  });

  it('should return correct path for macOS Chrome', () => {
    const dir = getManifestDirectory('darwin', 'chrome');
    // On Windows, HOME resolves to user dir, so check structure generically
    expect(dir).toContain('NativeMessagingHosts');
    expect(dir).toContain('google-chrome');
  });

  it('should return correct path for Linux Chrome', () => {
    const dir = getManifestDirectory('linux', 'chrome');
    expect(dir).toContain('.config');
    expect(dir).toContain('google-chrome');
    expect(dir).toContain('NativeMessagingHosts');
  });

  it('should return correct path for Firefox on Linux', () => {
    const dir = getManifestDirectory('linux', 'firefox');
    expect(dir).toContain('mozilla');
  });

  it('should return correct path for Edge on Windows', () => {
    const dir = getManifestDirectory('win32', 'edge');
    expect(dir).toContain('microsoft-edge');
    expect(dir).toContain('NativeMessagingHosts');
  });

  it('should default to Chrome config dir when browser is omitted', () => {
    const dirDefault = getManifestDirectory('linux');
    const dirChrome = getManifestDirectory('linux', 'chrome');
    expect(dirDefault).toBe(dirChrome);
  });

  it('should throw on unsupported platform', () => {
    expect(() => getManifestDirectory('aix' as PlatformId)).toThrow('Unsupported platform');
  });
});

describe('getManifestPath', () => {
  it('should return path ending with host name .json', () => {
    const path = getManifestPath('linux', 'chrome');
    expect(path).toMatch(new RegExp(`${NATIVE_HOST_NAME}\\.json$`));
  });
});

// ---------------------------------------------------------------------------
// serializeManifest
// ---------------------------------------------------------------------------

describe('serializeManifest', () => {
  it('should produce valid JSON', () => {
    const manifest = generateManifest({
      hostPath: FAKE_HOST_PATH,
      allowedExtensionIds: TEST_EXTENSION_IDS,
    });

    const json = serializeManifest(manifest);
    const parsed = JSON.parse(json);

    expect(parsed.name).toBe(NATIVE_HOST_NAME);
    expect(parsed.type).toBe(NATIVE_HOST_TYPE);
  });

  it('should use 2-space indentation', () => {
    const manifest = generateManifest({
      hostPath: FAKE_HOST_PATH,
      allowedExtensionIds: TEST_EXTENSION_IDS,
    });

    const json = serializeManifest(manifest);
    expect(json).toContain('  "name"');
    expect(json).toContain('  "type"');
  });
});

// ---------------------------------------------------------------------------
// validateManifest
// ---------------------------------------------------------------------------

describe('validateManifest', () => {
  it('should accept a valid manifest', () => {
    const manifest = generateManifest({
      hostPath: FAKE_HOST_PATH,
      allowedExtensionIds: TEST_EXTENSION_IDS,
    });

    const result = validateManifest(manifest);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.manifest.name).toBe(NATIVE_HOST_NAME);
    }
  });

  it('should accept null object input', () => {
    expect(validateManifest(null).ok).toBe(false);
  });

  it('should reject array input', () => {
    expect(validateManifest([]).ok).toBe(false);
  });

  it('should reject missing name', () => {
    const result = validateManifest({
      description: 'test',
      path: '/test',
      type: 'stdio',
      allowed_origins: [],
    });
    expect(result.ok).toBe(false);
  });

  it('should reject empty name', () => {
    const result = validateManifest({
      name: '',
      description: 'test',
      path: '/test',
      type: 'stdio',
      allowed_origins: [],
    });
    expect(result.ok).toBe(false);
  });

  it('should reject wrong type', () => {
    const result = validateManifest({
      name: 'test',
      description: 'test',
      path: '/test',
      type: 'websocket',
      allowed_origins: [],
    });
    expect(result.ok).toBe(false);
  });

  it('should reject non-array allowed_origins', () => {
    const result = validateManifest({
      name: 'test',
      description: 'test',
      path: '/test',
      type: 'stdio',
      allowed_origins: 'not-array',
    });
    expect(result.ok).toBe(false);
  });

  it('should reject non-string entries in allowed_origins', () => {
    const result = validateManifest({
      name: 'test',
      description: 'test',
      path: '/test',
      type: 'stdio',
      allowed_origins: [123],
    });
    expect(result.ok).toBe(false);
  });

  it('should reject missing path', () => {
    const result = validateManifest({
      name: 'test',
      description: 'test',
      type: 'stdio',
      allowed_origins: [],
    });
    expect(result.ok).toBe(false);
  });

  it('should reject empty path', () => {
    const result = validateManifest({
      name: 'test',
      description: 'test',
      path: '',
      type: 'stdio',
      allowed_origins: [],
    });
    expect(result.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Round-trip: generate → serialize → parse → validate
// ---------------------------------------------------------------------------

describe('Manifest round-trip', () => {
  it('should survive generate → serialize → parse → validate', () => {
    const original = generateManifest({
      hostPath: FAKE_HOST_PATH,
      allowedExtensionIds: TEST_EXTENSION_IDS,
    });

    const json = serializeManifest(original);
    const parsed = JSON.parse(json);
    const result = validateManifest(parsed);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.manifest).toEqual(original);
    }
  });
});
