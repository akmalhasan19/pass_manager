import { createHash, pbkdf2Sync, randomBytes } from 'node:crypto';
import { secureClear } from '../../shared/secureMemory';
import {
  deriveKeyArgon2id as argon2idDerive,
  initArgon2idEngine,
  isArgon2idAvailable,
} from './argon2id';
import {
  PBKDF2Engine,
  Argon2idEngine,
  createEngineWithFallback,
  type KDFEngine,
  type KdfAlgorithm,
  type KdfParams as KdfEngineParams,
  type KeyDerivationResult,
  type KeyDerivationResultWithFallback,
  type Argon2idParams,
} from './kdfEngine';

export const SALT_BYTES = 32;
export const KEY_BYTES = 32;
export const DEFAULT_PBKDF2_ITERATIONS = 600000;
export const PBKDF2_DIGEST = 'sha512';

export { KDFEngine, Argon2idEngine, PBKDF2Engine, KdfAlgorithm };
export type { KeyDerivationResult, KeyDerivationResultWithFallback, KdfEngineParams as KdfParams, Argon2idParams };

export function generateSalt(length: number = SALT_BYTES): Buffer {
  return randomBytes(length);
}

export function deriveKeyPBKDF2(
  password: string,
  salt: Buffer,
  iterations: number = DEFAULT_PBKDF2_ITERATIONS,
): Buffer {
  const passwordBuffer = Buffer.from(password, 'utf-8');
  try {
    return pbkdf2Sync(passwordBuffer, salt, iterations, KEY_BYTES, PBKDF2_DIGEST);
  } finally {
    secureClear(passwordBuffer);
  }
}

export async function deriveKeyArgon2id(
  password: string,
  salt: Buffer,
  memoryCost: number = 65536,
  timeCost: number = 3,
  parallelism: number = 4,
): Promise<Buffer> {
  return argon2idDerive(password, salt, {
    algorithm: 'argon2id',
    memoryCost,
    timeCost,
    parallelism,
  });
}

export { initArgon2idEngine } from './argon2id';

export function hashKeyForVerification(key: Buffer): string {
  return createHash('sha256').update(key).digest('hex');
}

export function verifyKeyAgainstHash(key: Buffer, storedHash: string): boolean {
  let computedHash = hashKeyForVerification(key);
  const result = timingSafeEqual(computedHash, storedHash);
  computedHash = '';
  return result;
}

export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

export async function deriveMasterKey(
  password: string,
  salt: Buffer,
  params: KdfEngineParams,
): Promise<Buffer> {
  const engine = getEngineForParams(params);
  return engine.deriveKey(password, salt, params);
}

/**
 * Derives a master key with fallback tracking.
 * If Argon2id is unavailable, automatically falls back to PBKDF2
 * and returns information about the fallback.
 */
export async function deriveMasterKeyWithFallback(
  password: string,
  salt: Buffer,
  params: KdfEngineParams,
): Promise<KeyDerivationResultWithFallback> {
  const { engine, getFallbackInfo } = createEngineWithFallback(params.algorithm);
  const key = await engine.deriveKey(password, salt, params);
  const fallbackInfo = getFallbackInfo();

  return {
    key,
    salt,
    params,
    fallbackOccurred: fallbackInfo.occurred,
    fallbackReason: fallbackInfo.reason,
  };
}

function getEngineForParams(params: KdfEngineParams): KDFEngine {
  switch (params.algorithm) {
    case 'pbkdf2':
      return new PBKDF2Engine();
    case 'argon2id':
      return new Argon2idEngine();
    default: {
      const _exhaustive: never = params;
      throw new Error(`Unknown KDF algorithm: ${(params as { algorithm: string }).algorithm}`);
    }
  }
}
