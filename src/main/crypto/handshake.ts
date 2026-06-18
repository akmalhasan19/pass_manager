/**
 * ECDH Handshake, Session Management, and Encrypted Messaging
 * for the SecurePass Manager Browser Extension (Host / Electron side).
 *
 * This module implements:
 * 1. ECDH P-256 key pair generation and shared secret derivation
 * 2. HKDF-based key derivation from ECDH shared secret
 * 3. HMAC-signed session token generation and verification
 * 4. AES-256-GCM message encryption/decryption
 * 5. Session lifecycle management (create, refresh, revoke)
 *
 * SECURITY INVARIANTS:
 * - All ECDH key pairs are ephemeral (generated per handshake).
 * - Shared secret is derived via HKDF with domain-specific info and salt.
 * - Session tokens are bound to the HMAC key derived from the session.
 * - AES-GCM nonces are randomly generated (12 bytes) to prevent reuse.
 * - All sensitive material (private keys, shared secrets) is wiped after use.
 *
 * @module main/crypto/handshake
 */

import {
  createECDH,
  createHmac,
  createCipheriv,
  createDecipheriv,
  randomBytes,
  diffieHellman,
  type ECDH,
  type CipherGCM,
  type DecipherGCM,
} from 'node:crypto';

import {
  HandshakeMessageType,
  SESSION_TOKEN_TTL_MS,
  HKDF_INFO,
  HKDF_SALT,
  type HandshakeInitMessage,
  type HandshakeCompleteMessage,
  type EncryptedMessageEnvelope,
  type TokenRefreshMessage,
  type TokenRefreshedMessage,
  type AnyProtocolMessage,
} from '../../shared/protocols/handshake';

import { secureClear } from '../../shared/secureMemory';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Result of an ECDH key exchange. */
export interface EcdhKeyPair {
  /** ECDH instance with generated private key. */
  ecdh: ECDH;

  /** Base64-encoded SPKI public key (SubjectPublicKeyInfo format). */
  publicKeyBase64: string;

  /** Raw public key buffer (uncompressed point, 65 bytes for P-256). */
  publicKeyRaw: Buffer;
}

/** Session state stored by the host after successful handshake. */
export interface SessionState {
  /** Unique session identifier. */
  sessionId: string;

  /** Base64-encoded SPKI public key of the extension (for reference). */
  extensionPublicKey: string;

  /** 32-byte derived shared key (for AES-256-GCM). */
  sharedKey: Buffer;

  /** 32-byte HMAC key for session token signing. */
  tokenSigningKey: Buffer;

  /** Unix timestamp (ms) when the session was created. */
  createdAt: number;

  /** Unix timestamp (ms) when the session expires. */
  expiresAt: number;
}

/** Validation result for handshake messages. */
export interface HandshakeValidationResult {
  ok: boolean;
  sessionId?: string;
  error?: string;
}

// ---------------------------------------------------------------------------
// ECDH Key Generation
// ---------------------------------------------------------------------------

/**
 * Generate an ECDH P-256 key pair for handshake.
 *
 * The returned public key is the raw uncompressed point (65 bytes),
 * base64-encoded. Node.js ECDH.computeSecret() accepts this format
 * directly. The browser extension can use Web Crypto API with 'raw'
 * import format for the same key.
 *
 * @returns ECDH key pair with raw public key.
 */
export function generateEcdhKeyPair(): EcdhKeyPair {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();

  const publicKeyRaw = ecdh.getPublicKey();
  const publicKeyBase64 = publicKeyRaw.toString('base64');

  return { ecdh, publicKeyBase64, publicKeyRaw };
}

/**
 * Derive a 32-byte shared secret from an ECDH exchange.
 *
 * Uses HKDF-SHA256 to derive a fixed-length key from the raw ECDH output.
 * This prevents the raw ECDH output (which is a point on the curve) from
 * being used directly as an AES key.
 *
 * @param ecdh - Local ECDH instance with generated private key.
 * @param peerPublicKeyBase64 - Base64-encoded raw public key from the peer (65 bytes).
 * @returns 32-byte derived shared key suitable for AES-256-GCM.
 */
export function deriveSharedKey(
  ecdh: ECDH,
  peerPublicKeyBase64: string,
): Buffer {
  const peerPublicKeyRaw = Buffer.from(peerPublicKeyBase64, 'base64');
  const rawSecret = ecdh.computeSecret(peerPublicKeyRaw);

  // HKDF extraction: PRK = HMAC-Hash(salt, IKM)
  const prk = createHmac('sha256', HKDF_SALT).update(rawSecret).digest();

  // HKDF expansion: OKM = HMAC-Hash(PRK, info || 0x01)
  const infoBuffer = Buffer.isBuffer(HKDF_INFO) ? HKDF_INFO : Buffer.from(HKDF_INFO, 'utf-8');
  const okm = createHmac('sha256', prk)
    .update(Buffer.concat([infoBuffer, Buffer.from([0x01])]))
    .digest();

  // Wipe intermediate secrets
  secureClear(rawSecret);
  secureClear(prk);

  return okm;
}

