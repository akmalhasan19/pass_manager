/**
 * Memory Leak Tests
 *
 * Automates the Chrome DevTools Memory profiler workflow for SecurePass
 * Manager: record heap state while the vault is unlocked, simulate lock to
 * wipe sensitive material, then assert that no key-related Buffer,
 * ArrayBuffer, or plaintext string remains reachable on the heap.
 */

import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { writeFileSync, unlinkSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import * as v8 from 'node:v8';
import { randomBytes } from 'node:crypto';
import { secureClear } from '../../../src/shared/secureMemory';
import { useItemStore } from '../../../src/renderer/stores/itemStore';
import { useFolderStore } from '../../../src/renderer/stores/folderStore';
import type { ItemDecrypted } from '../../../src/shared/types';
import type { Folder } from '../../../src/shared/types';

const TEST_DATA_DIR = join(process.cwd(), 'test-data');

/**
 * Generate a probe string that is unlikely to appear anywhere else in the
 * heap. The random suffix is generated at runtime so it is not present as a
 * literal in the test source or any other loaded module.
 */
function generateProbe(): string {
  return `SPM-LEAK-PROBE-${Date.now()}-${randomBytes(16).toString('hex')}`;
}

/**
 * Persist the probe to disk so a child process can search the heap snapshot
 * without loading the probe back into the test process heap.
 */
function writeProbeToFile(probe: string): string {
  const path = join(TEST_DATA_DIR, `probe-${Date.now()}.txt`);
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

describe('Memory Leak Tests', () => {
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
  // 5.2.1 — Heap snapshot before/after simulated lock/unlock
  // ========================================================================
  it('should retain sensitive key string in heap while unlocked', () => {
    let snapshotBefore: string;
    let probePath: string;

    // Simulate unlock: hold a unique plaintext key string and its Buffer.
    (() => {
      const probe = generateProbe();
      const sensitiveString: string | null = probe;
      let sensitiveBuffer: Buffer | null = Buffer.from(probe, 'utf-8');

      // Reference the string so the compiler/test runner cannot prove it away.
      expect(sensitiveString).toBe(probe);

      snapshotBefore = v8.writeHeapSnapshot();
      snapshotsToClean.push(snapshotBefore);

      probePath = writeProbeToFile(probe);
      probesToClean.push(probePath);

      // Sanity check: the probe must be observable while it is intentionally
      // held in memory, otherwise the test cannot distinguish leak from
      // absence of data.
      expect(snapshotContainsProbe(snapshotBefore, probePath)).toBe(true);

      // Simulate lock: wipe the buffer and release all strong references.
      secureClear(sensitiveBuffer);
      sensitiveBuffer = null;
      // `sensitiveString`, `sensitiveBuffer`, and `probe` go out of scope here.
    })();

    forceGc();

    const snapshotAfter = v8.writeHeapSnapshot();
    snapshotsToClean.push(snapshotAfter);

    expect(snapshotContainsProbe(snapshotAfter, probePath!)).toBe(false);
  });

  it('should not retain Buffer contents in heap after lock', () => {
    let snapshotBefore: string;
    let probePath: string;

    // Simulate unlock: hold a Buffer with a unique probe string.
    (() => {
      const probe = generateProbe();
      let keyBuffer: Buffer | null = Buffer.from(probe, 'utf-8');

      snapshotBefore = v8.writeHeapSnapshot();
      snapshotsToClean.push(snapshotBefore);

      probePath = writeProbeToFile(probe);
      probesToClean.push(probePath);

      expect(snapshotContainsProbe(snapshotBefore, probePath)).toBe(true);

      // Simulate lock: wipe the buffer and release the reference.
      secureClear(keyBuffer);
      keyBuffer = null;
      // probe goes out of scope.
    })();

    forceGc();

    const snapshotAfter = v8.writeHeapSnapshot();
    snapshotsToClean.push(snapshotAfter);

    expect(snapshotContainsProbe(snapshotAfter, probePath!)).toBe(false);
  });

  it('should not retain ArrayBuffer contents in heap after lock', () => {
    let snapshotBefore: string;
    let probePath: string;

    // Simulate unlock: hold an ArrayBuffer with a unique probe string.
    (() => {
      const probe = generateProbe();
      const encoder = new TextEncoder();
      let keyArrayBuffer: ArrayBuffer | null = encoder.encode(probe).buffer;

      snapshotBefore = v8.writeHeapSnapshot();
      snapshotsToClean.push(snapshotBefore);

      probePath = writeProbeToFile(probe);
      probesToClean.push(probePath);

      expect(snapshotContainsProbe(snapshotBefore, probePath)).toBe(true);

      // Simulate lock: wipe the ArrayBuffer and release the reference.
      secureClear(keyArrayBuffer);
      keyArrayBuffer = null;
      // probe goes out of scope.
    })();

    forceGc();

    const snapshotAfter = v8.writeHeapSnapshot();
    snapshotsToClean.push(snapshotAfter);

    expect(snapshotContainsProbe(snapshotAfter, probePath!)).toBe(false);
  });

  it('should not retain plaintext key string in heap after lock', () => {
    let snapshotBefore: string;
    let probePath: string;

    // Simulate unlock: hold a plaintext key string inside a heap object.
    // A naked local variable may be represented in a way that is not always
    // visible in a heap snapshot, so we deliberately store it as a property
    // and access a character to force V8 to materialize the flat string.
    (() => {
      const probe = generateProbe();
      let keyHolder: { value: string | null } | null = { value: probe };

      // Force V8 to flatten the string before recording the snapshot.
      const stringCheck = keyHolder!.value.length + keyHolder!.value.charCodeAt(0);
      expect(stringCheck).toBeGreaterThan(0);

      snapshotBefore = v8.writeHeapSnapshot();
      snapshotsToClean.push(snapshotBefore);

      probePath = writeProbeToFile(probe);
      probesToClean.push(probePath);

      expect(snapshotContainsProbe(snapshotBefore, probePath)).toBe(true);

      // Simulate lock: drop the string reference.
      keyHolder!.value = null;
      keyHolder = null;
      // probe goes out of scope.
    })();

    forceGc();

    const snapshotAfter = v8.writeHeapSnapshot();
    snapshotsToClean.push(snapshotAfter);

    expect(snapshotContainsProbe(snapshotAfter, probePath!)).toBe(false);
  });

  // ========================================================================
  // 5.2.2 — Renderer store cleanup on lock
  // ========================================================================
  it('renderer item store should drop decrypted passwords and notes on lock', () => {
    useItemStore.setState({
      items: {
        'item-1': {
          id: 'item-1',
          title: 'Bank',
          username: 'user',
          password: 'super-secret-password-123',
          notes: 'secret recovery phrase alpha beta',
        } as unknown as ItemDecrypted,
      },
      itemIds: ['item-1'],
    });

    useItemStore.getState().clearSensitiveData();

    const store = useItemStore.getState();
    expect(store.items['item-1']).toBeUndefined();
    expect(store.itemIds).toHaveLength(0);
    expect(store.currentFolderId).toBeNull();
    expect(store.selectedItemId).toBeNull();
  });

  it('renderer folder store should reset cached tree on lock', () => {
    useFolderStore.setState({
      folders: [{ id: 'folder-1', name: 'Financials', children: [] } as unknown as Folder],
      selectedFolderId: 'folder-1',
      expandedFolderIds: new Set(['folder-1']),
    });

    useFolderStore.getState().reset();

    const store = useFolderStore.getState();
    expect(store.folders).toHaveLength(0);
    expect(store.selectedFolderId).toBeNull();
    expect(store.expandedFolderIds.size).toBe(0);
  });
});
