/**
 * Protocol type definitions for the browser extension.
 *
 * These types mirror the main app's protocol types so the extension can
 * send/receive messages over native messaging. They are intentionally
 * kept as plain TypeScript interfaces (no imports from the main app)
 * so the extension can be built independently.
 */

// ---------------------------------------------------------------------------
// Protocol constants
// ---------------------------------------------------------------------------

export const PROTOCOL_VERSION = 1;
export const PROTOCOL_MAX_AGE_MS = 5 * 60 * 1000;
export const PROTOCOL_MAX_MATCHING_ITEMS = 50;

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export enum HostRequestType {
  GET_CREDENTIALS = 'GET_CREDENTIALS',
  GET_MATCHING_ITEMS = 'GET_MATCHING_ITEMS',
  COPY_TO_CLIPBOARD = 'COPY_TO_CLIPBOARD',
  LOCK_VAULT = 'LOCK_VAULT',
  CREATE_ITEM = 'CREATE_ITEM',
}

export enum ExtensionResponseType {
  CREDENTIALS_RESPONSE = 'CREDENTIALS_RESPONSE',
  MATCHING_ITEMS_RESPONSE = 'MATCHING_ITEMS_RESPONSE',
  NO_MATCH_FOUND = 'NO_MATCH_FOUND',
  VAULT_LOCKED = 'VAULT_LOCKED',
  CLIPBOARD_CONFIRMATION = 'CLIPBOARD_CONFIRMATION',
  CREATE_ITEM_RESPONSE = 'CREATE_ITEM_RESPONSE',
  ERROR = 'ERROR',
}

export enum ErrorCode {
  INVALID_MESSAGE = 'INVALID_MESSAGE',
  UNKNOWN_MESSAGE_TYPE = 'UNKNOWN_MESSAGE_TYPE',
  UNSUPPORTED_PROTOCOL_VERSION = 'UNSUPPORTED_PROTOCOL_VERSION',
  TIMESTAMP_EXPIRED = 'TIMESTAMP_EXPIRED',
  DUPLICATE_REQUEST_ID = 'DUPLICATE_REQUEST_ID',
  VAULT_LOCKED = 'VAULT_LOCKED',
  ITEM_NOT_FOUND = 'ITEM_NOT_FOUND',
  NO_PASSWORD = 'NO_PASSWORD',
  NO_OTP_CONFIGURED = 'NO_OTP_CONFIGURED',
  INVALID_URL = 'INVALID_URL',
  CLIPBOARD_FAILED = 'CLIPBOARD_FAILED',
  INTERNAL_ERROR = 'INTERNAL_ERROR',
  RATE_LIMITED = 'RATE_LIMITED',
  UNAUTHORIZED = 'UNAUTHORIZED',
  HANDSHAKE_REQUIRED = 'HANDSHAKE_REQUIRED',
  INVALID_HANDSHAKE = 'INVALID_HANDSHAKE',
  INVALID_SESSION = 'INVALID_SESSION',
  DECRYPTION_FAILED = 'DECRYPTION_FAILED',
}

// ---------------------------------------------------------------------------
// Base message
// ---------------------------------------------------------------------------

export interface ProtocolMessage {
  requestId: string;
  timestamp: number;
  protocolVersion: number;
}

// ---------------------------------------------------------------------------
// Request payloads (extension → host)
// ---------------------------------------------------------------------------

export interface GetCredentialsRequest extends ProtocolMessage {
  type: HostRequestType.GET_CREDENTIALS;
  itemId: string;
  includeOtp?: boolean;
}

export interface GetMatchingItemsRequest extends ProtocolMessage {
  type: HostRequestType.GET_MATCHING_ITEMS;
  url: string;
  domain?: string;
  limit?: number;
}

export interface CopyToClipboardRequest extends ProtocolMessage {
  type: HostRequestType.COPY_TO_CLIPBOARD;
  itemId: string;
  field: 'username' | 'password' | 'otp';
  clearAfterSeconds?: number;
}

export interface LockVaultRequest extends ProtocolMessage {
  type: HostRequestType.LOCK_VAULT;
}

export interface CreateItemRequest extends ProtocolMessage {
  type: HostRequestType.CREATE_ITEM;
  title: string;
  username: string;
  password: string;
  url: string;
  notes?: string;
}

export type HostRequest =
  | GetCredentialsRequest
  | GetMatchingItemsRequest
  | CopyToClipboardRequest
  | LockVaultRequest
  | CreateItemRequest;

// ---------------------------------------------------------------------------
// Response payloads (host → extension)
// ---------------------------------------------------------------------------

