/**
 * Background Service Worker for SecurePass Manager Browser Extension.
 *
 * Responsibilities:
 * - Manage native messaging port to the Electron host
 * - Perform ECDH key exchange handshake
 * - Encrypt/decrypt messages with AES-256-GCM
 * - Route messages between content scripts and the host
 * - Handle session token refresh
 * - Fallback to WebSocket transport when Native Messaging is unavailable
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
import { WebSocketTransport, type WsConnectionStatus } from '../shared/websocket-transport';
import {
  setIconState,
  setBadgeCount,
  pulseAutofillSuccess,
  updateFromHostResponse,
  setConnecting,
} from '../shared/icon-manager';
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
  type UpdateExtensionSettingsRequest,
  type DecryptedCredentialsResponse,
  type MatchingItemsResponse,
} from '../shared/protocol';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const HOST_NAME = 'com.securepass.manager';
const SESSION_TOKEN_REFRESH_MS = 20 * 60 * 1000; // refresh at 20 min (token TTL = 30 min)
const DISCOVERY_PORT = 18353;

// ---------------------------------------------------------------------------
// Transport mode
// ---------------------------------------------------------------------------

/** Current transport mode. */
type TransportMode = 'native-messaging' | 'websocket' | 'none';

let transportMode: TransportMode = 'none';

// ---------------------------------------------------------------------------
// Host shutdown tracking
// ---------------------------------------------------------------------------

/** Whether the host has sent a shutdown notification. */
let hostShutdown = false;

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
// Transport references
// ---------------------------------------------------------------------------

let nativePort: NativePort | null = null;
let wsTransport: WebSocketTransport | null = null;

// ---------------------------------------------------------------------------
// Transport management
// ---------------------------------------------------------------------------

/**
 * Connect to the host using the best available transport.
 * Tries Native Messaging first, falls back to WebSocket.
 */
function connectToHost(): void {
  if (hostShutdown) {
    console.log('[SecurePass] Host has shut down — not reconnecting');
    return;
  }

  if (nativePort?.isConnected || wsTransport?.isConnected) return;

  // Try Native Messaging first
  tryNativeMessaging();
}

function tryNativeMessaging(): void {
  transportMode = 'native-messaging';
  console.log('[SecurePass] Attempting Native Messaging connection...');

  nativePort = new NativePort(
    { hostName: HOST_NAME },
    {
      onConnect: () => {
        console.log('[SecurePass] Connected via Native Messaging');
        // Reset host shutdown state on successful reconnect
        hostShutdown = false;
        performHandshake();
      },
      onDisconnect: (error) => {
        console.warn('[SecurePass] Native Messaging disconnected:', error);
        if (!hostShutdown) {
          resetSessionAndFallback();
        }
      },
      onMessage: (message) => {
        handleHostMessage(message);
      },
      onError: (error) => {
        console.error('[SecurePass] Native Messaging error:', error);
        if (!hostShutdown) {
          resetSessionAndFallback();
        }
      },
      onHostShutdown: (message) => {
        console.log('[SecurePass] Host shutdown notification:', message);
        hostShutdown = true;
        resetSession();
        // Set icon to locked state to indicate host is unavailable
        setIconState('locked');
        setBadgeCount(0);
      },
    },
  );

  try {
    nativePort.connect();
  } catch (error) {
    console.warn('[SecurePass] Native Messaging connection failed, falling back to WebSocket:', error);
    resetSessionAndFallback();
  }
}

/**
 * Fallback to WebSocket transport when Native Messaging fails.
 */
async function tryWebSocketFallback(): Promise<void> {
  if (wsTransport?.isConnected) return;

  transportMode = 'websocket';
  console.log('[SecurePass] Attempting WebSocket fallback connection...');

  // Clean up any existing native port
  if (nativePort) {
    nativePort.disconnect();
    nativePort = null;
  }

  wsTransport = new WebSocketTransport({
    onConnect: () => {
      console.log('[SecurePass] Connected via WebSocket fallback');
      // WebSocket transport doesn't need ECDH handshake — JWT auth is built-in
      // The session is established via the WebSocket connection itself
      performWsHandshake();
    },
    onDisconnect: (error) => {
      console.warn('[SecurePass] WebSocket transport disconnected:', error);
      resetSession();
      // Try reconnecting after a delay
      setTimeout(() => {
        tryWebSocketFallback();
      }, 3000);
    },
    onMessage: (message) => {
      handleHostMessage(message);
    },
    onError: (error) => {
      console.error('[SecurePass] WebSocket transport error:', error);
    },
    onStatusChange: (status: WsConnectionStatus) => {
      if (status === 'error' || status === 'disconnected') {
        setConnecting();
      } else if (status === 'connected') {
        setIconState('unlocked');
      }
    },
  });

  try {
    await wsTransport.connect(DISCOVERY_PORT);
    // Connection is authenticated at this point
  } catch (error) {
    console.warn('[SecurePass] WebSocket fallback failed:', error);
    // Both transports failed — will retry when content script sends a message
    transportMode = 'none';
    setConnecting();
  }
}

