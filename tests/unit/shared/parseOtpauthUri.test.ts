import { describe, it, expect } from 'vitest';
import {
  parseOtpauthUri,
  parsedToTotpConfig,
  type ParsedOtpauth,
} from '../../../src/renderer/utils/parseOtpauthUri';

describe('parseOtpauthUri', () => {
  it('parses a standard TOTP URI', () => {
    const uri =
      'otpauth://totp/Example:user@example.com?secret=JBSWY3DPEHPK3PXP&issuer=Example';
    const parsed = parseOtpauthUri(uri);
    expect(parsed).not.toBeNull();
    expect(parsed!.type).toBe('totp');
    expect(parsed!.label).toBe('Example');
    expect(parsed!.account).toBe('user@example.com');
    expect(parsed!.issuer).toBe('Example');
    expect(parsed!.secret).toBe('JBSWY3DPEHPK3PXP');
    expect(parsed!.algorithm).toBe('SHA1');
    expect(parsed!.digits).toBe(6);
    expect(parsed!.period).toBe(30);
  });

  it('parses a URI with all optional parameters', () => {
    const uri =
      'otpauth://totp/GitHub:user?secret=JBSWY3DPEHPK3PXP&algorithm=SHA256&digits=8&period=60';
    const parsed = parseOtpauthUri(uri);
    expect(parsed).not.toBeNull();
    expect(parsed!.algorithm).toBe('SHA256');
    expect(parsed!.digits).toBe(8);
    expect(parsed!.period).toBe(60);
  });

  it('falls back to defaults when optional params are missing', () => {
    const uri = 'otpauth://totp/Service?secret=JBSWY3DPEHPK3PXP';
    const parsed = parseOtpauthUri(uri);
    expect(parsed).not.toBeNull();
    expect(parsed!.algorithm).toBe('SHA1');
    expect(parsed!.digits).toBe(6);
    expect(parsed!.period).toBe(30);
  });

  it('uses label as issuer when issuer param is absent', () => {
    const uri = 'otpauth://totp/AcmeCorp:user?secret=JBSWY3DPEHPK3PXP';
    const parsed = parseOtpauthUri(uri);
    expect(parsed!.issuer).toBe('AcmeCorp');
  });

  it('parses HOTP URIs', () => {
    const uri =
      'otpauth://hotp/Example:user?secret=JBSWY3DPEHPK3PXP&counter=42';
    const parsed = parseOtpauthUri(uri);
    expect(parsed).not.toBeNull();
    expect(parsed!.type).toBe('hotp');
    expect(parsed!.counter).toBe(42);
  });

  it('returns null for non-otpauth URIs', () => {
    expect(parseOtpauthUri('https://example.com')).toBeNull();
    expect(parseOtpauthUri('mailto:test@example.com')).toBeNull();
  });

  it('returns null for missing secret', () => {
    const uri = 'otpauth://totp/Example:user?issuer=Example';
    expect(parseOtpauthUri(uri)).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(parseOtpauthUri('')).toBeNull();
  });

  it('returns null for non-string input', () => {
    expect(parseOtpauthUri(null as unknown as string)).toBeNull();
    expect(parseOtpauthUri(undefined as unknown as string)).toBeNull();
  });

  it('handles URI-encoded characters in label and account', () => {
    const uri =
      'otpauth://totp/My%20Service%3Ajohn%40doe.com?secret=JBSWY3DPEHPK3PXP';
    const parsed = parseOtpauthUri(uri);
    expect(parsed!.label).toBe('My Service');
    expect(parsed!.account).toBe('john@doe.com');
  });

  it('normalizes algorithm to uppercase', () => {
    const uri =
      'otpauth://totp/Test?secret=JBSWY3DPEHPK3PXP&algorithm=sha512';
    const parsed = parseOtpauthUri(uri);
    expect(parsed!.algorithm).toBe('SHA512');
  });
});

describe('parsedToTotpConfig', () => {
  it('converts parsed URI to TotpConfig with defaults', () => {
    const parsed: ParsedOtpauth = {
      type: 'totp',
      label: 'Test',
      account: 'user',
      issuer: 'Test',
      secret: 'JBSWY3DPEHPK3PXP',
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
    };
    const config = parsedToTotpConfig(parsed);
    expect(config.secret).toBe('JBSWY3DPEHPK3PXP');
    expect(config.algorithm).toBe('SHA1');
    expect(config.digits).toBe(6);
    expect(config.period).toBe(30);
  });

  it('clamps unsupported digits to 6', () => {
    const parsed: ParsedOtpauth = {
      type: 'totp',
      label: 'Test',
      account: 'user',
      issuer: 'Test',
      secret: 'JBSWY3DPEHPK3PXP',
      algorithm: 'SHA1',
      digits: 7,
      period: 30,
    };
    const config = parsedToTotpConfig(parsed);
    expect(config.digits).toBe(6);
  });

  it('allows digits of 8', () => {
    const parsed: ParsedOtpauth = {
      type: 'totp',
      label: 'Test',
      account: 'user',
      issuer: 'Test',
      secret: 'JBSWY3DPEHPK3PXP',
      algorithm: 'SHA1',
      digits: 8,
      period: 30,
    };
    const config = parsedToTotpConfig(parsed);
    expect(config.digits).toBe(8);
  });

  it('normalizes unsupported algorithm to SHA1', () => {
    const parsed: ParsedOtpauth = {
      type: 'totp',
      label: 'Test',
      account: 'user',
      issuer: 'Test',
      secret: 'JBSWY3DPEHPK3PXP',
      algorithm: 'MD5',
      digits: 6,
      period: 30,
    };
    const config = parsedToTotpConfig(parsed);
    expect(config.algorithm).toBe('SHA1');
  });
});
