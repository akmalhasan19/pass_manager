import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  recordViolation,
  clearTabSuspicion,
  resetAllSuspicion,
  getSuspiciousTabs,
  getSuspicionStats,
} from '../src/shared/suspiciousActivity';

// ---------------------------------------------------------------------------
// recordViolation
// ---------------------------------------------------------------------------

describe('recordViolation', () => {
  beforeEach(() => {
    resetAllSuspicion();
  });

  it('should record a violation and return not suspicious initially', () => {
    const result = recordViolation(1);
    expect(result.tabId).toBe(1);
    expect(result.violationCount).toBe(1);
    expect(result.isSuspicious).toBe(false);
  });

  it('should become suspicious after threshold violations', () => {
    // Threshold is 3
    recordViolation(1);
    recordViolation(1);
    const result = recordViolation(1);

    expect(result.isSuspicious).toBe(true);
    expect(result.violationCount).toBe(3);
    expect(result.shouldAlert).toBe(true);
  });

  it('should track violations per tab independently', () => {
    recordViolation(1);
    recordViolation(1);
    recordViolation(1);

    const tab1Result = recordViolation(1);
    expect(tab1Result.isSuspicious).toBe(true);

    const tab2Result = recordViolation(2);
    expect(tab2Result.isSuspicious).toBe(false);
    expect(tab2Result.violationCount).toBe(1);
  });

  it('should handle undefined tabId as global (tabId=0)', () => {
    recordViolation(undefined);
    recordViolation(undefined);
    const result = recordViolation(undefined);

    expect(result.tabId).toBe(0);
    expect(result.isSuspicious).toBe(true);
  });

  it('should throttle alerts (not alert every time after threshold)', () => {
    // First 3 violations trigger alert
    recordViolation(1);
    recordViolation(1);
    const first = recordViolation(1);
    expect(first.shouldAlert).toBe(true);

    // Subsequent violations should not trigger alert (within alert cooldown)
    const second = recordViolation(1);
    expect(second.isSuspicious).toBe(true);
    expect(second.shouldAlert).toBe(false);
  });

  it('should respect cooldown period after clearing', () => {
    recordViolation(1);
    recordViolation(1);
    recordViolation(1);

    clearTabSuspicion(1);

    // After clearing, violations within cooldown period should not count
    const result = recordViolation(1);
    expect(result.isSuspicious).toBe(false);
    expect(result.violationCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// clearTabSuspicion
// ---------------------------------------------------------------------------

describe('clearTabSuspicion', () => {
  beforeEach(() => {
    resetAllSuspicion();
  });

  it('should clear violations for a specific tab', () => {
    recordViolation(1);
    recordViolation(1);
    recordViolation(1);

    clearTabSuspicion(1);

    const result = recordViolation(1);
    expect(result.violationCount).toBe(0);
    expect(result.isSuspicious).toBe(false);
  });

  it('should not affect other tabs', () => {
    recordViolation(1);
    recordViolation(1);
    recordViolation(1);

    clearTabSuspicion(1);

    // Tab 2 should still be unaffected
    const result = recordViolation(2);
    expect(result.violationCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// resetAllSuspicion
// ---------------------------------------------------------------------------

describe('resetAllSuspicion', () => {
  it('should clear all tab violations', () => {
    recordViolation(1);
    recordViolation(2);
    recordViolation(3);

    resetAllSuspicion();

    const stats = getSuspicionStats();
    expect(stats.monitoredTabs).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// getSuspiciousTabs
// ---------------------------------------------------------------------------

describe('getSuspiciousTabs', () => {
  beforeEach(() => {
    resetAllSuspicion();
  });

  it('should return empty array when no suspicious tabs', () => {
    recordViolation(1);
    recordViolation(1);
    const tabs = getSuspiciousTabs();
    expect(tabs).toEqual([]);
  });

  it('should return tab IDs that are suspicious', () => {
    recordViolation(1);
    recordViolation(1);
    recordViolation(1);

    recordViolation(2);
    recordViolation(2);

    const tabs = getSuspiciousTabs();
    expect(tabs).toContain(1);
    expect(tabs).not.toContain(2);
  });

  it('should not include cleared tabs', () => {
    recordViolation(1);
    recordViolation(1);
    recordViolation(1);

    clearTabSuspicion(1);

    const tabs = getSuspiciousTabs();
    expect(tabs).not.toContain(1);
  });
});

// ---------------------------------------------------------------------------
// getSuspicionStats
// ---------------------------------------------------------------------------

describe('getSuspicionStats', () => {
  beforeEach(() => {
    resetAllSuspicion();
  });

  it('should report zero monitored tabs when empty', () => {
    const stats = getSuspicionStats();
    expect(stats.monitoredTabs).toBe(0);
    expect(stats.suspiciousTabs).toBe('none');
  });

  it('should count monitored tabs', () => {
    recordViolation(1);
    recordViolation(2);
    recordViolation(3);

    const stats = getSuspicionStats();
    expect(stats.monitoredTabs).toBe(3);
  });

  it('should report suspicious tabs count', () => {
    recordViolation(1);
    recordViolation(1);
    recordViolation(1);

    recordViolation(2);
    recordViolation(2);

    const stats = getSuspicionStats();
    expect(stats.suspiciousTabs).toBe('1 tab(s)');
  });

  it('should report "none" when no tabs are suspicious', () => {
    recordViolation(1);
    recordViolation(1);

    const stats = getSuspicionStats();
    expect(stats.suspiciousTabs).toBe('none');
  });
});
