/**
 * Native Messaging Host Listener
 *
 * Implements the stdio-based communication channel between the Electron host
 * application and browser extensions (Chrome, Firefox, Edge). This is the
 * core transport layer that reads length-prefixed JSON messages from stdin
 * and writes responses to stdout.
 *
 * PROTOCOL:
 * - Native Messaging uses a simple length-prefixed wire format:
 *   [4 bytes: uint32 big-endian message length] [N bytes: UTF-8 JSON]
 * - The first message from the extension must be HANDSHAKE_INIT (ECDH).
 * - After a successful handshake, all messages are encrypted envelopes.
 *
 * RATE LIMITING:
 * - Per-connection sliding window: max 60 messages per 60-second window.
 * - Exceeding the limit returns RATE_LIMITED error.
 *
 * @module native-host/listener
 */

import { logger } from '../../shared/logger';
import {
  ErrorCode,
  ExtensionResponseType,
  type HostRequest,
  type ExtensionResponse,
} from '../../shared/protocols/nativeMessaging';
import {
  type HandshakeInitMessage,
  type EncryptedMessageEnvelope,
} from '../../shared/protocols/handshake';
import {
  routeIncomingMessage,
  isTimestampFresh,
  isExtensionIdAuthorized,
  createErrorResponse,
  type ValidationError,
} from '../../shared/protocols/validation';
import {
  processHandshakeInit,
  decryptMessage,
  getSession,
  revokeSession,
  type SessionState,
} from '../crypto/handshake';
import { getActiveAuthVaultId } from '../ipc/authHandlers';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum message size in bytes (1 MB). Matches Chrome native messaging limit. */
const MAX_MESSAGE_SIZE = 1024 * 1024;

/** Size of the length prefix in bytes (uint32 big-endian). */
const LENGTH_PREFIX_SIZE = 4;

/** Maximum messages per sliding window before rate limiting. */
const RATE_LIMIT_MAX_MESSAGES = 60;

/** Sliding window duration in milliseconds (1 minute). */
const RATE_LIMIT_WINDOW_MS = 60_000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Callback type for processing validated requests. */
export type RequestHandler = (
  request: HostRequest,
  session: SessionState,
) => Promise<ExtensionResponse> | ExtensionResponse;

/** Lifecycle event handlers. */
export type LifecycleHandler = {
  onConnect?: () => void;
  onDisconnect?: (reason: string) => void;
  onHandshakeComplete?: (session: SessionState) => void;
  onError?: (error: Error) => void;
};

/** Configuration for the native messaging listener. */
export interface NativeMessagingListenerConfig {
  onRequest?: RequestHandler;
  lifecycle?: LifecycleHandler;
  rateLimit?: {
    maxMessages?: number;
    windowMs?: number;
  };
  maxMessageSize?: number;
}

/** State of the current native messaging connection. */
interface ConnectionState {
  handshakeCompleted: boolean;
  session: SessionState | null;
  rateLimit: {
    timestamps: number[];
    maxMessages: number;
    windowMs: number;
  };
  seenRequestIds: Set<string>;
  closing: boolean;
  connectionId: string;
}

// ---------------------------------------------------------------------------
// Sliding Window Rate Limiter
// ---------------------------------------------------------------------------

function checkRateLimit(state: ConnectionState): boolean {
  const now = Date.now();
  const windowStart = now - state.rateLimit.windowMs;

  // Purge expired entries
  while (state.rateLimit.timestamps.length > 0 && state.rateLimit.timestamps[0]! < windowStart) {
    state.rateLimit.timestamps.shift();
  }

  if (state.rateLimit.timestamps.length >= state.rateLimit.maxMessages) {
    return false;
  }

  state.rateLimit.timestamps.push(now);
  return true;
}

// ---------------------------------------------------------------------------
// Stdout Writer
// ---------------------------------------------------------------------------

function writeToStdout(
  message: ExtensionResponse,
  stdout: NodeJS.WriteStream = process.stdout,
): void {
  try {
    const json = JSON.stringify(message);
    const jsonBuffer = Buffer.from(json, 'utf-8');

    if (jsonBuffer.length > MAX_MESSAGE_SIZE) {
      logger.error('Native messaging: response exceeds max size', {
        size: jsonBuffer.length,
      });
      return;
    }

    const lengthPrefix = Buffer.alloc(LENGTH_PREFIX_SIZE);
    lengthPrefix.writeUInt32BE(jsonBuffer.length, 0);

    stdout.write(lengthPrefix);
    stdout.write(jsonBuffer);

    logger.debug('Native messaging: sent response', {
      type: message.type,
      requestId: message.requestId,
    });
  } catch (cause) {
    logger.error('Native messaging: failed to write to stdout', {
      cause: cause instanceof Error ? cause.message : String(cause),
    });
  }
}

