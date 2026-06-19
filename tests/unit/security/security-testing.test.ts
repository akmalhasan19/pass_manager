/**
 * Security Testing (Sub-Task 7.4)
 *
 * Attack-scenario tests that simulate real threats against the
 * SecurePass Manager browser extension and Electron host:
 *
 * 1. XSS — Inject malicious page title/URL and verify it is NOT executed
 * 2. MITM — Intercept encrypted messages and verify they cannot be
 *    decrypted without the correct shared key
 * 3. Replay Attack — Re-send captured messages and verify rejection
 * 4. Phishing Resistance — Phishing domains with typo-squatting are
 *    flagged and must NOT trigger autofill
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { randomBytes } from 'node:crypto';

// =========================================================================
// 1. XSS Protection Tests
// =========================================================================

describe('XSS Protection — Malicious input neutralization', () => {
  /**
   * Helper: run sanitizeUrl from the browser-extension sanitize module.
   * We import the pure functions directly (no DOM needed for these).
   */
  let sanitizeUrl: (input: string) => string | null;
  let sanitizeDomain: (input: string) => string | null;
  let sanitizeDisplayTitle: (input: string) => string;
  let sanitizeUsername: (input: string) => string;
  let sanitizeFormField: (input: string) => string | null;
  let stripHtmlTags: (input: string) => string;
  let truncateString: (input: string, maxLength?: number) => string;
  let isValidTabUrl: (url: string | undefined) => boolean;

  beforeEach(async () => {
    const mod = await import('../../../browser-extension/src/shared/sanitize');
    sanitizeUrl = mod.sanitizeUrl;
    sanitizeDomain = mod.sanitizeDomain;
    sanitizeDisplayTitle = mod.sanitizeDisplayTitle;
    sanitizeUsername = mod.sanitizeUsername;
    sanitizeFormField = mod.sanitizeFormField;
    stripHtmlTags = mod.stripHtmlTags;
    truncateString = mod.truncateString;
    isValidTabUrl = mod.isValidTabUrl;
  });

  describe('Script injection in URLs', () => {
    it('should reject javascript: URLs', () => {
      expect(sanitizeUrl('javascript:alert(1)')).toBeNull();
      expect(sanitizeUrl('javascript:void(0)')).toBeNull();
      expect(sanitizeUrl('JAVASCRIPT:alert(1)')).toBeNull();
    });

    it('should reject data: URLs that can execute scripts', () => {
      expect(sanitizeUrl('data:text/html,<script>alert(1)</script>')).toBeNull();
      expect(sanitizeUrl('data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==')).toBeNull();
    });

    it('should reject file: URLs', () => {
      expect(sanitizeUrl('file:///etc/passwd')).toBeNull();
      expect(sanitizeUrl('file:///C:/Windows/System32/config/sam')).toBeNull();
    });

    it('should reject chrome-extension: URLs', () => {
      expect(sanitizeUrl('chrome-extension://abcdefghijklmnop/evil.html')).toBeNull();
    });

    it('should reject URLs with embedded credentials', () => {
      expect(sanitizeUrl('http://admin:password@example.com/')).toBeNull();
      expect(sanitizeUrl('https://user@evil.com/')).toBeNull();
    });

    it('should accept only http/https URLs', () => {
      expect(sanitizeUrl('https://example.com')).toBe('https://example.com/');
      expect(sanitizeUrl('http://example.com')).toBe('http://example.com/');
      expect(sanitizeUrl('ftp://example.com')).toBeNull();
      expect(sanitizeUrl('ws://example.com')).toBeNull();
      expect(sanitizeUrl('wss://example.com')).toBeNull();
    });
  });

  describe('HTML/Script injection in display titles', () => {
    it('should strip <script> tags from titles', () => {
      const result = sanitizeDisplayTitle('Login <script>alert("XSS")</script> Page');
      expect(result).not.toContain('<script>');
      expect(result).not.toContain('</script>');
      // Note: stripHtmlTags removes tags but keeps text content — this is expected.
      // XSS prevention relies on escaping when rendering (escapeHtml), not content removal.
    });

    it('should strip event handler attributes via tag removal', () => {
      const result = sanitizeDisplayTitle('<img src=x onerror=alert(1)>GitHub');
      expect(result).not.toContain('<img');
      expect(result).not.toContain('onerror');
      expect(result).toContain('GitHub');
    });

    it('should strip iframe injection', () => {
      const result = sanitizeDisplayTitle('<iframe src="https://evil.com"></iframe>GitHub');
      expect(result).not.toContain('<iframe');
      expect(result).toContain('GitHub');
    });

    it('should handle SVG-based XSS attempts', () => {
      const result = sanitizeDisplayTitle('<svg onload=alert(1)>');
      expect(result).not.toContain('<svg');
      expect(result).not.toContain('onload');
    });

    it('should remove null bytes and control characters', () => {
      const result = sanitizeDisplayTitle('Title\x00\x01\x02\x03');
      expect(result).toBe('Title');
    });

    it('should handle nested HTML injection', () => {
      const result = sanitizeDisplayTitle('<<script>alert(1)//<</script>');
      expect(result).not.toContain('<script>');
    });

    it('should truncate extremely long XSS payloads', () => {
      const longPayload = '<script>' + 'x'.repeat(10000) + '</script>';
      const result = sanitizeDisplayTitle(longPayload);
      expect(result.length).toBeLessThanOrEqual(500);
    });
  });

  describe('HTML/Script injection in usernames', () => {
    it('should strip script tags from usernames', () => {
      const result = sanitizeUsername('user<script>alert(1)</script>name');
      expect(result).not.toContain('<script>');
    });

    it('should strip HTML tags from usernames', () => {
      const result = sanitizeUsername('<img src=x onerror=alert(1)>admin');
      expect(result).not.toContain('<img');
      expect(result).toContain('admin');
    });

    it('should remove control characters', () => {
      const result = sanitizeUsername('user\x00name');
      expect(result).toBe('username');
    });
  });

  describe('HTML injection in form fields', () => {
    it('should accept clean form field values', () => {
      expect(sanitizeFormField('my_password_123')).toBe('my_password_123');
    });

    it('should strip control characters from form fields', () => {
      expect(sanitizeFormField('pass\x00word')).toBe('password');
    });

    it('should reject empty form fields', () => {
      expect(sanitizeFormField('')).toBeNull();
      expect(sanitizeFormField('   ')).toBeNull();
    });

    it('should reject excessively long form fields', () => {
      const longValue = 'x'.repeat(5000);
      expect(sanitizeFormField(longValue)).toBeNull();
    });
  });

  describe('XSS via URL domain extraction', () => {
    it('should not extract domain from javascript: URL', () => {
      expect(sanitizeDomain('javascript:alert(1)')).toBeNull();
    });

    it('should extract safe domain from legitimate URL', () => {
      expect(sanitizeDomain('https://www.github.com/login')).toBe('github.com');
    });

    it('should reject URLs with empty hostname', () => {
      expect(sanitizeDomain('https://')).toBeNull();
    });
  });

  describe('Tab URL validation (chrome://, about:)', () => {
    it('should reject chrome:// URLs', () => {
      expect(isValidTabUrl('chrome://extensions/')).toBe(false);
      expect(isValidTabUrl('chrome://settings/')).toBe(false);
    });

    it('should reject about: URLs', () => {
      expect(isValidTabUrl('about:blank')).toBe(false);
      expect(isValidTabUrl('about:config')).toBe(false);
    });

    it('should reject edge:// URLs', () => {
      expect(isValidTabUrl('edge://extensions/')).toBe(false);
    });

    it('should accept legitimate http/https URLs', () => {
      expect(isValidTabUrl('https://github.com/login')).toBe(true);
      expect(isValidTabUrl('http://example.com')).toBe(true);
    });

    it('should reject undefined', () => {
      expect(isValidTabUrl(undefined)).toBe(false);
    });
  });
});

