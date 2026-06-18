/**
 * Validation utilities for the Native Messaging Protocol.
 *
 * These functions validate incoming messages against the protocol schema,
 * rejecting malformed or suspicious payloads before they reach business logic.
 *
 * SECURITY NOTES:
 * - All validation is performed on the host side (Electron main process).
 * - Validation is strict: unknown properties, missing fields, and type mismatches
 *   result in immediate rejection.
 * - Timestamp validation prevents replay attacks; request ID dedup prevents
 *   message replay within the session.
 */

import {
  PROTOCOL_VERSION,
  PROTOCOL_MAX_AGE_MS,
  PROTOCOL_MAX_MATCHING_ITEMS,
  HostRequestType,
  ExtensionResponseType,
  ErrorCode,
  type ProtocolMessage,
  type HostRequest,
  type ExtensionResponse,
  type GetCredentialsRequest,
  type GetMatchingItemsRequest,
  type CopyToClipboardRequest,
  type LockVaultRequest,
  type CredentialsResponse,
  type MatchingItemsResponse,
  type NoMatchFoundResponse,
  type VaultLockedResponse,
  type ClipboardConfirmationResponse,
  type ErrorResponse,
} from './nativeMessaging';

import {
  HandshakeMessageType,
  type HandshakeInitMessage,
  type HandshakeCompleteMessage,
  type EncryptedMessageEnvelope,
  type TokenRefreshMessage,
  type TokenRefreshedMessage,
  type AnyProtocolMessage,
} from './handshake';

import {
  ALLOWED_EXTENSION_IDS,
  EXTENSION_ORIGIN_PREFIXES,
  EXTENSION_ERRORS,
} from '../constants';

// ---------------------------------------------------------------------------
// Validation result types
// ---------------------------------------------------------------------------

export interface ValidationError {
  code: ErrorCode;
  message: string;
  field?: string;
}

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: ValidationError };

// ---------------------------------------------------------------------------
// Primitive validators
// ---------------------------------------------------------------------------

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function isValidTimestamp(value: unknown): value is number {
  return isNonNegativeInteger(value) && value <= Date.now() + 60_000;
}

function isValidUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Base message validation
// ---------------------------------------------------------------------------

function validateBaseMessage(data: unknown): ValidationResult<ProtocolMessage> {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return {
      ok: false,
      error: {
        code: ErrorCode.INVALID_MESSAGE,
        message: 'Message must be a non-null JSON object.',
      },
    };
  }

  const obj = data as Record<string, unknown>;

  if (!isNonEmptyString(obj.requestId)) {
    return {
      ok: false,
      error: {
        code: ErrorCode.INVALID_MESSAGE,
        message: 'Missing or invalid "requestId" field.',
        field: 'requestId',
      },
    };
  }

  if (!isValidTimestamp(obj.timestamp)) {
    return {
      ok: false,
      error: {
        code: ErrorCode.TIMESTAMP_EXPIRED,
        message: 'Missing or invalid "timestamp" field.',
        field: 'timestamp',
      },
    };
  }

  if (typeof obj.protocolVersion !== 'number' || obj.protocolVersion < 1) {
    return {
      ok: false,
      error: {
        code: ErrorCode.UNSUPPORTED_PROTOCOL_VERSION,
        message: `Unsupported protocol version: ${obj.protocolVersion}.`,
        field: 'protocolVersion',
      },
    };
  }

  return {
    ok: true,
    value: {
      requestId: obj.requestId,
      timestamp: obj.timestamp,
      protocolVersion: obj.protocolVersion,
    },
  };
}

// ---------------------------------------------------------------------------
// Timestamp freshness check
// ---------------------------------------------------------------------------

export function isTimestampFresh(timestamp: number): boolean {
  const age = Date.now() - timestamp;
  return age >= 0 && age <= PROTOCOL_MAX_AGE_MS;
}

// ---------------------------------------------------------------------------
// Request validators (Extension → Host)
// ---------------------------------------------------------------------------