// ---------------------------------------------------------------------------
// Host Shutdown Notification
// ---------------------------------------------------------------------------

/**
 * Create a HOST_SHUTDOWN response message.
 *
 * @param reason - The reason for shutdown.
 * @returns A HostShutdownResponse message.
 */
function createHostShutdownResponse(reason: string): ExtensionResponse {
  return {
    requestId: 'host-shutdown',
    timestamp: Date.now(),
    protocolVersion: 1,
    type: ExtensionResponseType.HOST_SHUTDOWN,
    message: reason,
  };
}

/**
 * Send a HOST_SHUTDOWN notification to the connected extension.
 * This is best-effort — if the write fails, we proceed with shutdown anyway.
 */
function sendShutdownNotification(state: ConnectionState): void {
  if (!state.handshakeCompleted) return;

  try {
    const notification = createHostShutdownResponse(
      'The SecurePass Manager app is closing.',
    );
    writeToStdout(notification);
    logger.info('Native messaging: sent shutdown notification', {
      connectionId: state.connectionId,
    });
  } catch (cause) {
    // Best-effort — don't fail shutdown if notification fails
    logger.debug('Native messaging: failed to send shutdown notification', {
      connectionId: state.connectionId,
      cause: cause instanceof Error ? cause.message : String(cause),
    });
  }
}

// ---------------------------------------------------------------------------
// Message Processing
// ---------------------------------------------------------------------------

function handleValidationError(error: ValidationError, state: ConnectionState): void {
  const errorResponse = createErrorResponse(
    'unknown',
    error.code,
    error.message,
  );
  writeToStdout(errorResponse);
  logger.warn('Native messaging: validation error', {
    connectionId: state.connectionId,
    code: error.code,
  });
}

