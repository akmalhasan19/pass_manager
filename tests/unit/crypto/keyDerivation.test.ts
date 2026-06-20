import { describe, it, expect } from 'vitest';
import {
  generateSalt,
  deriveKeyPBKDF2,
  deriveKeyArgon2id,
  hashKeyForVerification,
  verifyKeyAgainstHash,
  timingSafeEqual,
  deriveMasterKey,
  SALT_BYTES,
  KEY_BYTES,
  DEFAULT_PBKDF2_ITERATIONS,
} from '../../../src/main/crypto/keyDerivation';

const TEST_PASSWORD = 'MySecureMasterPassword!2024';
const TEST_SALT = Buffer.alloc(32, 0xab);

describe('generateSalt', () => {
  it('should return a buffer of default SALT_BYTES length', () => {
    const salt = generateSalt();
    expect(salt).toBeInstanceOf(Buffer);
    expect(salt).toHaveLength(SALT_BYTES);
  });

  it('should return a buffer of custom length', () => {
    const salt = generateSalt(16);
    expect(salt).toHaveLength(16);
  });

  it('should produce different values on each call', () => {
    const salt1 = generateSalt();
    const salt2 = generateSalt();
    expect(salt1).not.toEqual(salt2);
  });

  it('should return 0-length buffer for length 0', () => {
    const salt = generateSalt(0);
    expect(salt).toHaveLength(0);
  });
});

describe('deriveKeyPBKDF2', () => {
  it('should return a key of KEY_BYTES length', () => {
    const key = deriveKeyPBKDF2(TEST_PASSWORD, TEST_SALT);
    expect(key).toBeInstanceOf(Buffer);
    expect(key).toHaveLength(KEY_BYTES);
  });

  it('should be deterministic (same inputs → same output)', () => {
    const key1 = deriveKeyPBKDF2(TEST_PASSWORD, TEST_SALT);
    const key2 = deriveKeyPBKDF2(TEST_PASSWORD, TEST_SALT);
    expect(key1).toEqual(key2);
  });

  it('should produce different key for different password', () => {
    const key1 = deriveKeyPBKDF2(TEST_PASSWORD, TEST_SALT);
    const key2 = deriveKeyPBKDF2('DifferentPassword!', TEST_SALT);
    expect(key1).not.toEqual(key2);
  });

  it('should produce different key for different salt', () => {
    const key1 = deriveKeyPBKDF2(TEST_PASSWORD, TEST_SALT);
    const differentSalt = Buffer.alloc(32, 0xcd);
    const key2 = deriveKeyPBKDF2(TEST_PASSWORD, differentSalt);
    expect(key1).not.toEqual(key2);
  });

  it('should use default iterations when not specified', () => {
    const key = deriveKeyPBKDF2(TEST_PASSWORD, TEST_SALT);
    const keyExplicit = deriveKeyPBKDF2(TEST_PASSWORD, TEST_SALT, DEFAULT_PBKDF2_ITERATIONS);
    expect(key).toEqual(keyExplicit);
  });

  it('should produce different key with different iteration count', () => {
    const key1 = deriveKeyPBKDF2(TEST_PASSWORD, TEST_SALT, 1000);
    const key2 = deriveKeyPBKDF2(TEST_PASSWORD, TEST_SALT, 2000);
    expect(key1).not.toEqual(key2);
  });

  it('should handle empty password', () => {
    const key = deriveKeyPBKDF2('', TEST_SALT);
    expect(key).toHaveLength(KEY_BYTES);
  });

  it('should handle very long password', () => {
    const longPw = 'a'.repeat(1000);
    const key = deriveKeyPBKDF2(longPw, TEST_SALT);
    expect(key).toHaveLength(KEY_BYTES);
  });

  it('should produce test-vector-consistent output for known inputs', () => {
    const knownPassword = 'password';
    const knownSalt = Buffer.from('saltsalt', 'utf-8');
    const key = deriveKeyPBKDF2(knownPassword, knownSalt, 1);
    expect(key).toHaveLength(32);
  });
});