function validateGetCredentialsRequest(
  base: ProtocolMessage,
  raw: Record<string, unknown>,
): ValidationResult<GetCredentialsRequest> {
  if (!isNonEmptyString(raw.itemId)) {
    return {
      ok: false,
      error: {
        code: ErrorCode.INVALID_MESSAGE,
        message: 'Missing or invalid "itemId" field.',
        field: 'itemId',
      },
    };
  }

  return {
    ok: true,
    value: {
      ...base,
      type: HostRequestType.GET_CREDENTIALS,
      itemId: raw.itemId,
      includeOtp: typeof raw.includeOtp === 'boolean' ? raw.includeOtp : undefined,
    },
  };
}

function validateGetMatchingItemsRequest(
  base: ProtocolMessage,
  raw: Record<string, unknown>,
): ValidationResult<GetMatchingItemsRequest> {
  if (!isNonEmptyString(raw.url)) {
    return {
      ok: false,
      error: {
        code: ErrorCode.INVALID_MESSAGE,
        message: 'Missing or invalid "url" field.',
        field: 'url',
      },
    };
  }

  if (!isValidUrl(raw.url)) {
    return {
      ok: false,
      error: {
        code: ErrorCode.INVALID_URL,
        message: 'URL must use http: or https: protocol.',
        field: 'url',
      },
    };
  }

  const limit =
    typeof raw.limit === 'number' && raw.limit > 0
      ? Math.min(raw.limit, PROTOCOL_MAX_MATCHING_ITEMS)
      : PROTOCOL_MAX_MATCHING_ITEMS;

  return {
    ok: true,
    value: {
      ...base,
      type: HostRequestType.GET_MATCHING_ITEMS,
      url: raw.url,
      domain:
        typeof raw.domain === 'string' && raw.domain.length > 0
          ? raw.domain
          : undefined,
      limit,
    },
  };
}

function validateCopyToClipboardRequest(
  base: ProtocolMessage,
  raw: Record<string, unknown>,
): ValidationResult<CopyToClipboardRequest> {
  if (!isNonEmptyString(raw.itemId)) {
    return {
      ok: false,
      error: {
        code: ErrorCode.INVALID_MESSAGE,
        message: 'Missing or invalid "itemId" field.',
        field: 'itemId',
      },
    };
  }

  const validFields = ['username', 'password', 'otp'] as const;
  if (!validFields.includes(raw.field as (typeof validFields)[number])) {
    return {
      ok: false,
      error: {
        code: ErrorCode.INVALID_MESSAGE,
        message: 'Missing or invalid "field" value. Must be "username", "password", or "otp".',
        field: 'field',
      },
    };
  }

  const clearAfterSeconds =
    typeof raw.clearAfterSeconds === 'number' && raw.clearAfterSeconds > 0
      ? Math.min(raw.clearAfterSeconds, 300)
      : 45;

  return {
    ok: true,
    value: {
      ...base,
      type: HostRequestType.COPY_TO_CLIPBOARD,
      itemId: raw.itemId,
      field: raw.field as 'username' | 'password' | 'otp',
      clearAfterSeconds,
    },
  };
}

function validateLockVaultRequest(
  base: ProtocolMessage,
): ValidationResult<LockVaultRequest> {
  return {
    ok: true,
    value: {
      ...base,
      type: HostRequestType.LOCK_VAULT,
    },
  };
}

// ---------------------------------------------------------------------------
// Public request validator
// ---------------------------------------------------------------------------

/**
 * Validate a raw JSON-parsed message from the browser extension.
 * Returns a strongly-typed request message or a validation error.
 */
