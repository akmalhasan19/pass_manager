/**
 * clockDrift.ts
 *
 * Utility for detecting potential system clock drift.
 * TOTP codes rely on accurate system time — if the clock is significantly
 * out of sync, generated codes will not match the server's expected value.
 *
 * SECURITY NOTE:
 * - This utility does NOT make any network requests.
 * - It provides a best-effort heuristic by comparing the current time
 *   against a previous reference point stored in memory.
 * - A gentle warning is shown to the user; no code generation is blocked.
 *
 * PREREQUISITE:
 * OS time synchronization (NTP) is required for correct TOTP operation.
 * This module only detects large *relative* shifts during a session,
 * not absolute clock drift from NTP servers.
 */

/**
 * Maximum allowed clock change (in milliseconds) between checks
 * before a drift warning is issued.
 *
 * A shift of more than 30 seconds in either direction suggests the
 * system clock may have been manually adjusted or NTP sync is off.
 */
export const MAX_CLOCK_DRIFT_MS = 30_000;

/**
 * Interval (in milliseconds) between clock drift checks.
 * We check every 60 seconds to minimize overhead.
 */
export const CLOCK_DRIFT_CHECK_INTERVAL_MS = 60_000;

/**
 * Checks for system clock drift by comparing the current time against
 * a previous reference point.
 *
 * @param lastKnownTime - The last known reference time (in ms since epoch)
 * @returns The absolute drift in milliseconds, or 0 if this is the first check
 */
export function checkClockDrift(lastKnownTime: number | null): number {
  if (lastKnownTime === null) {
    return 0;
  }

  const now = Date.now();
  const elapsed = now - lastKnownTime;

  // We expect approximately CLOCK_DRIFT_CHECK_INTERVAL_MS to have elapsed.
  // If the difference is significantly larger or smaller, the clock may have shifted.
  const drift = Math.abs(elapsed - CLOCK_DRIFT_CHECK_INTERVAL_MS);

  return drift > MAX_CLOCK_DRIFT_MS ? drift : 0;
}

/**
 * Determines if a detected clock drift is severe enough to warrant a warning.
 *
 * TOTP codes are valid for a full `period` window (usually 30 seconds).
 * If the drift exceeds half the period, the code may be generated for
 * the wrong time window.
 *
 * @param driftMs - The absolute clock drift in milliseconds
 * @param totpPeriod - The TOTP period in seconds (default 30)
 * @returns true if the drift could cause incorrect TOTP generation
 */
export function isDriftConcerning(driftMs: number, totpPeriod: number = 30): boolean {
  // If drift is more than half a TOTP period, codes could be invalid
  return driftMs > (totpPeriod * 1000) / 2;
}