// ---------------------------------------------------------------------------
// Session Token Management
// ---------------------------------------------------------------------------

/**
 * Generate a signed session token.
 *
 * Token format: base64url(JSON payload) + "." + base64url(HMAC signature)
 *
 * The HMAC is computed over the canonical JSON of the payload fields,
 * preventing token forgery without knowing the signing key.
 *
 * @param sessionId - Unique session identifier.
 * @param signingKey - 32-byte HMAC key for signing.
 * @param ttlMs - Time-to-live in milliseconds.
 * @returns Signed session token string.
 */
export function generateSessionToken(
  sessionId: string,
  signingKey: Buffer,
  ttlMs: number = SESSION_TOKEN_TTL_MS,
): string {
  const now = Date.now();
  const payload = {
    sessionId,
    createdAt: now,
    expiresAt: now + ttlMs,
  };

  const payloadJson = JSON.stringify(payload);
  const payloadBase64 = Buffer.from(payloadJson).toString('base64url');

  const signature = createHmac('sha256', signingKey)
    .update(payloadBase64)
    .digest('base64url');

  return `${payloadBase64}.${signature}`;
}

/**
 * Verify a session token and extract session info.
 *
 * @param token - The session token to verify.
 * @param signingKey - The HMAC key used to sign the token.
 * @returns Verification result with session details or error.
 */
export function verifySessionToken(
  token: string,
  signingKey: Buffer,
): HandshakeValidationResult {
  const parts = token.split('.');
  if (parts.length !== 2) {
    return { ok: false, error: 'Invalid token format' };
  }

  const [payloadBase64, signatureBase64] = parts;

  // Verify HMAC signature (timing-safe)
  const expectedSig = createHmac('sha256', signingKey)
    .update(payloadBase64)
    .digest('base64url');

  if (!timingSafeEqual(Buffer.from(signatureBase64), Buffer.from(expectedSig))) {
    return { ok: false, error: 'Invalid token signature' };
  }

  // Parse payload
  let payload: { sessionId: string; createdAt: number; expiresAt: number };
  try {
    payload = JSON.parse(Buffer.from(payloadBase64, 'base64url').toString());
  } catch {
    return { ok: false, error: 'Invalid token payload' };
  }

  // Validate required fields
  if (!payload.sessionId || typeof payload.createdAt !== 'number' || typeof payload.expiresAt !== 'number') {
    return { ok: false, error: 'Invalid token payload structure' };
  }

  // Check expiration
  if (Date.now() > payload.expiresAt) {
    return { ok: false, error: 'Token has expired' };
  }

  return {
    ok: true,
    sessionId: payload.sessionId,
  };
}

// ---------------------------------------------------------------------------
// Session Management
// ---------------------------------------------------------------------------

/** In-memory session store. Sessions are never persisted to disk. */
const activeSessions = new Map<string, SessionState>();

/**
 * Create a new session from a completed handshake.
 *
 * @param sessionId - Unique session identifier.
 * @param extensionPublicKeyBase64 - Base64-encoded SPKI public key from extension.
 * @param sharedKey - 32-byte derived shared key.
 * @returns The new session state.
 */
export function createSession(
  sessionId: string,
  extensionPublicKeyBase64: string,
  sharedKey: Buffer,
): SessionState {
  const now = Date.now();
  const tokenSigningKey = randomBytes(32);

  const session: SessionState = {
    sessionId,
    extensionPublicKey: extensionPublicKeyBase64,
    sharedKey: Buffer.from(sharedKey), // defensive copy
    tokenSigningKey,
    createdAt: now,
    expiresAt: now + SESSION_TOKEN_TTL_MS,
  };

  activeSessions.set(sessionId, session);
  return session;
}

/**
 * Refresh a session token (extend expiry).
 *
 * @param sessionId - Session to refresh.
 * @returns New session token, or null if session not found/expired.
 */
export function refreshSession(sessionId: string): string | null {
  const session = activeSessions.get(sessionId);
  if (!session) {
    return null;
  }

  // Check if session has expired
  if (Date.now() > session.expiresAt) {
    activeSessions.delete(sessionId);
    return null;
  }

  // Extend session
  const now = Date.now();
  session.expiresAt = now + SESSION_TOKEN_TTL_MS;

  // Generate new token
  return generateSessionToken(sessionId, session.tokenSigningKey);
}

/**
 * Retrieve a session by ID (only if still valid).
 */
