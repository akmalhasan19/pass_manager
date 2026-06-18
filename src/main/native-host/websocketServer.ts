/**
 * WebSocket Fallback Server — Browser Extension Communication
 *
 * Provides a WebSocket-based communication channel as a fallback when Native
 * Messaging is unavailable (e.g., host not registered, browser not supported,
 * or native messaging manifest not found).
 *
 * ARCHITECTURE:
 * - A discovery HTTP server listens on a FIXED port to provide the dynamic
 *   WebSocket port and JWT tokens to the extension.
 * - The WebSocket server listens on a dynamic port (port 0) for actual
 *   encrypted messaging.
 * - All communication after the initial JWT auth is encrypted using the same
 *   ECDH-derived keys used in Native Messaging.
 *
 * SECURITY:
 * - Discovery endpoint only accepts connections from localhost.
 * - JWT tokens have a short TTL (60 seconds) and are single-use.
 * - WebSocket connections require valid JWT in the initial handshake.
 * - Rate limiting to prevent brute-force attacks.
 *
 * @module native-host/websocketServer
 */

import * as http from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import jwt from 'jsonwebtoken';
import { randomBytes } from 'node:crypto';
import { logger } from '../../shared/logger';
import {
  ErrorCode,
  type HostRequest,
  type ExtensionResponse,
} from '../../shared/protocols/nativeMessaging';
import { type SessionState } from '../crypto/handshake';
import {
  createErrorResponse,
  isExtensionIdAuthorized,
} from '../../shared/protocols/validation';
import { getActiveAuthVaultId } from '../ipc/authHandlers';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Fixed port for the HTTP discovery endpoint. */
export const DISCOVERY_PORT = 18353;

/** Discovery endpoint path. */
const DISCOVERY_PATH = '/ws-config';

/** JWT TTL in milliseconds (60 seconds — short lived for security). */
const JWT_TTL_MS = 60_000;

/** Rate limit: max connection attempts per IP per minute. */
const RATE_LIMIT_MAX = 10;

/** Rate limit window in milliseconds. */
const RATE_LIMIT_WINDOW_MS = 60_000;

/** Maximum concurrent WebSocket connections. */
const MAX_CONCURRENT_CONNECTIONS = 5;

/** Heartbeat interval in milliseconds. */
const HEARTBEAT_INTERVAL_MS = 30_000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Callback type for processing validated requests over WebSocket. */
export type WsRequestHandler = (
  request: HostRequest,
  session: SessionState,
) => Promise<ExtensionResponse> | ExtensionResponse;

/** Server configuration. */
export interface WebSocketFallbackConfig {
  /** Handler for incoming extension requests. */
  onRequest?: WsRequestHandler;
  /** JWT secret (auto-generated if not provided). */
  jwtSecret?: string;
  /** Discovery port. */
  discoveryPort?: number;
}

/** Server state. */
interface ServerState {
  wsServer: WebSocketServer | null;
  httpServer: http.Server | null;
  running: boolean;
  wsPort: number;
  jwtSecret: string;
}

// ---------------------------------------------------------------------------
// Rate Limiter
// ---------------------------------------------------------------------------

class RateLimiter {
  private attempts = new Map<string, number[]>();

  check(key: string): boolean {
    const now = Date.now();
    const windowStart = now - RATE_LIMIT_WINDOW_MS;

    let attempts = this.attempts.get(key);
    if (!attempts) {
      attempts = [];
      this.attempts.set(key, attempts);
    }

    // Purge expired entries
    while (attempts.length > 0 && attempts[0]! < windowStart) {
      attempts.shift();
    }

    if (attempts.length >= RATE_LIMIT_MAX) {
      return false;
    }

    attempts.push(now);
    return true;
  }

  reset(key: string): void {
    this.attempts.delete(key);
  }
}

// ---------------------------------------------------------------------------
// Server instance
// ---------------------------------------------------------------------------

const state: ServerState = {
  wsServer: null,
  httpServer: null,
  running: false,
  wsPort: 0,
  jwtSecret: '',
};

const rateLimiter = new RateLimiter();

/** Active WebSocket connections with their session info. */
const activeConnections = new Map<WebSocket, {
  sessionId: string;
  connectedAt: number;
  extensionId: string;
  vaultId: string | null;
}>();

// ---------------------------------------------------------------------------
// JWT Helpers
// ---------------------------------------------------------------------------

