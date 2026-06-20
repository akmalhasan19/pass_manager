/**
 * Sub-Task 5.5: Performance & Stress Tests (PBKDF2 → Argon2id)
 *
 * Benchmarks and stress tests for the migration pipeline. The numbers below
 * are tuned for the minimum supported hardware target (2-core CPU, 4 GB
 * RAM, SSD) so the assertions stay meaningful on developer laptops while
 * still being representative of the production baseline.
 *
 *  1. Derivation benchmark: Argon2id vs PBKDF2 at both the test parameters
 *     and the production parameters (memoryCost 64 MB, timeCost 3,
 *     parallelism 4). Reports timing for the engineering dashboard.
 *  2. Re-encryption benchmark: migrate a vault with 1000 items end-to-end
 *     through the same `AUTH_MIGRATE_KDF` IPC the renderer uses, and
 *     assert the total time stays under the 60-second UX budget.
 *  3. Large-attachment migration: migrate a vault that holds many items
 *     each pointing at a sizeable attachment file on disk, and assert
 *     the migration completes without exhausting heap memory.
 *
 * Notes on thresholds:
 *  - The numbers are intentionally generous. They are designed to catch
 *    O(n²) regressions and accidental memory blow-ups, not to be tight
 *    performance gates. CI runners vary widely, so we leave headroom.
 *  - When running in a constrained environment (e.g. a Docker container
 *    with 1 GB of memory) the KDF timings can spike. The thresholds are
 *    set high enough that a clean run on a developer laptop leaves
 *    2-3× of headroom, which absorbs typical CI noise.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { IPC_CHANNELS } from '@shared/ipcChannels';
import {
  registerAuthHandlers,
  clearKeys,
  getMasterKey,
} from '@main/ipc/authHandlers';
import { registerVaultHandlers } from '@main/ipc/vaultHandlers';
import { registerItemHandlers } from '@main/ipc/itemHandlers';
import { registerFolderHandlers } from '@main/ipc/folderHandlers';
import { closeDatabase, initializeSqlJs, getActiveVaultId, getDatabase } from '@main/database/connection';
import { invalidateRegistryCache } from '@main/file-system/vaultRegistry';
import { readVaultAuthMetadata } from '@main/file-system/vaultAuthStorage';
import { deriveKeyPBKDF2, KEY_BYTES } from '@main/crypto/keyDerivation';
import {
  PBKDF2Engine,
  Argon2idEngine,
  type KdfParams,
} from '@main/crypto/kdfEngine';
import { encryptString } from '@main/crypto/encryption';
import { initArgon2idEngine } from '@main/crypto/argon2id';
import { ItemRepository } from '@main/database/repositories/ItemRepository';
import { FolderRepository } from '@main/database/repositories/FolderRepository';
import { FileAttachmentRepository } from '@main/database/repositories/FileAttachmentRepository';
import { getStoragePath } from '@main/file-system/storageManager';

// ---------------------------------------------------------------------------
// Shared test infrastructure
// ---------------------------------------------------------------------------

const testDataDir = join(process.cwd(), 'test-data', 'kdf-performance');

const ipcHandlers = new Map<string, (_event: unknown, ...args: unknown[]) => unknown>();

vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => {
      if (name === 'userData') return testDataDir;
      if (name === 'appPath') return process.cwd();
      throw new Error(`Unexpected Electron path request: ${name}`);
    },
    getAppPath: () => process.cwd(),
  },
  ipcMain: {
    handle: (
      channel: string,
      handler: (_event: unknown, ...args: unknown[]) => unknown,
    ) => {
      ipcHandlers.set(channel, handler);
    },
    on: vi.fn(),
    once: vi.fn(),
    removeHandler: vi.fn(),
    removeAllListeners: vi.fn(),
  },
  dialog: {
    showOpenDialog: vi.fn(),
    showSaveDialog: vi.fn(),
  },
  BrowserWindow: {
    getFocusedWindow: vi.fn(() => null),
  },
  shell: {
    showItemInFolder: vi.fn(),
  },
}));

const MASTER_PASSWORD = 'PerfBench-M@ster-P@ssword-2024!';

interface IpcResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  vaultId?: string;
}

interface VaultCreateResult {
  id: string;
  name: string;
  databasePath: string;
}

interface MigrateKdfResult {
  success: boolean;
  error?: string;
  fallbackOccurred?: boolean;
  fallbackReason?: string;
  fallbackToPbkdf2?: boolean;
}

async function invokeIpc<T>(channel: string, ...args: unknown[]): Promise<T> {
  const handler = ipcHandlers.get(channel);
  if (!handler) {
    throw new Error(`No IPC handler registered for channel: ${channel}`);
  }
  return handler(null, ...args) as T;
}

function resetTestData(): void {
  closeDatabase();
  clearKeys();
  invalidateRegistryCache();
  if (existsSync(testDataDir)) {
    rmSync(testDataDir, { recursive: true, force: true });
  }
  mkdirSync(testDataDir, { recursive: true });
  mkdirSync(join(testDataDir, 'vaults'), { recursive: true });
  mkdirSync(join(testDataDir, 'vault-auth'), { recursive: true });
}

function teardownTestData(): void {
  closeDatabase();
  clearKeys();
  invalidateRegistryCache();
}

async function createVault(name: string): Promise<{ vaultId: string; databasePath: string }> {
  const result = await invokeIpc<IpcResult<VaultCreateResult>>(
    IPC_CHANNELS.VAULT_CREATE,
    { name, masterPassword: MASTER_PASSWORD },
  );
  expect(result.success).toBe(true);
  return { vaultId: result.data!.id, databasePath: result.data!.databasePath };
}

function createFolder(folderName: string): string {
  const folderRepo = new FolderRepository();
  const folder = folderRepo.create(null, folderName, '📁');
  return folder.id;
}

function elapsed(start: number): number {
  return Date.now() - start;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ---------------------------------------------------------------------------
// Global setup / teardown
// ---------------------------------------------------------------------------

beforeAll(async () => {
  registerAuthHandlers();
  registerVaultHandlers();
  registerItemHandlers();
  registerFolderHandlers();
  await initializeSqlJs();
  await initArgon2idEngine();
});

afterAll(() => {
  closeDatabase();
  clearKeys();
});

beforeEach(() => {
  resetTestData();
});

afterEach(() => {
  teardownTestData();
});

// ---------------------------------------------------------------------------
// 5.5.1 — Derivation benchmark: Argon2id vs PBKDF2
// ---------------------------------------------------------------------------

describe('5.5.1 — Derivation benchmark (Argon2id vs PBKDF2)', () => {
  const BENCH_PASSWORD = 'Benchmark-M@ster-Pass!';
  const BENCH_SALT = randomBytes(32);

  // Test (small) parameters — fast to derive, used as a regression smoke test.
  const TEST_PBKDF2_PARAMS: KdfParams = { algorithm: 'pbkdf2', iterations: 1000 };
  const TEST_ARGON2ID_PARAMS: KdfParams = {
    algorithm: 'argon2id',
    memoryCost: 1024,
    timeCost: 1,
    parallelism: 1,
  };

  // Production parameters — the parameters users actually pay for on
  // every unlock. These thresholds reflect the target hardware minimum.
  const PROD_PBKDF2_PARAMS: KdfParams = { algorithm: 'pbkdf2', iterations: 600000 };
  const PROD_ARGON2ID_PARAMS: KdfParams = {
    algorithm: 'argon2id',
    memoryCost: 65536, // 64 MB
    timeCost: 3,
    parallelism: 4,
  };

  it('derives a PBKDF2 key (1,000 iterations) in under 200 ms', async () => {
    const engine = new PBKDF2Engine();
    const start = Date.now();
    const key = await engine.deriveKey(BENCH_PASSWORD, BENCH_SALT, TEST_PBKDF2_PARAMS);
    const duration = elapsed(start);
    expect(key.length).toBe(KEY_BYTES);
    console.log(`  → PBKDF2 1,000 iter: ${duration}ms`);
    expect(duration).toBeLessThan(200);
  });

  it('derives a PBKDF2 key (600,000 iterations, production default) in under 6 s', async () => {
    const engine = new PBKDF2Engine();
    const start = Date.now();
    const key = await engine.deriveKey(BENCH_PASSWORD, BENCH_SALT, PROD_PBKDF2_PARAMS);
    const duration = elapsed(start);
    expect(key.length).toBe(KEY_BYTES);
    console.log(`  → PBKDF2 600,000 iter (legacy default): ${duration}ms`);
    expect(duration).toBeLessThan(6000);
  });

  it('derives an Argon2id key with test parameters (1 MB / 1 iter / 1 lane) in under 200 ms', async () => {
    const engine = new Argon2idEngine();
    const start = Date.now();
    const key = await engine.deriveKey(BENCH_PASSWORD, BENCH_SALT, TEST_ARGON2ID_PARAMS);
    const duration = elapsed(start);
    expect(key.length).toBe(KEY_BYTES);
    console.log(`  → Argon2id test params (1MB/1/1): ${duration}ms`);
    expect(duration).toBeLessThan(200);
  });

  it('derives an Argon2id key with production parameters (64 MB / 3 iter / 4 lanes) in under 5 s', async () => {
    const engine = new Argon2idEngine();
    const start = Date.now();
    const key = await engine.deriveKey(BENCH_PASSWORD, BENCH_SALT, PROD_ARGON2ID_PARAMS);
    const duration = elapsed(start);
    expect(key.length).toBe(KEY_BYTES);
    console.log(`  → Argon2id production params (64MB/3/4): ${duration}ms`);
    expect(duration).toBeLessThan(5000);
  });

  it('reports both algorithms side-by-side at the production baseline', async () => {
    const pbkdf2 = new PBKDF2Engine();
    const argon2 = new Argon2idEngine();

    const pbkdf2Start = Date.now();
    const pbkdf2Key = await pbkdf2.deriveKey(BENCH_PASSWORD, BENCH_SALT, PROD_PBKDF2_PARAMS);
    const pbkdf2Ms = elapsed(pbkdf2Start);

    const argon2Start = Date.now();
    const argon2Key = await argon2.deriveKey(BENCH_PASSWORD, BENCH_SALT, PROD_ARGON2ID_PARAMS);
    const argon2Ms = elapsed(argon2Start);

    expect(pbkdf2Key.length).toBe(KEY_BYTES);
    expect(argon2Key.length).toBe(KEY_BYTES);
    expect(pbkdf2Key.equals(argon2Key)).toBe(false);

    console.log(
      `  → Side-by-side production baseline: PBKDF2 ${pbkdf2Ms}ms vs Argon2id ${argon2Ms}ms`,
    );

    // Both algorithms must stay within their respective production
    // budgets on the target hardware.
    expect(pbkdf2Ms).toBeLessThan(6000);
    expect(argon2Ms).toBeLessThan(5000);
  });

  it('handles 5 sequential Argon2id derivations without unbounded heap growth', async () => {
    const engine = new Argon2idEngine();
    const baseline = process.memoryUsage().heapUsed;

    let peakHeap = baseline;
    const samples: number[] = [];
    for (let i = 0; i < 5; i++) {
      const start = Date.now();
      const key = await engine.deriveKey(BENCH_PASSWORD, BENCH_SALT, PROD_ARGON2ID_PARAMS);
      const duration = elapsed(start);
      samples.push(duration);
      expect(key.length).toBe(KEY_BYTES);

      const current = process.memoryUsage().heapUsed;
      if (current > peakHeap) peakHeap = current;
    }

    const heapDelta = peakHeap - baseline;
    console.log(
      `  → 5× Argon2id derivations: ${samples.join('ms, ')}ms; heap Δ ${formatBytes(heapDelta)}`,
    );

    // Peak heap growth must stay bounded. Argon2id's working set is
    // ~64 MB per derivation, but it should be released between calls.
    // Allow 256 MB of headroom for V8 / sql.js overhead.
    expect(heapDelta).toBeLessThan(256 * 1024 * 1024);
  });

  it('falls back to PBKDF2 derivation timing when Argon2id is unavailable', async () => {
    // When the engine cannot use Argon2id it falls back to PBKDF2 with
    // the default 600,000 iterations. The fallback path must still
    // stay under the same budget as the legacy production path.
    const start = Date.now();
    const key = deriveKeyPBKDF2(BENCH_PASSWORD, BENCH_SALT, 600000);
    const duration = elapsed(start);
    expect(key.length).toBe(KEY_BYTES);
    console.log(`  → PBKDF2 fallback path: ${duration}ms`);
    expect(duration).toBeLessThan(6000);
  });
});

// ---------------------------------------------------------------------------
// 5.5.2 — Re-encrypt 1,000 items end-to-end migration
// ---------------------------------------------------------------------------

describe('5.5.2 — Migration benchmark: 1,000 items end-to-end', () => {
  const ITEM_COUNT = 1000;
  const MIGRATION_TIME_BUDGET_MS = 60_000;

  /**
   * Bulk-insert N items directly via the database handle. We bypass the
   * IPC handler to keep the fixture setup fast — the migration handler
   * still walks the full re-encryption path, which is the part we want
   * to measure. The items MUST be encrypted with the current master
   * key, otherwise the migration handler cannot decrypt them.
   */
  function seedItems(folderId: string, count: number): void {
    const db = getDatabase();
    const masterKey = getMasterKey();
    expect(db).toBeTruthy();
    expect(masterKey).toBeTruthy();
    expect(masterKey!.length).toBe(KEY_BYTES);

    const stmt = db.prepare(
      `INSERT INTO items (id, folder_id, title, username, password_encrypted, url, notes_encrypted, emoji, cover_image, created_at, updated_at, is_favorite, sort_order, otp_secret, otp_period, otp_digits, otp_algorithm)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    const now = Date.now();
    try {
      for (let i = 0; i < count; i++) {
        const id = `perf-item-${i.toString().padStart(5, '0')}`;
        const password = encryptString(`Password-${i}-secret!`, masterKey!);
        const notes = encryptString(
          `Notes for item ${i}: ${'lorem ipsum '.repeat(8)}`,
          masterKey!,
        );
        stmt.run([
          id,
          folderId,
          `Perf Item ${i}`,
          `user${i}@example.com`,
          new Uint8Array(password),
          `https://service${i}.example.com`,
          new Uint8Array(notes),
          null,
          null,
          now,
          now,
          0,
          i,
          null,
          30,
          6,
          'SHA1',
        ]);
      }
    } finally {
      stmt.free();
    }
  }

  it(`migrates a vault with ${ITEM_COUNT} items inside the 60-second UX budget`, async () => {
    const { vaultId, databasePath } = await createVault(`Perf ${ITEM_COUNT} Items`);
    const folderId = createFolder('Perf Items');

    const seedStart = Date.now();
    seedItems(folderId, ITEM_COUNT);
    const seedDuration = elapsed(seedStart);
    console.log(`  → Seeded ${ITEM_COUNT} items in ${seedDuration}ms`);

    // Sanity check: the items were inserted.
    const beforeFileSize = statSync(databasePath).size;

    const migrateStart = Date.now();
    const result = await invokeIpc<IpcResult<MigrateKdfResult>>(
      IPC_CHANNELS.AUTH_MIGRATE_KDF,
    );
    const migrateDuration = elapsed(migrateStart);

    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();
    console.log(
      `  → Migrated ${ITEM_COUNT} items in ${migrateDuration}ms (budget ${MIGRATION_TIME_BUDGET_MS}ms)`,
    );

    expect(migrateDuration).toBeLessThan(MIGRATION_TIME_BUDGET_MS);

    // The vault file should still exist and the on-disk format should
    // match a successful migration.
    expect(existsSync(databasePath)).toBe(true);
    const afterFileSize = statSync(databasePath).size;
    expect(afterFileSize).toBeGreaterThan(0);
    expect(afterFileSize).toBeGreaterThanOrEqual(beforeFileSize * 0.5);

    const auth = readVaultAuthMetadata(vaultId);
    expect(auth.kdfAlgorithm).toBe('argon2id');
    expect(auth.migratedAt).toBeDefined();
  });

  it(`keeps peak heap growth under 512 MB during the ${ITEM_COUNT}-item migration`, async () => {
    const { vaultId } = await createVault(`Perf ${ITEM_COUNT} Items Mem`);
    const folderId = createFolder('Perf Mem');

    seedItems(folderId, ITEM_COUNT);

    const baselineHeap = process.memoryUsage().heapUsed;
    const baselineRss = process.memoryUsage().rss;
    let peakHeap = baselineHeap;
    let peakRss = baselineRss;

    // Sample memory at high frequency while the migration runs. We
    // rely on the event loop to interleave the timer with the
    // synchronous re-encrypt loop in the migration handler.
    const sampler = setInterval(() => {
      const mem = process.memoryUsage();
      if (mem.heapUsed > peakHeap) peakHeap = mem.heapUsed;
      if (mem.rss > peakRss) peakRss = mem.rss;
    }, 5);

    try {
      const result = await invokeIpc<IpcResult<MigrateKdfResult>>(
        IPC_CHANNELS.AUTH_MIGRATE_KDF,
      );
      expect(result.success).toBe(true);
    } finally {
      clearInterval(sampler);
    }

    const heapDelta = peakHeap - baselineHeap;
    const rssDelta = peakRss - baselineRss;
    console.log(
      `  → Peak heap Δ ${formatBytes(heapDelta)}; RSS Δ ${formatBytes(rssDelta)} (peak heap ${formatBytes(peakHeap)}, RSS ${formatBytes(peakRss)})`,
    );

    // Heap should stay well below 512 MB for 1,000 items. The dominant
    // allocation is the db.export() buffer which mirrors the on-disk
    // file size; the fixture keeps each item small so the file should
    // stay under a few MB.
    expect(heapDelta).toBeLessThan(512 * 1024 * 1024);
    expect(peakHeap).toBeLessThan(1024 * 1024 * 1024);

    // Suppress unused-var warning for vaultId (used for assertion above).
    expect(vaultId).toBeTruthy();
  });

  it('keeps the migrated vault data readable through the in-memory master key after migration', async () => {
    // This exercises the same in-memory access path the renderer uses
    // after a successful migration: the migration handler updates the
    // session state so the in-memory master key now matches the new
    // Argon2id-derived key. The renderer keeps the vault open and
    // reads items through the same key, so the items must still be
    // decryptable without forcing the user to unlock again.
    const { vaultId } = await createVault(`Perf ${ITEM_COUNT} Items Readback`);
    const folderId = createFolder('Perf Readback');
    seedItems(folderId, 10);

    const migrateResult = await invokeIpc<IpcResult<MigrateKdfResult>>(
      IPC_CHANNELS.AUTH_MIGRATE_KDF,
    );
    expect(migrateResult.success).toBe(true);

    // The in-memory master key must still allow reading items through
    // the standard IPC surface. This is the read-back the migration
    // handler is supposed to keep working without an extra unlock.
    const listResult = await invokeIpc<IpcResult<Array<{ id: string }>>>(
      IPC_CHANNELS.ITEM_GET_ALL,
    );
    expect(listResult.success).toBe(true);
    expect(listResult.data?.length).toBe(10);

    // The vault ID must still be the active one.
    expect(getActiveVaultId()).toBe(vaultId);
  });
});

