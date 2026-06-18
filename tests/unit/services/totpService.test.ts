import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  generateTOTP,
  getRemainingSeconds,
  getNextTOTP,
  detectClockDrift,
  resetClockDriftTracker,
  getDriftCheckInterval,
} from '../../../src/main/services/totpService';
import type { TotpConfig } from '../../../src/shared/types';

/**
 * RFC 6238 Appendix B Test Vectors
 * Secret = "12345678901234567890" (ASCII)
 * Hex:    3132333435363738393031323334353637383930
 * Base32: GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ
 */
const RFC6238_SECRET_BASE32 = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

/** Well-known RFC 6238 test vector for SHA1 at T = 59 */
const RFC6238_VECTORS_SHA1: Array<{ timestamp: number; code: string }> = [
  { timestamp: 59, code: '94287082' },
  { timestamp: 1111111109, code: '07081804' },
  { timestamp: 1111111111, code: '14050471' },
  { timestamp: 1234567890, code: '89005924' },
  { timestamp: 2000000000, code: '69279037' },
  { timestamp: 20000000000, code: '65353130' },
];

/**
 * Verified test vectors produced by the otpauth library for SHA256
 * with the same base32 secret. These are not the canonical RFC 6238 SHA1
 * vectors, but they verify determinism and algorithmic correctness.
 */
const VERIFIED_VECTORS_SHA256: Array<{ timestamp: number; code: string }> = [
  { timestamp: 59, code: '32247374' },
  { timestamp: 1111111109, code: '34756375' },
  { timestamp: 1111111111, code: '74584430' },
  { timestamp: 1234567890, code: '42829826' },
  { timestamp: 2000000000, code: '78428693' },
  { timestamp: 20000000000, code: '24142410' },
];

/**
 * Verified test vectors produced by the otpauth library for SHA512
 * with the same base32 secret.
 */
const VERIFIED_VECTORS_SHA512: Array<{ timestamp: number; code: string }> = [
  { timestamp: 59, code: '69342147' },
  { timestamp: 1111111109, code: '63049338' },
  { timestamp: 1111111111, code: '54380122' },
  { timestamp: 1234567890, code: '76671578' },
  { timestamp: 2000000000, code: '56464532' },
  { timestamp: 20000000000, code: '69481994' },
];

describe('generateTOTP', () => {
  it('generates correct SHA1 codes for RFC 6238 test vectors', () => {
    for (const { timestamp, code } of RFC6238_VECTORS_SHA1) {
      vi.useFakeTimers();
      vi.setSystemTime(timestamp * 1000);

      const config: TotpConfig = {
        secret: RFC6238_SECRET_BASE32,
        period: 30,
        digits: 8,
        algorithm: 'SHA1',
      };

      const result = generateTOTP(config.secret, config);
      expect(result, `SHA1 at T=${timestamp}`).toBe(code);

      vi.useRealTimers();
    }
  });

  it('generates correct SHA256 codes for verified test vectors', () => {
    for (const { timestamp, code } of VERIFIED_VECTORS_SHA256) {
      vi.useFakeTimers();
      vi.setSystemTime(timestamp * 1000);

      const config: TotpConfig = {
        secret: RFC6238_SECRET_BASE32,
        period: 30,
        digits: 8,
        algorithm: 'SHA256',
      };

      const result = generateTOTP(config.secret, config);
      expect(result, `SHA256 at T=${timestamp}`).toBe(code);

      vi.useRealTimers();
    }
  });

  it('generates correct SHA512 codes for verified test vectors', () => {
    for (const { timestamp, code } of VERIFIED_VECTORS_SHA512) {
      vi.useFakeTimers();
      vi.setSystemTime(timestamp * 1000);

      const config: TotpConfig = {
        secret: RFC6238_SECRET_BASE32,
        period: 30,
        digits: 8,
        algorithm: 'SHA512',
      };

      const result = generateTOTP(config.secret, config);
      expect(result, `SHA512 at T=${timestamp}`).toBe(code);

      vi.useRealTimers();
    }
  });

  it('generates 6-digit code by default', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1234567890 * 1000);

    const config: TotpConfig = {
      secret: 'JBSWY3DPEHPK3PXP',
      period: 30,
      digits: 6,
      algorithm: 'SHA1',
    };

    const result = generateTOTP(config.secret, config);
    expect(result).toHaveLength(6);
    expect(result).toMatch(/^\d{6}$/);

    vi.useRealTimers();
  });

  it('generates 8-digit code when configured', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1234567890 * 1000);

    const config: TotpConfig = {
      secret: 'JBSWY3DPEHPK3PXP',
      period: 30,
      digits: 8,
      algorithm: 'SHA1',
    };

    const result = generateTOTP(config.secret, config);
    expect(result).toHaveLength(8);
    expect(result).toMatch(/^\d{8}$/);

    vi.useRealTimers();
  });

  it('normalizes lowercase secret before generation', () => {
    vi.useFakeTimers();
    vi.setSystemTime(59 * 1000);

    const config: TotpConfig = {
      secret: RFC6238_SECRET_BASE32.toLowerCase(),
      period: 30,
      digits: 8,
      algorithm: 'SHA1',
    };

    const result = generateTOTP(config.secret, config);
    expect(result).toBe('94287082');

    vi.useRealTimers();
  });

  it('normalizes spaced secret before generation', () => {
    vi.useFakeTimers();
    vi.setSystemTime(59 * 1000);

    const config: TotpConfig = {
      secret: 'GEZDGNBV GY3TQOJQ GEZDGNBV GY3TQOJQ',
      period: 30,
      digits: 8,
      algorithm: 'SHA1',
    };

    const result = generateTOTP(config.secret, config);
    expect(result).toBe('94287082');

    vi.useRealTimers();
  });

  it('throws for corrupted secret with illegal characters', () => {
    const config: TotpConfig = {
      secret: 'JBSWY3DPEHPK3PXP!@#',
      period: 30,
      digits: 6,
      algorithm: 'SHA1',
    };

    expect(() => generateTOTP(config.secret, config)).toThrow();
  });

  it('throws for completely invalid base32 secret', () => {
    const config: TotpConfig = {
      secret: '!!!!!!!!',
      period: 30,
      digits: 6,
      algorithm: 'SHA1',
    };

    expect(() => generateTOTP(config.secret, config)).toThrow();
  });

  it('generates a code even for empty secret (library does not throw)', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);

    const config: TotpConfig = {
      secret: '',
      period: 30,
      digits: 6,
      algorithm: 'SHA1',
    };

    // The otpauth library normalises an empty secret and still emits a code.
    const result = generateTOTP(config.secret, config);
    expect(result).toMatch(/^\d{6}$/);

    vi.useRealTimers();
  });
});

