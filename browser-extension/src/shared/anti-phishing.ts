/**
 * Anti-Phishing Protection Module for SecurePass Manager Browser Extension.
 *
 * Provides domain matching, typo-squatting detection, and visual warning
 * indicators to protect users from phishing attacks.
 *
 * Detection strategies:
 * 1. **Exact Domain Match** — The requested domain must exactly match the
 *    stored domain (case-insensitive, www-normalized).
 * 2. **Known Typo-Squatting Patterns** — Detects common phishing techniques:
 *    - Homoglyph (look-alike) character substitution (e.g., paypa1 vs paypal)
 *    - Missing/modified characters in known domain names
 *    - Subdomain spoofing (e.g., paypal.com.example.com)
 *    - TLD switching (e.g., .com vs .net)
 * 3. **Levenshtein Distance** — For domains that are close to known domains,
 *    compute edit distance to detect typos.
 *
 * @module shared/anti-phishing
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Minimum edit distance threshold for typo detection.
 * Domains with distance 1-2 from a stored domain are flagged as suspicious.
 */
const TYPO_DISTANCE_THRESHOLD = 2;

/**
 * Maximum domain length for edit distance calculation.
 * Longer domains are not checked for performance reasons.
 */
const MAX_DOMAIN_LENGTH_FOR_TYPO_CHECK = 40;

/**
 * Set of known homoglyph character substitutions used in phishing attacks.
 * Maps look-alike characters to their legitimate counterparts.
 */
const HOMOGLYPH_MAP: Record<string, string> = {
  '0': 'o',
  '1': 'l',
  '2': 'z',
  '3': 'e',
  '4': 'a',
  '5': 's',
  '6': 'g',
  '7': 't',
  '8': 'b',
  '9': 'g',
  '|': 'l',
  '!': 'i',
  '@': 'a',
  '#': 'h',
  '$': 's',
  '%': '',
  '^': '',
  '&': '',
  '*': '',
  // Cyrillic look-alikes
  'а': 'a',
  'е': 'e',
  'о': 'o',
  'р': 'p',
  'с': 'c',
  'у': 'y',
  'х': 'x',
  'і': 'i',
};

// ---------------------------------------------------------------------------
// Domain comparison and matching
// ---------------------------------------------------------------------------

/**
 * Normalize a domain for comparison.
 * Removes www prefix, lowercases, and strips trailing dots.
 */
function normalizeDomain(domain: string): string {
  return domain
    .replace(/^www\./, '')
    .toLowerCase()
    .replace(/\.+$/, '')
    .trim();
}

/**
 * Extract the registrable domain (eTLD+1) from a hostname.
 * For example: "login.paypal.com" -> "paypal.com", "sub.example.co.uk" -> "example.co.uk"
 *
 * This is a simplified implementation. In production, use the Public Suffix List.
 */
function extractRegistrableDomain(hostname: string): string {
  const parts = hostname.split('.');
  if (parts.length <= 2) return hostname;

  // Known two-part TLDs (simplified list)
  const twoPartTlds = new Set([
    'co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'net.uk', 'nhs.uk',
    'com.au', 'net.au', 'org.au', 'gov.au', 'edu.au',
    'co.nz', 'net.nz', 'org.nz',
    'co.jp', 'ne.jp', 'or.jp',
    'com.br', 'org.br', 'net.br', 'gov.br',
    'com.cn', 'net.cn', 'org.cn', 'gov.cn',
  ]);

  // Check last 2 parts for two-part TLD
  const lastTwo = parts.slice(-2).join('.');
  if (twoPartTlds.has(lastTwo) && parts.length >= 3) {
    return parts.slice(-3).join('.');
  }

  // Default: return last 2 parts
  return parts.slice(-2).join('.');
}

/**
 * Strict domain match: check if two domains match after normalization.
 *
 * @param storedDomain - Domain from the vault item.
 * @param requestedDomain - Domain from the current page URL.
 * @returns True if the domains strictly match.
 */
export function isExactDomainMatch(
  storedDomain: string,
  requestedDomain: string,
): boolean {
  const normalizedStored = normalizeDomain(storedDomain);
  const normalizedRequested = normalizeDomain(requestedDomain);
  return normalizedStored === normalizedRequested;
}