/**
 * Reset session and attempt WebSocket fallback.
 */
function resetSessionAndFallback(): void {
  resetSession();
  
  // Don't attempt WebSocket fallback if we're already using it
  if (transportMode === 'native-messaging') {
    tryWebSocketFallback();
  }
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

  // Reset icon to connecting state (unless host has shut down)
  if (!hostShutdown) {
    setConnecting();
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

    // Update extension icon to unlocked state
    setIconState('unlocked');

    // Schedule token refresh
    scheduleTokenRefresh();
  } catch (error) {
    console.error('[SecurePass] Handshake failed:', error);
    resetSessionAndFallback();
  }
}

/**
 * Perform a lightweight handshake after WebSocket JWT auth.
 * The WebSocket auth already establishes a session, so we just
 * need to set up our session state for message encryption.
 */
async function performWsHandshake(): Promise<void> {
  try {
    // For WebSocket transport, we still do ECDH key exchange for
    // end-to-end encryption on top of the WebSocket channel.
    const keyPair = await generateECDHKeyPair();
    session.privateKey = keyPair.privateKey;

    const initMessage = createHandshakeInit(keyPair.publicKeyBase64);
    const response = await wsTransport!.sendRequest<HandshakeCompleteMessage>(
      initMessage,
    );

    const parsed = parseHandshakeComplete(response);

    // Derive shared key
    const aesKey = await deriveSharedKey(
      session.privateKey,
      parsed.publicKey,
    );

    // Generate HMAC key
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

    session.aesKey = aesKey;
    session.hmacKeyBase64 = hmacKeyBase64;
    session.hmacKey = hmacKey;
    session.sessionId = parsed.sessionId;
    session.sessionToken = parsed.sessionToken;
    session.handshakeComplete = true;

    console.log('[SecurePass] WebSocket handshake complete, session:', parsed.sessionId);
    setIconState('unlocked');
    scheduleTokenRefresh();
  } catch (error) {
    console.error('[SecurePass] WebSocket handshake failed:', error);
    resetSession();
  }
}

function scheduleTokenRefresh(): void {
  if (session.refreshTimer) {
    clearTimeout(session.refreshTimer);
  }

  session.refreshTimer = setTimeout(async () => {
    if (!session.handshakeComplete) return;
    if (!nativePort?.isConnected && !wsTransport?.isConnected) return;

    try {
      const refreshMsg = {
        type: HandshakeMessageType.TOKEN_REFRESH as const,
        requestId: generateRequestId(),
        timestamp: currentTimestamp(),
        protocolVersion: PROTOCOL_VERSION,
        sessionToken: session.sessionToken!,
      };

      let response: AnyProtocolMessage;
      if (transportMode === 'websocket' && wsTransport) {
        response = await wsTransport.sendRequest(refreshMsg);
      } else if (nativePort) {
        response = await nativePort.sendRequest(refreshMsg);
      } else {
        throw new Error('No transport available');
      }

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
      if (transportMode === 'websocket') {
        tryWebSocketFallback();
      } else {
        connectToHost();
      }
    }
  }, SESSION_TOKEN_REFRESH_MS);
}

// ---------------------------------------------------------------------------
// Message handling
// ---------------------------------------------------------------------------

async function handleHostMessage(message: AnyProtocolMessage): Promise<void> {
  // Messages from the host that aren't correlated to a pending request
  console.log('[SecurePass] Unhandled host message:', message.type);
}

