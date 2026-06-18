/**
 * Native Messaging client for communicating with the Electron host.
 *
 * Wraps `chrome.runtime.connectNative()` to provide a structured
 * message-based interface with automatic reconnection and
 * request-response correlation via requestId.
 *
 * @module shared/native-messaging
 */

import type {
  AnyProtocolMessage,
  HostRequest,
  ExtensionResponse,
} from './protocol';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Configuration for the native messaging port. */
export interface NativePortConfig {
  /** Native messaging host name (must match manifest.json registered name). */
  hostName: string;
}

/** Callback for handling a response from the native host. */
export type ResponseCallback = (response: ExtensionResponse) => void;

/** Callback for handling connection events. */
export interface ConnectionCallbacks {
  /** Called when the port connects to the native host. */
  onConnect?: () => void;
  /** Called when the port disconnects. */
  onDisconnect?: (error?: Error) => void;
  /** Called when a message is received from the native host. */
  onMessage?: (message: AnyProtocolMessage) => void;
  /** Called when an error occurs. */
  onError?: (error: Error) => void;
}

// ---------------------------------------------------------------------------
// NativePort class
// ---------------------------------------------------------------------------

/**
 * Manages a single native messaging port to the Electron host.
 *
 * Features:
 * - Automatic reconnection on disconnect
 * - Request-response correlation via requestId
 * - Timeout for pending requests
 */
export class NativePort {
  private port: chrome.runtime.Port | null = null;
  private readonly hostName: string;
  private readonly callbacks: ConnectionCallbacks;
  private readonly pendingRequests = new Map<
    string,
    { resolve: (value: AnyProtocolMessage) => void; reject: (reason: Error) => void; timer: ReturnType<typeof setTimeout> }
  >();
  private connected = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  /** Default request timeout in milliseconds. */
  private static readonly REQUEST_TIMEOUT_MS = 30_000;

  constructor(config: NativePortConfig, callbacks: ConnectionCallbacks = {}) {
    this.hostName = config.hostName;
    this.callbacks = callbacks;
  }

  /**
   * Connect to the native host.
   *
   * @throws Error if already connected.
   */
  connect(): void {
    if (this.connected) {
      throw new Error('Already connected to native host');
    }

    this.port = chrome.runtime.connectNative(this.hostName);
    this.connected = true;

    this.port.onMessage.addListener((message: unknown) => {
      this.handleMessage(message as AnyProtocolMessage);
    });

    this.port.onDisconnect.addListener(() => {
      this.connected = false;
      const error = chrome.runtime.lastError
        ? new Error(chrome.runtime.lastError.message)
        : undefined;

      // Reject all pending requests
      for (const [id, pending] of this.pendingRequests) {
        clearTimeout(pending.timer);
        pending.reject(
          new Error(error?.message ?? 'Native host disconnected'),
        );
      }
      this.pendingRequests.clear();

      this.callbacks.onDisconnect?.(error);

      // Auto-reconnect after a delay
      this.scheduleReconnect();
    });

    this.callbacks.onConnect?.();
  }

  /**
   * Disconnect from the native host.
   */
  disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.port) {
      this.port.disconnect();
      this.port = null;
      this.connected = false;
    }

    // Reject all pending requests
    for (const [id, pending] of this.pendingRequests) {
      clearTimeout(pending.timer);
      pending.reject(new Error('Disconnected by user'));
    }
    this.pendingRequests.clear();
  }

  /**
   * Check if the port is currently connected.
   */
  get isConnected(): boolean {
    return this.connected;
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
    if (!this.connected || !this.port) {
      throw new Error('Not connected to native host');
    }

    const requestId = 'requestId' in message ? (message.requestId as string) : undefined;

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (requestId) this.pendingRequests.delete(requestId);
        reject(new Error(`Request ${requestId ?? 'unknown'} timed out`));
      }, NativePort.REQUEST_TIMEOUT_MS);

      if (requestId) {
        this.pendingRequests.set(requestId, {
          resolve: resolve as (value: AnyProtocolMessage) => void,
          reject,
          timer,
        });
      }

      this.port!.postMessage(message);
    });
  }

  /**
   * Send a raw message without waiting for a response.
   *
   * @param message - The message to send.
   */
  sendMessage(message: AnyProtocolMessage): void {
    if (!this.connected || !this.port) {
      throw new Error('Not connected to native host');
    }

    this.port.postMessage(message);
  }

  // -------------------------------------------------------------------------
  // Internal
  // -------------------------------------------------------------------------

  private handleMessage(message: AnyProtocolMessage): void {
    // Check if this is a response to a pending request
    if ('requestId' in message) {
      const pending = this.pendingRequests.get(
        message.requestId as string,
      );
      if (pending) {
        clearTimeout(pending.timer);
        this.pendingRequests.delete(message.requestId as string);
        pending.resolve(message);
        return;
      }
    }

    // Not a correlated response — emit to general callback
    this.callbacks.onMessage?.(message);
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      try {
        this.connect();
      } catch {
        // Reconnect failed — will retry on next disconnect
      }
    }, 1000);
  }
}
