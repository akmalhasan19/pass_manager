import { TOTP } from 'otpauth';
import type { TotpConfig } from '../../shared/types';
import type { TotpAlgorithm } from '../../shared/constants';
import { normalizeBase32Secret } from '../../shared/validation';
import {
  checkClockDrift,
  isDriftConcerning,
  CLOCK_DRIFT_CHECK_INTERVAL_MS,
} from '../../shared/clockDrift';

/**
 * Normalizes the secret using the shared Base32 sanitizer, then
 * generates a TOTP code via the otpauth library.
 *
 * The secret is normalized to guard against issues with whitespace,
 * casing, missing padding, or visual separators that may have been
 * introduced during manual entry or import.
 */
export function generateTOTP(secret: string, config: TotpConfig): string {
  const normalized = normalizeBase32Secret(secret);
  const totp = new TOTP({
    secret: normalized,
    digits: config.digits,
    period: config.period,
    algorithm: config.algorithm as TotpAlgorithm,
  });

  return totp.generate();
}

export function getRemainingSeconds(config: TotpConfig): number {
  const period = config.period;
  const epoch = Math.floor(Date.now() / 1000);
  return period - (epoch % period);
}

/**
 * Generates the current TOTP code and returns it together with the
 * number of seconds remaining before the next code refresh.
 *
 * The secret is normalized before being passed to the OTP library.
 */
export function getNextTOTP(
  secret: string,
  config: TotpConfig,
): { code: string; nextInSeconds: number } {
  const normalized = normalizeBase32Secret(secret);
  const totp = new TOTP({
    secret: normalized,
    digits: config.digits,
    period: config.period,
    algorithm: config.algorithm as TotpAlgorithm,
  });

  const code = totp.generate();
  const remaining = getRemainingSeconds(config);

  return { code, nextInSeconds: remaining };
}

// ─── Clock Drift Detection ──────────────────────────────────────────────────
//
// TOTP codes depend on the system clock being reasonably accurate. These
// functions detect large, unexpected shifts in the system clock during a
// session and warn the user.
//
// PREREQUISITE:
// OS time synchronization (NTP) must be enabled for correct TOTP operation.
// This module does NOT make network requests — it only monitors relative
// clock changes within the current process lifetime.

let lastCheckTime: number | null = null;

/**
 * Resets the clock drift tracker. Should be called when the vault is
 * locked or switched to prevent stale reference points.
 */
export function resetClockDriftTracker(): void {
  lastCheckTime = null;
}

/**
 * Checks for system clock drift since the last call.
 *
 * @returns An object indicating whether a concerning drift was detected.
 *   - `driftDetected`: true if the clock shifted by more than half a TOTP period
 *   - `driftMs`: The absolute detected drift in milliseconds (0 if none)
 *   - `period`: The TOTP period used for the concern threshold
 */
export function detectClockDrift(totpPeriod: number = 30): {
  driftDetected: boolean;
  driftMs: number;
  period: number;
} {
  const driftMs = checkClockDrift(lastCheckTime);

  // Update reference point for next check
  lastCheckTime = Date.now();

  if (driftMs > 0 && isDriftConcerning(driftMs, totpPeriod)) {
    return { driftDetected: true, driftMs, period: totpPeriod };
  }

  return { driftDetected: false, driftMs: 0, period: totpPeriod };
}

/**
 * Returns the interval (in ms) at which clock drift checks should be performed.
 */
export function getDriftCheckInterval(): number {
  return CLOCK_DRIFT_CHECK_INTERVAL_MS;
}