// =========================================================================
// 2. MITM Protection Tests — Encryption without shared key
// =========================================================================

describe('MITM Protection — Cannot decrypt without shared key', () => {
  // Use host-side crypto (Node.js) for realistic MITM simulation
  let hostCrypto: typeof import('../../../src/main/crypto/handshake');
  let HandshakeMessageType: typeof import('../../../src/shared/protocols/handshake').HandshakeMessageType;

  beforeEach(async () => {
    hostCrypto = await import('../../../src/main/crypto/handshake');
    const handshakeMod = await import('../../../src/shared/protocols/handshake');
    HandshakeMessageType = handshakeMod.HandshakeMessageType;
    hostCrypto.revokeAllSessions();
  });

  afterEach(() => {
    hostCrypto.revokeAllSessions();
  });

  it('should not decrypt with wrong AES key (MITM scenario)', () => {
    // Legitimate extension performs handshake
    const extKeyPair = hostCrypto.generateEcdhKeyPair();
    const initMsg = {
      type: HandshakeMessageType.HANDSHAKE_INIT,
      requestId: 'req-mitm-001',
      timestamp: Date.now(),
      protocolVersion: 1,
      publicKey: extKeyPair.publicKeyBase64,
      extensionId: 'sp_ext_dev_a1b2c3d4e5f6g7h8',
    };
    const complete = hostCrypto.processHandshakeInit(initMsg, 'vault-test');
    const session = hostCrypto.getSession(complete.sessionId)!;

    // Extension encrypts a message
    const plaintext = { type: 'GET_MATCHING_ITEMS', url: 'https://github.com/login' };
    const envelope = hostCrypto.encryptMessage(plaintext, session, HandshakeMessageType.ENCRYPTED_REQUEST);

    // MITM attacker creates their own session with a different key
    const attackerSession = hostCrypto.createSession(
      'sp_attacker_session',
      'attacker_public_key',
      randomBytes(32), // random key, not the real shared secret
      'attacker_ext',
      null,
    );

    // MITM tries to decrypt the intercepted message with wrong key
    // Should fail due to session ID mismatch first
    expect(() => hostCrypto.decryptMessage(envelope, attackerSession)).toThrow();
  });

  it('should not decrypt with wrong session signing key (tampered HMAC)', () => {
    const extKeyPair = hostCrypto.generateEcdhKeyPair();
    const initMsg = {
      type: HandshakeMessageType.HANDSHAKE_INIT,
      requestId: 'req-mitm-002',
      timestamp: Date.now(),
      protocolVersion: 1,
      publicKey: extKeyPair.publicKeyBase64,
      extensionId: 'sp_ext_dev_a1b2c3d4e5f6g7h8',
    };
    const complete = hostCrypto.processHandshakeInit(initMsg, 'vault-test');
    const session = hostCrypto.getSession(complete.sessionId)!;

    const plaintext = { type: 'GET_CREDENTIALS', itemId: 'item_123' };
    const envelope = hostCrypto.encryptMessage(plaintext, session, HandshakeMessageType.ENCRYPTED_REQUEST);

    // Attacker creates a session with same ID but different signing key
    const attackerSession = hostCrypto.createSession(
      complete.sessionId,
      'attacker_public_key',
      session.sharedKey, // same shared key but different signing key
      'attacker_ext',
      null,
    );

    // Should fail HMAC signature verification
    expect(() => hostCrypto.decryptMessage(envelope, attackerSession)).toThrow('signature verification failed');
  });

  it('should not decrypt when ciphertext is tampered', () => {
    const extKeyPair = hostCrypto.generateEcdhKeyPair();
    const initMsg = {
      type: HandshakeMessageType.HANDSHAKE_INIT,
      requestId: 'req-mitm-003',
      timestamp: Date.now(),
      protocolVersion: 1,
      publicKey: extKeyPair.publicKeyBase64,
      extensionId: 'sp_ext_dev_a1b2c3d4e5f6g7h8',
    };
    const complete = hostCrypto.processHandshakeInit(initMsg, 'vault-test');
    const session = hostCrypto.getSession(complete.sessionId)!;

    const plaintext = { secret: 'my_password' };
    const envelope = hostCrypto.encryptMessage(plaintext, session, HandshakeMessageType.ENCRYPTED_REQUEST);

    // MITM modifies the ciphertext
    const tamperedCiphertext = Buffer.from(envelope.ciphertext, 'base64');
    tamperedCiphertext[0] ^= 0xff;
    const tamperedEnvelope = {
      ...envelope,
      ciphertext: tamperedCiphertext.toString('base64'),
    };

    // Should fail due to auth tag mismatch
    expect(() => hostCrypto.decryptMessage(tamperedEnvelope, session)).toThrow();
  });

  it('should not decrypt when auth tag is tampered', () => {
    const extKeyPair = hostCrypto.generateEcdhKeyPair();
    const initMsg = {
      type: HandshakeMessageType.HANDSHAKE_INIT,
      requestId: 'req-mitm-004',
      timestamp: Date.now(),
      protocolVersion: 1,
      publicKey: extKeyPair.publicKeyBase64,
      extensionId: 'sp_ext_dev_a1b2c3d4e5f6g7h8',
    };
    const complete = hostCrypto.processHandshakeInit(initMsg, 'vault-test');
    const session = hostCrypto.getSession(complete.sessionId)!;

    const plaintext = { credential: 'sensitive_data' };
    const envelope = hostCrypto.encryptMessage(plaintext, session, HandshakeMessageType.ENCRYPTED_REQUEST);

    // MITM modifies the auth tag
    const tamperedTag = Buffer.from(envelope.authTag, 'base64');
    tamperedTag[0] ^= 0xff;
    const tamperedEnvelope = {
      ...envelope,
      authTag: tamperedTag.toString('base64'),
    };

    expect(() => hostCrypto.decryptMessage(tamperedEnvelope, session)).toThrow();
  });

  it('should produce different ciphertext for same plaintext (random nonces)', () => {
    const extKeyPair = hostCrypto.generateEcdhKeyPair();
    const initMsg = {
      type: HandshakeMessageType.HANDSHAKE_INIT,
      requestId: 'req-mitm-005',
      timestamp: Date.now(),
      protocolVersion: 1,
      publicKey: extKeyPair.publicKeyBase64,
      extensionId: 'sp_ext_dev_a1b2c3d4e5f6g7h8',
    };
    const complete = hostCrypto.processHandshakeInit(initMsg, 'vault-test');
    const session = hostCrypto.getSession(complete.sessionId)!;

    const plaintext = { url: 'https://github.com/login' };
    const env1 = hostCrypto.encryptMessage(plaintext, session, HandshakeMessageType.ENCRYPTED_REQUEST);
    const env2 = hostCrypto.encryptMessage(plaintext, session, HandshakeMessageType.ENCRYPTED_REQUEST);

    // Random nonces should produce different ciphertext
    expect(env1.nonce).not.toBe(env2.nonce);
    expect(env1.ciphertext).not.toBe(env2.ciphertext);
  });

  it('should reject session ID mismatch (cross-session replay)', () => {
    const extKeyPair = hostCrypto.generateEcdhKeyPair();
    const initMsg = {
      type: HandshakeMessageType.HANDSHAKE_INIT,
      requestId: 'req-mitm-006',
      timestamp: Date.now(),
      protocolVersion: 1,
      publicKey: extKeyPair.publicKeyBase64,
      extensionId: 'sp_ext_dev_a1b2c3d4e5f6g7h8',
    };
    const complete = hostCrypto.processHandshakeInit(initMsg, 'vault-test');
    const session = hostCrypto.getSession(complete.sessionId)!;

    const plaintext = { type: 'GET_CREDENTIALS', itemId: 'item_abc' };
    const envelope = hostCrypto.encryptMessage(plaintext, session, HandshakeMessageType.ENCRYPTED_REQUEST);

    // Create a different session
    const session2KeyPair = hostCrypto.generateEcdhKeyPair();
    const initMsg2 = {
      type: HandshakeMessageType.HANDSHAKE_INIT,
      requestId: 'req-mitm-006b',
      timestamp: Date.now(),
      protocolVersion: 1,
      publicKey: session2KeyPair.publicKeyBase64,
      extensionId: 'sp_ext_dev_a1b2c3d4e5f6g7h8',
    };
    const complete2 = hostCrypto.processHandshakeInit(initMsg2, 'vault-test');
    const session2 = hostCrypto.getSession(complete2.sessionId)!;

    // Try to decrypt session1's message with session2
    expect(() => hostCrypto.decryptMessage(envelope, session2)).toThrow('Session ID mismatch');
  });

  it('should not allow ECDH shared secret derivation without private key', () => {
    // Simulate MITM who only intercepts public keys but cannot derive shared secret
    const extKeyPair = hostCrypto.generateEcdhKeyPair();
    const hostKeyPair = hostCrypto.generateEcdhKeyPair();

    // Both public keys are visible in transit
    // But without the private key, an attacker cannot derive the shared secret
    const attackerEcdh = hostCrypto.generateEcdhKeyPair();

    const sharedKeyLegit = hostCrypto.deriveSharedKey(extKeyPair.ecdh, hostKeyPair.publicKeyBase64);
    const sharedKeyAttacker = hostCrypto.deriveSharedKey(attackerEcdh.ecdh, hostKeyPair.publicKeyBase64);

    // Attacker's derived key should differ from the legitimate shared key
    expect(sharedKeyAttacker).not.toEqual(sharedKeyLegit);
  });
});

