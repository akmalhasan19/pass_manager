/**
 * Handshake & Encrypted Messaging Protocol for SecurePass Manager Browser Extension.
 *
 * This module defines the cryptographic handshake protocol between the browser
 * extension and the Electron host application. All subsequent communication
 * after a successful handshake is encrypted using AES-256-GCM with a key
 * derived from an ECDH key exchange.
 *
 * PROTOCOL FLOW:
 *
 *   Extension                              Host
 *      │                                     │
 *      │──── HANDSHAKE_INIT ────────────────►│  (extension sends public key)
 *      │                                     │
 *      │◄── HANDSHAKE_COMPLETE ─────────────│  (host sends public key + token)
 *      │                                     │
 *      │──── ENCRYPTED_REQUEST ─────────────►│  (encrypted with shared key)
 *      │                                     │
 *      │◄── ENCRYPTED_RESPONSE ─────────────│  (encrypted with shared key)
 *      │                                     │
 *
 * CRYPTOGRAPHIC PRIMITIVES:
 * - ECDH P-256 for key exchange
 * - HKDF-SHA256 for shared secret derivation
 * - AES-256-GCM for message encryption
 * - HMAC-SHA256 for session token signing
 *
 * SECURITY PROPERTIES:
 * - Forward secrecy: each handshake generates new ephemeral key pairs
 * - Replay protection: request ID deduplication + timestamp freshness
 * - Token binding: session tokens are HMAC-signed with session-specific secret
 * - Auth tag verification: AES-GCM detects any tampering with ciphertext
 *
 * @module protocols/handshake
 */

// ---------------------------------------------------------------------------
// Handshake message types
// ---------------------------------------------------------------------------

/** Messages exchanged during the initial handshake phase (unencrypted). */
export enum HandshakeMessageType {
  /** Extension initiates handshake with its ECDH public key. */
  HANDSHAKE_INIT = 'HANDSHAKE_INIT',

  /** Host responds with its ECDH public key and session token. */
  HANDSHAKE_COMPLETE = 'HANDSHAKE_COMPLETE',

  /** Any message after handshake, encrypted with the derived shared key. */
  ENCRYPTED_REQUEST = 'ENCRYPTED_REQUEST',

  /** Host response to an encrypted request. */
  ENCRYPTED_RESPONSE = 'ENCRYPTED_RESPONSE',

  /** Extension requests a fresh session token (token refresh). */
  TOKEN_REFRESH = 'TOKEN_REFRESH',

  /** Host provides a new session token. */
  TOKEN_REFRESHED = 'TOKEN_REFRESHED',
}

// ---------------------------------------------------------------------------
// Handshake message interfaces
// ---------------------------------------------------------------------------

/**
 * Base interface for all handshake-phase messages.
 * These are NOT encrypted (they establish the encryption).
 */
export interface HandshakeMessage {
  /** Unique message identifier for request-response correlation. */
  requestId: string;

  /** Unix timestamp in milliseconds. */
  timestamp: number;

  /** Protocol version. Currently 1. */
  protocolVersion: number;

  /** Message type discriminator. */
  type: HandshakeMessageType;
}

/**
 * Extension → Host: Initiates the handshake by sending the extension's
 * ECDH P-256 public key in SubjectPublicKeyInfo (SPKI) format, base64-encoded.
 */
export interface HandshakeInitMessage extends HandshakeMessage {
  type: HandshakeMessageType.HANDSHAKE_INIT;

  /**
   * Base64-encoded SPKI public key of the extension.
   * The host uses this to derive the shared secret.
   */
  publicKey: string;
}

/**
 * Host → Extension: Completes the handshake by sending the host's
 * ECDH P-256 public key and a signed session token.
 */
export interface HandshakeCompleteMessage extends HandshakeMessage {
  type: HandshakeMessageType.HANDSHAKE_COMPLETE;

  /**
   * Base64-encoded SPKI public key of the host.
   * The extension uses this to derive the same shared secret.
   */
  publicKey: string;

