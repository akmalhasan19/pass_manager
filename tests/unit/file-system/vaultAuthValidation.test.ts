import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { validateAuthMetadata, readVaultAuthMetadata } from '../../../src/main/file-system/vaultAuthStorage';

// Mock electron app path
vi.mock('electron', () => ({
  app: {
    getPath: () => join(process.cwd(), 'test-data'),
  },
}));

const TEST_VAULT_ID = '550e8400-e29b-41d4-a716-446655440000';
const TEST_AUTH_DIR = join(process.cwd(), 'test-data', 'vault-auth');

describe('validateAuthMetadata', () => {
  beforeEach(() => {
    if (!existsSync(TEST_AUTH_DIR)) {
      mkdirSync(TEST_AUTH_DIR, { recursive: true });
    }
  });

  afterEach(() => {
    if (existsSync(TEST_AUTH_DIR)) {
      rmSync(TEST_AUTH_DIR, { recursive: true, force: true });
    }
  });

  it('should return null for valid PBKDF2 metadata', () => {
    const metadata = {
      salt: Buffer.alloc(32, 0xab).toString('base64'),
      verificationHash: 'a'.repeat(64),
      kdfAlgorithm: 'pbkdf2',
      kdfIterations: 600000,
      createdAt: Date.now(),
    };

    const error = validateAuthMetadata(metadata);
    expect(error).toBeNull();
  });

  it('should return null for valid Argon2id metadata', () => {
    const metadata = {
      salt: Buffer.alloc(32, 0xab).toString('base64'),
      verificationHash: 'a'.repeat(64),
      kdfAlgorithm: 'argon2id',
      kdfMemory: 65536,
      kdfParallelism: 4,
      createdAt: Date.now(),
    };

    const error = validateAuthMetadata(metadata);
    expect(error).toBeNull();
  });

  it('should return error for missing salt', () => {
    const metadata = {
      verificationHash: 'a'.repeat(64),
      kdfAlgorithm: 'pbkdf2',
      kdfIterations: 600000,
      createdAt: Date.now(),
    };

    const error = validateAuthMetadata(metadata);
    expect(error).toBe('Auth metadata is corrupt: missing or invalid salt.');
  });

  it('should return error for invalid salt type', () => {
    const metadata = {
      salt: 12345,
      verificationHash: 'a'.repeat(64),
      kdfAlgorithm: 'pbkdf2',
      kdfIterations: 600000,
      createdAt: Date.now(),
    };

    const error = validateAuthMetadata(metadata);
    expect(error).toBe('Auth metadata is corrupt: missing or invalid salt.');
  });

  it('should return error for empty salt', () => {
    const metadata = {
      salt: Buffer.alloc(0).toString('base64'),
      verificationHash: 'a'.repeat(64),
      kdfAlgorithm: 'pbkdf2',
      kdfIterations: 600000,
      createdAt: Date.now(),
    };

    const error = validateAuthMetadata(metadata);
    expect(error).toBe('Auth metadata is corrupt: missing or invalid salt.');
  });

  it('should return error for invalid base64 salt', () => {
    const metadata = {
      salt: 'invalid-base64!!!',
      verificationHash: 'a'.repeat(64),
      kdfAlgorithm: 'pbkdf2',
      kdfIterations: 600000,
      createdAt: Date.now(),
    };

    const error = validateAuthMetadata(metadata);
    expect(error).toBe('Auth metadata is corrupt: salt is not valid base64.');
  });

  it('should return error for missing verification hash', () => {
    const metadata = {
      salt: Buffer.alloc(32, 0xab).toString('base64'),
      kdfAlgorithm: 'pbkdf2',
      kdfIterations: 600000,
      createdAt: Date.now(),
    };

    const error = validateAuthMetadata(metadata);
    expect(error).toBe('Auth metadata is corrupt: missing or invalid verification hash.');
  });

  it('should return error for invalid verification hash format', () => {
    const metadata = {
      salt: Buffer.alloc(32, 0xab).toString('base64'),
      verificationHash: 'invalid-hash',
      kdfAlgorithm: 'pbkdf2',
      kdfIterations: 600000,
      createdAt: Date.now(),
    };

    const error = validateAuthMetadata(metadata);
    expect(error).toBe('Auth metadata is corrupt: verification hash is not valid hex.');
  });

  it('should return error for unsupported KDF algorithm', () => {
    const metadata = {
      salt: Buffer.alloc(32, 0xab).toString('base64'),
      verificationHash: 'a'.repeat(64),
      kdfAlgorithm: 'unsupported',
      kdfIterations: 600000,
      createdAt: Date.now(),
    };

    const error = validateAuthMetadata(metadata);
    expect(error).toBe('Auth metadata is corrupt: unsupported KDF algorithm "unsupported".');
  });

  it('should return error for invalid PBKDF2 iterations', () => {
    const metadata = {
      salt: Buffer.alloc(32, 0xab).toString('base64'),
      verificationHash: 'a'.repeat(64),
      kdfAlgorithm: 'pbkdf2',
      kdfIterations: -1,
      createdAt: Date.now(),
    };

    const error = validateAuthMetadata(metadata);
    expect(error).toBe('Auth metadata is corrupt: invalid PBKDF2 iterations count.');
  });

  it('should return error for invalid Argon2id memory cost', () => {
    const metadata = {
      salt: Buffer.alloc(32, 0xab).toString('base64'),
      verificationHash: 'a'.repeat(64),
      kdfAlgorithm: 'argon2id',
      kdfMemory: 0,
      kdfParallelism: 4,
      createdAt: Date.now(),
    };

    const error = validateAuthMetadata(metadata);
    expect(error).toBe('Auth metadata is corrupt: invalid Argon2id memory cost.');
  });

  it('should return error for invalid Argon2id parallelism', () => {
    const metadata = {
      salt: Buffer.alloc(32, 0xab).toString('base64'),
      verificationHash: 'a'.repeat(64),
      kdfAlgorithm: 'argon2id',
      kdfMemory: 65536,
      kdfParallelism: -1,
      createdAt: Date.now(),
    };

    const error = validateAuthMetadata(metadata);
    expect(error).toBe('Auth metadata is corrupt: invalid Argon2id parallelism.');
  });
});