/**
 * Encrypt and send a request to the host, then decrypt the response.
 *
 * Supports both Native Messaging and WebSocket transport.
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

  let rawResponse: AnyProtocolMessage;

  if (transportMode === 'websocket' && wsTransport?.isConnected) {
    rawResponse = await wsTransport.sendRequest<AnyProtocolMessage>(envelope);
  } else if (nativePort?.isConnected) {
    rawResponse = await nativePort.sendRequest<AnyProtocolMessage>(envelope);
  } else {
    throw new Error('No transport available');
  }

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
// Extension UI / content script message handling
// ---------------------------------------------------------------------------

interface UiActionMessage {
  action?: 'openApp' | 'openSettings' | 'openAddItem' | 'autofillSuccess';
  route?: string;
}

chrome.runtime.onMessage.addListener(
  (
    message: HostRequest | UiActionMessage,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response: unknown) => void,
  ) => {
    if (!message || (!('type' in message) && !message.action)) return false;

    // Handle the message asynchronously
    handleContentMessage(message, sender)
      .then((response) => {
        sendResponse(response);
      })
      .catch((error) => {
        console.error('[SecurePass] Error handling content message:', error);
        const isConnected = nativePort?.isConnected || wsTransport?.isConnected;
        sendResponse({
          type: ExtensionResponseType.ERROR,
          code: ErrorCode.HANDSHAKE_REQUIRED,
          message: isConnected
            ? 'SecurePass Manager could not complete the request. Try again or reopen the app.'
            : 'SecurePass Manager is not connected. Please open the app and unlock your vault.',
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
  message: (HostRequest & UiActionMessage) | UiActionMessage,
  _sender: chrome.runtime.MessageSender,
): Promise<ExtensionResponse> {
  // Handle non-protocol messages (e.g., autofill success notification)
  if (message.action === 'autofillSuccess') {
    pulseAutofillSuccess();
    return {
      type: ExtensionResponseType.CLIPBOARD_CONFIRMATION,
      field: 'password',
      clearAfterSeconds: 0,
      requestId: generateRequestId(),
      timestamp: currentTimestamp(),
      protocolVersion: PROTOCOL_VERSION,
    } as ExtensionResponse;
  }

  if (message.action === 'openApp' || message.action === 'openSettings' || message.action === 'openAddItem') {
    hostShutdown = false;
    connectToHost();
    return {
      type: ExtensionResponseType.CLIPBOARD_CONFIRMATION,
      field: 'password',
      clearAfterSeconds: 0,
      requestId: generateRequestId(),
      timestamp: currentTimestamp(),
      protocolVersion: PROTOCOL_VERSION,
    } as ExtensionResponse;
  }

  if (!('type' in message)) {
    return {
      type: ExtensionResponseType.ERROR,
      code: ErrorCode.UNKNOWN_MESSAGE_TYPE,
      message: 'Unknown UI action.',
      requestId: generateRequestId(),
      timestamp: currentTimestamp(),
      protocolVersion: PROTOCOL_VERSION,
    };
  }

  if (hostShutdown) {
    return {
      type: ExtensionResponseType.HOST_SHUTDOWN,
      message: 'The SecurePass Manager app has been closed. Please reopen the app to use the extension.',
      requestId: generateRequestId(),
      timestamp: currentTimestamp(),
      protocolVersion: PROTOCOL_VERSION,
    };
  }

  if (!session.handshakeComplete) {
    // Attempt to connect if not already connected
    if (!nativePort?.isConnected && !wsTransport?.isConnected) {
      connectToHost();
    }
    return {
      type: ExtensionResponseType.ERROR,
      code: ErrorCode.HANDSHAKE_REQUIRED,
      message: 'SecurePass Manager is not connected. Please open the app and unlock your vault.',
      requestId: generateRequestId(),
      timestamp: currentTimestamp(),
      protocolVersion: PROTOCOL_VERSION,
    };
  }

  switch (message.type) {
    case HostRequestType.GET_MATCHING_ITEMS: {
      const response = await sendEncryptedRequest<ExtensionResponse>(
        message as GetMatchingItemsRequest,
      );
      // Update badge count from the response
      if (response.type === ExtensionResponseType.MATCHING_ITEMS_RESPONSE) {
        const matching = response as MatchingItemsResponse;
        setBadgeCount(matching.items?.length ?? 0);
        updateFromHostResponse(false, matching.items?.length ?? 0);
      } else if (response.type === ExtensionResponseType.VAULT_LOCKED) {
        updateFromHostResponse(true, 0);
      } else if (response.type === ExtensionResponseType.NO_MATCH_FOUND) {
        updateFromHostResponse(false, 0);
      } else if (response.type === ExtensionResponseType.HOST_SHUTDOWN) {
        hostShutdown = true;
        resetSession();
        setIconState('locked');
        setBadgeCount(0);
      }
      return response;
    }

    case HostRequestType.GET_CREDENTIALS:
      return sendEncryptedRequest<ExtensionResponse>(
        message as GetCredentialsRequest,
      );

    case HostRequestType.COPY_TO_CLIPBOARD:
      return sendEncryptedRequest<ExtensionResponse>(
        message as CopyToClipboardRequest,
      );

    case HostRequestType.LOCK_VAULT: {
      const lockResponse = await sendEncryptedRequest<ExtensionResponse>(
        message as LockVaultRequest,
      );
      // Vault was explicitly locked
      updateFromHostResponse(true, 0);
      return lockResponse;
    }

    case HostRequestType.CREATE_ITEM:
      return sendEncryptedRequest<ExtensionResponse>(
        message as CreateItemRequest,
      );

    case HostRequestType.UPDATE_EXTENSION_SETTINGS:
      return sendEncryptedRequest<ExtensionResponse>(
        message as UpdateExtensionSettingsRequest,
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

// Connect on service worker startup (reset shutdown state)
hostShutdown = false;
connectToHost();

// Reconnect when the service worker wakes up (Manifest V3 service workers
// can be terminated and restarted by the browser)
chrome.runtime.onStartup.addListener(() => {
  console.log('[SecurePass] Browser startup — connecting to host');
  hostShutdown = false;
  connectToHost();
});

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    console.log('[SecurePass] Extension installed');
  } else if (details.reason === 'update') {
    console.log('[SecurePass] Extension updated to', chrome.runtime.getManifest().version);
  }
});
