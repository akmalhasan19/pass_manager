/**
 * Regression Security Tests
 *
 * Verifies specific security-critical scenarios identified in the security
 * audit plan:
 * 5.3.1 — Lock screen: after lock, no decryption key or plaintext item data
 *         remains reachable on the heap.
 * 5.3.2 — Close app: crash logs and close handlers do not retain sensitive
 *         material, and no crash dump files are present.
 */

import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { writeFileSync, unlinkSync, existsSync, mkdirSync, readdirSync, statSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as v8 from 'node:v8';
import { randomBytes } from 'node:crypto';
import { secureClear } from '../../../src/shared/secureMemory';
import { logger } from '../../../src/shared/logger';
import { useItemStore } from '../../../src/renderer/stores/itemStore';
import { useFolderStore } from '../../../src/renderer/stores/folderStore';
import type { ItemDecrypted } from '../../../src/shared/types';
import type { Folder } from '../../../src/shared/types';

const TEST_DATA_DIR = join(process.cwd(), 'test-data');
const ROOT_DIR = join(__dirname, '..', '..', '..');

/**
 * Generate a probe string that is unlikely to appear anywhere else in the
 * heap. The random suffix is generated at runtime so it is not present as a
 * literal in any loaded module.
 */
function generateProbe(): string {
  return `SPM-REGRESSION-PROBE-${Date.now()}-${randomBytes(16).toString('hex')}`;
}

/**
 * Persist the probe to disk so a child process can search the heap snapshot
 * without loading the probe back into the test process heap.
 */
function writeProbeToFile(probe: string): string {
  const path = join(TEST_DATA_DIR, `regression-probe-${Date.now()}-${randomBytes(4).toString('hex')}.txt`);
  writeFileSync(path, probe, 'utf-8');
  return path;
}

/**
 * Search a heap snapshot for the probe using a short-lived child process.
 * Keeping the probe out of the test process address space during the after-lock
 * snapshot avoids false positives caused by the test itself retaining the probe.
 */
function snapshotContainsProbe(snapshotPath: string, probePath: string): boolean {
  const script = `
    const fs = require('node:fs');
    const probe = fs.readFileSync(process.argv[1], 'utf-8');
    const snapshot = fs.readFileSync(process.argv[2], 'utf-8');
    process.exit(snapshot.includes(probe) ? 0 : 1);
  `;
  try {
    execFileSync(process.execPath, ['-e', script, probePath, snapshotPath]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Force a full garbage collection when the runtime exposes it. Deterministic
 * GC is required so that the after-lock heap snapshot only contains objects
 * that are still strongly reachable.
 */
function forceGc(): void {
  if (typeof global.gc === 'function') {
    global.gc();
  }
}

/**
 * Recursively find potential crash dump files in a directory. Crash dumps can
 * have extensions such as .dmp (Windows), .crash (macOS), or be named "core"
 * (Linux). Build artifacts and dependencies are skipped.
 */
function findCrashDumpFiles(dir: string): string[] {
  const skippedDirs = new Set(['node_modules', 'dist', 'dist-electron', 'release', '.git']);
  const results: string[] = [];

  function walk(current: string): void {
    let entries: string[];
    try {
      entries = readdirSync(current);
    } catch {
      return;
    }

    for (const entry of entries) {
      if (skippedDirs.has(entry)) continue;

      const fullPath = join(current, entry);
      let stats;
      try {
        stats = statSync(fullPath);
      } catch {
        continue;
      }

      if (stats.isDirectory()) {
        walk(fullPath);
      } else if (stats.isFile()) {
        const lower = entry.toLowerCase();
        if (lower.endsWith('.dmp') || lower.endsWith('.crash') || lower === 'core') {
          results.push(fullPath);
        }
      }
    }
  }

  walk(dir);
  return results;
}

describe('Regression Security Tests', () => {
  const snapshotsToClean: string[] = [];
  const probesToClean: string[] = [];

  beforeAll(() => {
    if (!existsSync(TEST_DATA_DIR)) {
      mkdirSync(TEST_DATA_DIR, { recursive: true });
    }
  });

  afterEach(() => {
    for (const path of snapshotsToClean) {
      try {
        if (existsSync(path)) unlinkSync(path);
      } catch {
        // ignore cleanup errors
      }
    }
    snapshotsToClean.length = 0;

    for (const path of probesToClean) {
      try {
        if (existsSync(path)) unlinkSync(path);
      } catch {
        // ignore cleanup errors
      }
    }
    probesToClean.length = 0;
  });

  // ========================================================================
  // 5.3.1 — Lock screen: heap snapshot after lock
  // ========================================================================
  describe('5.3.1 — Lock Screen Heap Snapshot', () => {
    it('should not retain decrypted item data or key material after lock', () => {
      let snapshotAfter: string;
      let probePaths: string[] = [];

      // Simulate an unlocked vault with decrypted items and a key buffer.
      (() => {
        const password = generateProbe();
        const notes = generateProbe();
        const keyMaterial = generateProbe();

        useItemStore.setState({
          items: {
            'item-1': {
              id: 'item-1',
              title: 'Bank',
              username: 'user',
              password,
              notes,
            } as unknown as ItemDecrypted,
          },
          itemIds: ['item-1'],
        });

        useFolderStore.setState({
          folders: [{ id: 'folder-1', name: 'Financials' } as unknown as Folder],
          selectedFolderId: 'folder-1',
        });

        // Simulate a master key held in memory while unlocked.
        let keyBuffer: Buffer | null = Buffer.from(keyMaterial, 'utf-8');
        // Force materialization of the key string so it is observable.
        expect(keyBuffer.length).toBeGreaterThan(0);

        // Simulate lock screen: wipe renderer stores and key material.
        useItemStore.getState().clearSensitiveData();
        useFolderStore.getState().reset();
        secureClear(keyBuffer);
        keyBuffer = null;

        probePaths = [
          writeProbeToFile(password),
          writeProbeToFile(notes),
          writeProbeToFile(keyMaterial),
        ];
        // password, notes, keyMaterial go out of scope here.
      })();

      forceGc();

      snapshotAfter = v8.writeHeapSnapshot();
      snapshotsToClean.push(snapshotAfter);

      for (const probePath of probePaths) {
        expect(snapshotContainsProbe(snapshotAfter, probePath)).toBe(false);
      }
    });

    it('should clear selected item and folder references on lock', () => {
      useItemStore.setState({
        selectedItemId: 'selected-item-1',
        currentFolderId: 'current-folder-1',
      });
      useFolderStore.setState({ selectedFolderId: 'selected-folder-1' });

      useItemStore.getState().clearSensitiveData();
      useFolderStore.getState().reset();

      const itemState = useItemStore.getState();
      const folderState = useFolderStore.getState();

      expect(itemState.selectedItemId).toBeNull();
      expect(itemState.currentFolderId).toBeNull();
      expect(folderState.selectedFolderId).toBeNull();
    });
  });

  // ========================================================================
  // 5.3.2 — Close app: crash logs and close handlers
  // ========================================================================
  describe('5.3.2 — Close App Security', () => {
    it('should call clearKeys in the before-quit handler', () => {
      const mainPath = join(ROOT_DIR, 'src', 'main', 'index.ts');
      const mainSrc = readFileSync(mainPath, 'utf-8');

      expect(mainSrc).toContain("app.on('before-quit'");
      expect(mainSrc).toContain('clearKeys()');
    });

    it('should not have crash dump files in the project', () => {
      const crashFiles = findCrashDumpFiles(ROOT_DIR);
      expect(crashFiles).toHaveLength(0);
    });

    it('should redact sensitive fields in error logs', () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      logger.error('Decryption failed', {
        password: 'super-secret-password',
        masterKey: Buffer.from('0123456789abcdef'),
        folderId: 'folder-1',
      });

      expect(consoleSpy).toHaveBeenCalledTimes(1);
      const output = JSON.stringify(consoleSpy.mock.calls[0]);

      expect(output).not.toContain('super-secret-password');
      expect(output).not.toContain('0123456789abcdef');
      expect(output).toContain('[REDACTED]');
      expect(output).toContain('folder-1');

      consoleSpy.mockRestore();
    });

    it('should redact sensitive fields in warning logs', () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      logger.warn('Suspicious activity', {
        secret: 'secret recovery phrase',
        verificationHash: 'abc123',
        userId: 'user-1',
      });

      expect(consoleSpy).toHaveBeenCalledTimes(1);
      const output = JSON.stringify(consoleSpy.mock.calls[0]);

      expect(output).not.toContain('secret recovery phrase');
      expect(output).not.toContain('abc123');
      expect(output).toContain('[REDACTED]');
      expect(output).toContain('user-1');

      consoleSpy.mockRestore();
    });
  });
});