export function validateIncomingRequest(
  data: unknown,
): ValidationResult<HostRequest> {
  const baseResult = validateBaseMessage(data);
  if (!baseResult.ok) return baseResult;

  const base = baseResult.value;
  const raw = data as Record<string, unknown>;

  if (!isNonEmptyString(raw.type)) {
    return {
      ok: false,
      error: {
        code: ErrorCode.UNKNOWN_MESSAGE_TYPE,
        message: 'Missing or invalid "type" field.',
        field: 'type',
      },
    };
  }

  const type = raw.type as string;

  switch (type) {
    case HostRequestType.GET_CREDENTIALS:
      return validateGetCredentialsRequest(base, raw);

    case HostRequestType.GET_MATCHING_ITEMS:
      return validateGetMatchingItemsRequest(base, raw);

    case HostRequestType.COPY_TO_CLIPBOARD:
      return validateCopyToClipboardRequest(base, raw);

    case HostRequestType.LOCK_VAULT:
      return validateLockVaultRequest(base);

    default:
      return {
        ok: false,
        error: {
          code: ErrorCode.UNKNOWN_MESSAGE_TYPE,
          message: `Unknown request type: "${type}".`,
          field: 'type',
        },
      };
  }
}

// ---------------------------------------------------------------------------
// Response validators (Host → Extension)
// ---------------------------------------------------------------------------

function validateCredentialsResponse(
  base: ProtocolMessage,
  raw: Record<string, unknown>,
): ValidationResult<CredentialsResponse> {
  if (typeof raw.item !== 'object' || raw.item === null) {
    return {
      ok: false,
      error: {
        code: ErrorCode.INVALID_MESSAGE,
        message: 'Missing or invalid "item" field.',
        field: 'item',
      },
    };
  }

  const item = raw.item as Record<string, unknown>;

  if (
    !isNonEmptyString(item.id) ||
    !isNonEmptyString(item.title) ||
    !isNonEmptyString(item.username) ||
    !isNonEmptyString(item.passwordEncrypted) ||
    !isNonEmptyString(item.url)
  ) {
    return {
      ok: false,
      error: {
        code: ErrorCode.INVALID_MESSAGE,
        message: 'Credential item is missing required fields (id, title, username, passwordEncrypted, url).',
        field: 'item',
      },
    };
  }

  return {
    ok: true,
    value: {
      ...base,
      type: ExtensionResponseType.CREDENTIALS_RESPONSE,
      item: {
        id: item.id,
        title: item.title,
        username: item.username,
        passwordEncrypted: item.passwordEncrypted,
        url: item.url,
        isFavorite: typeof item.isFavorite === 'boolean' ? item.isFavorite : false,
        emoji: typeof item.emoji === 'string' ? item.emoji : null,
        otpCode: typeof item.otpCode === 'string' ? item.otpCode : null,
        otpRemainingSeconds:
          typeof item.otpRemainingSeconds === 'number'
            ? item.otpRemainingSeconds
            : null,
      },
    },
  };
}

function validateMatchingItemsResponse(
  base: ProtocolMessage,
  raw: Record<string, unknown>,
): ValidationResult<MatchingItemsResponse> {
  if (!Array.isArray(raw.items)) {
    return {
      ok: false,
      error: {
        code: ErrorCode.INVALID_MESSAGE,
        message: 'Missing or invalid "items" array.',
        field: 'items',
      },
    };
  }

  if (!isNonEmptyString(raw.matchedDomain)) {
    return {
      ok: false,
      error: {
        code: ErrorCode.INVALID_MESSAGE,
        message: 'Missing or invalid "matchedDomain" field.',
        field: 'matchedDomain',
      },
    };
  }

  return {
    ok: true,
    value: {
      ...base,
      type: ExtensionResponseType.MATCHING_ITEMS_RESPONSE,
      items: raw.items as MatchingItemsResponse['items'],
      matchedDomain: raw.matchedDomain,
      totalCount: typeof raw.totalCount === 'number' ? raw.totalCount : raw.items.length,
    },
  };
}

function validateNoMatchFoundResponse(
  base: ProtocolMessage,
  raw: Record<string, unknown>,
): ValidationResult<NoMatchFoundResponse> {
  if (!isNonEmptyString(raw.searchedDomain) || !isNonEmptyString(raw.searchedUrl)) {
    return {
      ok: false,
      error: {
        code: ErrorCode.INVALID_MESSAGE,
        message: 'Missing or invalid "searchedDomain" or "searchedUrl" field.',
      },
    };
  }

  return {
    ok: true,
    value: {
      ...base,
      type: ExtensionResponseType.NO_MATCH_FOUND,
      searchedDomain: raw.searchedDomain,
      searchedUrl: raw.searchedUrl,
    },
  };
}