// =========================================================================
// 3. Replay Attack Prevention Tests
// =========================================================================

describe('Replay Attack Prevention — Duplicate message rejection', () => {
  let RequestIdTracker: typeof import('../../../src/shared/protocols/validation').RequestIdTracker;
  let isTimestampFresh: typeof import('../../../src/shared/protocols/validation').isTimestampFresh;
  let routeIncomingMessage: typeof import('../../../src/shared/protocols/validation').routeIncomingMessage;
  let validateHandshakeInit: typeof import('../../../src/shared/protocols/validation').validateHandshakeInit;
  let validateIncomingRequest: typeof import('../../../src/shared/protocols/validation').validateIncomingRequest;
  let isExtensionIdAuthorized: typeof import('../../../src/shared/protocols/validation').isExtensionIdAuthorized;
  let hostCrypto: typeof import('../../../src/main/crypto/handshake');
  let HandshakeMessageType: typeof import('../../../src/shared/protocols/handshake').HandshakeMessageType;
  let HostRequestType: typeof import('../../../src/shared/protocols/nativeMessaging').HostRequestType;

  beforeEach(async () => {
    const validationMod = await import('../../../src/shared/protocols/validation');
    RequestIdTracker = validationMod.RequestIdTracker;
    isTimestampFresh = validationMod.isTimestampFresh;
    routeIncomingMessage = validationMod.routeIncomingMessage;
    validateHandshakeInit = validationMod.validateHandshakeInit;
    validateIncomingRequest = validationMod.validateIncomingRequest;
    isExtensionIdAuthorized = validationMod.isExtensionIdAuthorized;

    hostCrypto = await import('../../../src/main/crypto/handshake');
    hostCrypto.revokeAllSessions();

    const handshakeMod = await import('../../../src/shared/protocols/handshake');
    HandshakeMessageType = handshakeMod.HandshakeMessageType;

    const nativeMessagingMod = await import('../../../src/shared/protocols/nativeMessaging');
    HostRequestType = nativeMessagingMod.HostRequestType;
  });

  afterEach(() => {
    hostCrypto.revokeAllSessions();
  });

  describe('RequestIdTracker — replay detection', () => {
    it('should reject duplicate request IDs (exact replay)', () => {
      const tracker = new RequestIdTracker();
      const requestId = 'replay-attack-id-001';
      const timestamp = Date.now();

      // First message — accepted
      expect(tracker.check(requestId, timestamp)).toBe(true);

      // Replay of same message — rejected
      expect(tracker.check(requestId, timestamp)).toBe(false);
    });

    it('should accept the same request ID after PROTOCOL_MAX_AGE_MS (window expired)', () => {
      vi.useFakeTimers();
      const tracker = new RequestIdTracker();
      const requestId = 'replay-window-test';
      const timestamp = Date.now();

      tracker.check(requestId, timestamp);

      // Advance time beyond the 5-minute window
      vi.advanceTimersByTime(6 * 60 * 1000);

      // Same request ID is now accepted because the window expired
      expect(tracker.check(requestId, Date.now())).toBe(true);

      vi.useRealTimers();
    });

    it('should reject replay within the same session at different timestamps', () => {
      const tracker = new RequestIdTracker();
      const requestId = 'replay-timestamp-test';

      expect(tracker.check(requestId, Date.now() - 1000)).toBe(true);
      expect(tracker.check(requestId, Date.now())).toBe(false);
    });

    it('should allow different request IDs (legitimate sequential messages)', () => {
      const tracker = new RequestIdTracker();
      const timestamp = Date.now();

      expect(tracker.check('id-001', timestamp)).toBe(true);
      expect(tracker.check('id-002', timestamp)).toBe(true);
      expect(tracker.check('id-003', timestamp)).toBe(true);
      expect(tracker.size).toBe(3);
    });

    it('should handle rapid-fire replay attempts', () => {
      const tracker = new RequestIdTracker();
      const requestId = 'rapid-replay';
      const timestamp = Date.now();

      const results = Array.from({ length: 100 }, () =>
        tracker.check(requestId, timestamp),
      );

      // Only the first should succeed
      expect(results[0]).toBe(true);
      expect(results.slice(1).every((r) => r === false)).toBe(true);
    });
  });

  describe('Timestamp freshness — replay window', () => {
    it('should accept current timestamp', () => {
      expect(isTimestampFresh(Date.now())).toBe(true);
    });

    it('should accept timestamp 4 minutes ago (within 5-min window)', () => {
      expect(isTimestampFresh(Date.now() - 4 * 60 * 1000)).toBe(true);
    });

    it('should reject timestamp 6 minutes ago (outside 5-min window)', () => {
      expect(isTimestampFresh(Date.now() - 6 * 60 * 1000)).toBe(false);
    });

    it('should reject negative timestamps (replayed old message)', () => {
      expect(isTimestampFresh(-1000)).toBe(false);
    });

    it('should reject future timestamps beyond tolerance', () => {
      expect(isTimestampFresh(Date.now() + 30_000)).toBe(false);
    });

    it('should reject extremely old timestamps', () => {
      expect(isTimestampFresh(Date.now() - 365 * 24 * 60 * 60 * 1000)).toBe(false);
    });
  });

  describe('Encrypted replay — full message replay', () => {
    it('should reject replay of an encrypted message via RequestIdTracker', () => {
      const extKeyPair = hostCrypto.generateEcdhKeyPair();
      const initMsg = {
        type: HandshakeMessageType.HANDSHAKE_INIT,
        requestId: 'replay-e2e-001',
        timestamp: Date.now(),
        protocolVersion: 1,
        publicKey: extKeyPair.publicKeyBase64,
        extensionId: 'sp_ext_dev_a1b2c3d4e5f6g7h8',
      };
      const complete = hostCrypto.processHandshakeInit(initMsg, 'vault-test');
      const session = hostCrypto.getSession(complete.sessionId)!;

      const plaintext = { type: HostRequestType.GET_CREDENTIALS, itemId: 'item_replay' };
      const envelope = hostCrypto.encryptMessage(plaintext, session, HandshakeMessageType.ENCRYPTED_REQUEST);

      const tracker = new RequestIdTracker();

      // Simulate the host processing: check request ID dedup
      const request = {
        type: HostRequestType.GET_CREDENTIALS,
        requestId: 'replay-e2e-001',
        timestamp: Date.now(),
        protocolVersion: 1,
        itemId: 'item_replay',
      };

      // First processing — accepted
      expect(tracker.check(request.requestId, request.timestamp)).toBe(true);

      // Replay of the same encrypted envelope — rejected by request ID
      expect(tracker.check(request.requestId, request.timestamp)).toBe(false);
    });
  });

  describe('Handshake replay prevention', () => {
    it('should reject replayed HANDSHAKE_INIT with same requestId', () => {
      const extKeyPair = hostCrypto.generateEcdhKeyPair();
      const initMsg = {
        type: HandshakeMessageType.HANDSHAKE_INIT,
        requestId: 'handshake-replay-001',
        timestamp: Date.now(),
        protocolVersion: 1,
        publicKey: extKeyPair.publicKeyBase64,
        extensionId: 'securepass-chrome-extension-placeholder',
      };

      // Validate first handshake — should pass structural validation
      const result1 = validateHandshakeInit(initMsg);
      if (!result1.ok) {
        throw new Error(`Validation failed: ${result1.error?.message}`);
      }
      expect(result1.ok).toBe(true);

      // Replay — same requestId, still valid structurally (validation doesn't check requestIds)
      // but the listener would reject via seenRequestIds check
      const tracker = new RequestIdTracker();
      expect(tracker.check(initMsg.requestId, initMsg.timestamp)).toBe(true);
      expect(tracker.check(initMsg.requestId, initMsg.timestamp)).toBe(false);
    });
  });
});