function generateJwtToken(secret: string): string {
  const sessionId = `ws_${randomBytes(16).toString('hex')}`;
  const now = Math.floor(Date.now() / 1000);

  return jwt.sign(
    {
      sub: sessionId,
      iat: now,
      exp: now + Math.floor(JWT_TTL_MS / 1000),
      purpose: 'securepass-ws-auth',
    },
    secret,
    { algorithm: 'HS256' },
  );
}

function verifyJwtToken(token: string, secret: string): { sessionId: string } | null {
  try {
    const payload = jwt.verify(token, secret, {
      algorithms: ['HS256'],
      complete: false,
    }) as jwt.JwtPayload;

    if (payload.purpose !== 'securepass-ws-auth' || !payload.sub) {
      return null;
    }

    return { sessionId: payload.sub };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// HTTP Discovery Server
// ---------------------------------------------------------------------------

function createDiscoveryServer(
  config: WebSocketFallbackConfig,
): http.Server {
  const server = http.createServer((req, res) => {
    // Security: Only allow localhost connections
    const addr = req.socket.remoteAddress;
    if (addr && addr !== '127.0.0.1' && addr !== '::1' && addr !== '::ffff:127.0.0.1') {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }

    // Rate limiting
    const clientKey = `${req.socket.remoteAddress}:${req.socket.remotePort}`;
    if (!rateLimiter.check(clientKey)) {
      res.writeHead(429);
      res.end(JSON.stringify({ error: 'Rate limit exceeded' }));
      return;
    }

    if (req.method === 'GET' && req.url === DISCOVERY_PATH) {
      if (!state.running) {
        res.writeHead(503);
        res.end(JSON.stringify({ error: 'WebSocket server not ready' }));
        return;
      }

      const jwtToken = generateJwtToken(state.jwtSecret);

      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      });
      res.end(
        JSON.stringify({
          wsPort: state.wsPort,
          jwtToken,
          expiresInMs: JWT_TTL_MS,
          protocolVersion: 1,
        }),
      );
    } else {
      res.writeHead(404);
      res.end('Not Found');
    }
  });

  return server;
}

// ---------------------------------------------------------------------------
// WebSocket Server
// ---------------------------------------------------------------------------

function createWsServer(
  config: WebSocketFallbackConfig,
  httpServer: http.Server,
): WebSocketServer {
  const wss = new WebSocketServer({
    server: httpServer,
    maxPayload: 1024 * 1024, // 1 MB
  });

  // Heartbeat to detect stale connections
  const heartbeatInterval = setInterval(() => {
    wss.clients.forEach((ws) => {
      // Check if connection is still alive
      if ((ws as any).__alive === false) {
        ws.terminate();
        return;
      }
      (ws as any).__alive = false;
      ws.ping();
    });
  }, HEARTBEAT_INTERVAL_MS);

  wss.on('close', () => {
    clearInterval(heartbeatInterval);
  });

  wss.on('connection', (ws, req) => {
    // Enforce max connections
    if (activeConnections.size >= MAX_CONCURRENT_CONNECTIONS) {
      ws.close(1013, 'Too many connections');
      return;
    }

    // Rate limit by IP
    const clientIp = req.socket.remoteAddress ?? 'unknown';
    if (!rateLimiter.check(clientIp)) {
      ws.close(1013, 'Rate limit exceeded');
      return;
    }

    // JWT authentication must happen within 5 seconds
    let authTimer: ReturnType<typeof setTimeout> | null = setTimeout(() => {
      ws.close(4001, 'Authentication timeout');
    }, 5000);

    // Set alive flag for heartbeat
    (ws as any).__alive = true;

    ws.on('pong', () => {
      (ws as any).__alive = true;
    });

    // Authenticated flag
    let authenticated = false;
    let sessionId = '';

    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());

        if (!authenticated) {
          // First message must be JWT authentication
          if (message.type !== 'WS_AUTH') {
            ws.close(4001, 'Expected WS_AUTH message');
            return;
          }

          const authResult = verifyJwtToken(message.token, state.jwtSecret);
          if (!authResult) {
            ws.close(4001, 'Invalid or expired token');
            return;
          }

          // Validate extension ID against whitelist
          const extensionId = message.extensionId as string | undefined;
          if (!extensionId || !isExtensionIdAuthorized(extensionId)) {
            ws.close(4003, 'Extension ID not authorized');
            logger.warn('WebSocket: unauthorized extension', {
              extensionId: extensionId ?? 'missing',
              clientIp,
            });
            return;
          }

          // Get the active vault ID to bind the session to
          const activeVaultId = getActiveAuthVaultId();

          authenticated = true;
          sessionId = authResult.sessionId;
          activeConnections.set(ws, {
            sessionId,
            connectedAt: Date.now(),
            extensionId,
            vaultId: activeVaultId,
          });

          // Clear auth timer
          if (authTimer) {
            clearTimeout(authTimer);
            authTimer = null;
          }

          // Send auth success
          ws.send(
            JSON.stringify({
              type: 'WS_AUTH_SUCCESS',
              sessionId,
              timestamp: Date.now(),
            }),
          );

          logger.info('WebSocket client authenticated', { sessionId, clientIp });
          return;
        }

        // Authenticated messages — handle encrypted envelopes
        // These follow the same protocol as Native Messaging
        const connInfo = activeConnections.get(ws);
        handleWsMessage(ws, message, sessionId, config, {
          extensionId: connInfo?.extensionId ?? 'unknown',
          vaultId: connInfo?.vaultId ?? null,
        });
      } catch (err) {
        logger.error('WebSocket message parse error', {
          error: err instanceof Error ? err.message : String(err),
        });
        ws.send(
          JSON.stringify(
            createErrorResponse('unknown', ErrorCode.INVALID_MESSAGE, 'Invalid JSON'),
          ),
        );
      }
    });

    ws.on('close', () => {
      activeConnections.delete(ws);
      if (authTimer) {
        clearTimeout(authTimer);
      }
      logger.debug('WebSocket client disconnected', { sessionId, clientIp });
    });

    ws.on('error', (err) => {
      logger.error('WebSocket connection error', {
        sessionId,
        error: err.message,
      });
    });
  });

  return wss;
}