/**
 * Check if the requested domain is a subdomain of the stored domain.
 * For example, "login.paypal.com" is a subdomain of "paypal.com".
 *
 * @param storedDomain - Domain from the vault item.
 * @param requestedDomain - Domain from the current page URL.
 * @returns True if requested is a subdomain of stored.
 */
export function isSubdomainMatch(
  storedDomain: string,
  requestedDomain: string,
): boolean {
  const normalizedStored = normalizeDomain(storedDomain);
  const normalizedRequested = normalizeDomain(requestedDomain);

  if (normalizedRequested === normalizedStored) return false;

  return (
    normalizedRequested.endsWith('.' + normalizedStored) ||
    normalizedRequested === normalizedStored
  );
}

// ---------------------------------------------------------------------------
// Typo-squatting detection
// ---------------------------------------------------------------------------

/**
 * Compute the Levenshtein edit distance between two strings.
 */
function levenshteinDistance(a: string, b: string): number {
  const aLen = a.length;
  const bLen = b.length;

  if (aLen === 0) return bLen;
  if (bLen === 0) return aLen;

  // Use a single row optimization for smaller memory
  let prevRow: number[] = [];
  let currRow: number[] = [];

  for (let j = 0; j <= bLen; j++) {
    prevRow[j] = j;
  }

  for (let i = 1; i <= aLen; i++) {
    currRow[0] = i;
    for (let j = 1; j <= bLen; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      currRow[j] = Math.min(
        prevRow[j] + 1,       // deletion
        currRow[j - 1] + 1,   // insertion
        prevRow[j - 1] + cost, // substitution
      );
    }
    [prevRow, currRow] = [currRow, prevRow];
  }

  return prevRow[bLen];
}

/**
 * Normalize homoglyph characters in a domain to detect look-alike attacks.
 * Converts characters to their legitimate ASCII equivalents.
 */
function normalizeHomoglyphs(input: string): string {
  let result = '';
  for (const char of input) {
    result += HOMOGLYPH_MAP[char] ?? char;
  }
  return result;
}

/**
 * Check if a requested domain is a potential typo-squatting attack against
 * a stored domain.
 *
 * @param storedDomain - The legitimate domain from the vault.
 * @param requestedDomain - The domain from the current page.
 * @returns An object describing the potential phishing risk.
 */
export function detectTypoSquatting(
  storedDomain: string,
  requestedDomain: string,
): { isSuspicious: boolean; reason: string; distance: number } {
  const stored = normalizeDomain(storedDomain);
  const requested = normalizeDomain(requestedDomain);

  if (stored === requested) {
    return { isSuspicious: false, reason: '', distance: 0 };
  }

  // Skip check for very long domains
  if (stored.length > MAX_DOMAIN_LENGTH_FOR_TYPO_CHECK) {
    return { isSuspicious: false, reason: '', distance: 0 };
  }

  // Check 1: Get registrable domain (eTLD+1) for comparison
  const storedRegistrable = extractRegistrableDomain(stored);
  const requestedRegistrable = extractRegistrableDomain(requested);

  // If registrable domains match, it's safe
  if (storedRegistrable === requestedRegistrable) {
    return { isSuspicious: false, reason: '', distance: 0 };
  }

  // Check 2: Homoglyph detection — normalize characters and compare
  const storedNormalized = normalizeHomoglyphs(stored);
  const requestedNormalized = normalizeHomoglyphs(requested);
  const homoglyphDistance = levenshteinDistance(storedNormalized, requestedNormalized);

  if (homoglyphDistance <= TYPO_DISTANCE_THRESHOLD && homoglyphDistance > 0) {
    return {
      isSuspicious: true,
      reason: `Domain looks similar to "${stored}" (homoglyph distance: ${homoglyphDistance})`,
      distance: homoglyphDistance,
    };
  }

  // Check 3: Levenshtein distance on original strings
  const distance = levenshteinDistance(stored, requested);
  if (distance <= TYPO_DISTANCE_THRESHOLD && distance > 0) {
    return {
      isSuspicious: true,
      reason: `Domain differs from "${stored}" by only ${distance} character(s)`,
      distance,
    };
  }

  // Check 4: Check if it's a subdomain of a known phishing pattern
  // e.g., "paypal.com.example.com" where "example.com" is the actual registrable domain
  if (!storedRegistrable.includes(requestedRegistrable) && 
      requested.includes(storedRegistrable) &&
      !requested.endsWith('.' + storedRegistrable)) {
    return {
      isSuspicious: true,
      reason: `Domain "${requested}" contains "${stored}" but is not a subdomain`,
      distance: -1,
    };
  }

  return { isSuspicious: false, reason: '', distance: 0 };
}

