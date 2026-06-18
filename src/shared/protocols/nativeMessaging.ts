/**
 * Native Messaging Protocol definitions for SecurePass Manager Browser Extension.
 *
 * This protocol governs all communication between the browser extension
 * (Chrome, Firefox, Edge) and the Electron host application via Native Messaging.
 *
 * SECURITY INVARIANTS:
 * - Every message MUST include `requestId` (UUID) for tracing and correlation.
 * - Every message MUST include `timestamp` (Unix ms) to prevent replay attacks.
 * - Messages with timestamps older than PROTOCOL_MAX_AGE_MS are rejected.
 * - Credential data is NEVER sent in plaintext; only encrypted blobs.
 */

// ---------------------------------------------------------------------------
// Protocol constants
// ---------------------------------------------------------------------------

/** Current protocol version. Bump on breaking changes. */
export const PROTOCOL_VERSION = 1;

/** Maximum allowed age of a message in milliseconds (5 minutes). */
export const PROTOCOL_MAX_AGE_MS = 5 * 60 * 1000;

/** Maximum number of items returned in a single GET_MATCHING_ITEMS response. */
export const PROTOCOL_MAX_MATCHING_ITEMS = 50;

// ---------------------------------------------------------------------------
// Message type enums
// ---------------------------------------------------------------------------

/** Messages sent from the browser extension TO the Electron host. */
export enum HostRequestType {
  GET_CREDENTIALS = 'GET_CREDENTIALS',
  GET_MATCHING_ITEMS = 'GET_MATCHING_ITEMS',
  COPY_TO_CLIPBOARD = 'COPY_TO_CLIPBOARD',
  LOCK_VAULT = 'LOCK_VAULT',
}

/** Messages sent from the Electron host TO the browser extension. */
export enum ExtensionResponseType {
  CREDENTIALS_RESPONSE = 'CREDENTIALS_RESPONSE',
  MATCHING_ITEMS_RESPONSE = 'MATCHING_ITEMS_RESPONSE',
  NO_MATCH_FOUND = 'NO_MATCH_FOUND',
  VAULT_LOCKED = 'VAULT_LOCKED',
  CLIPBOARD_CONFIRMATION = 'CLIPBOARD_CONFIRMATION',
  ERROR = 'ERROR',
}

// ---------------------------------------------------------------------------
// Base message interfaces
// ---------------------------------------------------------------------------

/**
 * Base interface for ALL messages in the protocol.
 * Both request and response messages extend this.
 */
export interface ProtocolMessage {
  /** Unique identifier for tracing and request-response correlation. */
  requestId: string;

  /** Unix timestamp in milliseconds when the message was created. */
  timestamp: number;

  /** Protocol version used by the sender. */
  protocolVersion: number;
}

// ---------------------------------------------------------------------------
// Extension → Host request payloads
// ---------------------------------------------------------------------------

/**
 * Request a single credential by its item ID.
 * The host returns the decrypted credential or an error.
 */
export interface GetCredentialsRequest extends ProtocolMessage {
  type: HostRequestType.GET_CREDENTIALS;

  /** The vault item ID to retrieve. */
  itemId: string;

  /**
   * Whether to also return the TOTP code for this item.
   * If true and the item has OTP configured, the response includes `otpCode`.
   */
  includeOtp?: boolean;
}

/**
 * Request matching credentials for a given URL/domain.
 * Used by autofill to find relevant logins for the current page.
 */
export interface GetMatchingItemsRequest extends ProtocolMessage {
  type: HostRequestType.GET_MATCHING_ITEMS;

  /**
   * The full URL of the current page (e.g. "https://github.com/login").
   * The host extracts the domain for matching against stored items.
   */
  url: string;

  /**
   * Optional domain override for cases where the URL parsing is ambiguous
   * (e.g. subdomain routing, single-page apps).
   */
  domain?: string;

  /**
   * Maximum number of items to return. Defaults to PROTOCOL_MAX_MATCHING_ITEMS.
   */
  limit?: number;
}

/**
 * Request to copy a specific field value to the system clipboard.
 * The host performs the copy and confirms success.
 */
export interface CopyToClipboardRequest extends ProtocolMessage {
  type: HostRequestType.COPY_TO_CLIPBOARD;

  /** The vault item ID whose field should be copied. */
  itemId: string;

  /** Which field to copy. */
  field: 'username' | 'password' | 'otp';

  /**
   * Auto-clear timeout in seconds. After this duration the clipboard
   * is wiped. Defaults to 45 seconds.
   */
  clearAfterSeconds?: number;
}

