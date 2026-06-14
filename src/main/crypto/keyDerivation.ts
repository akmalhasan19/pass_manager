import { randomBytes, pbkdf2Sync, createHash } from 'node:crypto';

export const SALT_BYTES = 32;
export const KEY_BYTES = 32;
export const DEFAULT_PBKDF2_ITERATIONS = 600000;
export const PBKDF2_DIGEST = 'sha512';

export interface KeyDerivationResult {
  key: Buffer;
  salt: Buffer;
  params: KdfParams;
}

export interface KdfParams {
  algorithm: 'pbkdf2' | 'argon2id';
  iterations: number;
}

export function generateSalt(length: number = SALT_BYTES): Buffer {
  return randomBytes(length);
}

export function deriveKeyPBKDF2(
  password: string,
  salt: Buffer,
  iterations: number = DEFAULT_PBKDF2_ITERATIONS,
): Buffer {
  return pbkdf2Sync(
    Buffer.from(password, 'utf-8'),
    salt,
    iterations,
    KEY_BYTES,
    PBKDF2_DIGEST,
  );
}

export async function deriveKeyArgon2id(
  _password: string,
  _salt: Buffer,
  _memory: number = 65536,
  _iterations: number = 3,
  _parallelism: number = 4,
): Promise<Buffer | null> {
  // Stub for future Argon2id implementation
  // Requires additional native dependency (argon2)
  return null;
}

export function hashKeyForVerification(key: Buffer): string {
  return createHash('sha256').update(key).digest('hex');
}

export function verifyKeyAgainstHash(key: Buffer, storedHash: string): boolean {
  const computedHash = hashKeyForVerification(key);
  return timingSafeEqual(computedHash, storedHash);
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

export function deriveMasterKey(
  password: string,
  salt: Buffer,
  params: KdfParams,
): Buffer {
  switch (params.algorithm) {
    case 'pbkdf2':
      return deriveKeyPBKDF2(password, salt, params.iterations);
    case 'argon2id':
      throw new Error('Argon2id not yet implemented');
    default:
      throw new Error(`Unknown KDF algorithm: ${params.algorithm}`);
  }
}
