/**
 * Extension Service — Bridge between Browser Extension and Vault
 *
 * Handles validated requests from the browser extension (via Native Messaging)
 * by performing read-only operations against the active unlocked vault.
 *
 * SECURITY INVARIANTS:
 * - This service only accesses the vault through the repository layer.
 * - Passwords are decrypted transiently with the master key, then re-encrypted
 *   with the session's ECDH-derived shared key before being sent to the extension.
 * - OTP secrets are decrypted transiently only to generate the current code.
 * - The master key never leaves the main process.
 * - Only the extension that completed the ECDH handshake can decrypt responses.
 *
 * @module services/extensionService
 */

import { clipboard } from 'electron';
import { ItemRepository } from '../database/repositories/ItemRepository';
import { isDatabaseOpen } from '../database/connection';
import { getMasterKey, lockCurrentVault, getActiveAuthVaultId } from '../ipc/authHandlers';
import { decryptString, encryptString } from '../crypto/encryption';
import { generateTOTP, getRemainingSeconds } from './totpService';
import { secureClear, secureClearString } from '../../shared/secureMemory';
import { PROTOCOL_MAX_MATCHING_ITEMS, ErrorCode } from '../../shared/protocols/nativeMessaging';
import type { Item } from '../../shared/types';
import type { SessionState } from '../crypto/handshake';
import type {
  HostRequest,
  ExtensionResponse,
  GetCredentialsRequest,
  GetMatchingItemsRequest,
  CopyToClipboardRequest,
  LockVaultRequest,
  EncryptedCredentialItem,
} from '../../shared/protocols/nativeMessaging';
import {
  HostRequestType,
  ExtensionResponseType,
} from '../../shared/protocols/nativeMessaging';
import { logger } from '../../shared/logger';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default clipboard auto-clear timeout in seconds. */
const DEFAULT_CLIPBOARD_CLEAR_SECONDS = 45;

/** Maximum clipboard auto-clear timeout in seconds. */
const MAX_CLIPBOARD_CLEAR_SECONDS = 300;

// ---------------------------------------------------------------------------
// Security Boundary Validation
// ---------------------------------------------------------------------------

/**
 * Validate that the session's vault context matches the currently active vault.
 *
 * This enforces the security invariant that all extension requests must go
 * through the ExtensionService with the correct vault context. If the vault
 * was locked or switched since the session was established, the request is
 * rejected to prevent stale session abuse.
 *
 * @param session - The session from the extension request.
 * @returns An ExtensionResponse if validation fails (return this immediately), or null if OK.
 */