// ---------------------------------------------------------------------------
// Domain match result
// ---------------------------------------------------------------------------

/** Result of a domain match check between stored and requested domains. */
export interface DomainMatchResult {
  /** Whether the match is safe for autofill. */
  isSafe: boolean;
  /** The level of risk. */
  riskLevel: 'exact' | 'subdomain' | 'suspicious' | 'mismatch';
  /** Human-readable description of the match result. */
  description: string;
  /** Detailed reason if suspicious. */
  detail?: string;
}

/**
 * Compare a stored vault domain against a requested page domain
 * and determine if autofill is safe.
 *
 * @param storedDomain - Domain stored in the vault credential.
 * @param requestedDomain - Domain of the current web page.
 * @returns A DomainMatchResult describing the match quality.
 */
export function checkDomainMatch(
  storedDomain: string,
  requestedDomain: string,
): DomainMatchResult {
  // Normalize both domains
  const stored = normalizeDomain(storedDomain);
  const requested = normalizeDomain(requestedDomain);

  if (!stored || !requested) {
    return {
      isSafe: false,
      riskLevel: 'mismatch',
      description: 'Invalid domain',
    };
  }

  // 1. Exact match (including www-normalized)
  if (isExactDomainMatch(stored, requested)) {
    return {
      isSafe: true,
      riskLevel: 'exact',
      description: 'Domain matches exactly',
    };
  }

  // 2. Subdomain match
  if (isSubdomainMatch(stored, requested)) {
    return {
      isSafe: true,
      riskLevel: 'subdomain',
      description: `Subdomain of ${stored}`,
    };
  }

  // 3. Typo-squatting check
  const typoResult = detectTypoSquatting(stored, requested);
  if (typoResult.isSuspicious) {
    return {
      isSafe: false,
      riskLevel: 'suspicious',
      description: `Warning: ${typoResult.reason}`,
      detail: `Stored: ${stored}, Current: ${requested}`,
    };
  }

  // 4. Complete mismatch
  return {
    isSafe: false,
    riskLevel: 'mismatch',
    description: `Domain "${requested}" does not match stored domain "${stored}"`,
    detail: `Stored: ${stored}, Current: ${requested}`,
  };
}

// ---------------------------------------------------------------------------
// Known domain database (commonly phished domains)
// ---------------------------------------------------------------------------

/**
 * Commonly phished domains that we should be extra vigilant about.
 * These domains are frequently targeted by typo-squatting attacks.
 */
const COMMONLY_PHISHED_DOMAINS = new Set([
  'paypal.com',
  'google.com',
  'facebook.com',
  'instagram.com',
  'twitter.com',
  'x.com',
  'linkedin.com',
  'github.com',
  'gitlab.com',
  'apple.com',
  'icloud.com',
  'amazon.com',
  'amazon.co.uk',
  'netflix.com',
  'spotify.com',
  'dropbox.com',
  'microsoft.com',
  'outlook.com',
  'live.com',
  'yahoo.com',
  'bankofamerica.com',
  'wellsfargo.com',
  'chase.com',
  'capitalone.com',
  'hsbc.com',
  'barclays.com',
  'reddit.com',
  'whatsapp.com',
  'telegram.org',
  'proton.me',
  'protonmail.com',
  'mozilla.org',
  'adobe.com',
  'wordpress.com',
  'shopify.com',
  'stackoverflow.com',
]);

/**
 * Check if a stored domain is a commonly phished domain.
 * If so, we should apply extra scrutiny to domain matches.
 *
 * @param domain - The stored domain from the vault.
 * @returns True if this domain is commonly phished.
 */
export function isCommonlyPhishedDomain(domain: string): boolean {
  const normalized = normalizeDomain(domain);
  return COMMONLY_PHISHED_DOMAINS.has(normalized);
}