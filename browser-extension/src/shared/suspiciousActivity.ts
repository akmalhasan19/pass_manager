const SUSPICIOUS_THRESHOLD = 3;
const SUSPICION_WINDOW_MS = 60_000;
const COOLDOWN_MS = 300_000;
const ALERT_COOLDOWN_MS = 120_000;

interface TabActivity {
  violations: number[];
  firstViolationAt: number;
  lastAlertAt: number;
  clearedAt: number;
}

const tabActivity = new Map<number, TabActivity>();

export interface SuspicionResult {
  isSuspicious: boolean;
  violationCount: number;
  shouldAlert: boolean;
  tabId: number;
}

export function recordViolation(tabId: number | undefined): SuspicionResult {
  const id = tabId ?? 0;
  const now = Date.now();

  let activity = tabActivity.get(id);
  if (!activity) {
    activity = {
      violations: [],
      firstViolationAt: now,
      lastAlertAt: 0,
      clearedAt: 0,
    };
    tabActivity.set(id, activity);
  }

  if (now - activity.clearedAt < COOLDOWN_MS) {
    return {
      isSuspicious: false,
      violationCount: 0,
      shouldAlert: false,
      tabId: id,
    };
  }

  const cutoff = now - SUSPICION_WINDOW_MS;
  activity.violations = activity.violations.filter((t) => t > cutoff);
  activity.violations.push(now);

  const violationCount = activity.violations.length;
  const isSuspicious = violationCount >= SUSPICIOUS_THRESHOLD;

  const shouldAlert =
    isSuspicious && now - activity.lastAlertAt > ALERT_COOLDOWN_MS;

  if (shouldAlert) {
    activity.lastAlertAt = now;
  }

  return { isSuspicious, violationCount, shouldAlert, tabId: id };
}

export function clearTabSuspicion(tabId: number): void {
  const activity = tabActivity.get(tabId);
  if (activity) {
    activity.clearedAt = Date.now();
    activity.violations = [];
  }
}

export function resetAllSuspicion(): void {
  tabActivity.clear();
}

export function getSuspiciousTabs(): number[] {
  const now = Date.now();
  const result: number[] = [];
  for (const [tabId, activity] of tabActivity) {
    if (now - activity.clearedAt >= COOLDOWN_MS && activity.violations.length >= SUSPICIOUS_THRESHOLD) {
      result.push(tabId);
    }
  }
  return result;
}

export function getSuspicionStats(): {
  monitoredTabs: number;
  suspiciousTabs: string;
} {
  const now = Date.now();
  let suspiciousCount = 0;
  for (const [, activity] of tabActivity) {
    if (now - activity.clearedAt >= COOLDOWN_MS && activity.violations.length >= SUSPICIOUS_THRESHOLD) {
      suspiciousCount++;
    }
  }
  return {
    monitoredTabs: tabActivity.size,
    suspiciousTabs: suspiciousCount > 0 ? `${suspiciousCount} tab(s)` : 'none',
  };
}
