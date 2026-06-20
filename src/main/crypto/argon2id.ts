import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { arch, platform } from 'node:os';
import { secureClear } from '../../shared/secureMemory';
import { KEY_BYTES } from './keyDerivation';
import { logger } from '../../shared/logger';
// @ts-expect-error - JSON import
import argon2Checksums from './argon2-checksums.json';

export interface Argon2idParams {
  algorithm: 'argon2id';
  memoryCost: number;
  timeCost: number;
  parallelism: number;
}

export const DEFAULT_ARGON2ID_PARAMS: Argon2idParams = {
  algorithm: 'argon2id',
  memoryCost: 65536,
  timeCost: 3,
  parallelism: 4,
};

let nativeModule: NativeArgon2 | null = null;
let wasmModule: WasmArgon2 | null = null;
let wasmError: Error | null = null;
let initialized = false;

interface NativeArgon2 {
  hash(
    password: string | Buffer | Uint8Array,
    opts: {
      type: number;
      memoryCost: number;
      timeCost: number;
      parallelism: number;
      hashLength: number;
      raw: true;
      salt?: Buffer;
    },
  ): Promise<Buffer>;
}

interface WasmArgon2 {
  argon2id(opts: {
    password: string | Uint8Array;
    salt: string | Uint8Array;
    parallelism: number;
    iterations: number;
    memorySize: number;
    hashLength: number;
    outputType: 'binary';
  }): Promise<Uint8Array>;
}

export type Argon2idEngineStatus =
  | { status: 'native' }
  | { status: 'wasm' }
  | { status: 'unavailable'; error: string };

let engineStatus: Argon2idEngineStatus = { status: 'unavailable', error: 'not initialized' };

/**
 * Returns the current Argon2id engine availability status.
 * Call after initArgon2idEngine() to check if Argon2id is available.
 */
export function getArgon2idStatus(): Argon2idEngineStatus {
  return engineStatus;
}

/**
 * Checks if Argon2id is available (either native or WASM).
 * Returns true if available, false otherwise.
 */
export function isArgon2idAvailable(): boolean {
  return engineStatus.status !== 'unavailable';
}

/**
 * Detects the current platform and arch to determine which native binary would be loaded.
 * Returns the relative path to the .node file within the argon2 prebuilds directory.
 */
function detectNativeBinaryPath(): string | null {
  const p = platform(); // 'darwin', 'linux', 'win32'
  const a = arch(); // 'x64', 'arm64', 'arm'

  // Map Node.js platform to argon2 prebuild directory names
  const platformMap: Record<string, string> = {
    darwin: 'darwin',
    linux: 'linux',
    win32: 'win32',
  };

  // Map Node.js arch to argon2 prebuild directory names
  const archMap: Record<string, string> = {
    x64: 'x64',
    arm64: 'arm64',
    arm: 'arm',
  };

  const prebuildPlatform = platformMap[p];
  const prebuildArch = archMap[a];

  if (!prebuildPlatform || !prebuildArch) {
    return null;
  }

  // Determine libc variant (musl vs glibc)
  // On Linux, check for musl by looking at the loaded libc
  let libc = 'glibc';
  if (p === 'linux') {
    try {
      // Check if running on musl (Alpine Linux)
      const lddOut = require('child_process').execSync('ldd --version 2>&1 || true', {
        encoding: 'utf-8',
        timeout: 1000,
      });
      if (lddOut.includes('musl')) {
        libc = 'musl';
      }
    } catch {
      // Default to glibc if detection fails
    }
  }

  // Build the expected filename based on platform and arch
  // Format varies by platform:
  // - darwin-arm64: argon2.armv8.glibc.node
  // - darwin-x64: argon2.glibc.node
  // - linux-x64: argon2.glibc.node or argon2.musl.node
  // - win32-x64: argon2.glibc.node
  let filename: string;
  if (a === 'arm64') {
    filename = `argon2.armv8.${libc}.node`;
  } else if (a === 'arm') {
    filename = `argon2.armv7.${libc}.node`;
  } else {
    filename = `argon2.${libc}.node`;
  }

  return `prebuilds/${prebuildPlatform}-${prebuildArch}/${filename}`;
}

/**
 * Verifies the SHA-256 checksum of the native argon2 binary.
 * Returns true if checksum matches or no checksums are available.
 * Returns false if checksum mismatches (possible corruption or tampering).
 */