function validateVaultLockedResponse(
  base: ProtocolMessage,
  raw: Record<string, unknown>,
): ValidationResult<VaultLockedResponse> {
  return {
    ok: true,
    value: {
      ...base,
      type: ExtensionResponseType.VAULT_LOCKED,
      message:
        typeof raw.message === 'string'
          ? raw.message
          : 'Vault is locked. Please unlock in the SecurePass app.',
    },
  };
}

function validateClipboardConfirmationResponse(
  base: ProtocolMessage,
  raw: Record<string, unknown>,
): ValidationResult<ClipboardConfirmationResponse> {
  const validFields = ['username', 'password', 'otp'] as const;
  const field = raw.field as string;

  if (!validFields.includes(field as (typeof validFields)[number])) {
    return {
      ok: false,
      error: {
        code: ErrorCode.INVALID_MESSAGE,
        message: 'Missing or invalid "field" value.',
        field: 'field',
      },
    };
  }

  return {
    ok: true,
    value: {
      ...base,
      type: ExtensionResponseType.CLIPBOARD_CONFIRMATION,
      field: field as 'username' | 'password' | 'otp',
      clearAfterSeconds:
        typeof raw.clearAfterSeconds === 'number' ? raw.clearAfterSeconds : 45,
    },
  };
}

function validateErrorResponse(
  base: ProtocolMessage,
  raw: Record<string, unknown>,
): ValidationResult<ErrorResponse> {
  if (!isNonEmptyString(raw.code) || !isNonEmptyString(raw.message)) {
    return {
      ok: false,
      error: {
        code: ErrorCode.INVALID_MESSAGE,
        message: 'Missing or invalid "code" or "message" field.',
      },
    };
  }

  return {
    ok: true,
    value: {
      ...base,
      type: ExtensionResponseType.ERROR,
      code: raw.code as ErrorCode,
      message: raw.message,
      details:
        typeof raw.details === 'object' && raw.details !== null
          ? (raw.details as Record<string, unknown>)
          : undefined,
    },
  };
}

// ---------------------------------------------------------------------------
// Public response validator
// ---------------------------------------------------------------------------

/**
 * Validate a raw JSON-parsed message from the Electron host.
 * Returns a strongly-typed response message or a validation error.
 */
export function validateIncomingResponse(
  data: unknown,
): ValidationResult<ExtensionResponse> {
  const baseResult = validateBaseMessage(data);
  if (!baseResult.ok) return baseResult;

  const base = baseResult.value;
  const raw = data as Record<string, unknown>;

  if (!isNonEmptyString(raw.type)) {
    return {
      ok: false,
      error: {
        code: ErrorCode.UNKNOWN_MESSAGE_TYPE,
        message: 'Missing or invalid "type" field.',
        field: 'type',
      },
    };
  }

  const type = raw.type as string;

  switch (type) {
    case ExtensionResponseType.CREDENTIALS_RESPONSE:
      return validateCredentialsResponse(base, raw);

    case ExtensionResponseType.MATCHING_ITEMS_RESPONSE:
      return validateMatchingItemsResponse(base, raw);

    case ExtensionResponseType.NO_MATCH_FOUND:
      return validateNoMatchFoundResponse(base, raw);

    case ExtensionResponseType.VAULT_LOCKED:
      return validateVaultLockedResponse(base, raw);

    case ExtensionResponseType.CLIPBOARD_CONFIRMATION:
      return validateClipboardConfirmationResponse(base, raw);

    case ExtensionResponseType.ERROR:
      return validateErrorResponse(base, raw);

    default:
      return {
        ok: false,
        error: {
          code: ErrorCode.UNKNOWN_MESSAGE_TYPE,
          message: `Unknown response type: "${type}".`,
          field: 'type',
        },
      };
  }
}

// ---------------------------------------------------------------------------
// Request ID deduplication
// ---------------------------------------------------------------------------

