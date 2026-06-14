import { describe, it, expect, vi } from 'vitest';
import { writeFileSync, readFileSync, unlinkSync, existsSync, mkdirSync, rmdirSync } from 'node:fs';
import { join } from 'node:path';

const testDataDir = join(process.cwd(), 'test-data');
const attachmentsDir = join(testDataDir, 'attachments');
const tempDir = join(testDataDir, 'temp');

function cleanupDirs() {
  try {
    rmdirSync(attachmentsDir, { recursive: true });
  } catch {}
  try {
    rmdirSync(tempDir, { recursive: true });
  } catch {}
}

vi.mock('electron', () => ({
  app: { getPath: () => testDataDir },
}));

const TEST_KEY = Buffer.from('0123456789abcdef0123456789abcdef', 'utf-8');
const WRONG_KEY = Buffer.from('fedcba9876543210fedcba9876543210', 'utf-8');

// Import buffer-based encrypt/decrypt from the file handlers
// These match the functions used in fileHandlers.ts
import { encryptAES256GCM, decryptAES256GCM } from '../../src/main/crypto/encryption';

function encryptFileData(plaintext: Buffer, key: Buffer): Buffer {
  const encrypted = encryptAES256GCM(plaintext, key);
  const ivLength = Buffer.alloc(1, encrypted.iv.length);
  const tagLength = Buffer.alloc(1, encrypted.tag.length);
  return Buffer.concat([ivLength, tagLength, encrypted.iv, encrypted.tag, encrypted.ciphertext]);
}

function decryptFileData(encryptedBlob: Buffer, key: Buffer): Buffer {
  let offset = 0;
  const ivLength = encryptedBlob.readUInt8(offset);
  offset += 1;
  const tagLength = encryptedBlob.readUInt8(offset);
  offset += 1;
  const iv = encryptedBlob.subarray(offset, offset + ivLength);
  offset += ivLength;
  const tag = encryptedBlob.subarray(offset, offset + tagLength);
  offset += tagLength;
  const ciphertext = encryptedBlob.subarray(offset);
  return decryptAES256GCM({ ciphertext: Buffer.from(ciphertext), iv, tag }, key);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('File Attachment Encrypt/Decrypt Flow', () => {
  beforeAll(() => {
    cleanupDirs();
    mkdirSync(attachmentsDir, { recursive: true });
    mkdirSync(tempDir, { recursive: true });
  });

  afterAll(() => {
    cleanupDirs();
  });

  it('should encrypt and decrypt data round-trip', () => {
    const plaintext = Buffer.from('Hello, SecurePass! File attachment test.');
    const encrypted = encryptFileData(plaintext, TEST_KEY);

    // Encrypted output should be different from original
    expect(encrypted.equals(plaintext)).toBe(false);
    // Should be larger (has IV + tag overhead)
    expect(encrypted.length).toBeGreaterThan(plaintext.length);

    const decrypted = decryptFileData(encrypted, TEST_KEY);
    expect(decrypted.equals(plaintext)).toBe(true);
  });

  it('should fail to decrypt with wrong key', () => {
    const plaintext = Buffer.from('Sensitive data');
    const encrypted = encryptFileData(plaintext, TEST_KEY);

    expect(() => decryptFileData(encrypted, WRONG_KEY)).toThrow();
  });

  it('should handle empty data', () => {
    const plaintext = Buffer.alloc(0);
    const encrypted = encryptFileData(plaintext, TEST_KEY);
    const decrypted = decryptFileData(encrypted, TEST_KEY);

    expect(decrypted.length).toBe(0);
  });

  it('should handle large data (1MB)', () => {
    const largeData = Buffer.alloc(1024 * 1024, 0xab);
    // Add some variation to avoid all zeros
    for (let i = 0; i < largeData.length; i++) {
      largeData[i] = i % 256;
    }

    const encrypted = encryptFileData(largeData, TEST_KEY);
    const decrypted = decryptFileData(encrypted, TEST_KEY);

    expect(decrypted.equals(largeData)).toBe(true);
  });

  it('should handle binary data with all byte values', () => {
    const binary = Buffer.alloc(256);
    for (let i = 0; i < 256; i++) {
      binary[i] = i;
    }

    const encrypted = encryptFileData(binary, TEST_KEY);
    const decrypted = decryptFileData(encrypted, TEST_KEY);

    expect(decrypted.equals(binary)).toBe(true);
  });

  it('should detect tampered ciphertext', () => {
    const plaintext = Buffer.from('Tamper detection test');
    const encrypted = encryptFileData(plaintext, TEST_KEY);

    // Tamper with the ciphertext portion (after IV + tag length headers)
    encrypted[4] ^= 0xff;

    expect(() => decryptFileData(encrypted, TEST_KEY)).toThrow();
  });

  it('should write and read encrypted file to/from disk', () => {
    const plaintext = Buffer.from('Disk read/write test for file attachments');
    const encrypted = encryptFileData(plaintext, TEST_KEY);

    const storagePath = join(attachmentsDir, `test-${Date.now()}.enc`);
    writeFileSync(storagePath, encrypted);

    // Read back
    const readBack = readFileSync(storagePath);
    const decrypted = decryptFileData(readBack, TEST_KEY);

    expect(decrypted.equals(plaintext)).toBe(true);

    // Secure delete test
    unlinkSync(storagePath);
    expect(existsSync(storagePath)).toBe(false);
  });
});
