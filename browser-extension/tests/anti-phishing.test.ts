import { describe, it, expect, beforeEach } from 'vitest';
import {
  isExactDomainMatch,
  isSubdomainMatch,
  detectTypoSquatting,
  checkDomainMatch,
  isCommonlyPhishedDomain,
} from '../src/shared/anti-phishing';

// ---------------------------------------------------------------------------
// isExactDomainMatch
// ---------------------------------------------------------------------------

describe('isExactDomainMatch', () => {
  it('should match identical domains', () => {
    expect(isExactDomainMatch('paypal.com', 'paypal.com')).toBe(true);
  });

  it('should match case-insensitively', () => {
    expect(isExactDomainMatch('PayPal.com', 'paypal.com')).toBe(true);
    expect(isExactDomainMatch('GITHUB.COM', 'github.com')).toBe(true);
  });

  it('should strip www prefix before matching', () => {
    expect(isExactDomainMatch('www.paypal.com', 'paypal.com')).toBe(true);
    expect(isExactDomainMatch('paypal.com', 'www.paypal.com')).toBe(true);
    expect(isExactDomainMatch('www.github.com', 'www.github.com')).toBe(true);
  });

  it('should strip trailing dots', () => {
    expect(isExactDomainMatch('paypal.com.', 'paypal.com')).toBe(true);
    expect(isExactDomainMatch('paypal.com', 'paypal.com.')).toBe(true);
  });

  it('should not match different domains', () => {
    expect(isExactDomainMatch('paypal.com', 'paypa1.com')).toBe(false);
    expect(isExactDomainMatch('github.com', 'gitlab.com')).toBe(false);
  });

  it('should not match subdomains as exact', () => {
    expect(isExactDomainMatch('paypal.com', 'login.paypal.com')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isSubdomainMatch
// ---------------------------------------------------------------------------

describe('isSubdomainMatch', () => {
  it('should detect subdomain of stored domain', () => {
    expect(isSubdomainMatch('paypal.com', 'login.paypal.com')).toBe(true);
    expect(isSubdomainMatch('paypal.com', 'secure.login.paypal.com')).toBe(true);
  });

  it('should not match exact domain as subdomain', () => {
    expect(isSubdomainMatch('paypal.com', 'paypal.com')).toBe(false);
  });

  it('should not match www-normalized exact domain as subdomain', () => {
    // www.paypal.com normalizes to paypal.com, which is an exact match, not subdomain
    expect(isSubdomainMatch('paypal.com', 'www.paypal.com')).toBe(false);
  });

  it('should not match unrelated domains', () => {
    expect(isSubdomainMatch('paypal.com', 'login.github.com')).toBe(false);
  });

  it('should be case-insensitive', () => {
    expect(isSubdomainMatch('paypal.com', 'Login.PayPal.com')).toBe(true);
  });

  it('should strip www prefix before checking', () => {
    expect(isSubdomainMatch('paypal.com', 'www.login.paypal.com')).toBe(true);
  });

  it('should not match domain that merely contains the stored domain as a substring', () => {
    expect(isSubdomainMatch('pay.com', 'paypal.com')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// detectTypoSquatting
// ---------------------------------------------------------------------------

describe('detectTypoSquatting', () => {
  it('should return not suspicious for exact match', () => {
    const result = detectTypoSquatting('paypal.com', 'paypal.com');
    expect(result.isSuspicious).toBe(false);
    expect(result.distance).toBe(0);
  });

  it('should detect homoglyph attack (0 → o)', () => {
    const result = detectTypoSquatting('paypal.com', 'paypa1.com');
    expect(result.isSuspicious).toBe(true);
    // The homoglyph normalization maps '1'→'l', making normalized strings equal (distance 0),
    // so it falls through to regular Levenshtein which catches it as a typo with distance 1
    expect(result.reason).toContain('differs from');
  });

  it('should detect Cyrillic homoglyph attack', () => {
    // Cyrillic 'а' (U+0430) looks like Latin 'a'
    const result = detectTypoSquatting('apple.com', 'аpple.com');
    // Homoglyph normalization maps Cyrillic 'а'→'a', making strings equal → not flagged as homoglyph
    // But Levenshtein on original strings catches the difference
    expect(result.isSuspicious).toBe(true);
  });

  it('should detect single character substitution (Levenshtein distance 1)', () => {
    const result = detectTypoSquatting('github.com', 'githib.com');
    expect(result.isSuspicious).toBe(true);
    expect(result.distance).toBe(1);
  });

  it('should detect close variant (Levenshtein distance 1)', () => {
    // github.com → githup.com: 'b' → 'p' is distance 1
    const result = detectTypoSquatting('github.com', 'githup.com');
    expect(result.isSuspicious).toBe(true);
    expect(result.distance).toBe(1);
  });

  it('should not flag domains with distance > 2', () => {
    const result = detectTypoSquatting('paypal.com', 'amazon.com');
    expect(result.isSuspicious).toBe(false);
  });

  it('should not flag domains with same registrable domain', () => {
    const result = detectTypoSquatting('paypal.com', 'login.paypal.com');
    expect(result.isSuspicious).toBe(false);
  });

  it('should skip check for very long domains', () => {
    const longDomain = 'a'.repeat(50) + '.com';
    const result = detectTypoSquatting(longDomain, longDomain.slice(1));
    expect(result.isSuspicious).toBe(false);
  });

  it('should detect subdomain spoofing pattern', () => {
    const result = detectTypoSquatting('paypal.com', 'paypal.com.example.com');
    expect(result.isSuspicious).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// checkDomainMatch
// ---------------------------------------------------------------------------

describe('checkDomainMatch', () => {
  it('should return exact match for identical domains', () => {
    const result = checkDomainMatch('github.com', 'github.com');
    expect(result.isSafe).toBe(true);
    expect(result.riskLevel).toBe('exact');
  });

  it('should return exact match with www normalization', () => {
    const result = checkDomainMatch('www.github.com', 'github.com');
    expect(result.isSafe).toBe(true);
    expect(result.riskLevel).toBe('exact');
  });

  it('should return subdomain match', () => {
    const result = checkDomainMatch('github.com', 'login.github.com');
    expect(result.isSafe).toBe(true);
    expect(result.riskLevel).toBe('subdomain');
    expect(result.description).toContain('Subdomain');
  });

  it('should return suspicious for typo-squatting', () => {
    const result = checkDomainMatch('paypal.com', 'paypa1.com');
    expect(result.isSafe).toBe(false);
    expect(result.riskLevel).toBe('suspicious');
  });

  it('should return mismatch for completely different domains', () => {
    const result = checkDomainMatch('github.com', 'evil.com');
    expect(result.isSafe).toBe(false);
    expect(result.riskLevel).toBe('mismatch');
  });

  it('should return mismatch for empty domains', () => {
    const result = checkDomainMatch('', 'github.com');
    expect(result.isSafe).toBe(false);
    expect(result.riskLevel).toBe('mismatch');

    const result2 = checkDomainMatch('github.com', '');
    expect(result2.isSafe).toBe(false);
    expect(result2.riskLevel).toBe('mismatch');
  });

  it('should be case-insensitive', () => {
    const result = checkDomainMatch('GitHub.COM', 'github.com');
    expect(result.isSafe).toBe(true);
    expect(result.riskLevel).toBe('exact');
  });

  it('should handle trailing dots', () => {
    const result = checkDomainMatch('github.com.', 'github.com');
    expect(result.isSafe).toBe(true);
    expect(result.riskLevel).toBe('exact');
  });
});

// ---------------------------------------------------------------------------
// isCommonlyPhishedDomain
// ---------------------------------------------------------------------------

describe('isCommonlyPhishedDomain', () => {
  it('should return true for known phished domains', () => {
    expect(isCommonlyPhishedDomain('paypal.com')).toBe(true);
    expect(isCommonlyPhishedDomain('google.com')).toBe(true);
    expect(isCommonlyPhishedDomain('facebook.com')).toBe(true);
    expect(isCommonlyPhishedDomain('github.com')).toBe(true);
    expect(isCommonlyPhishedDomain('apple.com')).toBe(true);
    expect(isCommonlyPhishedDomain('amazon.com')).toBe(true);
    expect(isCommonlyPhishedDomain('netflix.com')).toBe(true);
    expect(isCommonlyPhishedDomain('microsoft.com')).toBe(true);
  });

  it('should be case-insensitive', () => {
    expect(isCommonlyPhishedDomain('PayPal.COM')).toBe(true);
    expect(isCommonlyPhishedDomain('GITHUB.COM')).toBe(true);
  });

  it('should strip www prefix', () => {
    expect(isCommonlyPhishedDomain('www.paypal.com')).toBe(true);
    expect(isCommonlyPhishedDomain('www.github.com')).toBe(true);
  });

  it('should return false for unknown domains', () => {
    expect(isCommonlyPhishedDomain('my-random-site.org')).toBe(false);
    expect(isCommonlyPhishedDomain('totally-not-phishing.net')).toBe(false);
  });
});