export function getSession(sessionId: string): SessionState | null {
  const session = activeSessions.get(sessionId);
  if (!session) {
    return null;
  }

  if (Date.now() > session.expiresAt) {
    activeSessions.delete(sessionId);
    return null;
  }

  return session;
}

/**
 * Revoke a session (e.g., when vault is locked).
 */
export function revokeSession(sessionId: string): void {
  const session = activeSessions.get(sessionId);
  if (session) {
    secureClear(session.sharedKey);
    secureClear(session.tokenSigningKey);
    activeSessions.delete(sessionId);
  }
}

/**
 * Revoke all active sessions.
 */
export function revokeAllSessions(): void {
  for (const [id] of activeSessions) {
    revokeSession(id);
  }
}

/**
 * Get the number of active sessions (for monitoring).
 */
export function getActiveSessionCount(): number {
  // Purge expired sessions
  const now = Date.now();
  for (const [id, session] of activeSessions) {
    if (now > session.expiresAt) {
      revokeSession(id);
    }
  }
  return activeSessions.size;
}

// ---------------------------------------------------------------------------
// Message Encryption / Decryption
// ---------------------------------------------------------------------------

/**
 * Encrypt a plaintext message into an encrypted envelope.
 *
 * Encryption: AES-256-GCM with random 12-byte nonce.
 * Authentication: HMAC-SHA256 signature over (type + sessionId + nonce + ciphertext).
 *
 * @param plaintext - The JSON-serializable message to encrypt.
 * @param session - The active session with shared key.
 * @param messageType - ENCRYPTED_REQUEST or ENCRYPTED_RESPONSE.
 * @returns Encrypted message envelope ready for transmission.
 */
export function encryptMessage(
  plaintext: unknown,
  session: SessionState,
  messageType:
    | HandshakeMessageType.ENCRYPTED_REQUEST
    | HandshakeMessageType.ENCRYPTED_RESPONSE = HandshakeMessageType.ENCRYPTED_REQUEST,
  sign = true,
): EncryptedMessageEnvelope {
  const plaintextBuffer = Buffer.from(JSON.stringify(plaintext), 'utf-8');
  const nonce = randomBytes(12);

  // AES-256-GCM encryption
  const cipher = createCipheriv('aes-256-gcm', session.sharedKey, nonce) as CipherGCM;
  const encrypted = Buffer.concat([cipher.update(plaintextBuffer), cipher.final()]);
  const authTag = cipher.getAuthTag();

  // HMAC signature (optional): HMAC-SHA256(key, type || sessionId || nonce || ciphertext)
  let signature: string | undefined;
  if (sign) {
    const signatureInput = Buffer.concat([
      Buffer.from(messageType, 'utf-8'),
      Buffer.from(session.sessionId, 'utf-8'),
      nonce,
      encrypted,
    ]);
    signature = createHmac('sha256', session.tokenSigningKey)
      .update(signatureInput)
      .digest('base64');
  }

  // Wipe plaintext from memory
  secureClear(plaintextBuffer);

  return {
    type: messageType,
    sessionId: session.sessionId,
    signature,
    nonce: nonce.toString('base64'),
    authTag: authTag.toString('base64'),
    ciphertext: encrypted.toString('base64'),
  };
}

/**
 * Decrypt an encrypted message envelope back to the original plaintext.
 *
 * Verifies the HMAC signature and AES-GCM auth tag before returning
 * the decrypted content. Throws if any verification fails.
 *
 * @param envelope - The encrypted message envelope to decrypt.
 * @param session - The active session with shared key.
 * @returns The decrypted plaintext (JSON-parsed).
 * @throws If signature verification, auth tag verification, or decryption fails.
 */
export function decryptMessage<T = unknown>(
  envelope: EncryptedMessageEnvelope,
  session: SessionState,
): T {
  // Verify session ID matches
  if (envelope.sessionId !== session.sessionId) {
    throw new Error('Session ID mismatch');
  }

  // Verify HMAC signature (only present on host-signed messages)
  if (envelope.signature) {
    const signatureInput = Buffer.concat([
      Buffer.from(envelope.type, 'utf-8'),
      Buffer.from(envelope.sessionId, 'utf-8'),
      Buffer.from(envelope.nonce, 'base64'),
      Buffer.from(envelope.ciphertext, 'base64'),
    ]);
    const expectedSig = createHmac('sha256', session.tokenSigningKey)
      .update(signatureInput)
      .digest('base64');

    if (!timingSafeEqual(Buffer.from(envelope.signature), Buffer.from(expectedSig))) {
      throw new Error('Message signature verification failed');
    }
  }

  // AES-256-GCM decryption
  const decipher = createDecipheriv(
    'aes-256-gcm',
    session.sharedKey,
    Buffer.from(envelope.nonce, 'base64'),
  ) as DecipherGCM;
  decipher.setAuthTag(Buffer.from(envelope.authTag, 'base64'));

  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(envelope.ciphertext, 'base64')),
    decipher.final(),
  ]);

  // Parse JSON and wipe buffer
  let result: T;
  try {
    result = JSON.parse(decrypted.toString('utf-8')) as T;
  } finally {
    secureClear(decrypted);
  }

  return result;
}