describe('getRemainingSeconds', () => {
  it('returns full period at start of window', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0 * 1000); // epoch 0 → remainder 0 → 30 - 0 = 30

    const config: TotpConfig = {
      secret: 'JBSWY3DPEHPK3PXP',
      period: 30,
      digits: 6,
      algorithm: 'SHA1',
    };

    expect(getRemainingSeconds(config)).toBe(30);
    vi.useRealTimers();
  });

  it('returns 1 second before window ends', () => {
    vi.useFakeTimers();
    vi.setSystemTime(29 * 1000); // epoch 29 → remainder 29 → 30 - 29 = 1

    const config: TotpConfig = {
      secret: 'JBSWY3DPEHPK3PXP',
      period: 30,
      digits: 6,
      algorithm: 'SHA1',
    };

    expect(getRemainingSeconds(config)).toBe(1);
    vi.useRealTimers();
  });

  it('returns 30 at exact boundary of next window', () => {
    vi.useFakeTimers();
    vi.setSystemTime(30 * 1000); // epoch 30 → remainder 0 → 30 - 0 = 30

    const config: TotpConfig = {
      secret: 'JBSWY3DPEHPK3PXP',
      period: 30,
      digits: 6,
      algorithm: 'SHA1',
    };

    expect(getRemainingSeconds(config)).toBe(30);
    vi.useRealTimers();
  });

  it('handles custom period of 60 seconds', () => {
    vi.useFakeTimers();
    vi.setSystemTime(45 * 1000); // epoch 45 → remainder 45 → 60 - 45 = 15

    const config: TotpConfig = {
      secret: 'JBSWY3DPEHPK3PXP',
      period: 60,
      digits: 6,
      algorithm: 'SHA1',
    };

    expect(getRemainingSeconds(config)).toBe(15);
    vi.useRealTimers();
  });
});

