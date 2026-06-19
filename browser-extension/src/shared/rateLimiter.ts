export interface RateLimitConfig {
  maxRequests: number;
  windowMs: number;
}

type RateLimitKey = string;

interface WindowState {
  timestamps: number[];
}

const windows = new Map<RateLimitKey, WindowState>();

const WINDOW_CLEANUP_INTERVAL_MS = 60_000;

let cleanupTimer: ReturnType<typeof setInterval> | null = null;

function startCleanupInterval(): void {
  if (cleanupTimer) return;
  cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [key, state] of windows) {
      const cutoff = now - 60_000;
      state.timestamps = state.timestamps.filter((t) => t > cutoff);
      if (state.timestamps.length === 0) {
        windows.delete(key);
      }
    }
  }, WINDOW_CLEANUP_INTERVAL_MS);
}

function buildKey(tabId: number | undefined, type: string): RateLimitKey {
  return tabId ? `${tabId}:${type}` : `global:${type}`;
}

export function checkRateLimit(
  tabId: number | undefined,
  type: string,
  config: RateLimitConfig,
): boolean {
  startCleanupInterval();

  const key = buildKey(tabId, type);
  let state = windows.get(key);
  if (!state) {
    state = { timestamps: [] };
    windows.set(key, state);
  }

  const now = Date.now();
  const windowStart = now - config.windowMs;

  state.timestamps = state.timestamps.filter((t) => t > windowStart);

  if (state.timestamps.length >= config.maxRequests) {
    return false;
  }

  state.timestamps.push(now);
  return true;
}

export function getRateLimitStatus(
  tabId: number | undefined,
  type: string,
  config: RateLimitConfig,
): { allowed: number; remaining: number; resetAt: number } {
  const key = buildKey(tabId, type);
  const state = windows.get(key);
  const now = Date.now();
  const windowStart = now - config.windowMs;

  const timestamps = state
    ? state.timestamps.filter((t) => t > windowStart)
    : [];

  const remaining = Math.max(0, config.maxRequests - timestamps.length);
  const oldestInWindow = timestamps.length > 0 ? Math.min(...timestamps) : now;
  const resetAt = oldestInWindow + config.windowMs;

  return {
    allowed: config.maxRequests,
    remaining,
    resetAt,
  };
}

export function resetRateLimit(tabId: number | undefined, type: string): void {
  const key = buildKey(tabId, type);
  windows.delete(key);
}

export function resetAllRateLimits(): void {
  windows.clear();
}

export function getRateLimitStats(): { activeWindows: number } {
  return { activeWindows: windows.size };
}
