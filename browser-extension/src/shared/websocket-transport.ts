/**
 * WebSocket Transport — Fallback for Native Messaging
 *
 * Provides a WebSocket-based communication channel as a fallback when Native
 * Messaging is unavailable. The extension first fetches connection config
 * (port + JWT token) from the discovery HTTP endpoint, then establishes a
 * WebSocket connection to the Electron app.
 *
 * FLOW:
 * 1. Fetch /ws-config from discovery server (http://127.0.0.1:DISCOVERY_PORT/ws-config)
 * 2. Receive wsPort, jwtToken, expiresInMs
 * 3. Connect to ws://127.0.0.1:{wsPort}
 * 4. Send WS_AUTH message with jwtToken
 * 5. Receive WS_AUTH_SUCCESS confirmation
 * 6. Send/receive encrypted envelopes (same protocol as Native Messaging)
 *
 * SECURITY:
 * - JWT tokens expire after 60 seconds (short-lived)
 * - Only localhost connections accepted
 * - Tokens are single-use (server issues new one per request)
 *
 * @module shared/websocket-transport
 */

import type {
  AnyProtocolMessage,
  HostRequest,
  ExtensionResponse,
} from './protocol';
import { ErrorCode } from './protocol';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default discovery port — matches Electron app's DISCOVERY_PORT. */
const DISCOVERY_PORT = 18353;

/** Discovery endpoint path. */
const DISCOVERY_PATH = '/ws-config';

/** Timeout for discovery HTTP request (ms). */
const DISCOVERY_TIMEOUT_MS = 5_000;

/** Timeout for WebSocket connection (ms). */
const WS_CONNECT_TIMEOUT_MS = 5_000;

/** Timeout for request-response over WebSocket (ms). */
const WS_REQUEST_TIMEOUT_MS = 30_000;

/** Delay before reconnecting on failure (ms). */
const RECONNECT_DELAY_MS = 2_000;

/** Maximum reconnect attempts before giving up. */
const MAX_RECONNECT_ATTEMPTS = 3;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** WebSocket connection configuration from discovery endpoint. */
export interface WsDiscoveryConfig {
  wsPort: number;
  jwtToken: string;
  expiresInMs: number;
  protocolVersion: number;
}

/** WebSocket authentication message. */
interface WsAuthMessage {
  type: 'WS_AUTH';
  token: string;
}

/** WebSocket authentication success response. */
interface WsAuthSuccessMessage {
  type: 'WS_AUTH_SUCCESS';
  sessionId: string;
  timestamp: number;
}

/** Connection status. */
export type WsConnectionStatus =
  | 'disconnected'
  | 'discovering'
  | 'connecting'
  | 'authenticating'
  | 'connected'
  | 'error';

/** Callbacks for connection lifecycle events. */
export interface WsTransportCallbacks {
  onConnect?: () => void;
  onDisconnect?: (error?: Error) => void;
  onMessage?: (message: AnyProtocolMessage) => void;
  onError?: (error: Error) => void;
  onStatusChange?: (status: WsConnectionStatus) => void;
}

// ---------------------------------------------------------------------------
// WebSocket Transport Class
// ---------------------------------------------------------------------------

/**
 * WebSocket-based transport for communicating with the Electron host.
 * Used as a fallback when Native Messaging is unavailable.
 */
