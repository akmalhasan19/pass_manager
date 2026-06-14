import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import initSqlJs, { Database as SqlJsDatabase } from 'sql.js';
import { readFileSync, writeFileSync, existsSync, unlinkSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  generateSalt,
  deriveKeyPBKDF2,
  hashKeyForVerification,
  verifyKeyAgainstHash,
} from '@main/crypto/keyDerivation';
import { encryptString, decryptString } from '@main/crypto/encryption';
import { evaluateStrength } from '@main/crypto/passwordGenerator';

const testDataDir = join(process.cwd(), 'test-data');
const authPath = join(testDataDir, 'auth.json');
const FTS5_RELATED = /items_fts|fts5/i;

async function createDb(): Promise<SqlJsDatabase> {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  db.run('PRAGMA foreign_keys = ON');
  db.run('PRAGMA journal_mode = MEMORY');

  const schemaPath = join(__dirname, '..', '..', 'src', 'main', 'database', 'schema.sql');
  const schema = readFileSync(schemaPath, 'utf-8');
  const noComments = schema
    .split('\n')
    .filter((l) => !l.trim().startsWith('--'))
    .join('\n');
  const statements = noComments
    .split(';')
    .map((s) => s.trim() + ';')
    .filter((s) => s.length > 1);

  for (const stmt of statements) {
    if (FTS5_RELATED.test(stmt)) continue;
    try {
      db.run(stmt);
    } catch {
      /* skip */
    }
  }
  return db;
}