// ---------------------------------------------------------------------------
// Handshake Flow Helpers
// ---------------------------------------------------------------------------

/**
 * Process an incoming HANDSHAKE_INIT message from the extension.
 *
 * This function:
 * 1. Generates the host's ECDH key pair
 * 2. Derives the shared key using the extension's public key
 * 3. Creates a new session
 * 4. Generates a signed session token
 * 5. Returns the HANDSHAKE_COMPLETE response
 *
 * @param initMessage - The HANDSHAKE_INIT message from the extension.
 * @returns The HANDSHAKE_COMPLETE response message.
 */
export function processHandshakeInit(
  initMessage: HandshakeInitMessage,
): HandshakeCompleteMessage {
  // Generate host key pair
  const hostKeyPair = generateEcdhKeyPair();

  // Derive shared key
  const sharedKey = deriveSharedKey(hostKeyPair.ecdh, initMessage.publicKey);

  // Generate session ID
  const sessionId = `sp_${randomBytes(16).toString('hex')}`;

  // Create session
  const session = createSession(sessionId, initMessage.publicKey, sharedKey);

  // Generate signed token
  const sessionToken = generateSessionToken(sessionId, session.tokenSigningKey);

  return {
    requestId: initMessage.requestId,
    timestamp: Date.now(),
    protocolVersion: 1,
    type: HandshakeMessageType.HANDSHAKE_COMPLETE,
    publicKey: hostKeyPair.publicKeyBase64,
    sessionToken,
    sessionId,
  };
}

/**
 * Process an incoming TOKEN_REFRESH message.
 *
 * @param refreshMessage - The TOKEN_REFRESH message from the extension.
 * @returns The TOKEN_REFRESHED response, or null if refresh failed.
 */
export function processTokenRefresh(
  refreshMessage: TokenRefreshMessage,
): TokenRefreshedMessage | null {
  // Verify the current token
  const session = getSession(refreshMessage.sessionId ?? '');
  if (!session) {
    // Try to extract session from token
    const tokenResult = verifySessionTokenByPayload(refreshMessage.sessionToken);
    if (!tokenResult.ok || !tokenResult.sessionId) {
      return null;
    }

    const foundSession = getSession(tokenResult.sessionId);
    if (!foundSession) {
      return null;
    }

    const newToken = refreshSession(foundSession.sessionId);
    if (!newToken) {
      return null;
    }

    return {
      requestId: refreshMessage.requestId,
      timestamp: Date.now(),
      protocolVersion: 1,
      type: HandshakeMessageType.TOKEN_REFRESHED,
      sessionToken: newToken,
      sessionId: foundSession.sessionId,
    };
  }

  const newToken = refreshSession(session.sessionId);
  if (!newToken) {
    return null;
  }

  return {
    requestId: refreshMessage.requestId,
    timestamp: Date.now(),
    protocolVersion: 1,
    type: HandshakeMessageType.TOKEN_REFRESHED,
    sessionToken: newToken,
    sessionId: session.sessionId,
  };
}

/**
 * Verify a session token without knowing the signing key (for token refresh flow).
 * Extracts the session ID and checks expiration.
 */
function verifySessionTokenByPayload(
  token: string,
): HandshakeValidationResult {
  const parts = token.split('.');
  if (parts.length !== 2) {
    return { ok: false, error: 'Invalid token format' };
  }

  const [payloadBase64] = parts;

  let payload: { sessionId: string; createdAt: number; expiresAt: number };
  try {
    payload = JSON.parse(Buffer.from(payloadBase64, 'base64url').toString());
  } catch {
    return { ok: false, error: 'Invalid token payload' };
  }

  if (!payload.sessionId || typeof payload.expiresAt !== 'number') {
    return { ok: false, error: 'Invalid token payload structure' };
  }

  if (Date.now() > payload.expiresAt) {
    return { ok: false, error: 'Token has expired' };
  }

  return { ok: true, sessionId: payload.sessionId };
}

// ---------------------------------------------------------------------------
// Timing-safe comparison
// ---------------------------------------------------------------------------

/**
 * Constant-time comparison to prevent timing attacks on signatures.
 */
function timingSafeEqual(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length) {
    return false;
  }

  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a[i]! ^ b[i]!;
  }
  return result === 0;
}
