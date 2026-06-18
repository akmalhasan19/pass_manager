/**
 * Cryptographic operations for the browser extension.
 *
 * Uses the Web Crypto API (available in service workers and content scripts)
 * to implement ECDH P-256 key exchange, HKDF-SHA256 key derivation, and
 * AES-256-GCM authenticated encryption.
 *
 * This mirrors the main app's handshake crypto but runs entirely in the
 * browser environment.
 *
 * @module shared/crypto
 */

import {
  HandshakeMessageType,
  type HandshakeInitMessage,
  type HandshakeCompleteMessage,
  type EncryptedMessageEnvelope,
  type AnyProtocolMessage,
  PROTOCOL_VERSION,
} from './protocol';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** HKDF info string for shared secret derivation (must match main app). */
const HKDF_INFO = 'SecurePass Manager v1 Shared Key';

/** HKDF salt (empty padding, must match main app). */
const HKDF_SALT = new Uint8Array(32).fill(0x43); // 'C'

/** AES-GCM nonce length in bytes. */
const NONCE_LENGTH = 12;

/** AES-GCM auth tag length in bits. */
const AUTH_TAG_LENGTH = 128;

/** AES key length in bits. */
const AES_KEY_LENGTH = 256;

// ---------------------------------------------------------------------------
// Utility: base64 ↔ ArrayBuffer
// ---------------------------------------------------------------------------

/** Encode an ArrayBuffer to a base64 string. */
export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/** Decode a base64 string to an ArrayBuffer. */
export function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

/** Generate a random UUID v4. */
export function generateRequestId(): string {
  return crypto.randomUUID();
}

/** Get current Unix timestamp in milliseconds. */
export function currentTimestamp(): number {
  return Date.now();
}

// ---------------------------------------------------------------------------
// ECDH P-256 Key Generation & Shared Secret
// ---------------------------------------------------------------------------

/** An ephemeral ECDH key pair for one handshake. */
export interface ECDHKeyPair {
  /** The raw 65-byte uncompressed public key (base64-encoded). */
  publicKeyBase64: string;
  /** The Web Crypto CryptoKey object (private, non-exportable). */
  privateKey: CryptoKey;
}

/**
 * Generate an ephemeral ECDH P-256 key pair.
 *
 * @returns Key pair with base64-encoded public key and private CryptoKey.
 */
export async function generateECDHKeyPair(): Promise<ECDHKeyPair> {
  const keyPair = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    false, // not extractable
    ['deriveKey', 'deriveBits'],
  );

  // Export the raw uncompressed public key (65 bytes)
  const rawPublicKey = await crypto.subtle.exportKey(
    'raw',
    keyPair.publicKey,
  );

  return {
    publicKeyBase64: arrayBufferToBase64(rawPublicKey),
    privateKey: keyPair.privateKey,
  };
}

/**
 * Derive a shared AES-256 key from our private key and the peer's public key.
 *
 * The raw ECDH shared secret is fed through HKDF-SHA256 to produce
 * a fixed-length 32-byte AES key.
 *
 * @param privateKey - Our ECDH private key.
 * @param peerPublicKeyBase64 - Peer's raw 65-byte uncompressed public key (base64).
 * @returns The derived AES-256 CryptoKey.
 */
export async function deriveSharedKey(
  privateKey: CryptoKey,
  peerPublicKeyBase64: string,
): Promise<CryptoKey> {
  // Import peer's raw public key
  const peerPublicKeyBytes = base64ToArrayBuffer(peerPublicKeyBase64);
  const peerPublicKey = await crypto.subtle.importKey(
    'raw',
    peerPublicKeyBytes,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    [],
  );

  // Derive raw ECDH bits (32 bytes for P-256)
  const sharedSecretBits = await crypto.subtle.deriveBits(
    { name: 'ECDH', public: peerPublicKey },
    privateKey,
    256,
  );

  // Import HKDF key for derivation
  const hkdfKey = await crypto.subtle.importKey(
    'raw',
    sharedSecretBits,
    { name: 'HKDF' },
    false,
    ['deriveKey'],
  );

  // Derive AES-256-GCM key using HKDF-SHA256
  const aesKey = await crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: HKDF_SALT,
      info: new TextEncoder().encode(HKDF_INFO),
    },
    hkdfKey,
    { name: 'AES-GCM', length: AES_KEY_LENGTH },
    false,
    ['encrypt', 'decrypt'],
  );

  return aesKey;
}

// ---------------------------------------------------------------------------
// AES-256-GCM Encryption / Decryption
// ---------------------------------------------------------------------------

