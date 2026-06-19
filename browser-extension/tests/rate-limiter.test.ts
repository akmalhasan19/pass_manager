import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  checkRateLimit,
  getRateLimitStatus,
  resetRateLimit,
  resetAllRateLimits,
  getRateLimitStats,
  type RateLimitConfig,
} from '../src/shared/rateLimiter';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG: RateLimitConfig = {
  maxRequests: 5,
  windowMs: 1000,
};

// ---------------------------------------------------------------------------
// checkRateLimit
// ---------------------------------------------------------------------------

describe('checkRateLimit', () => {
  beforeEach(() => {
    resetAllRateLimits();
  });

  it('should allow requests within the limit', () => {
    for (let i = 0; i < 5; i++) {
      expect(checkRateLimit(1, 'GET_CREDENTIALS', DEFAULT_CONFIG)).toBe(true);
    }
  });

  it('should reject requests over the limit', () => {
    for (let i = 0; i < 5; i++) {
      checkRateLimit(1, 'GET_CREDENTIALS', DEFAULT_CONFIG);
    }
    expect(checkRateLimit(1, 'GET_CREDENTIALS', DEFAULT_CONFIG)).toBe(false);
  });

  it('should track requests per tab independently', () => {
    // Tab 1 uses all its quota
    for (let i = 0; i < 5; i++) {
      checkRateLimit(1, 'GET_CREDENTIALS', DEFAULT_CONFIG);
    }
    // Tab 1 is blocked
    expect(checkRateLimit(1, 'GET_CREDENTIALS', DEFAULT_CONFIG)).toBe(false);
    // Tab 2 still allowed
    expect(checkRateLimit(2, 'GET_CREDENTIALS', DEFAULT_CONFIG)).toBe(true);
  });

  it('should track requests per type independently', () => {
    // Use all quota for GET_CREDENTIALS
    for (let i = 0; i < 5; i++) {
      checkRateLimit(1, 'GET_CREDENTIALS', DEFAULT_CONFIG);
    }
    // GET_CREDENTIALS blocked
    expect(checkRateLimit(1, 'GET_CREDENTIALS', DEFAULT_CONFIG)).toBe(false);
    // COPY_TO_CLIPBOARD still allowed
    expect(checkRateLimit(1, 'COPY_TO_CLIPBOARD', DEFAULT_CONFIG)).toBe(true);
  });

  it('should handle undefined tabId as global', () => {
    for (let i = 0; i < 5; i++) {
      checkRateLimit(undefined, 'GET_CREDENTIALS', DEFAULT_CONFIG);
    }
    expect(checkRateLimit(undefined, 'GET_CREDENTIALS', DEFAULT_CONFIG)).toBe(false);
  });

  it('should allow requests after window expires', async () => {
    const config: RateLimitConfig = { maxRequests: 2, windowMs: 50 };
    checkRateLimit(1, 'TEST', config);
    checkRateLimit(1, 'TEST', config);
    expect(checkRateLimit(1, 'TEST', config)).toBe(false);

    // Wait for window to expire
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(checkRateLimit(1, 'TEST', config)).toBe(true);
  });

  it('should handle edge case of maxRequests=1', () => {
    const config: RateLimitConfig = { maxRequests: 1, windowMs: 1000 };
    expect(checkRateLimit(1, 'TEST', config)).toBe(true);
    expect(checkRateLimit(1, 'TEST', config)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// getRateLimitStatus
// ---------------------------------------------------------------------------

describe('getRateLimitStatus', () => {
  beforeEach(() => {
    resetAllRateLimits();
  });

  it('should report full quota when no requests made', () => {
    const status = getRateLimitStatus(1, 'TEST', DEFAULT_CONFIG);
    expect(status.allowed).toBe(5);
    expect(status.remaining).toBe(5);
    expect(status.resetAt).toBeGreaterThan(0);
  });

  it('should decrement remaining as requests are made', () => {
    checkRateLimit(1, 'TEST', DEFAULT_CONFIG);
    const status = getRateLimitStatus(1, 'TEST', DEFAULT_CONFIG);
    expect(status.remaining).toBe(4);
  });

  it('should report zero remaining when at limit', () => {
    for (let i = 0; i < 5; i++) {
      checkRateLimit(1, 'TEST', DEFAULT_CONFIG);
    }
    const status = getRateLimitStatus(1, 'TEST', DEFAULT_CONFIG);
    expect(status.remaining).toBe(0);
  });

  it('should track per-tab status independently', () => {
    checkRateLimit(1, 'TEST', DEFAULT_CONFIG);
    checkRateLimit(1, 'TEST', DEFAULT_CONFIG);

    const tab1Status = getRateLimitStatus(1, 'TEST', DEFAULT_CONFIG);
    const tab2Status = getRateLimitStatus(2, 'TEST', DEFAULT_CONFIG);

    expect(tab1Status.remaining).toBe(3);
    expect(tab2Status.remaining).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// resetRateLimit
// ---------------------------------------------------------------------------

describe('resetRateLimit', () => {
  beforeEach(() => {
    resetAllRateLimits();
  });

  it('should reset a specific tab/type rate limit', () => {
    for (let i = 0; i < 5; i++) {
      checkRateLimit(1, 'TEST', DEFAULT_CONFIG);
    }
    expect(checkRateLimit(1, 'TEST', DEFAULT_CONFIG)).toBe(false);

    resetRateLimit(1, 'TEST');
    expect(checkRateLimit(1, 'TEST', DEFAULT_CONFIG)).toBe(true);
  });

  it('should not affect other tabs when resetting one tab', () => {
    for (let i = 0; i < 5; i++) {
      checkRateLimit(1, 'TEST', DEFAULT_CONFIG);
      checkRateLimit(2, 'TEST', DEFAULT_CONFIG);
    }

    resetRateLimit(1, 'TEST');

    expect(checkRateLimit(1, 'TEST', DEFAULT_CONFIG)).toBe(true);
    expect(checkRateLimit(2, 'TEST', DEFAULT_CONFIG)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// resetAllRateLimits
// ---------------------------------------------------------------------------

describe('resetAllRateLimits', () => {
  it('should clear all rate limit windows', () => {
    checkRateLimit(1, 'TEST', DEFAULT_CONFIG);
    checkRateLimit(2, 'TEST', DEFAULT_CONFIG);

    resetAllRateLimits();

    expect(checkRateLimit(1, 'TEST', DEFAULT_CONFIG)).toBe(true);
    expect(checkRateLimit(2, 'TEST', DEFAULT_CONFIG)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// getRateLimitStats
// ---------------------------------------------------------------------------

describe('getRateLimitStats', () => {
  beforeEach(() => {
    resetAllRateLimits();
  });

  it('should report zero active windows when empty', () => {
    const stats = getRateLimitStats();
    expect(stats.activeWindows).toBe(0);
  });

  it('should report correct number of active windows', () => {
    checkRateLimit(1, 'TYPE_A', DEFAULT_CONFIG);
    checkRateLimit(2, 'TYPE_A', DEFAULT_CONFIG);
    checkRateLimit(1, 'TYPE_B', DEFAULT_CONFIG);

    const stats = getRateLimitStats();
    expect(stats.activeWindows).toBe(3);
  });
});