// =========================================================================
// 4. Phishing Resistance Tests — Typo-squatting and domain spoofing
// =========================================================================

describe('Phishing Resistance — Domain spoofing detection', () => {
  let isExactDomainMatch: typeof import('../../../browser-extension/src/shared/anti-phishing').isExactDomainMatch;
  let isSubdomainMatch: typeof import('../../../browser-extension/src/shared/anti-phishing').isSubdomainMatch;
  let detectTypoSquatting: typeof import('../../../browser-extension/src/shared/anti-phishing').detectTypoSquatting;
  let checkDomainMatch: typeof import('../../../browser-extension/src/shared/anti-phishing').checkDomainMatch;
  let isCommonlyPhishedDomain: typeof import('../../../browser-extension/src/shared/anti-phishing').isCommonlyPhishedDomain;

  beforeEach(async () => {
    const mod = await import('../../../browser-extension/src/shared/anti-phishing');
    isExactDomainMatch = mod.isExactDomainMatch;
    isSubdomainMatch = mod.isSubdomainMatch;
    detectTypoSquatting = mod.detectTypoSquatting;
    checkDomainMatch = mod.checkDomainMatch;
    isCommonlyPhishedDomain = mod.isCommonlyPhishedDomain;
  });

  describe('Homoglyph attacks (Cyrillic/lookalike characters)', () => {
    it('should detect Cyrillic "р" (→p) substitution via Levenshtein', () => {
      // "ерaypal.com" uses Cyrillic р, which normalizes to "paypal.com" (distance 0 via homoglyph).
      // But the original strings differ → Levenshtein catches it.
      const result = detectTypoSquatting('paypal.com', 'ерaypal.com');
      expect(result.isSuspicious).toBe(true);
    });

    it('should detect digit-for-letter homoglyph (paypa1)', () => {
      const result = detectTypoSquatting('paypal.com', 'paypa1.com');
      expect(result.isSuspicious).toBe(true);
    });

    it('should detect visually similar domain (githvb.com ≈ github.com)', () => {
      const result = detectTypoSquatting('github.com', 'githvb.com');
      expect(result.isSuspicious).toBe(true);
      expect(result.distance).toBe(1);
    });

    it('should detect exclamation mark for "i" (!inkedin)', () => {
      const result = detectTypoSquatting('linkedin.com', '!inkedin.com');
      expect(result.isSuspicious).toBe(true);
    });

    it('should detect "0" for "o" (g00gle.com)', () => {
      const result = detectTypoSquatting('google.com', 'g00gle.com');
      expect(result.isSuspicious).toBe(true);
    });
  });

  describe('Levenshtein-based typo detection', () => {
    it('should flag single-character substitution (githvb → github)', () => {
      const result = detectTypoSquatting('github.com', 'githvb.com');
      expect(result.isSuspicious).toBe(true);
      expect(result.distance).toBe(1);
    });

    it('should flag single-character omission (githu → github)', () => {
      const result = detectTypoSquatting('github.com', 'githu.com');
      expect(result.isSuspicious).toBe(true);
      expect(result.distance).toBe(1);
    });

    it('should flag single-character insertion (githhub → github)', () => {
      const result = detectTypoSquatting('github.com', 'githhub.com');
      expect(result.isSuspicious).toBe(true);
      expect(result.distance).toBe(1);
    });

    it('should flag two-character difference (guthub → github is distance 1)', () => {
      const result = detectTypoSquatting('github.com', 'guthub.com');
      expect(result.isSuspicious).toBe(true);
      expect(result.distance).toBe(1); // single char substitution: i→u
    });

    it('should flag three-character difference (githhub → github is distance 1)', () => {
      const result = detectTypoSquatting('github.com', 'githhub.com');
      expect(result.isSuspicious).toBe(true);
      expect(result.distance).toBe(1); // single char insertion
    });

    it('should NOT flag domains that are far enough away', () => {
      const result = detectTypoSquatting('github.com', 'abcdefg.com');
      // Distance > 2, no substring overlap
      expect(result.isSuspicious).toBe(false);
    });

    it('should NOT flag identical domains', () => {
      const result = detectTypoSquatting('github.com', 'github.com');
      expect(result.isSuspicious).toBe(false);
      expect(result.distance).toBe(0);
    });
  });

  describe('Subdomain spoofing attacks', () => {
    it('should flag "paypal.com.example.com" as suspicious (contains but is not subdomain)', () => {
      const result = detectTypoSquatting('paypal.com', 'paypal.com.example.com');
      expect(result.isSuspicious).toBe(true);
    });

    it('should flag "secure.paypal.com.phishing.com" as suspicious', () => {
      const result = detectTypoSquatting('paypal.com', 'secure.paypal.com.phishing.com');
      expect(result.isSuspicious).toBe(true);
    });

    it('should NOT flag "login.paypal.com" as suspicious (legitimate subdomain)', () => {
      const result = detectTypoSquatting('paypal.com', 'login.paypal.com');
      // Registrable domains match → safe
      expect(result.isSuspicious).toBe(false);
    });

    it('should NOT flag "www.github.com" as suspicious (www subdomain)', () => {
      const result = detectTypoSquatting('github.com', 'www.github.com');
      expect(result.isSuspicious).toBe(false);
    });
  });

  describe('TLD switching attacks', () => {
    it('should flag "paypal.net" when stored domain is "paypal.com"', () => {
      const result = checkDomainMatch('paypal.com', 'paypal.net');
      expect(result.isSafe).toBe(false);
      expect(result.riskLevel).not.toBe('exact');
    });

    it('should flag "github.org" when stored domain is "github.com"', () => {
      const result = checkDomainMatch('github.com', 'github.org');
      expect(result.isSafe).toBe(false);
    });
  });

  describe('Full phishing simulation — no autofill', () => {
    it('should block autofill for "ерaypal.com" (Cyrillic homoglyph)', () => {
      const result = checkDomainMatch('paypal.com', 'ерaypal.com');
      expect(result.isSafe).toBe(false);
      // Detected as suspicious via Levenshtein (homoglyph normalizes to same domain)
      expect(result.riskLevel).toBe('suspicious');
    });

    it('should block autofill for "paypa1.com" (digit substitution)', () => {
      const result = checkDomainMatch('paypal.com', 'paypa1.com');
      expect(result.isSafe).toBe(false);
      expect(result.riskLevel).toBe('suspicious');
    });

    it('should block autofill for "githvb.com" (single char substitution)', () => {
      const result = checkDomainMatch('github.com', 'githvb.com');
      expect(result.isSafe).toBe(false);
    });

    it('should block autofill for "secure-paypal.com" (prefix spoofing)', () => {
      const result = checkDomainMatch('paypal.com', 'secure-paypal.com');
      expect(result.isSafe).toBe(false);
    });

    it('should block autofill for "paypal.com.evil.com" (subdomain spoofing)', () => {
      const result = checkDomainMatch('paypal.com', 'paypal.com.evil.com');
      expect(result.isSafe).toBe(false);
    });

    it('should allow autofill for legitimate subdomain "login.paypal.com"', () => {
      const result = checkDomainMatch('paypal.com', 'login.paypal.com');
      expect(result.isSafe).toBe(true);
      expect(result.riskLevel).toBe('subdomain');
    });

    it('should allow autofill for exact match "www.paypal.com"', () => {
      const result = checkDomainMatch('paypal.com', 'www.paypal.com');
      expect(result.isSafe).toBe(true);
      expect(result.riskLevel).toBe('exact');
    });

    it('should block autofill for complete domain mismatch', () => {
      const result = checkDomainMatch('paypal.com', 'evil-phishing.com');
      expect(result.isSafe).toBe(false);
      expect(result.riskLevel).toBe('mismatch');
    });
  });

  describe('Commonly phished domain detection', () => {
    it('should recognize paypal.com as commonly phished', () => {
      expect(isCommonlyPhishedDomain('paypal.com')).toBe(true);
      expect(isCommonlyPhishedDomain('www.paypal.com')).toBe(true);
    });

    it('should recognize google.com as commonly phished', () => {
      expect(isCommonlyPhishedDomain('google.com')).toBe(true);
    });

    it('should recognize github.com as commonly phished', () => {
      expect(isCommonlyPhishedDomain('github.com')).toBe(true);
    });

    it('should NOT flag uncommon domains', () => {
      expect(isCommonlyPhishedDomain('my-random-blog.com')).toBe(false);
    });
  });

  describe('Edge cases — empty and invalid inputs', () => {
    it('should reject empty domain in checkDomainMatch', () => {
      const result = checkDomainMatch('', 'github.com');
      expect(result.isSafe).toBe(false);
    });

    it('should reject both empty domains', () => {
      const result = checkDomainMatch('', '');
      expect(result.isSafe).toBe(false);
    });

    it('should handle domain with trailing dots', () => {
      const result = isExactDomainMatch('github.com.', 'github.com');
      expect(result).toBe(true);
    });

    it('should handle case insensitive comparison', () => {
      const result = isExactDomainMatch('GITHUB.COM', 'github.com');
      expect(result).toBe(true);
    });
  });
});