/**
 * Encrypt plaintext with AES-256-GCM.
 *
 * @param key - AES-GCM key.
 * @param plaintext - Data to encrypt.
 * @returns Object with base64-encoded ciphertext, nonce, and auth tag.
 */
export async function encryptAESGCM(
  key: CryptoKey,
  plaintext: ArrayBuffer,
): Promise<{ ciphertext: string; nonce: string; authTag: string }> {
  const nonce = crypto.getRandomValues(new Uint8Array(NONCE_LENGTH));

  const { ciphertext, authTag: tag } = await (async () => {
    // Web Crypto AES-GCM returns ciphertext || authTag concatenated
    const encrypted = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: nonce, tagLength: AUTH_TAG_LENGTH },
      key,
      plaintext,
    );

    const encryptedBytes = new Uint8Array(encrypted);
    const authTagStart = encryptedBytes.length - AUTH_TAG_LENGTH / 8;
    const ciphertextBytes = encryptedBytes.slice(0, authTagStart);
    const authTagBytes = encryptedBytes.slice(authTagStart);

    return {
      ciphertext: arrayBufferToBase64(ciphertextBytes.buffer),
      authTag: arrayBufferToBase64(authTagBytes.buffer),
    };
  })();

  return {
    ciphertext,
    nonce: arrayBufferToBase64(nonce.buffer),
    authTag: tag,
  };
}

/**
 * Decrypt ciphertext with AES-256-GCM.
 *
 * @param key - AES-GCM key.
 * @param ciphertextBase64 - Base64-encoded ciphertext.
 * @param nonceBase64 - Base64-encoded nonce.
 * @param authTagBase64 - Base64-encoded auth tag.
 * @returns Decrypted plaintext as ArrayBuffer.
 * @throws Error if decryption fails (wrong key, tampered data).
 */
export async function decryptAESGCM(
  key: CryptoKey,
  ciphertextBase64: string,
  nonceBase64: string,
  authTagBase64: string,
): Promise<ArrayBuffer> {
  const ciphertext = base64ToArrayBuffer(ciphertextBase64);
  const nonce = new Uint8Array(base64ToArrayBuffer(nonceBase64));
  const authTag = new Uint8Array(base64ToArrayBuffer(authTagBase64));

  // Web Crypto expects ciphertext || authTag concatenated
  const combined = new Uint8Array(ciphertext.byteLength + authTag.byteLength);
  combined.set(new Uint8Array(ciphertext), 0);
  combined.set(authTag, ciphertext.byteLength);

  return crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: nonce, tagLength: AUTH_TAG_LENGTH },
    key,
    combined,
  );
}

// ---------------------------------------------------------------------------
// HMAC-SHA256 Signing / Verification
// ---------------------------------------------------------------------------

/**
 * Import a raw key for HMAC-SHA256 signing.
 *
 * @param keyBase64 - Base64-encoded HMAC key.
 * @returns CryptoKey for HMAC operations.
 */
