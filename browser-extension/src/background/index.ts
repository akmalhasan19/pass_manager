/**
 * Background Service Worker for SecurePass Manager Browser Extension.
 *
 * Responsibilities:
 * - Manage native messaging port to the Electron host
 * - Perform ECDH key exchange handshake
 * - Encrypt/decrypt messages with AES-256-GCM
 * - Route messages between content scripts and the host
 * - Handle session token refresh
 *
 * @module background/index
 */

import {
  generateECDHKeyPair,
  deriveSharedKey,
  createHandshakeInit,
  parseHandshakeComplete,
  createEncryptedEnvelope,
  decryptEnvelope,
  importHMACKey,
  arrayBufferToBase64,
  generateRequestId,
  currentTimestamp,
} from '../shared/crypto';
import { NativePort } from '../shared/native-messaging';
import {
  HandshakeMessageType,
  HostRequestType,
  ExtensionResponseType,
  ErrorCode,
  PROTOCOL_VERSION,
  type HandshakeInitMessage,
  type HandshakeCompleteMessage,
  type AnyProtocolMessage,
  type EncryptedMessageEnvelope,
  type ExtensionResponse,
  type HostRequest,
  type GetMatchingItemsRequest,
  type GetCredentialsRequest,
  type CopyToClipboardRequest,
  type LockVaultRequest,
  type CreateItemRequest,
  type DecryptedCredentialsResponse,
} from '../shared/protocol';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const HOST_NAME = 'com.securepass.manager';
const SESSION_TOKEN_REFRESH_MS = 20 * 60 * 1000; // refresh at 20 min (token TTL = 30 min)

// ---------------------------------------------------------------------------
// Session state
// ---------------------------------------------------------------------------

interface SessionState {
  /** Whether a handshake has been completed. */
  handshakeComplete: boolean;
  /** The derived AES-256-GCM shared key. */
  aesKey: CryptoKey | null;
  /** The base64-encoded HMAC key for signing. */
  hmacKeyBase64: string;
  /** HMAC CryptoKey for signing/verification. */
  hmacKey: CryptoKey | null;
  /** Session ID from the host. */
  sessionId: string | null;
  /** Session token from the host. */
  sessionToken: string | null;
  /** The ECDH private key (for the current handshake). */
  privateKey: CryptoKey | null;
  /** Timer for token refresh. */
  refreshTimer: ReturnType<typeof setTimeout> | null;
}

const session: SessionState = {
  handshakeComplete: false,
  aesKey: null,
  hmacKeyBase64: '',
  hmacKey: null,
  sessionId: null,
  sessionToken: null,
  privateKey: null,
  refreshTimer: null,
};

// ---------------------------------------------------------------------------
// Native port
// ---------------------------------------------------------------------------

let nativePort: NativePort | null = null;

function connectToHost(): void {
  if (nativePort?.isConnected) return;

  nativePort = new NativePort(
    { hostName: HOST_NAME },
    {
      onConnect: () => {
        console.log('[SecurePass] Connected to native host');
        performHandshake();
      },
      onDisconnect: (error) => {
        console.warn('[SecurePass] Disconnected from native host:', error);
        resetSession();
      },
      onMessage: (message) => {
        handleHostMessage(message);
      },
      onError: (error) => {
        console.error('[SecurePass] Native port error:', error);
      },
    },
  );

  nativePort.connect();
}

function resetSession(): void {
  session.handshakeComplete = false;
  session.aesKey = null;
  session.hmacKeyBase64 = '';
  session.hmacKey = null;
  session.sessionId = null;
  session.sessionToken = null;
  session.privateKey = null;
  if (session.refreshTimer) {
    clearTimeout(session.refreshTimer);
    session.refreshTimer = null;
  }
}

// ---------------------------------------------------------------------------
// Handshake
// ---------------------------------------------------------------------------

async function performHandshake(): Promise<void> {
  try {
    const keyPair = await generateECDHKeyPair();
    session.privateKey = keyPair.privateKey;

    const initMessage = createHandshakeInit(keyPair.publicKeyBase64);
    const response = await nativePort!.sendRequest<HandshakeCompleteMessage>(
      initMessage,
    );

    const parsed = parseHandshakeComplete(response);

    // Derive shared key from our private key and host's public key
    const aesKey = await deriveSharedKey(
      session.privateKey,
      parsed.publicKey,
    );

    // Generate HMAC key for session token signing (derived from session ID)
    const sessionKeyMaterial = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(parsed.sessionId),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign', 'verify'],
    );
    const hmacKeyBits = await crypto.subtle.sign(
      'HMAC',
      sessionKeyMaterial,
      new TextEncoder().encode('session-signing-key'),
    );
    const hmacKeyBase64 = arrayBufferToBase64(hmacKeyBits);
    const hmacKey = await importHMACKey(hmacKeyBase64);

    // Store session state
    session.aesKey = aesKey;
    session.hmacKeyBase64 = hmacKeyBase64;
    session.hmacKey = hmacKey;
    session.sessionId = parsed.sessionId;
    session.sessionToken = parsed.sessionToken;
    session.handshakeComplete = true;

    console.log('[SecurePass] Handshake complete, session:', parsed.sessionId);

    // Schedule token refresh
    scheduleTokenRefresh();
  } catch (error) {
    console.error('[SecurePass] Handshake failed:', error);
    resetSession();
  }
}