function validateVaultContext(session: SessionState): ExtensionResponse | null {
  const activeVaultId = getActiveAuthVaultId();

  // If no vault is active, all read requests must fail
  if (!activeVaultId) {
    return {
      requestId: 'unknown',
      timestamp: Date.now(),
      protocolVersion: 1,
      type: ExtensionResponseType.VAULT_LOCKED,
      message: 'Vault is locked. Please open the SecurePass Manager app and unlock your vault to continue.',
    };
  }

  // If the session was established against a different vault, reject
  if (session.vaultId !== null && session.vaultId !== activeVaultId) {
    logger.warn('Extension request rejected: vault context mismatch', {
      sessionVaultId: session.vaultId,
      activeVaultId,
      extensionId: session.extensionId,
    });
    return {
      requestId: 'unknown',
      timestamp: Date.now(),
      protocolVersion: 1,
      type: ExtensionResponseType.ERROR,
      code: ErrorCode.UNAUTHORIZED,
      message: 'Session is bound to a different vault. Please re-handshake by restarting the extension.',
    };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

const itemRepo = new ItemRepository();

// ---------------------------------------------------------------------------
// URL / Domain Utilities
// ---------------------------------------------------------------------------

/**
 * Extract the registrable domain (hostname) from a URL string.
 *
 * Handles edge cases:
 * - Missing protocol (prepends https://)
 * - Invalid URLs (returns null)
 * - IP addresses (returns the IP as-is)
 * - Localhost (returns 'localhost')
 *
 * @param url - The full URL or domain string.
 * @returns The hostname, or null if parsing fails.
 */
function extractDomain(url: string): string | null {
  try {
    const normalized = url.includes('://') ? url : `https://${url}`;
    const parsed = new URL(normalized);
    return parsed.hostname || null;
  } catch {
    return null;
  }
}

/**
 * Normalize a domain for comparison by removing 'www.' prefix
 * and converting to lowercase.
 */
function normalizeDomain(domain: string): string {
  let normalized = domain.toLowerCase().trim();
  if (normalized.startsWith('www.')) {
    normalized = normalized.slice(4);
  }
  return normalized;
}

/**
 * Check if an item's URL matches the given domain.
 *
 * Performs matching at multiple levels:
 * 1. Exact hostname match
 * 2. Subdomain match (item domain is a parent of request domain)
 * 3. Reverse subdomain match (request domain is a parent of item domain)
 *
 * @param itemUrl - The URL stored in the vault item.
 * @param targetDomain - The domain to match against.
 * @returns true if the item's URL matches the target domain.
 */
function matchesDomain(itemUrl: string, targetDomain: string): boolean {
  if (!itemUrl || !targetDomain) return false;

  const itemDomain = extractDomain(itemUrl);
  if (!itemDomain) return false;

  const normalizedItem = normalizeDomain(itemDomain);
  const normalizedTarget = normalizeDomain(targetDomain);

  if (normalizedItem === normalizedTarget) return true;
  if (normalizedItem.endsWith(`.${normalizedTarget}`)) return true;
  if (normalizedTarget.endsWith(`.${normalizedItem}`)) return true;

  return false;
}

// ---------------------------------------------------------------------------
// Encrypted Credential Builder
// ---------------------------------------------------------------------------

/**
 * Build an `EncryptedCredentialItem` from a vault Item.
 *
 * Decrypts the password with the master key, then re-encrypts it with the
 * session's ECDH-derived shared key so only the authenticated extension
 * can decrypt it.
 *
 * @param item - The vault item (with encrypted password).
 * @param masterKey - The vault's master decryption key.
 * @param sessionKey - The ECDH session shared key for re-encryption.
 * @param includeOtp - Whether to generate and include the current OTP code.
 * @returns The encrypted credential item for the protocol response.
 */
function buildEncryptedCredential(
  item: Item,
  masterKey: Buffer,
  sessionKey: Buffer,
  includeOtp: boolean,
): EncryptedCredentialItem {
  let passwordEncrypted = '';

  if (item.passwordEncrypted) {
    const passwordBuf = Buffer.from(item.passwordEncrypted);
    let plaintext: string | null = null;
    try {
      plaintext = decryptString(passwordBuf, masterKey);
      const reEncrypted = encryptString(plaintext, sessionKey);
      passwordEncrypted = reEncrypted.toString('base64');
    } finally {
      if (plaintext) secureClearString(plaintext);
      secureClear(passwordBuf);
    }
  }

  let otpCode: string | null = null;
  let otpRemainingSeconds: number | null = null;

  if (includeOtp && item.otpSecretEncrypted) {
    const otpBuf = Buffer.from(item.otpSecretEncrypted);
    let otpSecret: string | null = null;
    try {
      otpSecret = decryptString(otpBuf, masterKey);
      const totpConfig = {
        secret: otpSecret,
        period: item.otpPeriod || 30,
        digits: item.otpDigits || 6,
        algorithm: item.otpAlgorithm || 'SHA1',
      };
      otpCode = generateTOTP(otpSecret, totpConfig);
      otpRemainingSeconds = getRemainingSeconds(totpConfig);
    } catch (cause) {
      logger.warn('Failed to generate OTP code for extension', {
        itemId: item.id,
        cause: cause instanceof Error ? cause.message : String(cause),
      });
    } finally {
      if (otpSecret) secureClearString(otpSecret);
      secureClear(otpBuf);
    }
  }

  return {
    id: item.id,
    title: item.title,
    username: item.username ?? '',
    passwordEncrypted,
    url: item.url ?? '',
    isFavorite: item.isFavorite,
    emoji: item.emoji ?? null,
    otpCode,
    otpRemainingSeconds,
  };
}

// ---------------------------------------------------------------------------
// Request Handlers
// ---------------------------------------------------------------------------

/**
 * Handle GET_CREDENTIALS: Retrieve a single credential by item ID.
 *
 * Flow:
 * 1. Check vault is unlocked
 * 2. Fetch item from repository
 * 3. Decrypt password with master key
 * 4. Re-encrypt with session shared key
 * 5. Optionally generate OTP code
 * 6. Return encrypted credential
 */
function handleGetCredentials(
  request: GetCredentialsRequest,
  session: SessionState,
): ExtensionResponse {
  if (!isDatabaseOpen()) {
    return createVaultLockedResponse(request);
  }

  const masterKey = getMasterKey();
  if (!masterKey) {
    return createVaultLockedResponse(request);
  }

  const item = itemRepo.getById(request.itemId);
  if (!item) {
    return {
      requestId: request.requestId,
      timestamp: Date.now(),
      protocolVersion: 1,
      type: ExtensionResponseType.ERROR,
      code: ErrorCode.ITEM_NOT_FOUND,
      message: `Item not found: ${request.itemId}`,
    };
  }

  try {
    const encryptedItem = buildEncryptedCredential(
      item,
      masterKey,
      session.sharedKey,
      request.includeOtp ?? false,
    );

    return {
      requestId: request.requestId,
      timestamp: Date.now(),
      protocolVersion: 1,
      type: ExtensionResponseType.CREDENTIALS_RESPONSE,
      item: encryptedItem,
    };
  } catch (cause) {
    logger.error('Failed to build credential response', {
      itemId: request.itemId,
      cause: cause instanceof Error ? cause.message : String(cause),
    });
    return {
      requestId: request.requestId,
      timestamp: Date.now(),
      protocolVersion: 1,
      type: ExtensionResponseType.ERROR,
      code: ErrorCode.INTERNAL_ERROR,
      message: `Failed to retrieve credential: ${cause instanceof Error ? cause.message : String(cause)}`,
    };
  }
}

/**
 * Handle GET_MATCHING_ITEMS: Find credentials matching a URL/domain.
 *
 * Flow:
 * 1. Check vault is unlocked
 * 2. Extract domain from URL
 * 3. Fetch all items from repository
 * 4. Filter by domain match
 * 5. Encrypt each matching item with session key
 * 6. Return matching items (up to limit)
 */
function handleGetMatchingItems(
  request: GetMatchingItemsRequest,
  session: SessionState,
): ExtensionResponse {
  if (!isDatabaseOpen()) {
    return createVaultLockedResponse(request);
  }

  const masterKey = getMasterKey();
  if (!masterKey) {
    return createVaultLockedResponse(request);
  }

  const targetDomain = request.domain ?? extractDomain(request.url);
  if (!targetDomain) {
    return {
      requestId: request.requestId,
      timestamp: Date.now(),
      protocolVersion: 1,
      type: ExtensionResponseType.ERROR,
      code: ErrorCode.INVALID_URL,
      message: 'Could not extract domain from the provided URL.',
    };
  }

  try {
    const allItems = itemRepo.getAll();
    const limit = Math.min(
      request.limit ?? PROTOCOL_MAX_MATCHING_ITEMS,
      PROTOCOL_MAX_MATCHING_ITEMS,
    );

    const matchingItems = allItems
      .filter((item) => matchesDomain(item.url, targetDomain))
      .slice(0, limit);

    if (matchingItems.length === 0) {
      return {
        requestId: request.requestId,
        timestamp: Date.now(),
        protocolVersion: 1,
        type: ExtensionResponseType.NO_MATCH_FOUND,
        searchedDomain: targetDomain,
        searchedUrl: request.url,
      };
    }

    const encryptedItems = matchingItems.map((item) =>
      buildEncryptedCredential(
        item,
        masterKey,
        session.sharedKey,
        false,
      ),
    );

    return {
      requestId: request.requestId,
      timestamp: Date.now(),
      protocolVersion: 1,
      type: ExtensionResponseType.MATCHING_ITEMS_RESPONSE,
      items: encryptedItems,
      matchedDomain: targetDomain,
      totalCount: matchingItems.length,
    };
  } catch (cause) {
    logger.error('Failed to find matching items', {
      url: request.url,
      domain: targetDomain,
      cause: cause instanceof Error ? cause.message : String(cause),
    });
    return {
      requestId: request.requestId,
      timestamp: Date.now(),
      protocolVersion: 1,
      type: ExtensionResponseType.ERROR,
      code: ErrorCode.INTERNAL_ERROR,
      message: `Failed to search credentials: ${cause instanceof Error ? cause.message : String(cause)}`,
    };
  }
}

/**
 * Handle COPY_TO_CLIPBOARD: Copy a credential field to the system clipboard.
 *
 * Flow:
 * 1. Check vault is unlocked
 * 2. Fetch item from repository
 * 3. Decrypt the requested field
 * 4. Copy to clipboard
 * 5. Schedule auto-clear after timeout
 * 6. Return confirmation
 */
function handleCopyToClipboard(
  request: CopyToClipboardRequest,
  _session: SessionState,
): ExtensionResponse {
  if (!isDatabaseOpen()) {
    return createVaultLockedResponse(request);
  }

  const masterKey = getMasterKey();
  if (!masterKey) {
    return createVaultLockedResponse(request);
  }

  const item = itemRepo.getById(request.itemId);
  if (!item) {
    return {
      requestId: request.requestId,
      timestamp: Date.now(),
      protocolVersion: 1,
      type: ExtensionResponseType.ERROR,
      code: ErrorCode.ITEM_NOT_FOUND,
      message: `Item not found: ${request.itemId}`,
    };
  }

  try {
    let valueToCopy: string | null = null;

    switch (request.field) {
      case 'username': {
        valueToCopy = item.username ?? '';
        break;
      }
      case 'password': {
        if (!item.passwordEncrypted) {
          return {
            requestId: request.requestId,
            timestamp: Date.now(),
            protocolVersion: 1,
            type: ExtensionResponseType.ERROR,
            code: ErrorCode.NO_PASSWORD,
            message: 'This item has no password.',
          };
        }
        const passwordBuf = Buffer.from(item.passwordEncrypted);
        try {
          valueToCopy = decryptString(passwordBuf, masterKey);
        } finally {
          secureClear(passwordBuf);
        }
        break;
      }
      case 'otp': {
        if (!item.otpSecretEncrypted) {
          return {
            requestId: request.requestId,
            timestamp: Date.now(),
            protocolVersion: 1,
            type: ExtensionResponseType.ERROR,
            code: ErrorCode.NO_OTP_CONFIGURED,
            message: 'This item has no OTP configured.',
          };
        }
        const otpBuf = Buffer.from(item.otpSecretEncrypted);
        let otpSecret: string | null = null;
        try {
          otpSecret = decryptString(otpBuf, masterKey);
          const totpConfig = {
            secret: otpSecret,
            period: item.otpPeriod || 30,
            digits: item.otpDigits || 6,
            algorithm: item.otpAlgorithm || 'SHA1',
          };
          valueToCopy = generateTOTP(otpSecret, totpConfig);
        } finally {
          if (otpSecret) secureClearString(otpSecret);
          secureClear(otpBuf);
        }
        break;
      }
      default: {
        return {
          requestId: request.requestId,
          timestamp: Date.now(),
          protocolVersion: 1,
          type: ExtensionResponseType.ERROR,
          code: ErrorCode.INVALID_MESSAGE,
          message: `Unknown field: ${request.field}`,
        };
      }
    }

    clipboard.writeText(valueToCopy);

    const clearSeconds = Math.min(
      request.clearAfterSeconds ?? DEFAULT_CLIPBOARD_CLEAR_SECONDS,
      MAX_CLIPBOARD_CLEAR_SECONDS,
    );
    scheduleClipboardClear(clearSeconds);

    logger.info('Copied field to clipboard via extension', {
      itemId: request.itemId,
      field: request.field,
      clearAfterSeconds: clearSeconds,
    });

    return {
      requestId: request.requestId,
      timestamp: Date.now(),
      protocolVersion: 1,
      type: ExtensionResponseType.CLIPBOARD_CONFIRMATION,
      field: request.field,
      clearAfterSeconds: clearSeconds,
    };
  } catch (cause) {
    logger.error('Failed to copy to clipboard', {
      itemId: request.itemId,
      field: request.field,
      cause: cause instanceof Error ? cause.message : String(cause),
    });
    return {
      requestId: request.requestId,
      timestamp: Date.now(),
      protocolVersion: 1,
      type: ExtensionResponseType.ERROR,
      code: ErrorCode.CLIPBOARD_FAILED,
      message: `Failed to copy to clipboard: ${cause instanceof Error ? cause.message : String(cause)}`,
    };
  }
}

/**
 * Handle LOCK_VAULT: Lock the vault immediately.
 *
 * Flow:
 * 1. Save and close database
 * 2. Wipe all key material
 * 3. Return confirmation
 */
function handleLockVault(
  request: LockVaultRequest,
  _session: SessionState,
): ExtensionResponse {
  try {
    const lockedVaultId = lockCurrentVault();

    logger.info('Vault locked via extension request', { vaultId: lockedVaultId });

    return {
      requestId: request.requestId,
      timestamp: Date.now(),
      protocolVersion: 1,
      type: ExtensionResponseType.VAULT_LOCKED,
      message: 'Vault has been locked.',
    };
  } catch (cause) {
    logger.error('Failed to lock vault via extension', {
      cause: cause instanceof Error ? cause.message : String(cause),
    });
    return {
      requestId: request.requestId,
      timestamp: Date.now(),
      protocolVersion: 1,
      type: ExtensionResponseType.ERROR,
      code: ErrorCode.INTERNAL_ERROR,
      message: `Failed to lock vault: ${cause instanceof Error ? cause.message : String(cause)}`,
    };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Active clipboard clear timer handle (only one active at a time). */
let clipboardClearTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Schedule the clipboard to be cleared after the specified number of seconds.
 * If a clear is already scheduled, it is replaced.
 */
function scheduleClipboardClear(seconds: number): void {
  if (clipboardClearTimer) {
    clearTimeout(clipboardClearTimer);
  }

  clipboardClearTimer = setTimeout(() => {
    clipboard.clear();
    clipboardClearTimer = null;
    logger.debug('Clipboard auto-cleared after timeout');
  }, seconds * 1000);
}

function createVaultLockedResponse(request: { requestId: string }): ExtensionResponse {
  return {
    requestId: request.requestId,
    timestamp: Date.now(),
    protocolVersion: 1,
    type: ExtensionResponseType.VAULT_LOCKED,
    message: 'Vault is locked. Please open the SecurePass Manager app and unlock your vault to continue.',
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Handle a validated request from the browser extension.
 *
 * This is the main entry point that routes requests to the appropriate
 * handler based on the request type. It enforces the security boundary:
 * - All requests must go through this service (no direct database access)
 * - Each request is validated against the session's vault context
 * - The session must have been established via ECDH handshake with a whitelisted extension
 *
 * @param request - The validated host request from the extension.
 * @param session - The active ECDH session with shared encryption key, extension ID, and vault context.
 * @returns The protocol response to send back to the extension.
 */
export function handleExtensionRequest(
  request: HostRequest,
  session: SessionState,
): ExtensionResponse {
  logger.debug('Extension request received', {
    type: request.type,
    requestId: request.requestId,
    sessionId: session.sessionId,
    extensionId: session.extensionId,
    vaultId: session.vaultId,
  });

  // Security boundary: validate vault context before processing any request
  const vaultError = validateVaultContext(session);
  if (vaultError) {
    return { ...vaultError, requestId: request.requestId };
  }

  switch (request.type) {
    case HostRequestType.GET_CREDENTIALS:
      return handleGetCredentials(request, session);

    case HostRequestType.GET_MATCHING_ITEMS:
      return handleGetMatchingItems(request, session);

    case HostRequestType.COPY_TO_CLIPBOARD:
      return handleCopyToClipboard(request, session);

    case HostRequestType.LOCK_VAULT:
      return handleLockVault(request, session);

    default: {
      const _exhaustive: never = request;
      return {
        requestId: (_exhaustive as { requestId: string }).requestId ?? 'unknown',
        timestamp: Date.now(),
        protocolVersion: 1,
        type: ExtensionResponseType.ERROR,
        code: ErrorCode.UNKNOWN_MESSAGE_TYPE,
        message: `Unknown request type: ${(_exhaustive as { type: string }).type}`,
      };
    }
  }
}

/**
 * Clean up any pending clipboard clear timer.
 * Call this when the app is shutting down.
 */
export function cleanupExtensionService(): void {
  if (clipboardClearTimer) {
    clearTimeout(clipboardClearTimer);
    clipboardClearTimer = null;
  }
}
