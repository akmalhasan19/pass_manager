import { describe, it, expect } from 'vitest';
import {
  arrayBufferToBase64,
  base64ToArrayBuffer,
  generateRequestId,
  currentTimestamp,
  generateECDHKeyPair,
  deriveSharedKey,
  encryptAESGCM,
  decryptAESGCM,
  importHMACKey,
  signHMAC,
  verifyHMAC,
  createHandshakeInit,
  parseHandshakeComplete,
  createEncryptedEnvelope,
  decryptEnvelope,
} from '../src/shared/crypto';
import {
  HandshakeMessageType,
  PROTOCOL_VERSION,
} from '../src/shared/protocol';

describe('Browser Extension Crypto Module', () => {
  describe('Base64 ↔ ArrayBuffer conversion', () => {
    it('should round-trip empty buffer', () => {
      const buf = new ArrayBuffer(0);
      const b64 = arrayBufferToBase64(buf);
      expect(b64).toBe('');
      const decoded = base64ToArrayBuffer(b64);
      expect(decoded.byteLength).toBe(0);
    });

    it('should round-trip known bytes', () => {
      const bytes = new Uint8Array([0, 1, 127, 128, 255]);
      const b64 = arrayBufferToBase64(bytes.buffer);
      const decoded = new Uint8Array(base64ToArrayBuffer(b64));
      expect(Array.from(decoded)).toEqual(Array.from(bytes));
    });

    it('should handle 65-byte uncompressed EC point', () => {
      const bytes = new Uint8Array(65);
      bytes[0] = 0x04; // uncompressed point prefix
      for (let i = 1; i < 65; i++) bytes[i] = i;
      const b64 = arrayBufferToBase64(bytes.buffer);
      const decoded = new Uint8Array(base64ToArrayBuffer(b64));
      expect(decoded.byteLength).toBe(65);
      expect(decoded[0]).toBe(0x04);
    });
  });

  describe('generateRequestId', () => {
    it('should return a valid UUID v4 format', () => {
      const id = generateRequestId();
      expect(id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
    });

    it('should generate unique IDs', () => {
      const ids = new Set(Array.from({ length: 100 }, () => generateRequestId()));
      expect(ids.size).toBe(100);
    });
  });

  describe('currentTimestamp', () => {
    it('should return a number close to Date.now()', () => {
      const before = Date.now();
      const ts = currentTimestamp();
      const after = Date.now();
      expect(ts).toBeGreaterThanOrEqual(before);
      expect(ts).toBeLessThanOrEqual(after);
    });
  });

  describe('ECDH Key Generation', () => {
    it('should generate a valid P-256 key pair', async () => {
      const keyPair = await generateECDHKeyPair();
      expect(keyPair.publicKeyBase64).toBeTruthy();
      expect(keyPair.privateKey).toBeTruthy();

      // Public key should be 65 bytes (uncompressed point)
      const rawKey = base64ToArrayBuffer(keyPair.publicKeyBase64);
      expect(rawKey.byteLength).toBe(65);
    });

    it('should generate unique key pairs', async () => {
      const kp1 = await generateECDHKeyPair();
      const kp2 = await generateECDHKeyPair();
      expect(kp1.publicKeyBase64).not.toBe(kp2.publicKeyBase64);
    });
  });

  describe('Shared Key Derivation', () => {
    it('should derive the same key from both sides of ECDH', async () => {
      // Simulate: Extension generates key pair, Host generates key pair
      const extensionKeys = await generateECDHKeyPair();
      const hostKeys = await generateECDHKeyPair();

      // Both sides derive the shared key
      const sharedKeyExt = await deriveSharedKey(
        extensionKeys.privateKey,
        hostKeys.publicKeyBase64,
      );
      const sharedKeyHost = await deriveSharedKey(
        hostKeys.privateKey,
        extensionKeys.publicKeyBase64,
      );

      // Both should produce the same AES key
      // We can verify by encrypting with one and decrypting with the other
      const plaintext = new TextEncoder().encode('test shared secret');
      const { ciphertext, nonce, authTag } = await encryptAESGCM(
        sharedKeyExt,
        plaintext.buffer as ArrayBuffer,
      );

      const decrypted = await decryptAESGCM(
        sharedKeyHost,
        ciphertext,
        nonce,
        authTag,
      );
      expect(new TextDecoder().decode(decrypted)).toBe('test shared secret');
    });
  });

  describe('AES-256-GCM Encrypt/Decrypt', () => {
    let testKey: CryptoKey;

    beforeAll(async () => {
      testKey = await crypto.subtle.generateKey(
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt'],
      );
    });

    it('should encrypt and decrypt plaintext', async () => {
      const plaintext = new TextEncoder().encode('Hello, SecurePass!');
      const { ciphertext, nonce, authTag } = await encryptAESGCM(
        testKey,
        plaintext.buffer as ArrayBuffer,
      );

      expect(ciphertext).toBeTruthy();
      expect(nonce).toBeTruthy();
      expect(authTag).toBeTruthy();

      const decrypted = await decryptAESGCM(testKey, ciphertext, nonce, authTag);
      expect(new TextDecoder().decode(decrypted)).toBe('Hello, SecurePass!');
    });

    it('should produce different ciphertext for same plaintext (random nonce)', async () => {
      const plaintext = new TextEncoder().encode('same text');
      const enc1 = await encryptAESGCM(testKey, plaintext.buffer as ArrayBuffer);
      const enc2 = await encryptAESGCM(testKey, plaintext.buffer as ArrayBuffer);

      expect(enc1.ciphertext).not.toBe(enc2.ciphertext);
      expect(enc1.nonce).not.toBe(enc2.nonce);
    });

    it('should fail to decrypt with wrong key', async () => {
      const wrongKey = await crypto.subtle.generateKey(
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt'],
      );

      const plaintext = new TextEncoder().encode('secret data');
      const { ciphertext, nonce, authTag } = await encryptAESGCM(
        testKey,
        plaintext.buffer as ArrayBuffer,
      );

      await expect(
        decryptAESGCM(wrongKey, ciphertext, nonce, authTag),
      ).rejects.toThrow();
    });

    it('should fail to decrypt with tampered ciphertext', async () => {
      const plaintext = new TextEncoder().encode('tamper test');
      const { ciphertext, nonce, authTag } = await encryptAESGCM(
        testKey,
        plaintext.buffer as ArrayBuffer,
      );

      // Tamper with ciphertext
      const tampered = ciphertext.slice(0, -2) + 'AA';
      await expect(
        decryptAESGCM(testKey, tampered, nonce, authTag),
      ).rejects.toThrow();
    });
  });

  describe('HMAC-SHA256 Sign/Verify', () => {
    it('should sign and verify data', async () => {
      const rawKey = crypto.getRandomValues(new Uint8Array(32));
      const key = await importHMACKey(arrayBufferToBase64(rawKey.buffer));

      const data = 'message to sign';
      const signature = await signHMAC(key, data);

      const valid = await verifyHMAC(key, signature, data);
      expect(valid).toBe(true);
    });

    it('should reject invalid signature', async () => {
      const rawKey = crypto.getRandomValues(new Uint8Array(32));
      const key = await importHMACKey(arrayBufferToBase64(rawKey.buffer));

      const valid = await verifyHMAC(key, 'invalidsignature', 'data');
      expect(valid).toBe(false);
    });

    it('should reject signature for different data', async () => {
      const rawKey = crypto.getRandomValues(new Uint8Array(32));
      const key = await importHMACKey(arrayBufferToBase64(rawKey.buffer));

      const signature = await signHMAC(key, 'original data');
      const valid = await verifyHMAC(key, signature, 'different data');
      expect(valid).toBe(false);
    });
  });

  describe('Handshake Message Creation', () => {
    it('should create a valid HANDSHAKE_INIT message', () => {
      const publicKey = arrayBufferToBase64(new Uint8Array(65).buffer);
      const msg = createHandshakeInit(publicKey);

      expect(msg.type).toBe(HandshakeMessageType.HANDSHAKE_INIT);
      expect(msg.protocolVersion).toBe(PROTOCOL_VERSION);
      expect(msg.publicKey).toBe(publicKey);
      expect(msg.requestId).toBeTruthy();
      expect(msg.timestamp).toBeGreaterThan(0);
    });
  });

  describe('Handshake Message Parsing', () => {
    it('should parse a valid HANDSHAKE_COMPLETE message', () => {
      const msg = parseHandshakeComplete({
        type: HandshakeMessageType.HANDSHAKE_COMPLETE,
        requestId: 'test-id',
        timestamp: Date.now(),
        protocolVersion: 1,
        publicKey: 'test-public-key',
        sessionToken: 'test-token',
        sessionId: 'test-session',
      });

      expect(msg.type).toBe(HandshakeMessageType.HANDSHAKE_COMPLETE);
      expect(msg.publicKey).toBe('test-public-key');
      expect(msg.sessionToken).toBe('test-token');
      expect(msg.sessionId).toBe('test-session');
    });

    it('should reject non-HANDSHAKE_COMPLETE message', () => {
      expect(() =>
        parseHandshakeComplete({
          type: HandshakeMessageType.HANDSHAKE_INIT,
          requestId: 'test',
          timestamp: Date.now(),
          protocolVersion: 1,
          publicKey: 'key',
        }),
      ).toThrow('Expected HANDSHAKE_COMPLETE');
    });

    it('should reject message with missing publicKey', () => {
      expect(() =>
        parseHandshakeComplete({
          type: HandshakeMessageType.HANDSHAKE_COMPLETE,
          requestId: 'test',
          timestamp: Date.now(),
          protocolVersion: 1,
          publicKey: '',
          sessionToken: 'token',
          sessionId: 'session',
        }),
      ).toThrow('missing valid publicKey');
    });

    it('should reject null input', () => {
      expect(() => parseHandshakeComplete(null)).toThrow('must be an object');
    });
  });

  describe('Encrypted Envelope Round-Trip', () => {
    it('should encrypt and decrypt a message envelope', async () => {
      const extensionKeys = await generateECDHKeyPair();
      const hostKeys = await generateECDHKeyPair();

      const sharedKey = await deriveSharedKey(
        extensionKeys.privateKey,
        hostKeys.publicKeyBase64,
      );

      // Generate HMAC key
      const rawHmac = crypto.getRandomValues(new Uint8Array(32));
      const hmacKey = await importHMACKey(arrayBufferToBase64(rawHmac.buffer));

      const originalMessage = {
        type: 'GET_MATCHING_ITEMS' as const,
        requestId: generateRequestId(),
        timestamp: currentTimestamp(),
        protocolVersion: PROTOCOL_VERSION,
        url: 'https://github.com/login',
      };

      const envelope = await createEncryptedEnvelope(
        sharedKey,
        hmacKey,
        'session-123',
        originalMessage,
      );

      expect(envelope.type).toBe(HandshakeMessageType.ENCRYPTED_REQUEST);
      expect(envelope.sessionId).toBe('session-123');
      expect(envelope.ciphertext).toBeTruthy();
      expect(envelope.nonce).toBeTruthy();
      expect(envelope.authTag).toBeTruthy();
      expect(envelope.signature).toBeTruthy();

      const decrypted = await decryptEnvelope(sharedKey, hmacKey, envelope);
      expect(decrypted).toEqual(originalMessage);
    });

    it('should fail decryption with wrong HMAC key', async () => {
      const keys = await generateECDHKeyPair();
      const aesKey = await deriveSharedKey(keys.privateKey, keys.publicKeyBase64);

      const rawHmac = crypto.getRandomValues(new Uint8Array(32));
      const hmacKey = await importHMACKey(arrayBufferToBase64(rawHmac.buffer));

      const wrongRawHmac = crypto.getRandomValues(new Uint8Array(32));
      const wrongHmacKey = await importHMACKey(
        arrayBufferToBase64(wrongRawHmac.buffer),
      );

      const envelope = await createEncryptedEnvelope(
        aesKey,
        hmacKey,
        'session',
        { test: true },
      );

      await expect(
        decryptEnvelope(aesKey, wrongHmacKey, envelope),
      ).rejects.toThrow('HMAC signature verification failed');
    });
  });
});
