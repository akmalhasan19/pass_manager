import { describe, it, expect } from 'vitest';
import {
  encryptAES256GCM,
  decryptAES256GCM,
  encryptString,
  decryptString,
  encryptJSON,
  decryptJSON,
  EncryptedData,
} from '../../../src/main/crypto/encryption';
import { randomBytes } from 'node:crypto';

const VALID_KEY = Buffer.from('0123456789abcdef0123456789abcdef', 'utf-8');
const SHORT_KEY = Buffer.from('too-short', 'utf-8');

describe('encryptAES256GCM / decryptAES256GCM', () => {
  it('should encrypt and decrypt a buffer round-trip', () => {
    const plaintext = Buffer.from('Hello, SecurePass!', 'utf-8');
    const encrypted = encryptAES256GCM(plaintext, VALID_KEY);
    const decrypted = decryptAES256GCM(encrypted, VALID_KEY);
    expect(decrypted).toEqual(plaintext);
  });

  it('should encrypt and decrypt empty buffer', () => {
    const plaintext = Buffer.alloc(0);
    const encrypted = encryptAES256GCM(plaintext, VALID_KEY);
    const decrypted = decryptAES256GCM(encrypted, VALID_KEY);
    expect(decrypted).toEqual(plaintext);
  });

  it('should produce different ciphertext each time (random IV)', () => {
    const plaintext = Buffer.from('same data', 'utf-8');
    const result1 = encryptAES256GCM(plaintext, VALID_KEY);
    const result2 = encryptAES256GCM(plaintext, VALID_KEY);
    expect(result1.iv).not.toEqual(result2.iv);
    expect(result1.ciphertext).not.toEqual(result2.ciphertext);
  });

  it('should throw on invalid key length during encryption', () => {
    expect(() => encryptAES256GCM(Buffer.from('data'), SHORT_KEY)).toThrow(
      'Key must be 32 bytes',
    );
  });

  it('should throw on invalid key length during decryption', () => {
    const fakeData: EncryptedData = {
      ciphertext: Buffer.from('abc'),
      iv: Buffer.alloc(12),
      tag: Buffer.alloc(16),
    };
    expect(() => decryptAES256GCM(fakeData, SHORT_KEY)).toThrow(
      'Key must be 32 bytes',
    );
  });

  it('should throw when decrypting with wrong key', () => {
    const plaintext = Buffer.from('secret data', 'utf-8');
    const encrypted = encryptAES256GCM(plaintext, VALID_KEY);
    const wrongKey = randomBytes(32);
    expect(() => decryptAES256GCM(encrypted, wrongKey)).toThrow();
  });

  it('should throw on tampered ciphertext', () => {
    const plaintext = Buffer.from('tamper test', 'utf-8');
    const encrypted = encryptAES256GCM(plaintext, VALID_KEY);
    encrypted.ciphertext[0] ^= 0xff;
    expect(() => decryptAES256GCM(encrypted, VALID_KEY)).toThrow();
  });

  it('should throw on tampered tag', () => {
    const plaintext = Buffer.from('tamper tag', 'utf-8');
    const encrypted = encryptAES256GCM(plaintext, VALID_KEY);
    encrypted.tag[0] ^= 0xff;
    expect(() => decryptAES256GCM(encrypted, VALID_KEY)).toThrow();
  });

  it('should handle large data (1MB)', () => {
    const largeData = randomBytes(1024 * 1024);
    const encrypted = encryptAES256GCM(largeData, VALID_KEY);
    const decrypted = decryptAES256GCM(encrypted, VALID_KEY);
    expect(decrypted).toEqual(largeData);
  });

  it('should produce valid EncryptedData structure', () => {
    const plaintext = Buffer.from('structure check', 'utf-8');
    const result = encryptAES256GCM(plaintext, VALID_KEY);
    expect(result.iv).toHaveLength(12);
    expect(result.tag).toHaveLength(16);
    expect(result.ciphertext).toBeInstanceOf(Buffer);
  });
});

describe('encryptString / decryptString', () => {
  it('should encrypt and decrypt a string round-trip', () => {
    const original = 'Hello, World!';
    const encrypted = encryptString(original, VALID_KEY);
    const decrypted = decryptString(encrypted, VALID_KEY);
    expect(decrypted).toBe(original);
  });

  it('should handle empty string', () => {
    const encrypted = encryptString('', VALID_KEY);
    const decrypted = decryptString(encrypted, VALID_KEY);
    expect(decrypted).toBe('');
  });

  it('should handle unicode characters', () => {
    const unicode = '🔐 SecurePass ✓ ñôñ-ASCII 密码';
    const encrypted = encryptString(unicode, VALID_KEY);
    const decrypted = decryptString(encrypted, VALID_KEY);
    expect(decrypted).toBe(unicode);
  });

  it('should return a Buffer from encryptString', () => {
    const result = encryptString('test', VALID_KEY);
    expect(result).toBeInstanceOf(Buffer);
  });

  it('should fail to decrypt with wrong key', () => {
    const encrypted = encryptString('secret', VALID_KEY);
    const wrongKey = randomBytes(32);
    expect(() => decryptString(encrypted, wrongKey)).toThrow();
  });
});

describe('encryptJSON / decryptJSON', () => {
  it('should encrypt and decrypt a JSON object round-trip', () => {
    const obj = { name: 'Test Item', username: 'user@example.com', tags: [1, 2, 3] };
    const encrypted = encryptJSON(obj, VALID_KEY);
    const decrypted = decryptJSON<typeof obj>(encrypted, VALID_KEY);
    expect(decrypted).toEqual(obj);
  });

  it('should handle nested objects', () => {
    const nested = { a: { b: { c: [1, 2, { d: 'deep' }] } } };
    const encrypted = encryptJSON(nested, VALID_KEY);
    const decrypted = decryptJSON<typeof nested>(encrypted, VALID_KEY);
    expect(decrypted).toEqual(nested);
  });

  it('should handle arrays', () => {
    const arr = ['one', 'two', 'three'];
    const encrypted = encryptJSON(arr, VALID_KEY);
    const decrypted = decryptJSON<string[]>(encrypted, VALID_KEY);
    expect(decrypted).toEqual(arr);
  });

  it('should handle null and number values', () => {
    const data = { nullVal: null, numVal: 42, boolVal: true };
    const encrypted = encryptJSON(data, VALID_KEY);
    const decrypted = decryptJSON<typeof data>(encrypted, VALID_KEY);
    expect(decrypted).toEqual(data);
  });

  it('should fail to decrypt tampered JSON blob with wrong key', () => {
    const obj = { key: 'value' };
    const encrypted = encryptJSON(obj, VALID_KEY);
    const wrongKey = randomBytes(32);
    expect(() => decryptJSON(encrypted, wrongKey)).toThrow();
  });
});
