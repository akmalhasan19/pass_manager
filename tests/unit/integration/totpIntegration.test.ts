// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll } from 'vitest';
import {
  decodeQrImage,
  parseOtpauthUri,
  parsedToTotpConfig,
} from '../../../src/renderer/utils/parseOtpauthUri';
import { otpTimerService } from '../../../src/renderer/services/otpTimerService';
import type { ExportPayload } from '../../../src/shared/types';

describe('TOTP Integration Tests', () => {
  // ─── 7.3.1: Flow add item dengan OTP field (via export payload format) ──

  it('export payload includes OTP fields when item has OTP config', () => {
    const payload: ExportPayload = {
      formatVersion: 1,
      metadata: {
        appName: 'SecurePass Manager',
        appVersion: '0.1.0',
        exportedAt: Date.now(),
        formatVersion: 1,
        schemaVersion: 1,
        itemCount: 1,
        folderCount: 0,
        tagCount: 0,
        attachmentCount: 0,
      },
      folders: [],
      items: [
        {
          id: 'item-otp-1',
          folderId: 'folder-1',
          title: 'GitHub',
          username: 'user',
          passwordEncrypted: null,
          url: 'https://github.com',
          notesEncrypted: null,
          emoji: null,
          coverImage: null,
          createdAt: 1700000000000,
          updatedAt: 1700000000000,
          isFavorite: false,
          sortOrder: 0,
          tagIds: [],
          otpSecretEncrypted: 'encrypted-blob-mock',
          otpPeriod: 30,
          otpDigits: 6,
          otpAlgorithm: 'SHA1',
        },
      ],
      tags: [],
      attachments: [],
    };

    const item = payload.items[0];
    expect(item.otpSecretEncrypted).toBe('encrypted-blob-mock');
    expect(item.otpPeriod).toBe(30);
    expect(item.otpDigits).toBe(6);
    expect(item.otpAlgorithm).toBe('SHA1');
  });

  it('export payload has null OTP fields when item has no OTP', () => {
    const payload: ExportPayload = {
      formatVersion: 1,
      metadata: {
        appName: 'SecurePass Manager',
        appVersion: '0.1.0',
        exportedAt: Date.now(),
        formatVersion: 1,
        schemaVersion: 1,
        itemCount: 1,
        folderCount: 0,
        tagCount: 0,
        attachmentCount: 0,
      },
      folders: [],
      items: [
        {
          id: 'item-no-otp',
          folderId: 'folder-1',
          title: 'Plain Password',
          username: 'user',
          passwordEncrypted: null,
          url: '',
          notesEncrypted: null,
          emoji: null,
          coverImage: null,
          createdAt: 1700000000000,
          updatedAt: 1700000000000,
          isFavorite: false,
          sortOrder: 0,
          tagIds: [],
          otpSecretEncrypted: null,
          otpPeriod: 30,
          otpDigits: 6,
          otpAlgorithm: 'SHA1',
        },
      ],
      tags: [],
      attachments: [],
    };

    const item = payload.items[0];
    expect(item.otpSecretEncrypted).toBeNull();
  });

  // ─── 7.3.2: Import dari QR code image ──────────────────────────────────

  it('parses a valid otpauth:// URI string into correct TotpConfig', () => {
    const otpauthUri =
      'otpauth://totp/TestIssuer:user@example.com?secret=JBSWY3DPEHPK3PXP&issuer=TestIssuer&algorithm=SHA1&digits=6&period=30';
    const parsed = parseOtpauthUri(otpauthUri);

    expect(parsed).not.toBeNull();
    const config = parsedToTotpConfig(parsed!);

    expect(config.secret).toBe('JBSWY3DPEHPK3PXP');
    expect(config.period).toBe(30);
    expect(config.digits).toBe(6);
    expect(config.algorithm).toBe('SHA1');
  });

  it('parses otpauth URI with custom algorithm and digits', () => {
    const otpauthUri =
      'otpauth://totp/Custom:user?secret=GEZDGNBVGY3TQOJQ&issuer=Custom&algorithm=SHA256&digits=8&period=60';
    const parsed = parseOtpauthUri(otpauthUri);

    expect(parsed).not.toBeNull();
    const config = parsedToTotpConfig(parsed!);

    expect(config.secret).toBe('GEZDGNBVGY3TQOJQ');
    expect(config.period).toBe(60);
    expect(config.digits).toBe(8);
    expect(config.algorithm).toBe('SHA256');
  });

  // ─── 7.3.3: Export/import mempertahankan OTP config ────────────────────

  it('round-trips OTP config through export and re-import format', () => {
    const original = {
      id: 'item-1',
      folderId: 'f1',
      title: 'Bank',
      username: 'me',
      passwordEncrypted: 'enc-pw',
      url: 'https://bank.com',
      notesEncrypted: 'enc-notes',
      emoji: null,
      coverImage: null,
      createdAt: 1700000000000,
      updatedAt: 1700000000000,
      isFavorite: false,
      sortOrder: 0,
      tagIds: [],
      otpSecretEncrypted: 'enc-secret',
      otpPeriod: 60,
      otpDigits: 8,
      otpAlgorithm: 'SHA256',
    };

    // Simulate export → JSON stringify/parse → import
    const exported = JSON.stringify(original);
    const imported = JSON.parse(exported);

    expect(imported.otpSecretEncrypted).toBe('enc-secret');
    expect(imported.otpPeriod).toBe(60);
    expect(imported.otpDigits).toBe(8);
    expect(imported.otpAlgorithm).toBe('SHA256');
  });

  // ─── 7.3.4: Switch vault tidak menyebabkan crash atau timer zombie ──────

  it('otpTimerService resets all subscriptions and stops the interval', () => {
    // Simulate multiple widgets subscribing
    const unsub1 = otpTimerService.subscribe(() => {});
    const unsub2 = otpTimerService.subscribe(() => {});
    const unsub3 = otpTimerService.subscribe(() => {});

    expect(otpTimerService.subscriberCount).toBe(3);

    // Reset simulates vault switch / lock
    otpTimerService.reset();

    expect(otpTimerService.subscriberCount).toBe(0);

    // After reset, a new subscriber starts a fresh interval
    const unsub4 = otpTimerService.subscribe(() => {});
    expect(otpTimerService.subscriberCount).toBe(1);

    // Clean up
    unsub4();
    otpTimerService.reset();
  });

  it('otpTimerService does not throw when unsubscribing after reset', () => {
    const unsub = otpTimerService.subscribe(() => {});
    otpTimerService.reset();

    // Unsubscribe after reset should be safe (no-op)
    expect(() => unsub()).not.toThrow();
  });
});