export async function importHMACKey(keyBase64: string): Promise<CryptoKey> {
  const keyBytes = base64ToArrayBuffer(keyBase64);
  return crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

/**
 * Sign data with HMAC-SHA256.
 *
 * @param key - HMAC CryptoKey.
 * @param data - Data to sign (string or ArrayBuffer).
 * @returns Base64-encoded signature.
 */
export async function signHMAC(
  key: CryptoKey,
  data: string | ArrayBuffer,
): Promise<string> {
  const dataBuffer =
    typeof data === 'string' ? new TextEncoder().encode(data) : data;
  const signature = await crypto.subtle.sign('HMAC', key, dataBuffer);
  return arrayBufferToBase64(signature);
}

/**
 * Verify an HMAC-SHA256 signature.
 *
 * @param key - HMAC CryptoKey.
 * @param signatureBase64 - Base64-encoded signature to verify.
 * @param data - Original data that was signed.
 * @returns true if signature is valid.
 */
export async function verifyHMAC(
  key: CryptoKey,
  signatureBase64: string,
  data: string | ArrayBuffer,
): Promise<boolean> {
  const dataBuffer =
    typeof data === 'string' ? new TextEncoder().encode(data) : data;
  const signature = base64ToArrayBuffer(signatureBase64);
  return crypto.subtle.verify('HMAC', key, signature, dataBuffer);
}

// ---------------------------------------------------------------------------
// Handshake: create and parse messages
// ---------------------------------------------------------------------------

/**
 * Create a HANDSHAKE_INIT message.
 *
 * @param publicKeyBase64 - Our ECDH public key (base64).
 * @returns A complete HandshakeInitMessage.
 */
export function createHandshakeInit(
  publicKeyBase64: string,
): HandshakeInitMessage {
  return {
    type: HandshakeMessageType.HANDSHAKE_INIT,
    requestId: generateRequestId(),
    timestamp: currentTimestamp(),
    protocolVersion: PROTOCOL_VERSION,
    publicKey: publicKeyBase64,
  };
}

/**
 * Parse and validate a HANDSHAKE_COMPLETE message from the host.
 *
 * @param data - Raw message data (parsed JSON).
 * @returns The validated HandshakeCompleteMessage.
 * @throws Error if the message is invalid.
 */
export function parseHandshakeComplete(
  data: unknown,
): HandshakeCompleteMessage {
  if (typeof data !== 'object' || data === null) {
    throw new Error('Handshake response must be an object');
  }

  const msg = data as Record<string, unknown>;

  if (msg.type !== HandshakeMessageType.HANDSHAKE_COMPLETE) {
    throw new Error(
      `Expected HANDSHAKE_COMPLETE, got ${String(msg.type)}`,
    );
  }

  if (typeof msg.publicKey !== 'string' || msg.publicKey.length === 0) {
    throw new Error('Handshake response missing valid publicKey');
  }

  if (typeof msg.sessionToken !== 'string' || msg.sessionToken.length === 0) {
    throw new Error('Handshake response missing valid sessionToken');
  }

  if (typeof msg.sessionId !== 'string' || msg.sessionId.length === 0) {
    throw new Error('Handshake response missing valid sessionId');
  }

  return {
    type: HandshakeMessageType.HANDSHAKE_COMPLETE,
    requestId: msg.requestId as string,
    timestamp: msg.timestamp as number,
    protocolVersion: msg.protocolVersion as number,
    publicKey: msg.publicKey,
    sessionToken: msg.sessionToken,
    sessionId: msg.sessionId,
  };
}

// ---------------------------------------------------------------------------
// Encrypted message envelope creation and decryption
// ---------------------------------------------------------------------------

/**
 * Encrypt a protocol message into an EncryptedMessageEnvelope.
 *
 * @param aesKey - The derived AES-256-GCM shared key.
 * @param hmacKey - The HMAC key for signing (base64).
 * @param sessionId - The active session ID.
 * @param plaintextMessage - The message to encrypt.
 * @returns A complete EncryptedMessageEnvelope.
 */
export async function createEncryptedEnvelope(
  aesKey: CryptoKey,
  hmacKey: CryptoKey,
  sessionId: string,
  plaintextMessage: object,
): Promise<EncryptedMessageEnvelope> {
  const plaintext = new TextEncoder().encode(
    JSON.stringify(plaintextMessage),
  );

  const { ciphertext, nonce, authTag } = await encryptAESGCM(
    aesKey,
    plaintext.buffer as ArrayBuffer,
  );

  // Sign: HMAC-SHA256("ENCRYPTED_REQUEST" + sessionId + nonce + ciphertext)
  const signInput = `ENCRYPTED_REQUEST${sessionId}${nonce}${ciphertext}`;
  const signature = await signHMAC(hmacKey, signInput);

  return {
    type: HandshakeMessageType.ENCRYPTED_REQUEST,
    sessionId,
    signature,
    nonce,
    authTag,
    ciphertext,
  };
}

/**
 * Decrypt an EncryptedMessageEnvelope into its plaintext object.
 *
 * @param aesKey - The derived AES-256-GCM shared key.
 * @param hmacKey - The HMAC key for verification (base64).
 * @param envelope - The encrypted message envelope.
 * @returns The decrypted plaintext object.
 * @throws Error if decryption or signature verification fails.
 */
export async function decryptEnvelope(
  aesKey: CryptoKey,
  hmacKey: CryptoKey,
  envelope: EncryptedMessageEnvelope,
): Promise<unknown> {
  // Verify HMAC signature
  const signInput = `${envelope.type}${envelope.sessionId}${envelope.nonce}${envelope.ciphertext}`;
  const valid = await verifyHMAC(hmacKey, envelope.signature, signInput);

  if (!valid) {
    throw new Error('HMAC signature verification failed');
  }

  // Decrypt
  const plaintextBuffer = await decryptAESGCM(
    aesKey,
    envelope.ciphertext,
    envelope.nonce,
    envelope.authTag,
  );

  const plaintext = new TextDecoder().decode(plaintextBuffer);
  return JSON.parse(plaintext);
}