/**
 * Request to lock the vault immediately.
 * Used when the user clicks "Lock" in the extension or when
 * the extension detects suspicious activity.
 */
export interface LockVaultRequest extends ProtocolMessage {
  type: HostRequestType.LOCK_VAULT;
}

// ---------------------------------------------------------------------------
// Host → Extension response payloads
// ---------------------------------------------------------------------------

/**
 * A single credential item returned by the host.
 * All sensitive fields are encrypted; only the extension can decrypt them
 * after a successful handshake (see Sub-Task 1.3).
 */
export interface EncryptedCredentialItem {
  /** Unique vault item ID. */
  id: string;

  /** Display title (e.g. "GitHub"). */
  title: string;

  /** Username or email. */
  username: string;

  /** AES-256-GCM encrypted password, base64-encoded. */
  passwordEncrypted: string;

  /** The URL associated with this credential. */
  url: string;

  /** Whether this item is marked as favorite. */
  isFavorite: boolean;

  /** Optional emoji icon. */
  emoji: string | null;

  /** OTP code if requested and available. Null otherwise. */
  otpCode: string | null;

  /** Seconds remaining until the current OTP code expires. Null if no OTP. */
  otpRemainingSeconds: number | null;
}

/**
 * Response to GET_CREDENTIALS containing a single decrypted credential.
 */
export interface CredentialsResponse extends ProtocolMessage {
  type: ExtensionResponseType.CREDENTIALS_RESPONSE;

  /** The requested credential item. */
  item: EncryptedCredentialItem;
}

/**
 * Response to GET_MATCHING_ITEMS containing multiple matching credentials.
 */
export interface MatchingItemsResponse extends ProtocolMessage {
  type: ExtensionResponseType.MATCHING_ITEMS_RESPONSE;

  /** Array of matching credential items, sorted by relevance. */
  items: EncryptedCredentialItem[];

  /** The domain that was matched against. */
  matchedDomain: string;

  /** Total number of matching items (may exceed returned count if truncated). */
  totalCount: number;
}

/**
 * Response when no credentials match the requested URL/domain.
 */
export interface NoMatchFoundResponse extends ProtocolMessage {
  type: ExtensionResponseType.NO_MATCH_FOUND;

  /** The domain that was searched. */
  searchedDomain: string;

  /** The original URL that was searched. */
  searchedUrl: string;
}

/**
 * Response when the vault is locked and cannot serve credentials.
 */
export interface VaultLockedResponse extends ProtocolMessage {
  type: ExtensionResponseType.VAULT_LOCKED;

  /** Human-readable message for display in the extension UI. */
  message: string;
}

/**
 * Response confirming that clipboard copy was successful.
 */
export interface ClipboardConfirmationResponse extends ProtocolMessage {
  type: ExtensionResponseType.CLIPBOARD_CONFIRMATION;

  /** Which field was copied. */
  field: 'username' | 'password' | 'otp';

  /** The auto-clear timeout applied (in seconds). */
  clearAfterSeconds: number;
}

/**
 * Generic error response from the host.
 */
export interface ErrorResponse extends ProtocolMessage {
  type: ExtensionResponseType.ERROR;

  /** Machine-readable error code. */
  code: ErrorCode;

  /** Human-readable error message. */
  message: string;

  /** Optional additional context for debugging. */
  details?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Error codes
// ---------------------------------------------------------------------------

/** Standardized error codes for protocol-level errors. */
export enum ErrorCode {
  /** The request could not be parsed (malformed JSON, missing fields). */
  INVALID_MESSAGE = 'INVALID_MESSAGE',

  /** The message type is not recognized. */
  UNKNOWN_MESSAGE_TYPE = 'UNKNOWN_MESSAGE_TYPE',

  /** The protocol version is not supported by the host. */
  UNSUPPORTED_PROTOCOL_VERSION = 'UNSUPPORTED_PROTOCOL_VERSION',

  /** The message timestamp is too old (> PROTOCOL_MAX_AGE_MS). */
  TIMESTAMP_EXPIRED = 'TIMESTAMP_EXPIRED',

  /** The request ID has already been used (replay attack detected). */
  DUPLICATE_REQUEST_ID = 'DUPLICATE_REQUEST_ID',

  /** The vault is locked. User must unlock before requesting credentials. */
  VAULT_LOCKED = 'VAULT_LOCKED',

  /** The requested item does not exist in the vault. */
  ITEM_NOT_FOUND = 'ITEM_NOT_FOUND',

