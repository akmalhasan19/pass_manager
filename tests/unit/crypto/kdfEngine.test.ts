import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  PBKDF2Engine,
  Argon2idEngine,
  createEngine,
  createEngineWithFallback,
  type KdfParams,
  type KdfAlgorithm,
} from '../../../src/main/crypto/kdfEngine';
import { KEY_BYTES, deriveKeyPBKDF2 } from '../../../src/main/crypto/keyDerivation';
import { unicodeEdgeCases } from '../../fixtures/unicode-edge-cases';

const TEST_PASSWORD = 'MySecureMasterPassword!2024';
const TEST_SALT = Buffer.alloc(32, 0xab);

const PBKDF2_PARAMS: KdfParams = { algorithm: 'pbkdf2', iterations: 1000 };
const ARGON2ID_PARAMS: KdfParams = {
  algorithm: 'argon2id',
  memoryCost: 65536,
  timeCost: 3,
  parallelism: 4,
};

describe('PBKDF2Engine', () => {
  const engine = new PBKDF2Engine();

  it('should report pbkdf2 algorithm', () => {
    expect(engine.getAlgorithm()).toBe('pbkdf2');
  });

  it('should produce deterministic output for identical inputs', async () => {
    const key1 = await engine.deriveKey(TEST_PASSWORD, TEST_SALT, PBKDF2_PARAMS);
    const key2 = await engine.deriveKey(TEST_PASSWORD, TEST_SALT, PBKDF2_PARAMS);
    expect(key1).toEqual(key2);
  });

  it('should always output a 32-byte key for AES-256', async () => {
    const key = await engine.deriveKey(TEST_PASSWORD, TEST_SALT, PBKDF2_PARAMS);
    expect(key).toBeInstanceOf(Buffer);
    expect(key).toHaveLength(KEY_BYTES);
  });

  it('should handle an empty password', async () => {
    const key = await engine.deriveKey('', TEST_SALT, PBKDF2_PARAMS);
    expect(key).toBeInstanceOf(Buffer);
    expect(key).toHaveLength(KEY_BYTES);
  });

  it('should handle Unicode passwords', async () => {
    const key = await engine.deriveKey('pässwörd🔥', TEST_SALT, PBKDF2_PARAMS);
    expect(key).toBeInstanceOf(Buffer);
    expect(key).toHaveLength(KEY_BYTES);
  });

  it('should handle passwords longer than 1000 characters', async () => {
    const longPassword = 'a'.repeat(1001);
    const key = await engine.deriveKey(longPassword, TEST_SALT, PBKDF2_PARAMS);
    expect(key).toBeInstanceOf(Buffer);
    expect(key).toHaveLength(KEY_BYTES);
  });

  it('should produce different keys for different passwords', async () => {
    const key1 = await engine.deriveKey(TEST_PASSWORD, TEST_SALT, PBKDF2_PARAMS);
    const key2 = await engine.deriveKey('DifferentPassword!', TEST_SALT, PBKDF2_PARAMS);
    expect(key1).not.toEqual(key2);
  });

  it('should produce different keys for different salts', async () => {
    const key1 = await engine.deriveKey(TEST_PASSWORD, TEST_SALT, PBKDF2_PARAMS);
    const otherSalt = Buffer.alloc(32, 0xcd);
    const key2 = await engine.deriveKey(TEST_PASSWORD, otherSalt, PBKDF2_PARAMS);
    expect(key1).not.toEqual(key2);
  });

  it('should throw when given non-PBKDF2 parameters', async () => {
    await expect(
      engine.deriveKey(TEST_PASSWORD, TEST_SALT, {
        algorithm: 'argon2id',
        memoryCost: 1,
        timeCost: 1,
        parallelism: 1,
      } as KdfParams),
    ).rejects.toThrow('PBKDF2Engine received non-PBKDF2 params');
  });

  it.each(unicodeEdgeCases.map((c) => [c.id, c.value] as const))(
    'should handle Unicode edge case "%s"',
    async (_id, password) => {
      const key = await engine.deriveKey(password, TEST_SALT, PBKDF2_PARAMS);
      expect(key).toBeInstanceOf(Buffer);
      expect(key).toHaveLength(KEY_BYTES);
    },
  );
});

