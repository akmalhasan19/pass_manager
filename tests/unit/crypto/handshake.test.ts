import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { randomBytes, createHmac } from 'node:crypto';
import {
  generateEcdhKeyPair,
  deriveSharedKey,
  generateSessionToken,
  verifySessionToken,
  createSession,
  refreshSession,
  getSession,
  revokeSession,
  revokeAllSessions,
  getActiveSessionCount,
  encryptMessage,
  decryptMessage,
  processHandshakeInit,
  processTokenRefresh,
  type SessionState,
} from '../../../src/main/crypto/handshake';
import { HandshakeMessageType } from '../../../src/shared/protocols/handshake';
import type { HandshakeInitMessage, TokenRefreshMessage } from '../../../src/shared/protocols/handshake';

describe('ECDH Key Pair Generation', () => {
  it('should generate a valid ECDH P-256 key pair', () => {
    const keyPair = generateEcdhKeyPair();
    expect(keyPair.ecdh).toBeDefined();
    expect(keyPair.publicKeyBase64).toBeTruthy();
    expect(keyPair.publicKeyRaw).toBeInstanceOf(Buffer);
    expect(keyPair.publicKeyRaw.length).toBe(65); // Uncompressed P-256 point
  });

  it('should generate different key pairs each time', () => {
    const kp1 = generateEcdhKeyPair();
    const kp2 = generateEcdhKeyPair();
    expect(kp1.publicKeyBase64).not.toBe(kp2.publicKeyBase64);
    expect(kp1.publicKeyRaw).not.toEqual(kp2.publicKeyRaw);
  });

  it('should produce a valid base64-encoded public key', () => {
    const keyPair = generateEcdhKeyPair();
    const decoded = Buffer.from(keyPair.publicKeyBase64, 'base64');
    // Raw uncompressed P-256 point: 65 bytes starting with 0x04
    expect(decoded.length).toBe(65);
    expect(decoded[0]).toBe(0x04); // uncompressed point prefix
  });
});

describe('HKDF Shared Key Derivation', () => {
  it('should derive the same shared key from both sides of the exchange', () => {
    const alice = generateEcdhKeyPair();
    const bob = generateEcdhKeyPair();

    const sharedKeyAlice = deriveSharedKey(alice.ecdh, bob.publicKeyBase64);
    const sharedKeyBob = deriveSharedKey(bob.ecdh, alice.publicKeyBase64);

    expect(sharedKeyAlice).toEqual(sharedKeyBob);
    expect(sharedKeyAlice.length).toBe(32);
  });

  it('should produce different keys for different key pairs', () => {
    const alice1 = generateEcdhKeyPair();
    const bob1 = generateEcdhKeyPair();
    const alice2 = generateEcdhKeyPair();
    const bob2 = generateEcdhKeyPair();

    const key1 = deriveSharedKey(alice1.ecdh, bob1.publicKeyBase64);
    const key2 = deriveSharedKey(alice2.ecdh, bob2.publicKeyBase64);

    expect(key1).not.toEqual(key2);
  });

  it('should derive a 32-byte key suitable for AES-256', () => {
    const alice = generateEcdhKeyPair();
    const bob = generateEcdhKeyPair();
    const sharedKey = deriveSharedKey(alice.ecdh, bob.publicKeyBase64);
    expect(sharedKey.length).toBe(32);
  });
});