  /**
   * Signed session token for subsequent requests.
   * Format: base64(JSON({ sessionId, createdAt, expiresAt })) + "." + base64(hmac)
   */
  sessionToken: string;

  /** Unique session identifier. */
  sessionId: string;
}

/**
 * Encrypted message envelope. Wraps any protocol message after handshake.
 * The plaintext is serialized to JSON, encrypted with AES-256-GCM, and
 * transmitted in this envelope format.
 */
export interface EncryptedMessageEnvelope {
  /** Always 'ENCRYPTED_REQUEST' or 'ENCRYPTED_RESPONSE'. */
  type: HandshakeMessageType.ENCRYPTED_REQUEST | HandshakeMessageType.ENCRYPTED_RESPONSE;

  /** Session ID to identify which session key to use. */
  sessionId: string;

  /** Base64-encoded HMAC-SHA256 signature of (type + sessionId + nonce + ciphertext). */
  signature: string;

  /** 12-byte nonce, base64-encoded. Unique per message. */
  nonce: string;

  /** 16-byte AES-GCM auth tag, base64-encoded. */
  authTag: string;

  /** Base64-encoded AES-256-GCM ciphertext. */
  ciphertext: string;
}

/**
 * Extension → Host: Requests a fresh session token (token refresh).
 */
export interface TokenRefreshMessage extends HandshakeMessage {
  type: HandshakeMessageType.TOKEN_REFRESH;

  /** Current session token (must be valid for refresh to succeed). */
  sessionToken: string;
}

/**
 * Host → Extension: Provides a new session token after refresh.
 */
export interface TokenRefreshedMessage extends HandshakeMessage {
  type: HandshakeMessageType.TOKEN_REFRESHED;

  /** New signed session token. */
  sessionToken: string;

  /** Updated session ID (same as before). */
  sessionId: string;
}

// ---------------------------------------------------------------------------
// Union types
// ---------------------------------------------------------------------------

/** All handshake-phase messages (unencrypted). */
export type AnyHandshakeMessage =
  | HandshakeInitMessage
  | HandshakeCompleteMessage
  | TokenRefreshMessage
  | TokenRefreshedMessage;

/** All messages that can be sent during or after handshake. */
export type AnyProtocolMessage = AnyHandshakeMessage | EncryptedMessageEnvelope;

// ---------------------------------------------------------------------------
// Type guards
// ---------------------------------------------------------------------------

export function isHandshakeInit(
  msg: AnyProtocolMessage,
): msg is HandshakeInitMessage {
  return msg.type === HandshakeMessageType.HANDSHAKE_INIT;
}

export function isHandshakeComplete(
  msg: AnyProtocolMessage,
): msg is HandshakeCompleteMessage {
  return msg.type === HandshakeMessageType.HANDSHAKE_COMPLETE;
}

export function isEncryptedMessage(
  msg: AnyProtocolMessage,
): msg is EncryptedMessageEnvelope {
  return (
    msg.type === HandshakeMessageType.ENCRYPTED_REQUEST ||
    msg.type === HandshakeMessageType.ENCRYPTED_RESPONSE
  );
}

export function isTokenRefresh(
  msg: AnyProtocolMessage,
): msg is TokenRefreshMessage {
  return msg.type === HandshakeMessageType.TOKEN_REFRESH;
}

export function isTokenRefreshed(
  msg: AnyProtocolMessage,
): msg is TokenRefreshedMessage {
  return msg.type === HandshakeMessageType.TOKEN_REFRESHED;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Session token TTL in milliseconds (30 minutes). */
export const SESSION_TOKEN_TTL_MS = 30 * 60 * 1000;

/** HKDF info string for shared secret derivation. */
export const HKDF_INFO = 'SecurePass Manager v1 Shared Key';

/** HKDF salt (empty — not needed for ECDH HKDF, but included for domain separation). */
export const HKDF_SALT = Buffer.alloc(32, 0x43); // 'C' padding

/** HMAC key for session token signing (used in production by main process). */
export const TOKEN_SIGNING_KEY = Buffer.alloc(32, 0); // placeholder — replaced at runtime