describe('Argon2idEngine', () => {
  const engine = new Argon2idEngine();

  it('should report argon2id algorithm', () => {
    expect(engine.getAlgorithm()).toBe('argon2id');
  });

  it('should produce deterministic output for identical inputs', async () => {
    const key1 = await engine.deriveKey(TEST_PASSWORD, TEST_SALT, ARGON2ID_PARAMS);
    const key2 = await engine.deriveKey(TEST_PASSWORD, TEST_SALT, ARGON2ID_PARAMS);
    expect(key1).toEqual(key2);
  });

  it('should always output a 32-byte key for AES-256', async () => {
    const key = await engine.deriveKey(TEST_PASSWORD, TEST_SALT, ARGON2ID_PARAMS);
    expect(key).toBeInstanceOf(Buffer);
    expect(key).toHaveLength(KEY_BYTES);
  });

  it('should handle an empty password', async () => {
    const key = await engine.deriveKey('', TEST_SALT, ARGON2ID_PARAMS);
    expect(key).toBeInstanceOf(Buffer);
    expect(key).toHaveLength(KEY_BYTES);
  });

  it('should handle Unicode passwords', async () => {
    const key = await engine.deriveKey('pässwörd🔥', TEST_SALT, ARGON2ID_PARAMS);
    expect(key).toBeInstanceOf(Buffer);
    expect(key).toHaveLength(KEY_BYTES);
  });

  it('should handle passwords longer than 1000 characters', async () => {
    const longPassword = 'a'.repeat(1001);
    const key = await engine.deriveKey(longPassword, TEST_SALT, ARGON2ID_PARAMS);
    expect(key).toBeInstanceOf(Buffer);
    expect(key).toHaveLength(KEY_BYTES);
  });

  it('should produce different keys for different passwords', async () => {
    const key1 = await engine.deriveKey(TEST_PASSWORD, TEST_SALT, ARGON2ID_PARAMS);
    const key2 = await engine.deriveKey('DifferentPassword!', TEST_SALT, ARGON2ID_PARAMS);
    expect(key1).not.toEqual(key2);
  });

  it('should produce different keys for different salts', async () => {
    const key1 = await engine.deriveKey(TEST_PASSWORD, TEST_SALT, ARGON2ID_PARAMS);
    const otherSalt = Buffer.alloc(32, 0xcd);
    const key2 = await engine.deriveKey(TEST_PASSWORD, otherSalt, ARGON2ID_PARAMS);
    expect(key1).not.toEqual(key2);
  });

  it('should throw when given non-Argon2id parameters', async () => {
    await expect(
      engine.deriveKey(TEST_PASSWORD, TEST_SALT, {
        algorithm: 'pbkdf2',
        iterations: 1000,
      } as KdfParams),
    ).rejects.toThrow('Argon2idEngine received non-Argon2id params');
  });

  it.each(unicodeEdgeCases.map((c) => [c.id, c.value] as const))(
    'should handle Unicode edge case "%s"',
    async (_id, password) => {
      const key = await engine.deriveKey(password, TEST_SALT, ARGON2ID_PARAMS);
      expect(key).toBeInstanceOf(Buffer);
      expect(key).toHaveLength(KEY_BYTES);
    },
  );
});

describe('Argon2idEngine native module failure fallback', () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.doMock('../../../src/main/crypto/argon2id', async () => {
      return {
        DEFAULT_ARGON2ID_PARAMS: {
          algorithm: 'argon2id' as const,
          memoryCost: 65536,
          timeCost: 3,
          parallelism: 4,
        },
        initArgon2idEngine: vi.fn().mockResolvedValue({
          status: 'unavailable' as const,
          error: 'mock native module load failure',
        }),
        isArgon2idAvailable: vi.fn().mockReturnValue(false),
        getArgon2idStatus: vi.fn().mockReturnValue({
          status: 'unavailable' as const,
          error: 'mock native module load failure',
        }),
        deriveKeyArgon2id: vi.fn().mockRejectedValue(new Error('native argon2 should not be called')),
      };
    });
  });

  afterEach(() => {
    vi.doUnmock('../../../src/main/crypto/argon2id');
  });

  it('should fall back to PBKDF2 when the native Argon2id module fails to load', async () => {
    const { Argon2idEngine } = await import('../../../src/main/crypto/kdfEngine');
    const engine = new Argon2idEngine();

    const key = await engine.deriveKey(TEST_PASSWORD, TEST_SALT, ARGON2ID_PARAMS);

    expect(key).toBeInstanceOf(Buffer);
    expect(key).toHaveLength(KEY_BYTES);
    expect(engine.fallbackOccurred).toBe(true);
    expect(engine.fallbackReason).toContain('Argon2id not available');

    // The fallback path uses the default PBKDF2 fallback parameters.
    const expectedFallbackKey = deriveKeyPBKDF2(TEST_PASSWORD, TEST_SALT, 600000);
    expect(key).toEqual(expectedFallbackKey);
  });

  it('should report fallback info through createEngineWithFallback when Argon2id is unavailable', async () => {
    const { createEngineWithFallback } = await import('../../../src/main/crypto/kdfEngine');
    const { engine, getFallbackInfo } = createEngineWithFallback('argon2id');

    await engine.deriveKey(TEST_PASSWORD, TEST_SALT, ARGON2ID_PARAMS);

    const info = getFallbackInfo();
    expect(info.occurred).toBe(true);
    expect(info.reason).toContain('Argon2id not available');
  });
});

describe('createEngine', () => {
  it.each([
    ['pbkdf2', PBKDF2Engine],
    ['argon2id', Argon2idEngine],
  ] as const)('should create the correct engine for algorithm "%s"', (algorithm, ExpectedClass) => {
    const engine = createEngine(algorithm as KdfAlgorithm);
    expect(engine).toBeInstanceOf(ExpectedClass);
    expect(engine.getAlgorithm()).toBe(algorithm);
  });

  it('should throw for an unknown algorithm', () => {
    expect(() => createEngine('unknown' as KdfAlgorithm)).toThrow('Unknown KDF algorithm');
  });
});

describe('createEngineWithFallback', () => {
  it('should return a PBKDF2 engine that never reports fallback', async () => {
    const { engine, getFallbackInfo } = createEngineWithFallback('pbkdf2');
    const key = await engine.deriveKey(TEST_PASSWORD, TEST_SALT, PBKDF2_PARAMS);

    expect(key).toHaveLength(KEY_BYTES);
    expect(getFallbackInfo().occurred).toBe(false);
    expect(engine.getAlgorithm()).toBe('pbkdf2');
  });

  it('should return an Argon2id engine that reports no fallback on success', async () => {
    const { engine, getFallbackInfo } = createEngineWithFallback('argon2id');
    const key = await engine.deriveKey(TEST_PASSWORD, TEST_SALT, ARGON2ID_PARAMS);

    expect(key).toHaveLength(KEY_BYTES);
    expect(engine.getAlgorithm()).toBe('argon2id');
    expect(getFallbackInfo().occurred).toBe(false);
  });
});