function scheduleTokenRefresh(): void {
  if (session.refreshTimer) {
    clearTimeout(session.refreshTimer);
  }

  session.refreshTimer = setTimeout(async () => {
    if (!session.handshakeComplete || !nativePort?.isConnected) return;

    try {
      const refreshMsg = {
        type: HandshakeMessageType.TOKEN_REFRESH as const,
        requestId: generateRequestId(),
        timestamp: currentTimestamp(),
        protocolVersion: PROTOCOL_VERSION,
        sessionToken: session.sessionToken!,
      };

      const response = await nativePort.sendRequest(refreshMsg);
      if (response.type === HandshakeMessageType.TOKEN_REFRESHED) {
        const refreshed = response as {
          sessionToken: string;
          sessionId: string;
        };
        session.sessionToken = refreshed.sessionToken;
        console.log('[SecurePass] Session token refreshed');
        scheduleTokenRefresh();
      }
    } catch (error) {
      console.error('[SecurePass] Token refresh failed:', error);
      // Re-handshake on refresh failure
      resetSession();
      performHandshake();
    }
  }, SESSION_TOKEN_REFRESH_MS);
}

// ---------------------------------------------------------------------------
// Message handling
// ---------------------------------------------------------------------------

async function handleHostMessage(message: AnyProtocolMessage): Promise<void> {
  // Messages from the host that aren't correlated to a pending request
  // (e.g., push notifications from the host)
  console.log('[SecurePass] Unhandled host message:', message.type);
}

/**
 * Encrypt and send a request to the host, then decrypt the response.
 *
 * @param request - The plaintext request to send.
 * @returns The decrypted response from the host.
 */
async function sendEncryptedRequest<T extends ExtensionResponse>(
  request: HostRequest,
): Promise<T> {
  if (!session.handshakeComplete || !session.aesKey || !session.hmacKey) {
    throw new Error('Handshake not complete');
  }

  const envelope = await createEncryptedEnvelope(
    session.aesKey,
    session.hmacKey,
    session.sessionId!,
    request,
  );

  const rawResponse = await nativePort!.sendRequest<AnyProtocolMessage>(
    envelope,
  );

  if (
    rawResponse.type === HandshakeMessageType.ENCRYPTED_RESPONSE
  ) {
    const decrypted = await decryptEnvelope(
      session.aesKey,
      session.hmacKey,
      rawResponse as EncryptedMessageEnvelope,
    );
    return decrypted as T;
  }

  return rawResponse as unknown as T;
}

// ---------------------------------------------------------------------------
// Content script message handling
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener(
  (
    message: HostRequest,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response: unknown) => void,
  ) => {
    if (!message?.type) return false;

    // Handle the message asynchronously
    handleContentMessage(message, sender)
      .then((response) => {
        sendResponse(response);
      })
      .catch((error) => {
        console.error('[SecurePass] Error handling content message:', error);
        sendResponse({
          type: ExtensionResponseType.ERROR,
          code: 'INTERNAL_ERROR',
          message: error instanceof Error ? error.message : 'Unknown error',
          requestId: generateRequestId(),
          timestamp: currentTimestamp(),
          protocolVersion: PROTOCOL_VERSION,
        });
      });

    // Return true to indicate we will send a response asynchronously
    return true;
  },
);

async function handleContentMessage(
  message: HostRequest,
  _sender: chrome.runtime.MessageSender,
): Promise<ExtensionResponse> {
  if (!session.handshakeComplete) {
    // Attempt to connect and handshake if not already done
    if (!nativePort?.isConnected) {
      connectToHost();
    }
    return {
      type: ExtensionResponseType.VAULT_LOCKED,
      message: 'SecurePass Manager is not connected. Please ensure the desktop app is running.',
      requestId: generateRequestId(),
      timestamp: currentTimestamp(),
      protocolVersion: PROTOCOL_VERSION,
    };
  }

  switch (message.type) {
    case HostRequestType.GET_MATCHING_ITEMS:
      return sendEncryptedRequest<ExtensionResponse>(
        message as GetMatchingItemsRequest,
      );

    case HostRequestType.GET_CREDENTIALS:
      return sendEncryptedRequest<ExtensionResponse>(
        message as GetCredentialsRequest,
      );

    case HostRequestType.COPY_TO_CLIPBOARD:
      return sendEncryptedRequest<ExtensionResponse>(
        message as CopyToClipboardRequest,
      );

    case HostRequestType.LOCK_VAULT:
      return sendEncryptedRequest<ExtensionResponse>(
        message as LockVaultRequest,
      );

    case HostRequestType.CREATE_ITEM:
      return sendEncryptedRequest<ExtensionResponse>(
        message as CreateItemRequest,
      );

    default:
      return {
        type: ExtensionResponseType.ERROR,
        code: ErrorCode.UNKNOWN_MESSAGE_TYPE,
        message: `Unknown message type: ${String((message as HostRequest).type)}`,
        requestId: generateRequestId(),
        timestamp: currentTimestamp(),
        protocolVersion: PROTOCOL_VERSION,
      };
  }
}

// ---------------------------------------------------------------------------
// Extension lifecycle
// ---------------------------------------------------------------------------

// Connect on service worker startup
connectToHost();

// Reconnect when the service worker wakes up (Manifest V3 service workers
// can be terminated and restarted by the browser)
chrome.runtime.onStartup.addListener(() => {
  console.log('[SecurePass] Browser startup — connecting to host');
  connectToHost();
});

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    console.log('[SecurePass] Extension installed');
  } else if (details.reason === 'update') {
    console.log('[SecurePass] Extension updated to', chrome.runtime.getManifest().version);
  }
});