describe('Auth Flow Integration', () => {
  beforeEach(() => {
    try {
      mkdirSync(testDataDir, { recursive: true });
    } catch {}
    if (existsSync(authPath)) {
      unlinkSync(authPath);
    }
  });

  const STRONG_PW = 'MyStr0ng!M@sterP@ssword';
  const WEAK_PW = 'weak';

  // =========================================================================
  // 1. First-time init flow
  // =========================================================================
  it('should init: generate salt, derive key, store auth metadata', () => {
    // Password strength check
    const weakStrength = evaluateStrength(WEAK_PW);
    expect(weakStrength.score).toBeLessThan(2);

    const strength = evaluateStrength(STRONG_PW);
    expect(strength.score).toBeGreaterThanOrEqual(2);

    // Generate salt
    const salt = generateSalt();
    expect(salt.length).toBe(32);

    // Derive key
    const key = deriveKeyPBKDF2(STRONG_PW, salt);
    expect(key.length).toBe(32);

    // Create verification hash
    const hash = hashKeyForVerification(key);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);

    // Store auth metadata
    const metadata = {
      salt: salt.toString('base64'),
      kdfAlgorithm: 'pbkdf2',
      kdfIterations: 600000,
      verificationHash: hash,
      createdAt: Date.now(),
    };
    writeFileSync(authPath, JSON.stringify(metadata, null, 2), 'utf-8');
    expect(existsSync(authPath)).toBe(true);
  });

  // =========================================================================
  // 2. Unlock with correct password
  // =========================================================================
  it('should unlock with correct password', () => {
    // Setup: init first
    const salt = generateSalt();
    const key = deriveKeyPBKDF2(STRONG_PW, salt);
    const hash = hashKeyForVerification(key);
    writeFileSync(
      authPath,
      JSON.stringify(
        {
          salt: salt.toString('base64'),
          kdfAlgorithm: 'pbkdf2',
          kdfIterations: 600000,
          verificationHash: hash,
          createdAt: Date.now(),
        },
        null,
        2,
      ),
      'utf-8',
    );

    // Read back auth metadata
    const raw = JSON.parse(readFileSync(authPath, 'utf-8'));
    const storedSalt = Buffer.from(raw.salt, 'base64');
    const storedHash = raw.verificationHash;

    // Derive key from password + stored salt
    const derivedKey = deriveKeyPBKDF2(STRONG_PW, storedSalt);

    // Verify
    expect(verifyKeyAgainstHash(derivedKey, storedHash)).toBe(true);
  });

  // =========================================================================
  // 3. Unlock with wrong password fails
  // =========================================================================
  it('should fail unlock with wrong password', () => {
    const salt = generateSalt();
    const key = deriveKeyPBKDF2(STRONG_PW, salt);
    const hash = hashKeyForVerification(key);
    writeFileSync(
      authPath,
      JSON.stringify(
        {
          salt: salt.toString('base64'),
          verificationHash: hash,
          kdfAlgorithm: 'pbkdf2',
          kdfIterations: 600000,
          createdAt: Date.now(),
        },
        null,
        2,
      ),
      'utf-8',
    );

    const raw = JSON.parse(readFileSync(authPath, 'utf-8'));
    const storedSalt = Buffer.from(raw.salt, 'base64');

    const wrongKey = deriveKeyPBKDF2('Wr0ngP@ssword!', storedSalt);
    expect(verifyKeyAgainstHash(wrongKey, raw.verificationHash)).toBe(false);
  });

  // =========================================================================
  // 4. Full decrypt/encrypt item flow with master key
  // =========================================================================
  it('should encrypt item fields with master key and decrypt them back', () => {
    const salt = generateSalt();
    const masterKey = deriveKeyPBKDF2(STRONG_PW, salt);

    // Encrypt password & notes
    const passwordEncrypted = encryptString('mySecretPassword123', masterKey);
    const notesEncrypted = encryptString('Some secure notes here', masterKey);

    expect(passwordEncrypted).toBeInstanceOf(Buffer);
    expect(notesEncrypted).toBeInstanceOf(Buffer);
    // Encrypted should differ from plaintext
    expect(passwordEncrypted.toString()).not.toBe('mySecretPassword123');

    // Decrypt
    const passwordDecrypted = decryptString(passwordEncrypted, masterKey);
    const notesDecrypted = decryptString(notesEncrypted, masterKey);

    expect(passwordDecrypted).toBe('mySecretPassword123');
    expect(notesDecrypted).toBe('Some secure notes here');
  });

  // =========================================================================
  // 5. Change password: re-encrypt item data
  // =========================================================================
  it('should change password by re-encrypting data with new key', () => {
    const oldSalt = generateSalt();
    const oldKey = deriveKeyPBKDF2(STRONG_PW, oldSalt);

    // Original encrypted data
    const originalPwEnc = encryptString('myPassword', oldKey);
    const originalNotesEnc = encryptString('my notes', oldKey);

    // Decrypt with old key, re-encrypt with new key
    const newSalt = generateSalt();
    const newKey = deriveKeyPBKDF2('MyN3w$tr0ngP@ss', newSalt);

    const decryptedPw = decryptString(originalPwEnc, oldKey);
    const decryptedNotes = decryptString(originalNotesEnc, oldKey);

    const newPwEnc = encryptString(decryptedPw, newKey);
    const newNotesEnc = encryptString(decryptedNotes, newKey);

    // Verify with new key
    expect(decryptString(newPwEnc, newKey)).toBe('myPassword');
    expect(decryptString(newNotesEnc, newKey)).toBe('my notes');

    // Old key should no longer work for new encrypted data
    expect(() => decryptString(newPwEnc, oldKey)).toThrow();
  });

  // =========================================================================
  // 6. Key isolation: different salts produce different keys
  // =========================================================================
  it('should produce different keys from different salts', () => {
    const salt1 = generateSalt();
    const salt2 = generateSalt();

    const key1 = deriveKeyPBKDF2(STRONG_PW, salt1);
    const key2 = deriveKeyPBKDF2(STRONG_PW, salt2);

    expect(key1.equals(key2)).toBe(false);
  });

  // =========================================================================
  // 7. Hash verification is one-way
  // =========================================================================
  it('should not be able to reverse verification hash to get key', () => {
    const salt = generateSalt();
    const key = deriveKeyPBKDF2(STRONG_PW, salt);
    const hash = hashKeyForVerification(key);

    // Hash is not the key itself
    expect(hash).not.toBe(key.toString('hex'));
    // Hash alone cannot verify - need the key
    expect(verifyKeyAgainstHash(key, hash)).toBe(true);
  });
});