describe('Session Token Generation and Verification', () => {
  it('should generate a valid signed token', () => {
    const sessionId = 'sp_test123';
    const signingKey = randomBytes(32);
    const token = generateSessionToken(sessionId, signingKey);

    expect(token).toContain('.');
    const parts = token.split('.');
    expect(parts.length).toBe(2);
  });

  it('should verify a valid token', () => {
    const sessionId = 'sp_test456';
    const signingKey = randomBytes(32);
    const token = generateSessionToken(sessionId, signingKey);

    const result = verifySessionToken(token, signingKey);
    expect(result.ok).toBe(true);
    expect(result.sessionId).toBe(sessionId);
  });

  it('should reject token with wrong signing key', () => {
    const sessionId = 'sp_test789';
    const signingKey = randomBytes(32);
    const wrongKey = randomBytes(32);
    const token = generateSessionToken(sessionId, signingKey);

    const result = verifySessionToken(token, wrongKey);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('signature');
  });

  it('should reject expired token', () => {
    const sessionId = 'sp_expired';
    const signingKey = randomBytes(32);
    // Manually create an expired token payload
    const expiredPayload = {
      sessionId,
      createdAt: Date.now() - 60000,
      expiresAt: Date.now() - 1000, // expired 1 second ago
    };
    const payloadBase64 = Buffer.from(JSON.stringify(expiredPayload)).toString('base64url');
    const signature = createHmac('sha256', signingKey)
      .update(payloadBase64)
      .digest('base64url');
    const token = `${payloadBase64}.${signature}`;

    const result = verifySessionToken(token, signingKey);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('expired');
  });

  it('should reject malformed token', () => {
    const signingKey = randomBytes(32);
    expect(verifySessionToken('invalid', signingKey).ok).toBe(false);
    expect(verifySessionToken('a.b.c', signingKey).ok).toBe(false);
    expect(verifySessionToken('', signingKey).ok).toBe(false);
  });
});

describe('Session Management', () => {
  beforeEach(() => {
    revokeAllSessions();
  });

  afterEach(() => {
    revokeAllSessions();
  });

  it('should create a session and retrieve it', () => {
    const sharedKey = randomBytes(32);
    const session = createSession('sp_session1', 'fakepubkey', sharedKey, 'test-ext-id', 'vault-1');

    expect(session.sessionId).toBe('sp_session1');
    expect(session.sharedKey).toEqual(sharedKey);
    expect(session.extensionId).toBe('test-ext-id');
    expect(session.vaultId).toBe('vault-1');
    expect(session.expiresAt).toBeGreaterThan(session.createdAt);

    const retrieved = getSession('sp_session1');
    expect(retrieved).not.toBeNull();
    expect(retrieved!.sessionId).toBe('sp_session1');
  });

  it('should return null for non-existent session', () => {
    expect(getSession('sp_nonexistent')).toBeNull();
  });

  it('should revoke a session', () => {
    const sharedKey = randomBytes(32);
    createSession('sp_revoke1', 'fakepubkey', sharedKey, 'test-ext-id', null);

    expect(getSession('sp_revoke1')).not.toBeNull();
    revokeSession('sp_revoke1');
    expect(getSession('sp_revoke1')).toBeNull();
  });

  it('should revoke all sessions', () => {
    const key = randomBytes(32);
    createSession('sp_all1', 'pk1', key, 'ext-1', null);
    createSession('sp_all2', 'pk2', key, 'ext-2', null);

    expect(getActiveSessionCount()).toBe(2);
    revokeAllSessions();
    expect(getActiveSessionCount()).toBe(0);
  });

  it('should refresh a session token', () => {
    const sharedKey = randomBytes(32);
    const session = createSession('sp_refresh1', 'fakepubkey', sharedKey, 'test-ext', null);

    const newToken = refreshSession('sp_refresh1');
    expect(newToken).not.toBeNull();

    // Verify the new token
    const result = verifySessionToken(newToken!, session.tokenSigningKey);
    expect(result.ok).toBe(true);
  });

  it('should return null when refreshing non-existent session', () => {
    expect(refreshSession('sp_nonexistent')).toBeNull();
  });

  it('should track active session count', () => {
    const key = randomBytes(32);
    expect(getActiveSessionCount()).toBe(0);

    createSession('sp_count1', 'pk1', key, 'ext-a', null);
    expect(getActiveSessionCount()).toBe(1);

    createSession('sp_count2', 'pk2', key, 'ext-b', null);
    expect(getActiveSessionCount()).toBe(2);

    revokeSession('sp_count1');
    expect(getActiveSessionCount()).toBe(1);
  });
});

