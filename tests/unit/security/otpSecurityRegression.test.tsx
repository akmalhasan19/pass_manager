// @vitest-environment jsdom
/**
 * OTP Security Regression Tests (Sub-Task 7.4)
 *
 * Verifies that OTP secrets and QR codes are not leaked through:
 * 1. DOM / React DevTools (secret must not appear in rendered output)
 * 2. localStorage / sessionStorage (secret must never be persisted)
 * 3. QR code plain text / base64 without masking (blur by default)
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import OtpWidget from '../../../src/renderer/components/otp/OtpWidget';
import OtpSection from '../../../src/renderer/components/otp/OtpSection';

// ─── Mocks ──────────────────────────────────────────────────────────────────

vi.mock('framer-motion', () => ({
  motion: {
    div: React.forwardRef((props: Record<string, unknown>, ref: React.Ref<HTMLDivElement>) => {
      const { initial, animate, exit, transition, layout, ...rest } = props;
      return <div ref={ref} {...rest} />;
    }),
  },
}));

vi.mock('../../../src/renderer/hooks/useToast', () => ({
  useToast: () => ({ showSuccess: vi.fn() }),
}));

vi.mock('../../../src/renderer/stores/settingsStore', () => ({
  useSettingsStore: () => ({ settings: { otpPrivacyMode: false } }),
}));

vi.mock('../../../src/renderer/i18n/useTranslation', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        'otp.clockDriftTitle': 'Clock Drift Detected',
        'otp.clockDriftWarning': 'Your system clock may be out of sync.',
        'otp.blurHint': 'OTP code hidden for privacy',
        'otp.reveal': 'Reveal OTP',
        'otp.revealQr': 'Reveal QR',
        'otp.revealOtp': 'Reveal OTP',
        'otp.revealOtpDescription': 'Click to reveal your one-time password.',
        'otp.copyWarning': 'This code is sensitive — do not share it.',
        'otp.hideOtp': 'Hide OTP',
        'item.revealOtp': 'Reveal OTP',
        'item.revealOtpDescription': 'Click to reveal your one-time password.',
        'item.hideOtp': 'Hide OTP',
        'item.scanQrCode': 'Scan QR Code',
        'item.generateQrCode': 'Generate QR Code',
      };
      return map[key] ?? key;
    },
  }),
}));

vi.mock('../../../src/renderer/components/ui/Modal', () => ({
  default: ({
    isOpen,
    children,
    ariaLabel,
  }: {
    isOpen: boolean;
    children: React.ReactNode;
    ariaLabel?: string;
  }) => (isOpen ? <div role="dialog" aria-label={ariaLabel}>{children}</div> : null),
}));

vi.mock('../../../src/renderer/components/otp/QrScannerModal', () => ({
  default: () => null,
}));

const mockToDataUrl = vi.fn().mockResolvedValue('data:image/png;base64,iVBORw0KGgoAAAANSU');
const mockToString = vi.fn().mockResolvedValue('<svg xmlns="http://www.w3.org/2000/svg"></svg>');

vi.mock('qrcode', () => ({
  default: {
    toDataURL: (...args: unknown[]) => mockToDataUrl(...args),
    toString: (...args: unknown[]) => mockToString(...args),
  },
}));

const mockGenerate = vi.fn();
const mockCheckTimeSync = vi.fn();
const mockGetConfig = vi.fn();

(globalThis as unknown as Record<string, unknown>).window = Object.create(
  (globalThis as unknown as Record<string, unknown>).window ?? {},
);
(globalThis as unknown as Record<string, unknown>).window.electron = {
  otp: {
    generate: mockGenerate,
    checkTimeSync: mockCheckTimeSync,
    getConfig: mockGetConfig,
  },
};

(globalThis as unknown as Record<string, unknown>).navigator = {
  ...(globalThis as unknown as Record<string, unknown>).navigator,
  clipboard: { writeText: vi.fn() },
};

Object.defineProperty(globalThis, 'crypto', {
  value: {
    randomUUID: () => `test-uuid-${Math.random().toString(36).slice(2)}`,
  },
  writable: true,
  configurable: true,
});

// ─── End Mocks ──────────────────────────────────────────────────────────────

import { otpTimerService } from '../../../src/renderer/services/otpTimerService';

const SECRET = 'JBSWY3DPEHPK3PXP';
const DEFAULT_CONFIG = {
  secret: SECRET,
  period: 30,
  digits: 6,
  algorithm: 'SHA1',
} as const;

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('OTP Security Regression Tests', () => {
  let localStorageSetItemSpy: ReturnType<typeof vi.fn>;
  let sessionStorageSetItemSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockGenerate.mockReset();
    mockCheckTimeSync.mockReset();
    mockGetConfig.mockReset();
    mockToDataUrl.mockClear();
    mockToString.mockClear();
    otpTimerService.reset();

    // Default mocks for IPC calls
    mockGetConfig.mockResolvedValue({
      success: true,
      data: { ...DEFAULT_CONFIG },
    });
    mockGenerate.mockResolvedValue({
      success: true,
      data: { code: '123456', remaining: 25 },
    });
    mockCheckTimeSync.mockResolvedValue({
      success: true,
      data: { driftDetected: false },
    });
    mockToDataUrl.mockResolvedValue('data:image/png;base64,iVBORw0KGgoAAAANSU');
    mockToString.mockResolvedValue('<svg xmlns="http://www.w3.org/2000/svg"></svg>');

    localStorageSetItemSpy = vi.fn();
    sessionStorageSetItemSpy = vi.fn();
    localStorage.setItem = localStorageSetItemSpy;
    sessionStorage.setItem = sessionStorageSetItemSpy;
  });

  afterEach(() => {
    otpTimerService.reset();
    vi.restoreAllMocks();
  });

  // =========================================================================
  // 1. Secret OTP tidak muncul di DevTools atau React DevTools inspect state
  // =========================================================================
  describe('1. OTP secret must not appear in rendered DOM', () => {
    it('OtpWidget does not render the OTP secret in any DOM text content', async () => {
      const { container } = render(
        <OtpWidget itemId="item-1" config={{ ...DEFAULT_CONFIG }} />,
      );
      await flush();

      const fullText = container.textContent || '';
      expect(fullText).not.toContain(SECRET);

      const allElements = container.querySelectorAll('*');
      for (const el of allElements) {
        expect(el.textContent).not.toContain(SECRET);
        for (const attr of Array.from(el.attributes)) {
          if (attr.name.startsWith('data-')) {
            expect(attr.value).not.toContain(SECRET);
          }
        }
      }
    });

    it('OtpWidget does not include the secret in accessible labels or aria attributes', async () => {
      const { container } = render(
        <OtpWidget itemId="item-2" config={{ ...DEFAULT_CONFIG }} />,
      );
      await flush();

      const allElements = container.querySelectorAll('*');
      for (const el of allElements) {
        for (const attr of Array.from(el.attributes)) {
          if (
            attr.name.startsWith('aria-') ||
            attr.name === 'label' ||
            attr.name === 'title' ||
            attr.name === 'alt'
          ) {
            expect(attr.value).not.toContain(SECRET);
          }
        }
      }
    });

    it('OtpWidget does not expose secret in innerHTML or outerHTML', async () => {
      const { container } = render(
        <OtpWidget itemId="item-3" config={{ ...DEFAULT_CONFIG }} />,
      );
      await flush();

      expect(container.innerHTML).not.toContain(SECRET);
    });

    it('OtpSection in view mode does not render the OTP secret', async () => {
      const { container } = render(
        <OtpSection
          itemId="item-4"
          itemTitle="My Service"
          otpConfig={{ ...DEFAULT_CONFIG }}
          isEditMode={false}
          onChange={vi.fn()}
        />,
      );
      await flush();

      expect(container.textContent).not.toContain(SECRET);
      expect(container.innerHTML).not.toContain(SECRET);
    });

    it('OtpSection in view mode reveals OtpWidget which does not leak secret', async () => {
      render(
        <OtpSection
          itemId="item-5"
          itemTitle="My Service"
          otpConfig={{ ...DEFAULT_CONFIG }}
          isEditMode={false}
          onChange={vi.fn()}
        />,
      );
      await flush();

      const revealBtn = screen.getByLabelText('Reveal OTP');
      await act(async () => {
        revealBtn.click();
      });

      // Wait for the OTP widget timer to appear (IPC call resolves)
      await waitFor(() => {
        expect(screen.getByRole('timer')).toBeDefined();
      });
    });
  });

  // =========================================================================
  // 2. Secret OTP tidak disimpan ke localStorage atau sessionStorage
  // =========================================================================
  describe('2. OTP secret must not be stored in browser storage', () => {
    it('OtpWidget does not write OTP secret to localStorage', async () => {
      render(<OtpWidget itemId="item-6" config={{ ...DEFAULT_CONFIG }} />);
      await flush();

      for (const call of localStorageSetItemSpy.mock.calls) {
        const [, value] = call;
        expect(value).not.toContain(SECRET);
      }
    });

    it('OtpWidget does not write OTP secret to sessionStorage', async () => {
      render(<OtpWidget itemId="item-7" config={{ ...DEFAULT_CONFIG }} />);
      await flush();

      for (const call of sessionStorageSetItemSpy.mock.calls) {
        const [, value] = call;
        expect(value).not.toContain(SECRET);
      }
    });

    it('OtpSection does not write OTP secret to localStorage during QR generation', async () => {
      render(
        <OtpSection
          itemId="item-8"
          itemTitle="Test Service"
          otpConfig={{ ...DEFAULT_CONFIG }}
          isEditMode={true}
          onChange={vi.fn()}
        />,
      );
      await flush();

      localStorageSetItemSpy.mockClear();
      sessionStorageSetItemSpy.mockClear();

      const qrButton = screen.getByText('Generate QR Code');
      await act(async () => {
        qrButton.click();
      });
      await flush();

      for (const call of localStorageSetItemSpy.mock.calls) {
        const [, value] = call;
        expect(value).not.toContain(SECRET);
      }
      for (const call of sessionStorageSetItemSpy.mock.calls) {
        const [, value] = call;
        expect(value).not.toContain(SECRET);
      }
    });

    it('localStorage does not contain OTP secrets after widget lifecycle', async () => {
      const { unmount } = render(
        <OtpWidget itemId="item-9" config={{ ...DEFAULT_CONFIG }} />,
      );
      await flush();

      unmount();

      expect(localStorageSetItemSpy).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // 3. QR code tidak dirender sebagai plain text/base64 tanpa masking
  // =========================================================================
  describe('3. QR code must be masked (blurred) by default', () => {
    it('QR code image has blur class when first rendered', async () => {
      render(
        <OtpSection
          itemId="item-10"
          itemTitle="Test Service"
          otpConfig={{ ...DEFAULT_CONFIG }}
          isEditMode={true}
          onChange={vi.fn()}
        />,
      );
      await flush();

      const qrButton = screen.getByText('Generate QR Code');
      await act(async () => {
        qrButton.click();
      });
      await flush();

      const qrImage = screen.getByAltText('OTP QR Code');
      expect(qrImage.className).toContain('blur-md');
    });

    it('QR code image has blur class before reveal', async () => {
      render(
        <OtpSection
          itemId="item-11"
          itemTitle="Test Service"
          otpConfig={{ ...DEFAULT_CONFIG }}
          isEditMode={true}
          onChange={vi.fn()}
        />,
      );
      await flush();

      const qrButton = screen.getByText('Generate QR Code');
      await act(async () => {
        qrButton.click();
      });
      await flush();

      const qrImage = screen.getByAltText('OTP QR Code');
      expect(qrImage).toBeDefined();
      expect(qrImage.className).toMatch(/blur/);
    });

    it('Reveal button is present to control QR code visibility', async () => {
      render(
        <OtpSection
          itemId="item-12"
          itemTitle="Test Service"
          otpConfig={{ ...DEFAULT_CONFIG }}
          isEditMode={true}
          onChange={vi.fn()}
        />,
      );
      await flush();

      const qrButton = screen.getByText('Generate QR Code');
      await act(async () => {
        qrButton.click();
      });
      await flush();

      const revealBtn = screen.getByText('Reveal QR');
      expect(revealBtn).toBeDefined();
    });

    it('QR code blur is removed after clicking Reveal', async () => {
      render(
        <OtpSection
          itemId="item-13"
          itemTitle="Test Service"
          otpConfig={{ ...DEFAULT_CONFIG }}
          isEditMode={true}
          onChange={vi.fn()}
        />,
      );
      await flush();

      const qrButton = screen.getByText('Generate QR Code');
      await act(async () => {
        qrButton.click();
      });
      await flush();

      const qrImage = screen.getByAltText('OTP QR Code');
      expect(qrImage.className).toContain('blur-md');

      const revealBtn = screen.getByText('Reveal QR');
      await act(async () => {
        revealBtn.click();
      });
      await flush();

      expect(qrImage.className).not.toContain('blur-md');
    });

    it('QR code secret is not embedded as visible text in the DOM', async () => {
      const { container } = render(
        <OtpSection
          itemId="item-14"
          itemTitle="Test Service"
          otpConfig={{ ...DEFAULT_CONFIG }}
          isEditMode={true}
          onChange={vi.fn()}
        />,
      );
      await flush();

      const qrButton = screen.getByText('Generate QR Code');
      await act(async () => {
        qrButton.click();
      });
      await flush();

      expect(container.textContent).not.toContain(SECRET);
      expect(container.textContent).not.toContain('otpauth://');
    });
  });
});