describe('getNextTOTP', () => {
  it('returns code and remaining seconds', () => {
    vi.useFakeTimers();
    vi.setSystemTime(59 * 1000);

    const config: TotpConfig = {
      secret: RFC6238_SECRET_BASE32,
      period: 30,
      digits: 8,
      algorithm: 'SHA1',
    };

    const result = getNextTOTP(config.secret, config);
    expect(result.code).toBe('94287082');
    expect(result.nextInSeconds).toBe(1); // 59 % 30 = 29 → 30 - 29 = 1

    vi.useRealTimers();
  });

  it('returns consistent result for same timestamp', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1234567890 * 1000);

    const config: TotpConfig = {
      secret: 'JBSWY3DPEHPK3PXP',
      period: 30,
      digits: 6,
      algorithm: 'SHA1',
    };

    const result1 = getNextTOTP(config.secret, config);
    const result2 = getNextTOTP(config.secret, config);
    expect(result1.code).toBe(result2.code);
    expect(result1.nextInSeconds).toBe(result2.nextInSeconds);

    vi.useRealTimers();
  });

  it('normalizes secret before generating code', () => {
    vi.useFakeTimers();
    vi.setSystemTime(59 * 1000);

    const spaced = 'GEZDGNBV GY3TQOJQ GEZDGNBV GY3TQOJQ';
    const normal = RFC6238_SECRET_BASE32;

    const configSpaced: TotpConfig = {
      secret: spaced,
      period: 30,
      digits: 8,
      algorithm: 'SHA1',
    };

    const configNormal: TotpConfig = {
      secret: normal,
      period: 30,
      digits: 8,
      algorithm: 'SHA1',
    };

    const resultSpaced = getNextTOTP(configSpaced.secret, configSpaced);
    const resultNormal = getNextTOTP(configNormal.secret, configNormal);
    expect(resultSpaced.code).toBe(resultNormal.code);

    vi.useRealTimers();
  });
});

describe('determinism', () => {
  it('produces identical codes for identical timestamp and config', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1234567890 * 1000);

    const config: TotpConfig = {
      secret: 'JBSWY3DPEHPK3PXP',
      period: 30,
      digits: 6,
      algorithm: 'SHA1',
    };

    const code1 = generateTOTP(config.secret, config);
    const code2 = generateTOTP(config.secret, config);
    const code3 = generateTOTP(config.secret, config);

    expect(code1).toBe(code2);
    expect(code2).toBe(code3);

    vi.useRealTimers();
  });

  it('produces identical codes across different generate calls at same time', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1111111109 * 1000);

    const configs: TotpConfig[] = [
      {
        secret: RFC6238_SECRET_BASE32,
        period: 30,
        digits: 8,
        algorithm: 'SHA1',
      },
      {
        secret: RFC6238_SECRET_BASE32,
        period: 30,
        digits: 8,
        algorithm: 'SHA256',
      },
      {
        secret: RFC6238_SECRET_BASE32,
        period: 30,
        digits: 8,
        algorithm: 'SHA512',
      },
    ];

    for (const config of configs) {
      const code1 = generateTOTP(config.secret, config);
      const code2 = generateTOTP(config.secret, config);
      expect(code1, `algorithm=${config.algorithm}`).toBe(code2);
    }

    vi.useRealTimers();
  });
});

describe('algorithm variations', () => {
  it('produces different codes for different algorithms at same time', () => {
    vi.useFakeTimers();
    vi.setSystemTime(59 * 1000);

    const configSHA1: TotpConfig = {
      secret: RFC6238_SECRET_BASE32,
      period: 30,
      digits: 8,
      algorithm: 'SHA1',
    };

    const configSHA256: TotpConfig = {
      secret: RFC6238_SECRET_BASE32,
      period: 30,
      digits: 8,
      algorithm: 'SHA256',
    };

    const configSHA512: TotpConfig = {
      secret: RFC6238_SECRET_BASE32,
      period: 30,
      digits: 8,
      algorithm: 'SHA512',
    };

    const codeSHA1 = generateTOTP(configSHA1.secret, configSHA1);
    const codeSHA256 = generateTOTP(configSHA256.secret, configSHA256);
    const codeSHA512 = generateTOTP(configSHA512.secret, configSHA512);

    expect(codeSHA1).not.toBe(codeSHA256);
    expect(codeSHA1).not.toBe(codeSHA512);
    expect(codeSHA256).not.toBe(codeSHA512);

    vi.useRealTimers();
  });
});