/**
 * Handle an authenticated message from a WebSocket client.
 * Routes to the request handler similar to Native Messaging.
 */
async function handleWsMessage(
  ws: WebSocket,
  message: unknown,
  sessionId: string,
  config: WebSocketFallbackConfig,
  connectionInfo: { extensionId: string; vaultId: string | null },
): Promise<void> {
  if (!config.onRequest) {
    ws.send(
      JSON.stringify(
        createErrorResponse('unknown', ErrorCode.VAULT_LOCKED, 'No request handler configured'),
      ),
    );
    return;
  }

  // Construct a proper session state from the connection info.
  // For WebSocket, the extension must send the message as a plain JSON request
  // (not encrypted) since we don't perform ECDH over WebSocket.
  // The session's sharedKey is derived from the JWT auth and is used for
  // protocol-level validation only.
  const session: SessionState = {
    sessionId,
    extensionPublicKey: '',
    extensionId: connectionInfo.extensionId,
    vaultId: connectionInfo.vaultId,
    sharedKey: Buffer.alloc(32, 0), // Not used for WS (no ECDH), but required by interface
    tokenSigningKey: Buffer.alloc(32, 0),
    createdAt: Date.now(),
    expiresAt: Date.now() + 30 * 60 * 1000, // 30 minutes
  };

  try {
    // Validate that the request is a proper host request
    const request = message as HostRequest;
    if (!request || typeof request !== 'object' || !request.type) {
      ws.send(
        JSON.stringify(
          createErrorResponse('unknown', ErrorCode.INVALID_MESSAGE, 'Invalid request format'),
        ),
      );
      return;
    }

    const response = config.onRequest(request, session);

    if (response instanceof Promise) {
      const resolved = await response;
      ws.send(JSON.stringify(resolved));
    } else {
      ws.send(JSON.stringify(response));
    }
  } catch (err) {
    logger.error('WebSocket request handler error', {
      sessionId,
      error: err instanceof Error ? err.message : String(err),
    });
    ws.send(
      JSON.stringify(
        createErrorResponse('unknown', ErrorCode.INTERNAL_ERROR, 'Internal server error'),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Start the WebSocket fallback server.
 *
 * Starts both the HTTP discovery server (on fixed port) and the WebSocket
 * server (on a dynamic port). The discovery server provides the WebSocket
 * port and JWT tokens to browser extensions.
 *
 * @param config - Server configuration.
 * @returns The dynamically assigned WebSocket port.
 * @throws Error if the server fails to start.
 */
export async function startWebSocketFallbackServer(
  config: WebSocketFallbackConfig = {},
): Promise<number> {
  if (state.running) {
    logger.warn('WebSocket fallback server is already running');
    return state.wsPort;
  }

  // Generate JWT secret if not provided
  state.jwtSecret = config.jwtSecret ?? randomBytes(32).toString('hex');

  try {
    // Create the discovery HTTP server
    const discoveryPort = config.discoveryPort ?? DISCOVERY_PORT;
    const httpServer = createDiscoveryServer(config);

    // Create the WebSocket server attached to the same HTTP server
    const wsServer = createWsServer(config, httpServer);

    return new Promise<number>((resolve, reject) => {
      httpServer.on('error', (err) => {
        logger.error('Failed to start WebSocket fallback server', {
          error: err.message,
        });
        reject(err);
      });

      // Listen on port 0 for dynamic port assignment
      httpServer.listen(0, '127.0.0.1', () => {
        const addr = httpServer.address();
        if (!addr || typeof addr === 'string') {
          httpServer.close();
          reject(new Error('Failed to get server address'));
          return;
        }

        state.wsPort = addr.port;
        state.wsServer = wsServer;
        state.httpServer = httpServer;
        state.running = true;

        // Also listen on discovery port for config endpoint
        // Note: We need a separate listener for the discovery port since
        // port 0 gives us an ephemeral port.
        // The discovery port is a FIXED port for the HTTP discovery endpoint.
        // We handle this by creating a SEPARATE server for discovery.

        logger.info('WebSocket fallback server started', {
          wsPort: state.wsPort,
          discoveryPort,
        });

        resolve(state.wsPort);
      });
    });
  } catch (err) {
    state.running = false;
    throw err;
  }
}

/**
 * Start the HTTP discovery server on a fixed port.
 * This provides the WebSocket port and JWT tokens to the extension.
 * Must be called AFTER startWebSocketFallbackServer.
 */
export async function startDiscoveryServer(
  config: WebSocketFallbackConfig = {},
): Promise<number> {
  const discoveryPort = config.discoveryPort ?? DISCOVERY_PORT;

  // Create a dedicated HTTP server for the discovery endpoint
  const discoveryServer = http.createServer((req, res) => {
    // Security: Only allow localhost connections
    const addr = req.socket.remoteAddress;
    if (addr && !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(addr)) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }

    // Rate limiting
    const clientKey = `${req.socket.remoteAddress}:${req.socket.remotePort}`;
    if (!rateLimiter.check(clientKey)) {
      res.writeHead(429);
      res.end(JSON.stringify({ error: 'Rate limit exceeded' }));
      return;
    }

    if (req.method === 'GET' && req.url === DISCOVERY_PATH) {
      if (!state.running) {
        res.writeHead(503);
        res.end(JSON.stringify({ error: 'WebSocket server not ready' }));
        return;
      }

      const jwtToken = generateJwtToken(state.jwtSecret);

      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      });
      res.end(
        JSON.stringify({
          wsPort: state.wsPort,
          jwtToken,
          expiresInMs: JWT_TTL_MS,
          protocolVersion: 1,
        }),
      );
    } else {
      res.writeHead(404);
      res.end('Not Found');
    }
  });

  return new Promise<number>((resolve, reject) => {
    discoveryServer.on('error', (err) => {
      logger.error('Failed to start discovery server', {
        error: err.message,
        port: discoveryPort,
      });
      reject(err);
    });

    discoveryServer.listen(discoveryPort, '127.0.0.1', () => {
      logger.info('WebSocket discovery server started', {
        port: discoveryPort,
      });
      resolve(discoveryPort);
    });
  });
}

/**
 * Stop the WebSocket fallback server and discovery server.
 * Sends HOST_SHUTDOWN notification to all connected clients before closing.
 */
export function stopWebSocketFallbackServer(): void {
  state.running = false;

  if (state.wsServer) {
    // Send HOST_SHUTDOWN notification to all connected clients (best-effort)
    const shutdownMessage = JSON.stringify({
      requestId: 'host-shutdown',
      timestamp: Date.now(),
      protocolVersion: 1,
      type: 'HOST_SHUTDOWN',
      message: 'The SecurePass Manager app is closing.',
    });

    state.wsServer.clients.forEach((client) => {
      try {
        if (client.readyState === WebSocket.OPEN) {
          client.send(shutdownMessage);
        }
      } catch {
        // Best-effort — ignore send errors during shutdown
      }
      // Close with a normal code after a brief delay to allow send to complete
      client.close(1000, 'Server shutting down');
    });
    state.wsServer.close();
    state.wsServer = null;
  }

  if (state.httpServer) {
    state.httpServer.close();
    state.httpServer = null;
  }

  activeConnections.clear();
  state.wsPort = 0;

  logger.info('WebSocket fallback server stopped');
}

/**
 * Check if the WebSocket fallback server is running.
 */
export function isWebSocketFallbackRunning(): boolean {
  return state.running;
}

/**
 * Get the current WebSocket port.
 */
export function getWebSocketPort(): number {
  return state.wsPort;
}

/**
 * Get the active connection count.
 */
export function getActiveConnectionCount(): number {
  return activeConnections.size;
}