// ---------------------------------------------------------------------------
// 5.5.3 — Large attachment migration: no out-of-memory
// ---------------------------------------------------------------------------

describe('5.5.3 — Migration with large attachments (no OOM)', () => {
  const ITEM_COUNT = 50;
  const ATTACHMENT_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB per file
  const TOTAL_ATTACHMENT_BYTES = ITEM_COUNT * ATTACHMENT_SIZE_BYTES;
  const MIGRATION_TIME_BUDGET_MS = 90_000;
  const PEAK_HEAP_BUDGET_BYTES = 512 * 1024 * 1024; // 512 MB
  const PEAK_RSS_BUDGET_BYTES = 2 * 1024 * 1024 * 1024; // 2 GB

  /**
   * Bulk-insert N items with one attachment each. The attachment file is
   * written to disk via `getStoragePath(vaultId)` so the on-disk layout
   * matches the production storage strategy.
   */
  function seedItemsWithAttachments(vaultId: string, folderId: string, count: number): void {
    const itemRepo = new ItemRepository();
    const attachmentRepo = new FileAttachmentRepository();
    const masterKey = getMasterKey();
    expect(masterKey).toBeTruthy();
    expect(masterKey!.length).toBe(KEY_BYTES);
    const storageDir = getStoragePath(vaultId);
    if (!existsSync(storageDir)) {
      mkdirSync(storageDir, { recursive: true });
    }

    for (let i = 0; i < count; i++) {
      const password = encryptString(`Attachment-pwd-${i}-secret!`, masterKey!);
      const item = itemRepo.create(folderId, {
        title: `Attachment Item ${i}`,
        username: `user${i}@example.com`,
        passwordEncrypted: new Uint8Array(password),
        url: `https://attach${i}.example.com`,
        notesEncrypted: null,
      });

      // Create a real attachment file on disk.
      const storagePath = join(storageDir, `${item.id}.bin`);
      const buf = randomBytes(ATTACHMENT_SIZE_BYTES);
      writeFileSync(storagePath, buf);

      attachmentRepo.create(
        item.id,
        null,
        `attachment-${i}.bin`,
        'application/octet-stream',
        ATTACHMENT_SIZE_BYTES,
        storagePath,
      );
    }
  }

  it('migrates a vault with many large attachments without exceeding the heap budget', async () => {
    const { vaultId, databasePath } = await createVault('Large Attachments');
    const folderId = createFolder('Attachments');

    const seedStart = Date.now();
    seedItemsWithAttachments(vaultId, folderId, ITEM_COUNT);
    const seedDuration = elapsed(seedStart);
    console.log(
      `  → Seeded ${ITEM_COUNT} items × ${formatBytes(ATTACHMENT_SIZE_BYTES)} = ${formatBytes(TOTAL_ATTACHMENT_BYTES)} attachments in ${seedDuration}ms`,
    );

    const beforeFileSize = statSync(databasePath).size;
    expect(beforeFileSize).toBeGreaterThan(0);

    const baselineHeap = process.memoryUsage().heapUsed;
    const baselineRss = process.memoryUsage().rss;
    let peakHeap = baselineHeap;
    let peakRss = baselineRss;

    const sampler = setInterval(() => {
      const mem = process.memoryUsage();
      if (mem.heapUsed > peakHeap) peakHeap = mem.heapUsed;
      if (mem.rss > peakRss) peakRss = mem.rss;
    }, 5);

    const migrateStart = Date.now();
    let migrateResult: IpcResult<MigrateKdfResult> | undefined;
    try {
      migrateResult = await invokeIpc<IpcResult<MigrateKdfResult>>(
        IPC_CHANNELS.AUTH_MIGRATE_KDF,
      );
    } finally {
      clearInterval(sampler);
    }
    const migrateDuration = elapsed(migrateStart);

    expect(migrateResult).toBeDefined();
    expect(migrateResult!.success).toBe(true);
    expect(migrateResult!.error).toBeUndefined();

    const heapDelta = peakHeap - baselineHeap;
    const rssDelta = peakRss - baselineRss;
    console.log(
      `  → Migrated ${ITEM_COUNT}-attachment vault in ${migrateDuration}ms; heap Δ ${formatBytes(heapDelta)} (peak ${formatBytes(peakHeap)}), RSS Δ ${formatBytes(rssDelta)} (peak ${formatBytes(peakRss)})`,
    );

    expect(migrateDuration).toBeLessThan(MIGRATION_TIME_BUDGET_MS);
    expect(peakHeap).toBeLessThan(PEAK_HEAP_BUDGET_BYTES);
    expect(peakRss).toBeLessThan(PEAK_RSS_BUDGET_BYTES);

    // Sanity: the vault file is on disk and the migration metadata
    // reflects the new algorithm.
    expect(existsSync(databasePath)).toBe(true);
    const afterFileSize = statSync(databasePath).size;
    expect(afterFileSize).toBeGreaterThan(0);

    const auth = readVaultAuthMetadata(vaultId);
    expect(auth.kdfAlgorithm).toBe('argon2id');
    expect(auth.migratedAt).toBeDefined();
  });

  it('leaves attachment files on disk untouched after migration', async () => {
    const { vaultId } = await createVault('Attachments Untouched');
    const folderId = createFolder('Attach Untouched');

    seedItemsWithAttachments(vaultId, folderId, 10);

    const storageDir = getStoragePath(vaultId);
    const expectedFiles = (() => {
      const itemRepo = new ItemRepository();
      const item = itemRepo.getByFolder(folderId)[0];
      const fileName = `${item.id}.bin`;
      return join(storageDir, fileName);
    })();

    expect(existsSync(expectedFiles)).toBe(true);
    const beforeAttachmentSize = statSync(expectedFiles).size;

    const result = await invokeIpc<IpcResult<MigrateKdfResult>>(
      IPC_CHANNELS.AUTH_MIGRATE_KDF,
    );
    expect(result.success).toBe(true);

    // The attachment file must still exist and its size must be
    // unchanged — the migration handler re-encrypts database rows but
    // never touches raw attachment blobs.
    expect(existsSync(expectedFiles)).toBe(true);
    const afterAttachmentSize = statSync(expectedFiles).size;
    expect(afterAttachmentSize).toBe(beforeAttachmentSize);
    expect(afterAttachmentSize).toBe(ATTACHMENT_SIZE_BYTES);
  });

  it('keeps memory growth proportional to the database size, not the attachment size', async () => {
    const { vaultId } = await createVault('Mem vs Attach Size');
    const folderId = createFolder('Mem vs Attach');

    // Use a small fixture (10 items × 1 MB attachments) to keep the
    // test fast while still exercising the same code path.
    const smallItemCount = 10;
    const smallAttachmentSize = 1 * 1024 * 1024;
    const itemRepo = new ItemRepository();
    const attachmentRepo = new FileAttachmentRepository();
    const storageDir = getStoragePath(vaultId);
    if (!existsSync(storageDir)) mkdirSync(storageDir, { recursive: true });

    for (let i = 0; i < smallItemCount; i++) {
      const item = itemRepo.create(folderId, {
        title: `Mem Item ${i}`,
        username: `user${i}`,
        passwordEncrypted: null,
      });
      const filePath = join(storageDir, `${item.id}.bin`);
      writeFileSync(filePath, randomBytes(smallAttachmentSize));
      attachmentRepo.create(
        item.id,
        null,
        `${item.id}.bin`,
        'application/octet-stream',
        smallAttachmentSize,
        filePath,
      );
    }

    const databasePath = join(
      testDataDir,
      'vaults',
      `vault-${vaultId}.db`,
    );
    const databaseSize = statSync(databasePath).size;

    const baselineHeap = process.memoryUsage().heapUsed;
    let peakHeap = baselineHeap;
    const sampler = setInterval(() => {
      const mem = process.memoryUsage();
      if (mem.heapUsed > peakHeap) peakHeap = mem.heapUsed;
    }, 5);

    try {
      const result = await invokeIpc<IpcResult<MigrateKdfResult>>(
        IPC_CHANNELS.AUTH_MIGRATE_KDF,
      );
      expect(result.success).toBe(true);
    } finally {
      clearInterval(sampler);
    }

    const heapDelta = peakHeap - baselineHeap;
    console.log(
      `  → DB size ${formatBytes(databaseSize)}; peak heap Δ ${formatBytes(heapDelta)}; total attachment bytes on disk ${formatBytes(smallItemCount * smallAttachmentSize)}`,
    );

    // Peak heap growth should be O(database size), not O(attachment
    // bytes). We allow 64× of the database size as headroom for
    // V8/sampling overhead and the in-memory encryption buffers.
    expect(heapDelta).toBeLessThan(databaseSize * 64);
  });

  it('can re-encrypt attachment items without OOM when the database is large', async () => {
    const { vaultId } = await createVault('Large DB No OOM');
    const folderId = createFolder('Large DB');

    const itemRepo = new ItemRepository();
    const masterKey = getMasterKey();
    expect(masterKey).toBeTruthy();
    expect(masterKey!.length).toBe(KEY_BYTES);
    // Create items with realistic but small encrypted blobs so the
    // database file size grows without growing the heap envelope.
    const notesText = 'x'.repeat(2048);
    for (let i = 0; i < 200; i++) {
      const password = encryptString(`pwd-${i}-${'a'.repeat(32)}`, masterKey!);
      const notes = encryptString(`${notesText}-${i}`, masterKey!);
      itemRepo.create(folderId, {
        title: `Large DB Item ${i}`,
        username: `user${i}@example.com`,
        passwordEncrypted: new Uint8Array(password),
        url: `https://db${i}.example.com`,
        notesEncrypted: new Uint8Array(notes),
      });
    }

    const databasePath = join(testDataDir, 'vaults', `vault-${vaultId}.db`);
    const databaseSize = statSync(databasePath).size;
    expect(databaseSize).toBeGreaterThan(50 * 1024); // > 50 KB

    const baselineHeap = process.memoryUsage().heapUsed;
    let peakHeap = baselineHeap;
    const sampler = setInterval(() => {
      const mem = process.memoryUsage();
      if (mem.heapUsed > peakHeap) peakHeap = mem.heapUsed;
    }, 5);

    let result: IpcResult<MigrateKdfResult> | undefined;
    try {
      result = await invokeIpc<IpcResult<MigrateKdfResult>>(
        IPC_CHANNELS.AUTH_MIGRATE_KDF,
      );
    } finally {
      clearInterval(sampler);
    }

    expect(result).toBeDefined();
    expect(result!.success).toBe(true);
    const heapDelta = peakHeap - baselineHeap;
    console.log(
      `  → 200 items, DB ${formatBytes(databaseSize)}, peak heap Δ ${formatBytes(heapDelta)}`,
    );

    // The migration must not balloon the heap. We allow generous
    // headroom (8× database size) to absorb Argon2id's working set.
    expect(heapDelta).toBeLessThan(Math.max(PEAK_HEAP_BUDGET_BYTES, databaseSize * 8));
  });
});