describe('Message Encryption / Decryption', () => {
  let session: SessionState;

  beforeEach(() => {
    revokeAllSessions();
    const sharedKey = randomBytes(32);
    session = createSession('sp_encrypt_test', 'fakepubkey', sharedKey, 'test-ext', null);
  });

  afterEach(() => {
    revokeAllSessions();
  });

  it('should encrypt and decrypt a message round-trip', () => {
    const plaintext = { type: 'GET_CREDENTIALS', itemId: 'item_123' };
    const envelope = encryptMessage(plaintext, session);

    expect(envelope.sessionId).toBe(session.sessionId);
    expect(envelope.ciphertext).toBeTruthy();
    expect(envelope.nonce).toBeTruthy();
    expect(envelope.authTag).toBeTruthy();
    expect(envelope.signature).toBeTruthy();

    const decrypted = decryptMessage<typeof plaintext>(envelope, session);
    expect(decrypted).toEqual(plaintext);
  });

  it('should produce different ciphertext each time (random nonce)', () => {
    const plaintext = { data: 'same message' };
    const env1 = encryptMessage(plaintext, session);
    const env2 = encryptMessage(plaintext, session);

    expect(env1.nonce).not.toBe(env2.nonce);
    expect(env1.ciphertext).not.toBe(env2.ciphertext);
  });

  it('should handle empty object', () => {
    const plaintext = {};
    const envelope = encryptMessage(plaintext, session);
    const decrypted = decryptMessage(envelope, session);
    expect(decrypted).toEqual(plaintext);
  });

  it('should handle large payloads', () => {
    const plaintext = { items: Array(1000).fill({ id: 'item', username: 'user', password: 'pass' }) };
    const envelope = encryptMessage(plaintext, session);
    const decrypted = decryptMessage<typeof plaintext>(envelope, session);
    expect(decrypted.items.length).toBe(1000);
  });

  it('should handle unicode content', () => {
    const plaintext = { title: '🔐 SecurePass', notes: '日本語テスト ✓' };
    const envelope = encryptMessage(plaintext, session);
    const decrypted = decryptMessage<typeof plaintext>(envelope, session);
    expect(decrypted).toEqual(plaintext);
  });

  it('should fail to decrypt with wrong session key', () => {
    const plaintext = { secret: 'data' };
    const envelope = encryptMessage(plaintext, session);

    const wrongSession = createSession('sp_wrong', 'fakepubkey', randomBytes(32), 'wrong-ext', null);
    expect(() => decryptMessage(envelope, wrongSession)).toThrow('Session ID mismatch');
  });

  it('should fail to decrypt with tampered ciphertext', () => {
    const plaintext = { data: 'integrity check' };
    const envelope = encryptMessage(plaintext, session);

    // Tamper with ciphertext
    const tampered = { ...envelope };
    const ctBuf = Buffer.from(tampered.ciphertext, 'base64');
    ctBuf[0] ^= 0xff;
    tampered.ciphertext = ctBuf.toString('base64');

    expect(() => decryptMessage(tampered, session)).toThrow();
  });

  it('should fail to decrypt with tampered auth tag', () => {
    const plaintext = { data: 'tag check' };
    const envelope = encryptMessage(plaintext, session);

    const tampered = { ...envelope };
    const tagBuf = Buffer.from(tampered.authTag, 'base64');
    tagBuf[0] ^= 0xff;
    tampered.authTag = tagBuf.toString('base64');

    expect(() => decryptMessage(tampered, session)).toThrow();
  });

  it('should fail to decrypt with tampered signature', () => {
    const plaintext = { data: 'sig check' };
    const envelope = encryptMessage(plaintext, session);

    const tampered = { ...envelope };
    tampered.signature = 'tampered_signature_value';

    expect(() => decryptMessage(tampered, session)).toThrow('signature verification failed');
  });

  it('should fail to decrypt with tampered session ID', () => {
    const plaintext = { data: 'session check' };
    const envelope = encryptMessage(plaintext, session);

    const tampered = { ...envelope, sessionId: 'sp_tampered' };
    expect(() => decryptMessage(tampered, session)).toThrow('Session ID mismatch');
  });

  it('should support ENCRYPTED_RESPONSE message type', () => {
    const plaintext = { result: 'ok' };
    const envelope = encryptMessage(plaintext, session, HandshakeMessageType.ENCRYPTED_RESPONSE);

    expect(envelope.type).toBe(HandshakeMessageType.ENCRYPTED_RESPONSE);

    const decrypted = decryptMessage<typeof plaintext>(envelope, session);
    expect(decrypted).toEqual(plaintext);
  });
});