function verifyNativeChecksum(): { valid: boolean; binaryPath: string | null; expected?: string; actual?: string } {
  const binaryPath = detectNativeBinaryPath();

  if (!binaryPath) {
    logger.warn('Could not determine native binary path for checksum verification');
    return { valid: true, binaryPath: null };
  }

  const expectedHash = argon2Checksums.checksums[binaryPath];
  if (!expectedHash) {
    logger.warn('No checksum found for binary path, skipping verification', { binaryPath });
    return { valid: true, binaryPath };
  }

  // Resolve the actual file path
  const argon2Dir = resolve(require.resolve('argon2'), '..');
  const fullPath = join(argon2Dir, binaryPath);

  if (!existsSync(fullPath)) {
    logger.warn('Native binary file not found', { path: fullPath });
    return { valid: false, binaryPath, expected: expectedHash };
  }

  try {
    const fileContent = readFileSync(fullPath);
    const actualHash = createHash('sha256').update(fileContent).digest('hex');

    if (actualHash !== expectedHash) {
      logger.error('Argon2id native module checksum mismatch - possible corruption or tampering', {
        binaryPath,
        expectedHash,
        actualHash,
      });
      return { valid: false, binaryPath, expected: expectedHash, actual: actualHash };
    }

    logger.debug('Argon2id native module checksum verified', { binaryPath });
    return { valid: true, binaryPath, expected: expectedHash, actual: actualHash };
  } catch (err) {
    logger.error('Failed to verify argon2id native module checksum', {
      binaryPath,
      error: err instanceof Error ? err.message : String(err),
    });
    return { valid: false, binaryPath, expected: expectedHash };
  }
}

async function tryLoadNative(): Promise<NativeArgon2 | null> {
  try {
    // SECURITY: Verify checksum before loading native module
    const checksumResult = verifyNativeChecksum();
    if (!checksumResult.valid) {
      logger.warn('Skipping argon2id native module due to checksum failure', {
        binaryPath: checksumResult.binaryPath,
        expected: checksumResult.expected,
        actual: checksumResult.actual,
      });
      return null;
    }

    const mod = require('argon2') as typeof import('argon2');
    return mod as unknown as NativeArgon2;
  } catch (err) {
    logger.debug('Failed to load argon2id native module', {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

async function tryLoadWasm(): Promise<WasmArgon2 | null> {
  try {
    const mod = await import('hash-wasm');
    wasmModule = mod as unknown as WasmArgon2;
    return wasmModule;
  } catch (err) {
    wasmError = err instanceof Error ? err : new Error(String(err));
    return null;
  }
}

export async function initArgon2idEngine(): Promise<Argon2idEngineStatus> {
  if (initialized) return engineStatus;
  initialized = true;

  nativeModule = await tryLoadNative();
  if (nativeModule) {
    engineStatus = { status: 'native' };
    return engineStatus;
  }

  const wasm = await tryLoadWasm();
  if (wasm) {
    engineStatus = { status: 'wasm' };
    return engineStatus;
  }

  engineStatus = { status: 'unavailable', error: wasmError?.message ?? 'unknown error' };
  return engineStatus;
}

export async function deriveKeyArgon2id(
  password: string,
  salt: Buffer,
  params: Argon2idParams = DEFAULT_ARGON2ID_PARAMS,
): Promise<Buffer> {
  if (!initialized) {
    await initArgon2idEngine();
  }

  if (nativeModule) {
    return deriveWithNative(password, salt, params);
  }

  if (wasmModule) {
    return deriveWithWasm(password, salt, params);
  }

  throw new Error(
    'Argon2id is not available on this platform. No native or WASM module could be loaded.',
  );
}

async function deriveWithNative(
  password: string,
  salt: Buffer,
  params: Argon2idParams,
): Promise<Buffer> {
  const passwordBuffer = Buffer.from(password, 'utf-8');
  try {
    const raw = await nativeModule!.hash(passwordBuffer, {
      type: 2,
      memoryCost: params.memoryCost,
      timeCost: params.timeCost,
      parallelism: params.parallelism,
      hashLength: KEY_BYTES,
      raw: true,
      salt,
    });
    return raw;
  } finally {
    secureClear(passwordBuffer);
  }
}

async function deriveWithWasm(
  password: string,
  salt: Buffer,
  params: Argon2idParams,
): Promise<Buffer> {
  const passwordBuffer = Buffer.from(password, 'utf-8');
  try {
    const raw = await wasmModule!.argon2id({
      password: passwordBuffer,
      salt,
      parallelism: params.parallelism,
      iterations: params.timeCost,
      memorySize: params.memoryCost,
      hashLength: KEY_BYTES,
      outputType: 'binary',
    });
    const result = Buffer.from(raw);
    secureClear(raw);
    return result;
  } finally {
    secureClear(passwordBuffer);
  }
}