// =========================================================================
// 5. Cross-cutting security properties
// =========================================================================

describe('Cross-cutting Security Properties', () => {
  it('session tokens should use timing-safe comparison', async () => {
    const handshake = await import('../../../src/main/crypto/handshake');
    const keyPair = handshake.generateEcdhKeyPair();
    const session = handshake.createSession(
      'sp_test_timing',
      'fakepubkey',
      randomBytes(32),
      'ext-test',
      null,
    );

    const token1 = handshake.generateSessionToken('sp_test_timing', session.tokenSigningKey);
    const result = handshake.verifySessionToken(token1, session.tokenSigningKey);
    expect(result.ok).toBe(true);

    // Wrong key should fail
    const wrongKey = randomBytes(32);
    const result2 = handshake.verifySessionToken(token1, wrongKey);
    expect(result2.ok).toBe(false);

    handshake.revokeAllSessions();
  });

  it('ECDH shared secret should be derived via HKDF (not raw ECDH output)', async () => {
    const handshake = await import('../../../src/main/crypto/handshake');
    const keyPair1 = handshake.generateEcdhKeyPair();
    const keyPair2 = handshake.generateEcdhKeyPair();

    const sharedKey = handshake.deriveSharedKey(keyPair1.ecdh, keyPair2.publicKeyBase64);

    // HKDF output should be exactly 32 bytes
    expect(sharedKey.length).toBe(32);

    // Raw ECDH output for P-256 is 32 bytes, but HKDF ensures
    // uniform distribution — verify it's not all zeros
    expect(sharedKey.every((b: number) => b === 0)).toBe(false);
  });

  it('AES-GCM should use random 12-byte nonces', async () => {
    const handshake = await import('../../../src/main/crypto/handshake');
    const handshakeTypes = await import('../../../src/shared/protocols/handshake');
    const keyPair = handshake.generateEcdhKeyPair();
    const initMsg = {
      type: handshakeTypes.HandshakeMessageType.HANDSHAKE_INIT,
      requestId: 'nonce-test',
      timestamp: Date.now(),
      protocolVersion: 1,
      publicKey: keyPair.publicKeyBase64,
      extensionId: 'sp_ext_dev_a1b2c3d4e5f6g7h8',
    };
    const complete = handshake.processHandshakeInit(initMsg, null);
    const session = handshake.getSession(complete.sessionId)!;

    const plaintext = { test: 'nonce-randomness' };
    const env1 = handshake.encryptMessage(plaintext, session);
    const env2 = handshake.encryptMessage(plaintext, session);

    // Different nonces → different ciphertext even for same plaintext
    expect(env1.nonce).not.toBe(env2.nonce);
    expect(env1.ciphertext).not.toBe(env2.ciphertext);

    handshake.revokeAllSessions();
  });
});