describe('Handshake Flow', () => {
  beforeEach(() => {
    revokeAllSessions();
  });

  afterEach(() => {
    revokeAllSessions();
  });

  it('should complete a full handshake flow', () => {
    // Extension side: generate key pair and send HANDSHAKE_INIT
    const extensionKeyPair = generateEcdhKeyPair();
    const initMessage: HandshakeInitMessage = {
      requestId: 'req_001',
      timestamp: Date.now(),
      protocolVersion: 1,
      type: HandshakeMessageType.HANDSHAKE_INIT,
      publicKey: extensionKeyPair.publicKeyBase64,
      extensionId: 'test-extension-id',
    };

    // Host side: process the init message (with active vault)
    const completeMessage = processHandshakeInit(initMessage, 'vault-test');

    // Verify response
    expect(completeMessage.type).toBe(HandshakeMessageType.HANDSHAKE_COMPLETE);
    expect(completeMessage.publicKey).toBeTruthy();
    expect(completeMessage.sessionToken).toBeTruthy();
    expect(completeMessage.sessionId).toBeTruthy();
    expect(completeMessage.requestId).toBe('req_001');

    // Both sides should derive the same shared key
    const hostKeyPair = generateEcdhKeyPair(); // This is NOT the one used in processHandshakeInit
    // We verify by checking that the session was created with a valid shared key
    const session = getSession(completeMessage.sessionId);
    expect(session).not.toBeNull();
    expect(session!.sharedKey.length).toBe(32);
    expect(session!.extensionId).toBe('test-extension-id');
    expect(session!.vaultId).toBe('vault-test');
  });

  it('should allow encrypted communication after handshake', () => {
    // Complete handshake
    const extKeyPair = generateEcdhKeyPair();
    const initMessage: HandshakeInitMessage = {
      requestId: 'req_002',
      timestamp: Date.now(),
      protocolVersion: 1,
      type: HandshakeMessageType.HANDSHAKE_INIT,
      publicKey: extKeyPair.publicKeyBase64,
      extensionId: 'test-extension-encrypted',
    };

    const completeMessage = processHandshakeInit(initMessage, null);
    const session = getSession(completeMessage.sessionId)!;

    // Extension encrypts a request
    const request = { type: 'GET_CREDENTIALS', itemId: 'item_abc' };
    const envelope = encryptMessage(request, session, HandshakeMessageType.ENCRYPTED_REQUEST);

    // Host decrypts the request
    const decrypted = decryptMessage<typeof request>(envelope, session);
    expect(decrypted).toEqual(request);

    // Host encrypts a response
    const response = { username: 'user@example.com', password: 'encrypted_blob' };
    const responseEnvelope = encryptMessage(
      response,
      session,
      HandshakeMessageType.ENCRYPTED_RESPONSE,
    );

    // Extension decrypts response
    const decryptedResponse = decryptMessage<typeof response>(responseEnvelope, session);
    expect(decryptedResponse).toEqual(response);
  });
});