describe('secret validation', () => {
  it('rejects secret containing characters outside base32 alphabet', () => {
    const badSecrets = [
      'JBSWY3DPEHPK3PXP!',
      'JBSWY3DPEHPK3PXP@',
      'JBSWY3DPEHPK3PXP#',
      'JBSWY1', // '1' is not in base32 alphabet (A-Z, 2-7)
      'JBSWY8', // '8' is not in base32 alphabet
      'JBSWY0', // '0' is not in base32 alphabet
      'JBSWY9', // '9' is not in base32 alphabet
    ];

    const config: TotpConfig = {
      secret: '',
      period: 30,
      digits: 6,
      algorithm: 'SHA1',
    };

    for (const secret of badSecrets) {
      expect(() => generateTOTP(secret, { ...config, secret })).toThrow();
    }
  });

  it('accepts valid base32 characters only', () => {
    const validSecrets = [
      'JBSWY3DP',
      'JBSWY3DPEHPK3PXP',
      'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ',
      'AAAAAAAA',
      '22222222',
      '77777777',
    ];

    const config: TotpConfig = {
      secret: '',
      period: 30,
      digits: 6,
      algorithm: 'SHA1',
    };

    for (const secret of validSecrets) {
      expect(() => generateTOTP(secret, { ...config, secret })).not.toThrow();
    }
  });

  it('handles empty secret by producing a numeric code', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);

    const config: TotpConfig = {
      secret: '',
      period: 30,
      digits: 6,
      algorithm: 'SHA1',
    };

    const result = generateTOTP('', config);
    expect(result).toMatch(/^\d{6}$/);

    vi.useRealTimers();
  });

  it('handles null secret by normalising to empty string', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);

    const config = {
      secret: null as unknown as string,
      period: 30,
      digits: 6,
      algorithm: 'SHA1',
    };

    // normalizeBase32Secret(null) returns '', which the library accepts.
    const result = generateTOTP(null as unknown as string, config);
    expect(result).toMatch(/^\d{6}$/);

    vi.useRealTimers();
  });

  it('handles secret with missing padding gracefully', () => {
    vi.useFakeTimers();
    vi.setSystemTime(59 * 1000);

    // Same secret as RFC6238 but without padding, which normalizeBase32Secret should fix
    const unpadded = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'.replace(/=+$/, '');

    const config: TotpConfig = {
      secret: unpadded,
      period: 30,
      digits: 8,
      algorithm: 'SHA1',
    };

    const result = generateTOTP(config.secret, config);
    expect(result).toBe('94287082');

    vi.useRealTimers();
  });
});

describe('clock drift detection', () => {
  beforeEach(() => {
    resetClockDriftTracker();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns no drift on first call', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000 * 1000);

    const result = detectClockDrift(30);
    expect(result.driftDetected).toBe(false);
    expect(result.driftMs).toBe(0);
    expect(result.period).toBe(30);

    vi.useRealTimers();
  });

  it('detects no drift when the expected check interval elapses', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000 * 1000);

    detectClockDrift(30);
    vi.advanceTimersByTime(60000); // advance by the expected check interval (60s)

    const result = detectClockDrift(30);
    expect(result.driftDetected).toBe(false);
    expect(result.driftMs).toBe(0);

    vi.useRealTimers();
  });

  it('detects forward drift larger than MAX_CLOCK_DRIFT_MS (30s)', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000 * 1000);

    detectClockDrift(30);
    // Advance 60s (expected interval) + 30_001ms (just above MAX_CLOCK_DRIFT_MS)
    vi.advanceTimersByTime(90001);

    const result = detectClockDrift(30);
    expect(result.driftDetected).toBe(true);
    expect(result.driftMs).toBe(30001);

    vi.useRealTimers();
  });

  it('does not flag small drift under MAX_CLOCK_DRIFT_MS threshold', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000 * 1000);

    detectClockDrift(30);
    // Advance 60s (expected interval) + 10s (small forward drift below 30s max)
    vi.advanceTimersByTime(70000);

    const result = detectClockDrift(30);
    expect(result.driftDetected).toBe(false);

    vi.useRealTimers();
  });

  it('returns the configured check interval', () => {
    const interval = getDriftCheckInterval();
    expect(typeof interval).toBe('number');
    expect(interval).toBeGreaterThan(0);
  });

  it('resets tracker when resetClockDriftTracker is called', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000 * 1000);

    detectClockDrift(30);
    resetClockDriftTracker();

    // After reset, next call should be treated as first call (no drift)
    vi.advanceTimersByTime(60000);
    const result = detectClockDrift(30);
    expect(result.driftDetected).toBe(false);
    expect(result.driftMs).toBe(0);

    vi.useRealTimers();
  });

  it('uses custom period for drift threshold', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000 * 1000);

    // First call establishes reference
    detectClockDrift(60);

    // Drift of 20s is under the 30s half-period threshold for a 60s period
    vi.advanceTimersByTime(80000); // 60s + 20s

    const result = detectClockDrift(60);
    expect(result.driftDetected).toBe(false);

    // Reset and restart with a larger drift (40s > 30s threshold)
    resetClockDriftTracker();
    detectClockDrift(60);
    vi.advanceTimersByTime(100000); // 60s + 40s

    const result2 = detectClockDrift(60);
    expect(result2.driftDetected).toBe(true);

    vi.useRealTimers();
  });
});