export interface EncryptedCredentialItem {
  id: string;
  title: string;
  username: string;
  passwordEncrypted: string;
  url: string;
  isFavorite: boolean;
  emoji: string | null;
  otpCode: string | null;
  otpRemainingSeconds: number | null;
}

export interface CredentialsResponse extends ProtocolMessage {
  type: ExtensionResponseType.CREDENTIALS_RESPONSE;
  item: EncryptedCredentialItem;
}

export interface DecryptedCredentialsResponse extends ProtocolMessage {
  type: ExtensionResponseType.CREDENTIALS_RESPONSE;
  item: EncryptedCredentialItem & {
    /** Decrypted plaintext password (only present when host decrypts). */
    password?: string;
    /** Current TOTP code if OTP is configured and includeOtp was true. */
    otpCode?: string;
    /** Seconds until the current OTP code rotates. */
    otpRemainingSeconds?: number;
  };
}

export interface MatchingItemsResponse extends ProtocolMessage {
  type: ExtensionResponseType.MATCHING_ITEMS_RESPONSE;
  items: EncryptedCredentialItem[];
  matchedDomain: string;
  totalCount: number;
}

export interface NoMatchFoundResponse extends ProtocolMessage {
  type: ExtensionResponseType.NO_MATCH_FOUND;
  searchedDomain: string;
  searchedUrl: string;
}

export interface VaultLockedResponse extends ProtocolMessage {
  type: ExtensionResponseType.VAULT_LOCKED;
  message: string;
}

export interface ClipboardConfirmationResponse extends ProtocolMessage {
  type: ExtensionResponseType.CLIPBOARD_CONFIRMATION;
  field: 'username' | 'password' | 'otp';
  clearAfterSeconds: number;
}

export interface ErrorResponse extends ProtocolMessage {
  type: ExtensionResponseType.ERROR;
  code: ErrorCode;
  message: string;
  details?: Record<string, unknown>;
}

export interface CreateItemResponse extends ProtocolMessage {
  type: ExtensionResponseType.CREATE_ITEM_RESPONSE;
  success: boolean;
  itemId?: string;
  message: string;
}

export type ExtensionResponse =
  | CredentialsResponse
  | DecryptedCredentialsResponse
  | MatchingItemsResponse
  | NoMatchFoundResponse
  | VaultLockedResponse
  | ClipboardConfirmationResponse
  | CreateItemResponse
  | ErrorResponse;

// ---------------------------------------------------------------------------
// Handshake types
// ---------------------------------------------------------------------------

export enum HandshakeMessageType {
  HANDSHAKE_INIT = 'HANDSHAKE_INIT',
  HANDSHAKE_COMPLETE = 'HANDSHAKE_COMPLETE',
  ENCRYPTED_REQUEST = 'ENCRYPTED_REQUEST',
  ENCRYPTED_RESPONSE = 'ENCRYPTED_RESPONSE',
  TOKEN_REFRESH = 'TOKEN_REFRESH',
  TOKEN_REFRESHED = 'TOKEN_REFRESHED',
}

export interface HandshakeMessage {
  requestId: string;
  timestamp: number;
  protocolVersion: number;
  type: HandshakeMessageType;
}

export interface HandshakeInitMessage extends HandshakeMessage {
  type: HandshakeMessageType.HANDSHAKE_INIT;
  publicKey: string;
}

export interface HandshakeCompleteMessage extends HandshakeMessage {
  type: HandshakeMessageType.HANDSHAKE_COMPLETE;
  publicKey: string;
  sessionToken: string;
  sessionId: string;
}

export interface EncryptedMessageEnvelope {
  type:
    | HandshakeMessageType.ENCRYPTED_REQUEST
    | HandshakeMessageType.ENCRYPTED_RESPONSE;
  sessionId: string;
  signature: string;
  nonce: string;
  authTag: string;
  ciphertext: string;
}

export interface TokenRefreshMessage extends HandshakeMessage {
  type: HandshakeMessageType.TOKEN_REFRESH;
  sessionToken: string;
}

export interface TokenRefreshedMessage extends HandshakeMessage {
  type: HandshakeMessageType.TOKEN_REFRESHED;
  sessionToken: string;
  sessionId: string;
}

export type AnyHandshakeMessage =
  | HandshakeInitMessage
  | HandshakeCompleteMessage
  | TokenRefreshMessage
  | TokenRefreshedMessage;

export type AnyProtocolMessage = AnyHandshakeMessage | EncryptedMessageEnvelope;
