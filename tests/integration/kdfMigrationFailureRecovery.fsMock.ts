/**
 * Mockable wrapper around `node:fs` for tests that need to simulate
 * filesystem failures (e.g. disk full, permissions revoked). The
 * migration handler imports `copyFileSync` (and other functions) from
 * `node:fs` at module load time. We cannot `vi.spyOn` a read-only ES
 * module export, so we provide a full `vi.mock('node:fs', ...)`
 * replacement that delegates to the real implementation by default
 * and lets tests toggle failures via the exported `mockFsState` flag.
 *
 * The test file uses `vi.mock('node:fs', ...)` to install this
 * module. The `mockFsState.copyFileSyncShouldFail` flag controls
 * whether the next `copyFileSync` call throws.
 */

import * as realFs from 'node:fs';

export interface MockFsState {
  copyFileSyncShouldFail: boolean;
}

/**
 * Mutable state. Tests flip the flag to make the next copyFileSync
 * call throw. Always reset to false in a `finally` block.
 */
export const mockFsState: MockFsState = {
  copyFileSyncShouldFail: false,
};

/**
 * Replacement for `node:fs` `copyFileSync`. Throws when the test
 * toggles `copyFileSyncShouldFail`, otherwise delegates to the real
 * implementation.
 */
export function copyFileSync(
  src: Parameters<typeof realFs.copyFileSync>[0],
  dest: Parameters<typeof realFs.copyFileSync>[1],
  mode?: Parameters<typeof realFs.copyFileSync>[2],
): void {
  if (mockFsState.copyFileSyncShouldFail) {
    throw new Error('Simulated filesystem failure: copyFileSync disabled by test');
  }
  return realFs.copyFileSync(src, dest, mode);
}

/**
 * The migration handler also reads the auth metadata via
 * `existsSync` after the backup write. We keep this delegate so
 * other tests (which do not toggle the flag) can still use the
 * real filesystem.
 */
export const existsSync = realFs.existsSync;
export const mkdirSync = realFs.mkdirSync;
export const readFileSync = realFs.readFileSync;
export const writeFileSync = realFs.writeFileSync;
export const renameSync = realFs.renameSync;
export const unlinkSync = realFs.unlinkSync;
export const rmSync = realFs.rmSync;
export const statSync = realFs.statSync;
export const readdirSync = realFs.readdirSync;
export const createReadStream = realFs.createReadStream;
export const createWriteStream = realFs.createWriteStream;

// Re-export types so consumers do not need to import from node:fs.
export type { MockFsState };
