import { TOTP } from 'otpauth';
import type { TotpConfig } from '../../shared/types';
import type { TotpAlgorithm } from '../../shared/constants';
import { normalizeBase32Secret } from '../../shared/validation';

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