describe('readVaultAuthMetadata validation', () => {
  beforeEach(() => {
    if (!existsSync(TEST_AUTH_DIR)) {
      mkdirSync(TEST_AUTH_DIR, { recursive: true });
    }
  });

  afterEach(() => {
    if (existsSync(TEST_AUTH_DIR)) {
      rmSync(TEST_AUTH_DIR, { recursive: true, force: true });
    }
  });

  it('should throw error for invalid JSON', () => {
    const authPath = join(TEST_AUTH_DIR, `${TEST_VAULT_ID}.auth.json`);
    writeFileSync(authPath, 'invalid json', 'utf-8');

    expect(() => readVaultAuthMetadata(TEST_VAULT_ID)).toThrow(
      `Auth metadata for vault ${TEST_VAULT_ID} is corrupt: invalid JSON format.`,
    );
  });

  it('should throw error for missing required fields', () => {
    const authPath = join(TEST_AUTH_DIR, `${TEST_VAULT_ID}.auth.json`);
    writeFileSync(authPath, JSON.stringify({ invalid: 'data' }), 'utf-8');

    expect(() => readVaultAuthMetadata(TEST_VAULT_ID)).toThrow(
      `Auth metadata for vault ${TEST_VAULT_ID} is corrupt:`,
    );
  });

  it('should throw error for corrupt salt', () => {
    const authPath = join(TEST_AUTH_DIR, `${TEST_VAULT_ID}.auth.json`);
    const metadata = {
      salt: 'invalid-base64!!!',
      verificationHash: 'a'.repeat(64),
      kdfAlgorithm: 'pbkdf2',
      kdfIterations: 600000,
      createdAt: Date.now(),
    };
    writeFileSync(authPath, JSON.stringify(metadata), 'utf-8');

    expect(() => readVaultAuthMetadata(TEST_VAULT_ID)).toThrow(
      `Auth metadata for vault ${TEST_VAULT_ID} is corrupt:`,
    );
  });

  it('should successfully read valid metadata', () => {
    const authPath = join(TEST_AUTH_DIR, `${TEST_VAULT_ID}.auth.json`);
    const metadata = {
      salt: Buffer.alloc(32, 0xab).toString('base64'),
      verificationHash: 'a'.repeat(64),
      kdfAlgorithm: 'pbkdf2',
      kdfIterations: 600000,
      createdAt: Date.now(),
    };
    writeFileSync(authPath, JSON.stringify(metadata), 'utf-8');

    const result = readVaultAuthMetadata(TEST_VAULT_ID);
    expect(result.salt).toBeInstanceOf(Buffer);
    expect(result.salt).toHaveLength(32);
    expect(result.kdfAlgorithm).toBe('pbkdf2');
    expect(result.kdfIterations).toBe(600000);
  });
});