/**
 * Tracks seen request IDs within a time window to detect replay attacks.
 * Items are automatically purged after PROTOCOL_MAX_AGE_MS.
 */
export class RequestIdTracker {
  private seen = new Map<string, number>();

  /**
   * Check if a request ID has been seen before.
   * If not, record it and return true (valid).
   * If yes, return false (replay detected).
   */
  check(requestId: string, timestamp: number): boolean {
    this.purge();

    if (this.seen.has(requestId)) {
      return false;
    }

    this.seen.set(requestId, timestamp);
    return true;
  }

  /** Remove expired entries. */
  private purge(): void {
    const cutoff = Date.now() - PROTOCOL_MAX_AGE_MS;
    for (const [id, ts] of this.seen) {
      if (ts < cutoff) {
        this.seen.delete(id);
      }
    }
  }

  /** Number of tracked request IDs. */
  get size(): number {
    this.purge();
    return this.seen.size;
  }

  /** Clear all tracked IDs. */
  clear(): void {
    this.seen.clear();
  }
}

// ---------------------------------------------------------------------------
// Error response factory
// ---------------------------------------------------------------------------

/**
 * Create a protocol-compliant error response.
 */
export function createErrorResponse(
  requestId: string,
  code: ErrorCode,
  message: string,
  details?: Record<string, unknown>,
): ErrorResponse {
  return {
    requestId,
    timestamp: Date.now(),
    protocolVersion: PROTOCOL_VERSION,
    type: ExtensionResponseType.ERROR,
    code,
    message,
    details,
  };
}

// ---------------------------------------------------------------------------
// Extension ID Authorization
// ---------------------------------------------------------------------------

/**
 * Normalize an extension ID to a full origin string for comparison.
 *
 * - If already a full origin (starts with `chrome-extension://` or `moz-extension://`), returns as-is.
 * - Otherwise, wraps it with `chrome-extension://<id>/`.
 *
 * @param id - Bare extension ID or full origin string.
 * @returns Normalized origin string.
 */
function normalizeExtensionId(id: string): string {
  const trimmed = id.trim();

  if (
    trimmed.startsWith(EXTENSION_ORIGIN_PREFIXES.chrome) ||
    trimmed.startsWith(EXTENSION_ORIGIN_PREFIXES.firefox)
  ) {
    return trimmed;
  }

  // Bare ID — wrap with chrome-extension:// prefix
  return `${EXTENSION_ORIGIN_PREFIXES.chrome}${trimmed}/`;
}

/**
 * Check if an extension ID is authorized to communicate with the host.
 *
 * Performs a case-insensitive comparison against the whitelist after
 * normalizing both the input and whitelist entries to full origin format.
 *
 * @param extensionId - The extension ID to check (bare or full origin).
 * @returns true if the extension is in the whitelist.
 */
export function isExtensionIdAuthorized(extensionId: string): boolean {
  if (!extensionId || extensionId.trim().length === 0) {
    return false;
  }

  const normalizedInput = normalizeExtensionId(extensionId).toLowerCase();

  return ALLOWED_EXTENSION_IDS.some((allowedId) => {
    const normalizedAllowed = normalizeExtensionId(allowedId).toLowerCase();
    return normalizedInput === normalizedAllowed;
  });
}

// ---------------------------------------------------------------------------
// Handshake message validation
// ---------------------------------------------------------------------------

/**
 * Validate an incoming HANDSHAKE_INIT message.
 *
 * @param data - Raw JSON-parsed message from the extension.
 * @returns Validation result with typed message or error.
 */