  /** The requested item has no password field. */
  NO_PASSWORD = 'NO_PASSWORD',

  /** The requested item has no OTP configured. */
  NO_OTP_CONFIGURED = 'NO_OTP_CONFIGURED',

  /** The URL/domain is invalid or could not be parsed. */
  INVALID_URL = 'INVALID_URL',

  /** The clipboard operation failed. */
  CLIPBOARD_FAILED = 'CLIPBOARD_FAILED',

  /** The host encountered an internal error. */
  INTERNAL_ERROR = 'INTERNAL_ERROR',

  /** Rate limit exceeded; too many requests in a short time window. */
  RATE_LIMITED = 'RATE_LIMITED',

  /** The extension is not authorized to access this host. */
  UNAUTHORIZED = 'UNAUTHORIZED',

  /** The handshake has not been completed. */
  HANDSHAKE_REQUIRED = 'HANDSHAKE_REQUIRED',

  /** The handshake message is invalid (bad public key, etc.). */
  INVALID_HANDSHAKE = 'INVALID_HANDSHAKE',

  /** The session token is invalid or expired. */
  INVALID_SESSION = 'INVALID_SESSION',

  /** The encrypted message could not be decrypted or verified. */
  DECRYPTION_FAILED = 'DECRYPTION_FAILED',
}

// ---------------------------------------------------------------------------
// Union types for type-safe message handling
// ---------------------------------------------------------------------------

/** All request message types that can be sent from the extension to the host. */
export type HostRequest =
  | GetCredentialsRequest
  | GetMatchingItemsRequest
  | CopyToClipboardRequest
  | LockVaultRequest;

/** All response message types that can be sent from the host to the extension. */
export type ExtensionResponse =
  | CredentialsResponse
  | MatchingItemsResponse
  | NoMatchFoundResponse
  | VaultLockedResponse
  | ClipboardConfirmationResponse
  | ErrorResponse;

/** Any message in the protocol (request or response). */
export type ProtocolAnyMessage = HostRequest | ExtensionResponse;

// ---------------------------------------------------------------------------
// Helper type guards
// ---------------------------------------------------------------------------

export function isHostRequest(msg: ProtocolAnyMessage): msg is HostRequest {
  return Object.values(HostRequestType).includes(
    (msg as HostRequest).type as HostRequestType,
  );
}

export function isGetCredentialsRequest(
  msg: HostRequest,
): msg is GetCredentialsRequest {
  return msg.type === HostRequestType.GET_CREDENTIALS;
}

export function isGetMatchingItemsRequest(
  msg: HostRequest,
): msg is GetMatchingItemsRequest {
  return msg.type === HostRequestType.GET_MATCHING_ITEMS;
}

export function isCopyToClipboardRequest(
  msg: HostRequest,
): msg is CopyToClipboardRequest {
  return msg.type === HostRequestType.COPY_TO_CLIPBOARD;
}

export function isLockVaultRequest(msg: HostRequest): msg is LockVaultRequest {
  return msg.type === HostRequestType.LOCK_VAULT;
}

export function isExtensionResponse(
  msg: ProtocolAnyMessage,
): msg is ExtensionResponse {
  return Object.values(ExtensionResponseType).includes(
    (msg as ExtensionResponse).type as ExtensionResponseType,
  );
}

export function isCredentialsResponse(
  msg: ExtensionResponse,
): msg is CredentialsResponse {
  return msg.type === ExtensionResponseType.CREDENTIALS_RESPONSE;
}

export function isMatchingItemsResponse(
  msg: ExtensionResponse,
): msg is MatchingItemsResponse {
  return msg.type === ExtensionResponseType.MATCHING_ITEMS_RESPONSE;
}

export function isNoMatchFoundResponse(
  msg: ExtensionResponse,
): msg is NoMatchFoundResponse {
  return msg.type === ExtensionResponseType.NO_MATCH_FOUND;
}

export function isVaultLockedResponse(
  msg: ExtensionResponse,
): msg is VaultLockedResponse {
  return msg.type === ExtensionResponseType.VAULT_LOCKED;
}

export function isClipboardConfirmationResponse(
  msg: ExtensionResponse,
): msg is ClipboardConfirmationResponse {
  return msg.type === ExtensionResponseType.CLIPBOARD_CONFIRMATION;
}

export function isErrorResponse(
  msg: ExtensionResponse,
): msg is ErrorResponse {
  return msg.type === ExtensionResponseType.ERROR;
}