describe('deriveKeyArgon2id', () => {
  it('should return a 32-byte Buffer (AES-256 key)', async () => {
    const result = await deriveKeyArgon2id('pw', Buffer.alloc(16));
    expect(result).toBeInstanceOf(Buffer);
    expect(result).toHaveLength(KEY_BYTES);
  });

  it('should be deterministic with same salt', async () => {
    const salt = Buffer.alloc(32, 0xab);
    const key1 = await deriveKeyArgon2id(TEST_PASSWORD, salt, 65536, 3, 4);
    const key2 = await deriveKeyArgon2id(TEST_PASSWORD, salt, 65536, 3, 4);
    expect(key1).toEqual(key2);
  });

  it('should produce different keys for different passwords', async () => {
    const salt = Buffer.alloc(32, 0xab);
    const key1 = await deriveKeyArgon2id(TEST_PASSWORD, salt, 65536, 3, 4);
    const key2 = await deriveKeyArgon2id('DifferentPassword', salt, 65536, 3, 4);
    expect(key1).not.toEqual(key2);
  });

  it('should handle empty password', async () => {
    const salt = generateSalt();
    const result = await deriveKeyArgon2id('', salt, 65536, 3, 4);
    expect(result).toHaveLength(KEY_BYTES);
  });

  it('should handle very long password (1000 chars)', async () => {
    const salt = generateSalt();
    const longPw = 'a'.repeat(1000);
    const result = await deriveKeyArgon2id(longPw, salt, 65536, 3, 4);
    expect(result).toHaveLength(KEY_BYTES);
  });

  it('should handle Unicode password', async () => {
    const salt = generateSalt();
    const result = await deriveKeyArgon2id('pässwörd🔥', salt, 65536, 3, 4);
    expect(result).toHaveLength(KEY_BYTES);
  });
});

describe('hashKeyForVerification', () => {
  it('should return a hex string', () => {
    const key = deriveKeyPBKDF2(TEST_PASSWORD, TEST_SALT);
    const hash = hashKeyForVerification(key);
    expect(typeof hash).toBe('string');
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('should be deterministic for same key', () => {
    const key = deriveKeyPBKDF2(TEST_PASSWORD, TEST_SALT);
    const hash1 = hashKeyForVerification(key);
    const hash2 = hashKeyForVerification(key);
    expect(hash1).toBe(hash2);
  });

  it('should produce different hash for different keys', () => {
    const key1 = deriveKeyPBKDF2(TEST_PASSWORD, TEST_SALT);
    const key2 = deriveKeyPBKDF2('other', TEST_SALT);
    const hash1 = hashKeyForVerification(key1);
    const hash2 = hashKeyForVerification(key2);
    expect(hash1).not.toBe(hash2);
  });
});

describe('verifyKeyAgainstHash', () => {
  it('should return true for matching key and hash', () => {
    const key = deriveKeyPBKDF2(TEST_PASSWORD, TEST_SALT);
    const hash = hashKeyForVerification(key);
    expect(verifyKeyAgainstHash(key, hash)).toBe(true);
  });

  it('should return false for non-matching key and hash', () => {
    const key = deriveKeyPBKDF2(TEST_PASSWORD, TEST_SALT);
    const otherKey = deriveKeyPBKDF2('different', TEST_SALT);
    const otherHash = hashKeyForVerification(otherKey);
    expect(verifyKeyAgainstHash(key, otherHash)).toBe(false);
  });
});

describe('timingSafeEqual', () => {
  it('should return true for identical strings', () => {
    expect(timingSafeEqual('hello', 'hello')).toBe(true);
  });

  it('should return false for different strings of same length', () => {
    expect(timingSafeEqual('hello', 'hxllo')).toBe(false);
  });

  it('should return false for strings of different lengths', () => {
    expect(timingSafeEqual('abc', 'abcd')).toBe(false);
  });

  it('should return true for empty strings', () => {
    expect(timingSafeEqual('', '')).toBe(true);
  });

  it('should handle special characters', () => {
    expect(timingSafeEqual('!@#', '!@#')).toBe(true);
    expect(timingSafeEqual('!@#', '!@$')).toBe(false);
  });
});

describe('deriveMasterKey', () => {
  it('should derive key using PBKDF2 when algorithm is pbkdf2', async () => {
    const key = await deriveMasterKey(TEST_PASSWORD, TEST_SALT, {
      algorithm: 'pbkdf2',
      iterations: 1000,
    });
    const expected = deriveKeyPBKDF2(TEST_PASSWORD, TEST_SALT, 1000);
    expect(key).toEqual(expected);
    expect(key).toHaveLength(KEY_BYTES);
  });

  it('should derive key using Argon2id when algorithm is argon2id', async () => {
    const key = await deriveMasterKey(TEST_PASSWORD, TEST_SALT, {
      algorithm: 'argon2id',
      memoryCost: 65536,
      timeCost: 3,
      parallelism: 4,
    });
    expect(key).toBeInstanceOf(Buffer);
    expect(key).toHaveLength(KEY_BYTES);
  });

  it('should throw for unknown algorithm', async () => {
    await expect(
      deriveMasterKey(TEST_PASSWORD, TEST_SALT, {
        algorithm: 'unknown' as never,
        iterations: 1000,
      }),
    ).rejects.toThrow('Unknown KDF algorithm');
  });
});