function handleHandshakeInit(
  initMessage: HandshakeInitMessage,
  state: ConnectionState,
): void {
  logger.info('Native messaging: processing handshake init', {
    connectionId: state.connectionId,
    requestId: initMessage.requestId,
    extensionId: initMessage.extensionId,
  });

  // Validate extension ID against whitelist (defense in depth — also checked in validation.ts)
  if (!isExtensionIdAuthorized(initMessage.extensionId)) {
    const errorResponse = createErrorResponse(
      initMessage.requestId,
      ErrorCode.UNAUTHORIZED,
      'Extension ID is not authorized to communicate with this host.',
    );
    writeToStdout(errorResponse);
    logger.warn('Native messaging: unauthorized extension', {
      connectionId: state.connectionId,
      extensionId: initMessage.extensionId,
    });
    return;
  }

  try {
    if (state.session) {
      revokeSession(state.session.sessionId);
    }

    // Get the active vault ID to bind the session to
    const activeVaultId = getActiveAuthVaultId();

    const completeMessage = processHandshakeInit(initMessage, activeVaultId);
    const session = getSession(completeMessage.sessionId);

    state.session = session;
    state.handshakeCompleted = true;
    state.seenRequestIds.clear();

    writeToStdout(completeMessage);

    logger.info('Native messaging: handshake completed', {
      connectionId: state.connectionId,
      sessionId: completeMessage.sessionId,
      extensionId: initMessage.extensionId,
      vaultId: activeVaultId ?? 'none',
    });
  } catch (cause) {
    const errorResponse = createErrorResponse(
      initMessage.requestId,
      ErrorCode.INVALID_HANDSHAKE,
      `Handshake failed: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
    writeToStdout(errorResponse);
    logger.error('Native messaging: handshake failed', {
      connectionId: state.connectionId,
      cause: cause instanceof Error ? cause.message : String(cause),
    });
  }
}

function handleEncryptedMessage(
  envelope: EncryptedMessageEnvelope,
  state: ConnectionState,
  config: NativeMessagingListenerConfig,
): void {
  if (!state.session) {
    writeToStdout(createErrorResponse(
      'unknown',
      ErrorCode.HANDSHAKE_REQUIRED,
      'No active session. Complete handshake first.',
    ));
    return;
  }

  if (Date.now() > state.session.expiresAt) {
    writeToStdout(createErrorResponse(
      'unknown',
      ErrorCode.INVALID_SESSION,
      'Session has expired. Re-handshake required.',
    ));
    return;
  }

  try {
    const plaintext = decryptMessage(envelope, state.session);
    const route = routeIncomingMessage(plaintext);

    switch (route.kind) {
      case 'request': {
        if (state.seenRequestIds.has(route.message.requestId)) {
          writeToStdout(createErrorResponse(
            route.message.requestId,
            ErrorCode.DUPLICATE_REQUEST_ID,
            'Duplicate request ID detected.',
          ));
          return;
        }
        state.seenRequestIds.add(route.message.requestId);

        if (!isTimestampFresh(route.message.timestamp)) {
          writeToStdout(createErrorResponse(
            route.message.requestId,
            ErrorCode.TIMESTAMP_EXPIRED,
            'Message timestamp is too old.',
          ));
          return;
        }

        processRequest(route.message, state, config);
        break;
      }

      case 'handshake_init':
        handleHandshakeInit(route.message, state);
        break;

      default:
        writeToStdout(createErrorResponse(
          'unknown',
          ErrorCode.INVALID_MESSAGE,
          'Unexpected message type in encrypted envelope.',
        ));
    }
  } catch (cause) {
    writeToStdout(createErrorResponse(
      'unknown',
      ErrorCode.DECRYPTION_FAILED,
      `Failed to decrypt message: ${cause instanceof Error ? cause.message : String(cause)}`,
    ));
    logger.error('Native messaging: decryption failed', {
      connectionId: state.connectionId,
      cause: cause instanceof Error ? cause.message : String(cause),
    });
  }
}

function processRequest(
  request: HostRequest,
  state: ConnectionState,
  config: NativeMessagingListenerConfig,
): void {
  logger.debug('Native messaging: processing request', {
    connectionId: state.connectionId,
    type: request.type,
  });

  try {
    if (config.onRequest && state.session) {
      const response = config.onRequest(request, state.session);
      if (response instanceof Promise) {
        response.then(
          (res) => writeToStdout(res),
          (err) => {
            writeToStdout(createErrorResponse(
              request.requestId,
              ErrorCode.INTERNAL_ERROR,
              `Async request error: ${err instanceof Error ? err.message : String(err)}`,
            ));
          },
        );
      } else {
        writeToStdout(response);
      }
    } else {
      writeToStdout(createErrorResponse(
        request.requestId,
        ErrorCode.VAULT_LOCKED,
        'No request handler configured.',
      ));
    }
  } catch (cause) {
    writeToStdout(createErrorResponse(
      request.requestId,
      ErrorCode.INTERNAL_ERROR,
      `Request processing failed: ${cause instanceof Error ? cause.message : String(cause)}`,
    ));
    logger.error('Native messaging: request processing failed', {
      connectionId: state.connectionId,
      type: request.type,
    });
  }
}

async function handleMessage(
  rawData: unknown,
  state: ConnectionState,
  config: NativeMessagingListenerConfig,
): Promise<void> {
  if (!checkRateLimit(state)) {
    writeToStdout(createErrorResponse(
      (rawData as Record<string, unknown>)?.requestId as string || 'unknown',
      ErrorCode.RATE_LIMITED,
      'Rate limit exceeded.',
    ));
    logger.warn('Native messaging: rate limit exceeded', {
      connectionId: state.connectionId,
    });
    return;
  }

  const route = routeIncomingMessage(rawData);

  switch (route.kind) {
    case 'handshake_init':
      handleHandshakeInit(route.message, state);
      break;

    case 'encrypted':
      handleEncryptedMessage(route.envelope, state, config);
      break;

    case 'request':
      writeToStdout(createErrorResponse(
        route.message.requestId,
        ErrorCode.HANDSHAKE_REQUIRED,
        'Handshake required before sending requests.',
      ));
      break;

    case 'error':
      handleValidationError(route.error, state);
      break;
  }
}

// ---------------------------------------------------------------------------
// Stdin Reader (Length-Prefixed Protocol)
// ---------------------------------------------------------------------------

function readStdinLoop(
  stdin: NodeJS.ReadStream,
  state: ConnectionState,
  config: NativeMessagingListenerConfig,
): Promise<void> {
  let lengthBuffer: Buffer | null = null;
  let messageBuffer: Buffer | null = null;
  let messageLength = 0;
  let readingLength = true;

  return new Promise<void>((resolve) => {
    function cleanup(): void {
      state.closing = true;

      // Send shutdown notification before revoking session (best-effort)
      sendShutdownNotification(state);

      if (state.session) {
        revokeSession(state.session.sessionId);
      }
      if (config.lifecycle?.onDisconnect) {
        config.lifecycle.onDisconnect('connection closed');
      }
    }

    stdin.on('data', (chunk: Buffer) => {
      if (state.closing) return;

      let offset = 0;

      while (offset < chunk.length) {
        if (readingLength) {
          if (lengthBuffer === null) {
            lengthBuffer = Buffer.alloc(LENGTH_PREFIX_SIZE);
          }

          const remaining = LENGTH_PREFIX_SIZE - lengthBuffer.length;
          const copyLen = Math.min(remaining, chunk.length - offset);
          chunk.copy(lengthBuffer, lengthBuffer.length, offset, offset + copyLen);
          offset += copyLen;

          if (lengthBuffer.length === LENGTH_PREFIX_SIZE) {
            messageLength = lengthBuffer.readUInt32BE(0);

            if (messageLength > MAX_MESSAGE_SIZE) {
              logger.error('Native messaging: message too large', {
                size: messageLength,
              });
              state.closing = true;
              cleanup();
              resolve();
              return;
            }

            messageBuffer = Buffer.alloc(messageLength);
            readingLength = false;
          }
        } else {
          const remaining = messageLength - messageBuffer!.length;
          const copyLen = Math.min(remaining, chunk.length - offset);
          chunk.copy(messageBuffer!, messageBuffer!.length, offset, offset + copyLen);
          offset += copyLen;

          if (messageBuffer!.length === messageLength) {
            const jsonStr = messageBuffer!.toString('utf-8');
            let parsed: unknown;
            try {
              parsed = JSON.parse(jsonStr);
            } catch {
              writeToStdout(createErrorResponse(
                'unknown',
                ErrorCode.INVALID_MESSAGE,
                'Invalid JSON in message payload.',
              ));
              readingLength = true;
              lengthBuffer = null;
              messageBuffer = null;
              messageLength = 0;
              continue;
            }

            handleMessage(parsed, state, config).catch((err) => {
              logger.error('Native messaging: unhandled error', {
                connectionId: state.connectionId,
                cause: err instanceof Error ? err.message : String(err),
              });
            });

            readingLength = true;
            lengthBuffer = null;
            messageBuffer = null;
            messageLength = 0;
          }
        }
      }
    });

    stdin.on('end', () => {
      logger.info('Native messaging: stdin ended', {
        connectionId: state.connectionId,
      });
      cleanup();
      resolve();
    });

    stdin.on('close', () => {
      // Handle close event (may fire instead of end when stdin.destroy() is called)
      if (!state.closing) {
        logger.info('Native messaging: stdin closed', {
          connectionId: state.connectionId,
        });
        cleanup();
        resolve();
      }
    });

    stdin.on('error', (err) => {
      logger.error('Native messaging: stdin error', {
        connectionId: state.connectionId,
        cause: err.message,
      });
      cleanup();
      resolve();
    });
  });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Start the native messaging host listener.
 *
 * Reads messages from stdin, processes them, and writes responses to stdout.
 * This is the entry point when the Electron app is launched as a native
 * messaging host by a browser extension.
 *
 * @param config - Optional configuration overrides.
 * @returns Promise that resolves when the connection ends.
 */
export async function startNativeMessagingListener(
  config?: NativeMessagingListenerConfig,
): Promise<void> {
  const connectionId = `conn_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  const state: ConnectionState = {
    handshakeCompleted: false,
    session: null,
    rateLimit: {
      timestamps: [],
      maxMessages: config?.rateLimit?.maxMessages ?? RATE_LIMIT_MAX_MESSAGES,
      windowMs: config?.rateLimit?.windowMs ?? RATE_LIMIT_WINDOW_MS,
    },
    seenRequestIds: new Set(),
    closing: false,
    connectionId,
  };

  logger.info('Native messaging: listener started', { connectionId });

  if (config?.lifecycle?.onConnect) {
    config.lifecycle.onConnect();
  }

  // Set stdin to binary mode for reading length-prefixed messages
  if (process.stdin.setEncoding) {
    process.stdin.setEncoding(null as unknown as BufferEncoding);
  }

  // Resume stdin if it's in paused state
  if (process.stdin.isPaused()) {
    process.stdin.resume();
  }

  await readStdinLoop(process.stdin, state, config);

  logger.info('Native messaging: listener stopped', { connectionId });
}

/**
 * Check if the current process was launched as a native messaging host.
 *
 * When a browser launches the app via native messaging, stdin is a pipe
 * (not a TTY). This function detects that condition.
 *
 * @returns true if stdin is a pipe (native messaging mode).
 */
export function isNativeMessagingMode(): boolean {
  const forceGui = process.env.SECURE_PASS_FORCE_GUI === '1';
  const forceNative = process.env.SECURE_PASS_FORCE_NATIVE_MESSAGING === '1';

  if (forceNative) return true;
  if (forceGui) return false;

  // In dev (Vite dev server), stdin often appears as a non-TTY pipe,
  // which incorrectly triggers native messaging mode. Only enter native
  // messaging when there is no dev server URL.
  return process.stdin.isTTY !== true && process.env.VITE_DEV_SERVER_URL === undefined;
}

/**
 * Stop the native messaging listener gracefully.
 * Writes any pending data and closes stdin.
 */
export function stopNativeMessagingListener(): void {
  if (!process.stdin.destroyed) {
    process.stdin.destroy();
  }
}