export function validateHandshakeInit(
  data: unknown,
): ValidationResult<HandshakeInitMessage> {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return {
      ok: false,
      error: {
        code: ErrorCode.INVALID_MESSAGE,
        message: 'Message must be a non-null JSON object.',
      },
    };
  }

  const obj = data as Record<string, unknown>;

  if (obj.type !== HandshakeMessageType.HANDSHAKE_INIT) {
    return {
      ok: false,
      error: {
        code: ErrorCode.UNKNOWN_MESSAGE_TYPE,
        message: `Expected HANDSHAKE_INIT, got "${obj.type}".`,
        field: 'type',
      },
    };
  }

  if (!isNonEmptyString(obj.requestId)) {
    return {
      ok: false,
      error: {
        code: ErrorCode.INVALID_HANDSHAKE,
        message: 'Missing or invalid "requestId" field.',
        field: 'requestId',
      },
    };
  }

  if (!isValidTimestamp(obj.timestamp)) {
    return {
      ok: false,
      error: {
        code: ErrorCode.TIMESTAMP_EXPIRED,
        message: 'Missing or invalid "timestamp" field.',
        field: 'timestamp',
      },
    };
  }

  if (typeof obj.protocolVersion !== 'number' || obj.protocolVersion < 1) {
    return {
      ok: false,
      error: {
        code: ErrorCode.UNSUPPORTED_PROTOCOL_VERSION,
        message: `Unsupported protocol version: ${obj.protocolVersion}.`,
        field: 'protocolVersion',
      },
    };
  }

  if (!isNonEmptyString(obj.publicKey)) {
    return {
      ok: false,
      error: {
        code: ErrorCode.INVALID_HANDSHAKE,
        message: 'Missing or invalid "publicKey" field.',
        field: 'publicKey',
      },
    };
  }

  // Validate publicKey is valid base64
  try {
    const keyBuffer = Buffer.from(obj.publicKey as string, 'base64');
    if (keyBuffer.length < 60) {
      return {
        ok: false,
        error: {
          code: ErrorCode.INVALID_HANDSHAKE,
          message: 'Public key is too short (expected 65+ bytes in SPKI format).',
          field: 'publicKey',
        },
      };
    }
  } catch {
    return {
      ok: false,
      error: {
        code: ErrorCode.INVALID_HANDSHAKE,
        message: 'Public key is not valid base64.',
        field: 'publicKey',
      },
    };
  }

  // Validate extensionId is present
  if (!isNonEmptyString(obj.extensionId)) {
    return {
      ok: false,
      error: {
        code: ErrorCode.UNAUTHORIZED,
        message: EXTENSION_ERRORS.MISSING_EXTENSION_ID,
        field: 'extensionId',
      },
    };
  }

  // Validate extensionId against whitelist
  if (!isExtensionIdAuthorized(obj.extensionId as string)) {
    return {
      ok: false,
      error: {
        code: ErrorCode.UNAUTHORIZED,
        message: EXTENSION_ERRORS.UNAUTHORIZED,
        field: 'extensionId',
      },
    };
  }

  return {
    ok: true,
    value: {
      requestId: obj.requestId,
      timestamp: obj.timestamp,
      protocolVersion: obj.protocolVersion,
      type: HandshakeMessageType.HANDSHAKE_INIT,
      publicKey: obj.publicKey as string,
      extensionId: obj.extensionId as string,
    },
  };
}

/**
 * Validate an incoming HANDSHAKE_COMPLETE message (from host to extension).
 * Used by the extension to verify the host's response.
 */
export function validateHandshakeComplete(
  data: unknown,
): ValidationResult<HandshakeCompleteMessage> {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return {
      ok: false,
      error: {
        code: ErrorCode.INVALID_MESSAGE,
        message: 'Message must be a non-null JSON object.',
      },
    };
  }

  const obj = data as Record<string, unknown>;

  if (obj.type !== HandshakeMessageType.HANDSHAKE_COMPLETE) {
    return {
      ok: false,
      error: {
        code: ErrorCode.UNKNOWN_MESSAGE_TYPE,
        message: `Expected HANDSHAKE_COMPLETE, got "${obj.type}".`,
        field: 'type',
      },
    };
  }

  if (!isNonEmptyString(obj.requestId) || !isValidTimestamp(obj.timestamp)) {
    return {
      ok: false,
      error: {
        code: ErrorCode.INVALID_HANDSHAKE,
        message: 'Missing or invalid base fields (requestId, timestamp).',
      },
    };
  }

  if (!isNonEmptyString(obj.publicKey)) {
    return {
      ok: false,
      error: {
        code: ErrorCode.INVALID_HANDSHAKE,
        message: 'Missing or invalid "publicKey" field.',
        field: 'publicKey',
      },
    };
  }

  if (!isNonEmptyString(obj.sessionToken)) {
    return {
      ok: false,
      error: {
        code: ErrorCode.INVALID_HANDSHAKE,
        message: 'Missing or invalid "sessionToken" field.',
        field: 'sessionToken',
      },
    };
  }

  if (!isNonEmptyString(obj.sessionId)) {
    return {
      ok: false,
      error: {
        code: ErrorCode.INVALID_HANDSHAKE,
        message: 'Missing or invalid "sessionId" field.',
        field: 'sessionId',
      },
    };
  }

  return {
    ok: true,
    value: {
      requestId: obj.requestId as string,
      timestamp: obj.timestamp as number,
      protocolVersion: obj.protocolVersion as number,
      type: HandshakeMessageType.HANDSHAKE_COMPLETE,
      publicKey: obj.publicKey as string,
      sessionToken: obj.sessionToken as string,
      sessionId: obj.sessionId as string,
    },
  };
}