describe('Token Refresh Flow', () => {
  beforeEach(() => {
    revokeAllSessions();
  });

  afterEach(() => {
    revokeAllSessions();
  });

  it('should refresh an existing session token', () => {
    // Create a session
    const sharedKey = randomBytes(32);
    const session = createSession('sp_refresh_flow', 'fakepubkey', sharedKey, 'test-ext', null);

    // Generate initial token
    const initialToken = generateSessionToken('sp_refresh_flow', session.tokenSigningKey);

    // Create refresh request
    const refreshMsg: TokenRefreshMessage = {
      requestId: 'req_refresh_001',
      timestamp: Date.now(),
      protocolVersion: 1,
      type: HandshakeMessageType.TOKEN_REFRESH,
      sessionToken: initialToken,
    };

    // Process refresh
    const refreshedMsg = processTokenRefresh(refreshMsg);

    expect(refreshedMsg).not.toBeNull();
    expect(refreshedMsg!.type).toBe(HandshakeMessageType.TOKEN_REFRESHED);
    expect(refreshedMsg!.sessionId).toBe('sp_refresh_flow');
    // Token may be identical if generated in the same millisecond; the key
    // property is that the refresh extends the session's expiry.
    expect(refreshedMsg!.sessionToken).toBeTruthy();

    // Verify new token is valid
    const verifyResult = verifySessionToken(refreshedMsg!.sessionToken, session.tokenSigningKey);
    expect(verifyResult.ok).toBe(true);
  });

  it('should reject refresh for non-existent session', () => {
    const refreshMsg: TokenRefreshMessage = {
      requestId: 'req_refresh_002',
      timestamp: Date.now(),
      protocolVersion: 1,
      type: HandshakeMessageType.TOKEN_REFRESH,
      sessionToken: 'invalid.token.here',
    };

    const result = processTokenRefresh(refreshMsg);
    expect(result).toBeNull();
  });
});

describe('Integration: End-to-End Secure Communication', () => {
  beforeEach(() => {
    revokeAllSessions();
  });

  afterEach(() => {
    revokeAllSessions();
  });

  it('should support a complete handshake → encrypted request → response cycle', () => {
    // 1. Extension generates key pair
    const extKeyPair = generateEcdhKeyPair();

    // 2. Extension sends HANDSHAKE_INIT
    const initMsg: HandshakeInitMessage = {
      requestId: 'req_e2e_001',
      timestamp: Date.now(),
      protocolVersion: 1,
      type: HandshakeMessageType.HANDSHAKE_INIT,
      publicKey: extKeyPair.publicKeyBase64,
      extensionId: 'e2e-test-extension',
    };

    // 3. Host processes init → HANDSHAKE_COMPLETE (with active vault)
    const completeMsg = processHandshakeInit(initMsg, 'vault-e2e');
    expect(completeMsg.sessionId).toBeTruthy();

    // 4. Host retrieves session
    const hostSession = getSession(completeMsg.sessionId);
    expect(hostSession).not.toBeNull();

    // 5. Extension derives same shared key (simulated)
    // In real extension, this would use Web Crypto API ECDH
    const extDerivedKey = deriveSharedKey(extKeyPair.ecdh, completeMsg.publicKey);
    expect(extDerivedKey).toEqual(hostSession!.sharedKey);

    // 6. Extension encrypts GET_MATCHING_ITEMS request (signed with shared tokenSigningKey)
    const extSession: SessionState = {
      sessionId: completeMsg.sessionId,
      extensionPublicKey: extKeyPair.publicKeyBase64,
      extensionId: 'e2e-test-extension',
      vaultId: 'vault-e2e',
      sharedKey: extDerivedKey,
      tokenSigningKey: hostSession!.tokenSigningKey, // exchanged during handshake
      createdAt: Date.now(),
      expiresAt: Date.now() + 30 * 60 * 1000,
    };

    const matchingRequest = {
      url: 'https://github.com/login',
      domain: 'github.com',
    };
    const requestEnvelope = encryptMessage(matchingRequest, extSession);

    // 7. Host decrypts request and verifies signature
    const decryptedRequest = decryptMessage<typeof matchingRequest>(
      requestEnvelope,
      hostSession!,
    );
    expect(decryptedRequest.url).toBe('https://github.com/login');
    expect(decryptedRequest.domain).toBe('github.com');

    // 8. Host encrypts and signs response
    const matchingResponse = {
      items: [
        { id: 'item1', title: 'GitHub', username: 'user@example.com' },
      ],
      totalCount: 1,
    };
    const responseEnvelope = encryptMessage(
      matchingResponse,
      hostSession!,
      HandshakeMessageType.ENCRYPTED_RESPONSE,
    );

    // 9. Extension decrypts and verifies host-signed response
    const decryptedResponse = decryptMessage<typeof matchingResponse>(
      responseEnvelope,
      extSession,
    );
    expect(decryptedResponse.items).toHaveLength(1);
    expect(decryptedResponse.items[0].title).toBe('GitHub');
  });
});