export class WebSocketTransport {
  private ws: WebSocket | null = null;
  private readonly callbacks: WsTransportCallbacks;
  private status: WsConnectionStatus = 'disconnected';
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly pendingRequests = new Map<
    string,
    {
      resolve: (value: AnyProtocolMessage) => void;
      reject: (reason: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  private authenticated = false;
  private sessionId = '';

  constructor(callbacks: WsTransportCallbacks = {}) {
    this.callbacks = callbacks;
  }

  /**
   * Connect to the WebSocket fallback server.
   * Performs discovery → connect → authenticate flow.
   */
  async connect(discoveryPort: number = DISCOVERY_PORT): Promise<void> {
    if (this.ws) {
      throw new Error('Already connected or connecting');
    }

    try {
      this.setStatus('discovering');

      // Step 1: Discover WebSocket configuration
      const config = await this.discover(discoveryPort);

      // Step 2: Connect to WebSocket
      this.setStatus('connecting');
      await this.connectWebSocket(config.wsPort, config.jwtToken);

      this.reconnectAttempts = 0;
    } catch (error) {
      this.setStatus('error');
      this.cleanup();
      throw error;
    }
  }

  /**
   * Disconnect from the WebSocket server.
   */
  disconnect(): void {
    this.reconnectAttempts = MAX_RECONNECT_ATTEMPTS; // Prevent auto-reconnect
    this.cleanup();
    this.setStatus('disconnected');
  }

  /**
   * Check if the transport is currently connected and authenticated.
   */
  get isConnected(): boolean {
    return this.authenticated && this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  /**
   * Get the current connection status.
   */
  get connectionStatus(): WsConnectionStatus {
    return this.status;
  }

  /**
   * Send a message and wait for a correlated response.
   *
   * @param message - The message to send (must include requestId).
   * @returns The correlated response from the host.
   * @throws Error if not connected or if request times out.
   */
  async sendRequest<T extends AnyProtocolMessage = AnyProtocolMessage>(
    message: AnyProtocolMessage,
  ): Promise<T> {
    if (!this.isConnected || !this.ws) {
      throw new Error('Not connected to WebSocket server');
    }

    const requestId = 'requestId' in message ? (message.requestId as string) : undefined;

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (requestId) this.pendingRequests.delete(requestId);
        reject(new Error(`Request ${requestId ?? 'unknown'} timed out`));
      }, WS_REQUEST_TIMEOUT_MS);

      if (requestId) {
        this.pendingRequests.set(requestId, {
          resolve: resolve as (value: AnyProtocolMessage) => void,
          reject,
          timer,
        });
      }

      this.ws!.send(JSON.stringify(message));
    });
  }

  /**
   * Send a raw message without waiting for a response.
   *
   * @param message - The message to send.
   */
  sendMessage(message: AnyProtocolMessage): void {
    if (!this.isConnected || !this.ws) {
      throw new Error('Not connected to WebSocket server');
    }

    this.ws.send(JSON.stringify(message));
  }

  // -------------------------------------------------------------------------
  // Private methods
  // -------------------------------------------------------------------------

  /**
   * Fetch WebSocket configuration from the discovery HTTP endpoint.
   */
  private async discover(discoveryPort: number): Promise<WsDiscoveryConfig> {
    const url = `http://127.0.0.1:${discoveryPort}${DISCOVERY_PATH}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DISCOVERY_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: { Accept: 'application/json' },
      });

      if (!response.ok) {
        throw new Error(`Discovery failed: HTTP ${response.status}`);
      }

      const config: WsDiscoveryConfig = await response.json();

      if (!config.wsPort || !config.jwtToken) {
        throw new Error('Invalid discovery response: missing required fields');
      }

      return config;
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Connect to the WebSocket server and authenticate.
   */
  private async connectWebSocket(port: number, jwtToken: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const connectTimer = setTimeout(() => {
        this.cleanup();
        reject(new Error('WebSocket connection timeout'));
      }, WS_CONNECT_TIMEOUT_MS);

      try {
        const url = `ws://127.0.0.1:${port}`;
        this.ws = new WebSocket(url);

        this.ws.onopen = () => {
          this.setStatus('authenticating');

          // Send JWT authentication
          const authMessage: WsAuthMessage = {
            type: 'WS_AUTH',
            token: jwtToken,
          };
          this.ws!.send(JSON.stringify(authMessage));
        };

        this.ws.onmessage = (event) => {
          try {
            const message = JSON.parse(event.data);

            // Check if this is the auth success message
            if (message.type === 'WS_AUTH_SUCCESS') {
              clearTimeout(connectTimer);
              this.authenticated = true;
              this.sessionId = message.sessionId;
              this.setStatus('connected');

              this.callbacks.onConnect?.();
              resolve();
              return;
            }

            // Handle correlated responses
            if (message.requestId) {
              const pending = this.pendingRequests.get(message.requestId);
              if (pending) {
                clearTimeout(pending.timer);
                this.pendingRequests.delete(message.requestId);
                pending.resolve(message);
                return;
              }
            }

            // Uncategorized message
            this.callbacks.onMessage?.(message);
          } catch (err) {
            console.error('[WebSocketTransport] Failed to parse message:', err);
          }
        };

        this.ws.onclose = (event) => {
          clearTimeout(connectTimer);
          this.authenticated = false;

          // Reject all pending requests
          for (const [id, pending] of this.pendingRequests) {
            clearTimeout(pending.timer);
            pending.reject(new Error(`WebSocket closed: code ${event.code}`));
          }
          this.pendingRequests.clear();

          this.callbacks.onDisconnect?.(
            event.code !== 1000 ? new Error(`WebSocket closed: ${event.reason || `code ${event.code}`}`) : undefined,
          );

          this.cleanup();
          this.setStatus('disconnected');

          // Auto-reconnect
          if (this.reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
            this.scheduleReconnect();
          }
        };

        this.ws.onerror = () => {
          // onerror is followed by onclose, so cleanup happens there
        };
      } catch (err) {
        clearTimeout(connectTimer);
        this.cleanup();
        reject(err instanceof Error ? err : new Error('Failed to create WebSocket'));
      }
    });
  }

  /**
   * Schedule a reconnection attempt.
   */
  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;

    this.reconnectAttempts++;
    this.setStatus('disconnected');

    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;

      try {
        await this.connect();
      } catch (err) {
        console.error('[WebSocketTransport] Reconnect failed:', err);
        this.setStatus('error');
      }
    }, RECONNECT_DELAY_MS * this.reconnectAttempts);
  }

  /**
   * Clean up WebSocket resources.
   */
  private cleanup(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.ws) {
      // Only close if not already closed
      if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
        this.ws.close(1000, 'Client disconnect');
      }
      this.ws = null;
    }

    this.authenticated = false;
    this.sessionId = '';
  }

  /**
   * Update connection status and notify callback.
   */
  private setStatus(status: WsConnectionStatus): void {
    this.status = status;
    this.callbacks.onStatusChange?.(status);
  }
}