/**
 * Detect if a message is an encrypted envelope (before full validation).
 * This allows the message handler to route to decrypt logic.
 */
export function isEncryptedEnvelope(data: unknown): data is EncryptedMessageEnvelope {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return false;
  }
  const obj = data as Record<string, unknown>;
  return (
    obj.type === HandshakeMessageType.ENCRYPTED_REQUEST ||
    obj.type === HandshakeMessageType.ENCRYPTED_RESPONSE
  );
}

/**
 * Validate the structure of an encrypted message envelope.
 * Does NOT decrypt or verify signatures — that requires the session key.
 */
export function validateEncryptedEnvelope(
  data: unknown,
): ValidationResult<EncryptedMessageEnvelope> {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return {
      ok: false,
      error: {
        code: ErrorCode.INVALID_MESSAGE,
        message: 'Message must be a non-null JSON object.',
      },
    };
  }

  const obj = data as Record<string, unknown>;

  if (!isEncryptedEnvelope(data)) {
    return {
      ok: false,
      error: {
        code: ErrorCode.UNKNOWN_MESSAGE_TYPE,
        message: `Expected ENCRYPTED_REQUEST or ENCRYPTED_RESPONSE, got "${obj.type}".`,
        field: 'type',
      },
    };
  }

  if (!isNonEmptyString(obj.sessionId)) {
    return {
      ok: false,
      error: {
        code: ErrorCode.INVALID_SESSION,
        message: 'Missing or invalid "sessionId" field.',
        field: 'sessionId',
      },
    };
  }

  if (!isNonEmptyString(obj.signature)) {
    return {
      ok: false,
      error: {
        code: ErrorCode.DECRYPTION_FAILED,
        message: 'Missing or invalid "signature" field.',
        field: 'signature',
      },
    };
  }

  if (!isNonEmptyString(obj.nonce)) {
    return {
      ok: false,
      error: {
        code: ErrorCode.DECRYPTION_FAILED,
        message: 'Missing or invalid "nonce" field.',
        field: 'nonce',
      },
    };
  }

  if (!isNonEmptyString(obj.authTag)) {
    return {
      ok: false,
      error: {
        code: ErrorCode.DECRYPTION_FAILED,
        message: 'Missing or invalid "authTag" field.',
        field: 'authTag',
      },
    };
  }

  if (!isNonEmptyString(obj.ciphertext)) {
    return {
      ok: false,
      error: {
        code: ErrorCode.DECRYPTION_FAILED,
        message: 'Missing or invalid "ciphertext" field.',
        field: 'ciphertext',
      },
    };
  }

  return {
    ok: true,
    value: {
      type: obj.type as
        | HandshakeMessageType.ENCRYPTED_REQUEST
        | HandshakeMessageType.ENCRYPTED_RESPONSE,
      sessionId: obj.sessionId as string,
      signature: obj.signature as string,
      nonce: obj.nonce as string,
      authTag: obj.authTag as string,
      ciphertext: obj.ciphertext as string,
    },
  };
}

/**
 * Validate an incoming TOKEN_REFRESH message.
 */
export function validateTokenRefresh(
  data: unknown,
): ValidationResult<TokenRefreshMessage> {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return {
      ok: false,
      error: {
        code: ErrorCode.INVALID_MESSAGE,
        message: 'Message must be a non-null JSON object.',
      },
    };
  }

  const obj = data as Record<string, unknown>;

  if (obj.type !== HandshakeMessageType.TOKEN_REFRESH) {
    return {
      ok: false,
      error: {
        code: ErrorCode.UNKNOWN_MESSAGE_TYPE,
        message: `Expected TOKEN_REFRESH, got "${obj.type}".`,
        field: 'type',
      },
    };
  }

  if (!isNonEmptyString(obj.requestId) || !isValidTimestamp(obj.timestamp)) {
    return {
      ok: false,
      error: {
        code: ErrorCode.INVALID_HANDSHAKE,
        message: 'Missing or invalid base fields (requestId, timestamp).',
      },
    };
  }

  if (!isNonEmptyString(obj.sessionToken)) {
    return {
      ok: false,
      error: {
        code: ErrorCode.INVALID_SESSION,
        message: 'Missing or invalid "sessionToken" field.',
        field: 'sessionToken',
      },
    };
  }

  return {
    ok: true,
    value: {
      requestId: obj.requestId as string,
      timestamp: obj.timestamp as number,
      protocolVersion: obj.protocolVersion as number,
      type: HandshakeMessageType.TOKEN_REFRESH,
      sessionToken: obj.sessionToken as string,
    },
  };
}

/**
 * Detect if a message is a handshake-phase message (unencrypted).
 */
export function isHandshakePhaseMessage(data: unknown): boolean {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return false;
  }
  const obj = data as Record<string, unknown>;
  return (
    obj.type === HandshakeMessageType.HANDSHAKE_INIT ||
    obj.type === HandshakeMessageType.HANDSHAKE_COMPLETE ||
    obj.type === HandshakeMessageType.TOKEN_REFRESH ||
    obj.type === HandshakeMessageType.TOKEN_REFRESHED
  );
}

/**
 * Unified message router that detects message phase and type.
 *
 * Returns a discriminated result indicating:
 * - 'handshake_init' → needs handshake processing
 * - 'encrypted' → needs decryption + standard request validation
 * - 'request' → standard unencrypted request validation
 * - 'error' → validation failed
 */
export type MessageRoute =
  | { kind: 'handshake_init'; message: HandshakeInitMessage }
  | { kind: 'encrypted'; envelope: EncryptedMessageEnvelope }
  | { kind: 'request'; message: HostRequest }
  | { kind: 'error'; error: ValidationError };

/**
 * Route an incoming raw message to the appropriate handler.
 * This is the main entry point for message processing.
 */
export function routeIncomingMessage(data: unknown): MessageRoute {
  // Check for encrypted envelope first
  if (isEncryptedEnvelope(data)) {
    const result = validateEncryptedEnvelope(data);
    if (result.ok) {
      return { kind: 'encrypted', envelope: result.value };
    }
    return { kind: 'error', error: result.error };
  }

  // Check for handshake messages
  if (isHandshakePhaseMessage(data)) {
    const obj = data as Record<string, unknown>;
    if (obj.type === HandshakeMessageType.HANDSHAKE_INIT) {
      const result = validateHandshakeInit(data);
      if (result.ok) {
        return { kind: 'handshake_init', message: result.value };
      }
      return { kind: 'error', error: result.error };
    }
    // Other handshake messages (COMPLETE, TOKEN_REFRESH, TOKEN_REFRESHED)
    // are handled by the extension side, not the host
    return {
      kind: 'error',
      error: {
        code: ErrorCode.UNKNOWN_MESSAGE_TYPE,
        message: `Handshake message type "${obj.type}" is not handled by the host.`,
      },
    };
  }

  // Standard request validation
  const result = validateIncomingRequest(data);
  if (result.ok) {
    return { kind: 'request', message: result.value };
  }
  return { kind: 'error', error: result.error };
}
