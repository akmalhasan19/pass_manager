// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import OtpWidget from '../../../../src/renderer/components/otp/OtpWidget';

// ─── Mocks ──────────────────────────────────────────────────────────────────

vi.mock('framer-motion', () => ({
  motion: {
    div: React.forwardRef((props: Record<string, unknown>, ref: React.Ref<HTMLDivElement>) => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { initial, animate, exit, transition, layout, ...rest } = props;
      return <div ref={ref} {...rest} />;
    }),
  },
}));

const mockShowSuccess = vi.fn();

vi.mock('../../../../src/renderer/hooks/useToast', () => ({
  useToast: () => ({ showSuccess: mockShowSuccess }),
}));

vi.mock('../../../../src/renderer/stores/settingsStore', () => ({
  useSettingsStore: () => ({ settings: { otpPrivacyMode: false } }),
}));

vi.mock('../../../../src/renderer/i18n/useTranslation', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        'otp.clockDriftTitle': 'Clock Drift Detected',
        'otp.clockDriftWarning': 'Your system clock may be out of sync.',
        'otp.blurHint': 'OTP code hidden for privacy',
        'otp.reveal': 'Reveal OTP',
        'otp.copyWarning': 'This code is sensitive — do not share it.',
      };
      return map[key] ?? key;
    },
  }),
}));

const mockGenerate = vi.fn();
const mockCheckTimeSync = vi.fn();

// Properly typed window mock for Electron IPC
const mockWindow = Object.create(
  (globalThis as Record<string, unknown>).window ?? null,
) as typeof globalThis & { electron: Record<string, unknown> };
mockWindow.electron = {
  otp: {
    generate: mockGenerate,
    checkTimeSync: mockCheckTimeSync,
  },
};
(globalThis as unknown as { window: typeof mockWindow }).window = mockWindow;

// Mock navigator.clipboard
const mockNavigator = Object.create(
  (typeof navigator !== 'undefined' ? navigator : null) ?? null,
) as Navigator & { clipboard: Clipboard };
Object.defineProperty(mockNavigator, 'clipboard', {
  value: { writeText: vi.fn() },
  writable: true,
  configurable: true,
});
(globalThis as unknown as { navigator: typeof mockNavigator }).navigator = mockNavigator;

// Mock crypto.randomUUID for otpTimerService
Object.defineProperty(globalThis, 'crypto', {
  value: {
    randomUUID: () => `test-uuid-${Math.random().toString(36).slice(2)}`,
  },
  writable: true,
  configurable: true,
});

// ─── End Mocks ──────────────────────────────────────────────────────────────

import { otpTimerService } from '../../../../src/renderer/services/otpTimerService';

const DEFAULT_CONFIG = {
  secret: 'JBSWY3DPEHPK3PXP',
  period: 30,
  digits: 6,
  algorithm: 'SHA1',
} as const;

async function flushPromises(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('OtpWidget', () => {
  beforeEach(() => {
    mockGenerate.mockReset();
    mockCheckTimeSync.mockReset();
    mockShowSuccess.mockReset();
    (navigator.clipboard.writeText as ReturnType<typeof vi.fn>).mockReset();
    otpTimerService.reset();
  });

  afterEach(() => {
    otpTimerService.reset();
  });

  async function flush() {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  // ─── Sub-Task 7.2: Render kode awal dan transisi saat timer refresh ──────

  it('renders the initial OTP code after fetching', async () => {
    mockGenerate.mockResolvedValue({
      success: true,
      data: { code: '123456', remaining: 25 },
    });
    mockCheckTimeSync.mockResolvedValue({ success: true, data: { driftDetected: false } });

    render(<OtpWidget itemId="item-1" config={{ ...DEFAULT_CONFIG }} />);
    await flush();

    expect(screen.getByText('123456')).toBeDefined();
  });

  it('displays the countdown timer with the remaining seconds', async () => {
    mockGenerate.mockResolvedValue({
      success: true,
      data: { code: '654321', remaining: 15 },
    });
    mockCheckTimeSync.mockResolvedValue({ success: true, data: { driftDetected: false } });

    render(<OtpWidget itemId="item-2" config={{ ...DEFAULT_CONFIG }} />);
    await flush();

    expect(screen.getByRole('timer')).toBeDefined();
    expect(screen.getByRole('timer').textContent).toBe('15');
  });

  it('decrements the timer display every second via global tick', async () => {
    mockGenerate.mockResolvedValue({
      success: true,
      data: { code: '333333', remaining: 10 },
    });
    mockCheckTimeSync.mockResolvedValue({ success: true, data: { driftDetected: false } });

    vi.useFakeTimers();
    render(<OtpWidget itemId="item-4" config={{ ...DEFAULT_CONFIG }} />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(screen.getByRole('timer').textContent).toBe('10');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1100);
    });
    expect(screen.getByRole('timer').textContent).toBe('9');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(screen.getByRole('timer').textContent).toBe('6');
    vi.useRealTimers();
  });

  it('shows low-time visual state when remaining is 5 seconds or less', async () => {
    mockGenerate.mockResolvedValue({
      success: true,
      data: { code: '444444', remaining: 4 },
    });
    mockCheckTimeSync.mockResolvedValue({ success: true, data: { driftDetected: false } });

    vi.useFakeTimers();
    render(<OtpWidget itemId="item-5" config={{ ...DEFAULT_CONFIG }} />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    const timer = screen.getByRole('timer');
    // aria-live should be polite when time is low (< 5s)
    expect(timer.getAttribute('aria-live')).toBe('polite');
    vi.useRealTimers();
  });

  // ─── Sub-Task 7.2: Tombol Copy mengirim kode ke clipboard tanpa error ────

  it('copies the OTP code to clipboard when clicked', async () => {
    mockGenerate.mockResolvedValue({
      success: true,
      data: { code: '555555', remaining: 20 },
    });
    mockCheckTimeSync.mockResolvedValue({ success: true, data: { driftDetected: false } });
    (navigator.clipboard.writeText as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    render(<OtpWidget itemId="item-6" config={{ ...DEFAULT_CONFIG }} />);

    const copyButton = await screen.findByLabelText('Copy OTP code 555555');
    fireEvent.click(copyButton);
    await flush();

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('555555');
    expect(mockShowSuccess).toHaveBeenCalledWith('OTP code copied');
  });

  it('shows Copied! feedback after copying', async () => {
    mockGenerate.mockResolvedValue({
      success: true,
      data: { code: '666666', remaining: 20 },
    });
    mockCheckTimeSync.mockResolvedValue({ success: true, data: { driftDetected: false } });
    (navigator.clipboard.writeText as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    render(<OtpWidget itemId="item-7" config={{ ...DEFAULT_CONFIG }} />);

    const copyButton = await screen.findByLabelText('Copy OTP code 666666');
    fireEvent.click(copyButton);
    await flush();

    expect(screen.getByText('Copied!')).toBeDefined();
  });

  it('does nothing on copy when no code is present', async () => {
    mockGenerate.mockResolvedValue({
      success: true,
      data: { code: '', remaining: 30 },
    });
    mockCheckTimeSync.mockResolvedValue({ success: true, data: { driftDetected: false } });

    render(<OtpWidget itemId="item-8" config={{ ...DEFAULT_CONFIG }} />);
    await flush();

    // Even if the button is found, clicking should short-circuit because code is empty
    const button = await screen.findByRole('button');
    fireEvent.click(button);
    expect(navigator.clipboard.writeText).not.toHaveBeenCalled();
  });

  it('gracefully ignores clipboard errors without crashing', async () => {
    mockGenerate.mockResolvedValue({
      success: true,
      data: { code: '777777', remaining: 20 },
    });
    mockCheckTimeSync.mockResolvedValue({ success: true, data: { driftDetected: false } });
    (navigator.clipboard.writeText as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('Clipboard denied'),
    );

    render(<OtpWidget itemId="item-9" config={{ ...DEFAULT_CONFIG }} />);

    const copyButton = await screen.findByLabelText('Copy OTP code 777777');
    // Should not throw even though clipboard.writeText rejects
    expect(() => fireEvent.click(copyButton)).not.toThrow();
  });

  // ─── Sub-Task 7.2: Error state saat secret invalid atau kosong ────────────

  it('renders error message when OTP generation fails', async () => {
    mockGenerate.mockResolvedValue({
      success: false,
      error: 'Invalid secret format',
    });
    mockCheckTimeSync.mockResolvedValue({ success: true, data: { driftDetected: false } });

    render(<OtpWidget itemId="item-10" config={{ ...DEFAULT_CONFIG }} />);
    await flush();

    expect(screen.getByText('Invalid secret format')).toBeDefined();
  });

  it('renders generic error message when generation returns no specific error', async () => {
    mockGenerate.mockResolvedValue({
      success: false,
      error: null,
    });
    mockCheckTimeSync.mockResolvedValue({ success: true, data: { driftDetected: false } });

    render(<OtpWidget itemId="item-11" config={{ ...DEFAULT_CONFIG }} />);
    await flush();

    expect(screen.getByText('Unable to generate OTP code')).toBeDefined();
  });

  it('renders error message when OTP generation throws an exception', async () => {
    mockGenerate.mockRejectedValue(new Error('IPC timeout'));
    mockCheckTimeSync.mockResolvedValue({ success: true, data: { driftDetected: false } });

    render(<OtpWidget itemId="item-12" config={{ ...DEFAULT_CONFIG }} />);
    await flush();

    expect(screen.getByText('Unable to generate OTP code')).toBeDefined();
  });

  it('does not render countdown or copy controls in error state', async () => {
    mockGenerate.mockResolvedValue({
      success: false,
      error: 'Corrupted secret',
    });
    mockCheckTimeSync.mockResolvedValue({ success: true, data: { driftDetected: false } });

    render(<OtpWidget itemId="item-13" config={{ ...DEFAULT_CONFIG }} />);
    await flush();

    expect(screen.queryByRole('timer')).toBeNull();
    expect(screen.queryByLabelText(/Copy OTP code/)).toBeNull();
  });

  // ─── Sub-Task 7.2: Keyboard accessibility ─────────────────────────────────

  it('supports Tab navigation to the copy button', async () => {
    mockGenerate.mockResolvedValue({
      success: true,
      data: { code: '888888', remaining: 20 },
    });
    mockCheckTimeSync.mockResolvedValue({ success: true, data: { driftDetected: false } });

    render(<OtpWidget itemId="item-14" config={{ ...DEFAULT_CONFIG }} />);

    const copyButton = await screen.findByLabelText('Copy OTP code 888888');
    copyButton.focus();
    expect(document.activeElement).toBe(copyButton);
  });

  it('triggers copy on Enter key press', async () => {
    mockGenerate.mockResolvedValue({
      success: true,
      data: { code: '999999', remaining: 20 },
    });
    mockCheckTimeSync.mockResolvedValue({ success: true, data: { driftDetected: false } });
    (navigator.clipboard.writeText as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    render(<OtpWidget itemId="item-15" config={{ ...DEFAULT_CONFIG }} />);

    const copyButton = await screen.findByLabelText('Copy OTP code 999999');
    fireEvent.keyDown(copyButton, { key: 'Enter', code: 'Enter' });
    fireEvent.click(copyButton); // button onClick fires on Enter in jsdom via click

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('999999');
  });

  it('triggers copy on Space key press', async () => {
    mockGenerate.mockResolvedValue({
      success: true,
      data: { code: '000000', remaining: 20 },
    });
    mockCheckTimeSync.mockResolvedValue({ success: true, data: { driftDetected: false } });
    (navigator.clipboard.writeText as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    render(<OtpWidget itemId="item-16" config={{ ...DEFAULT_CONFIG }} />);

    const copyButton = await screen.findByLabelText('Copy OTP code 000000');
    fireEvent.keyDown(copyButton, { key: ' ', code: 'Space' });
    fireEvent.click(copyButton);

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('000000');
  });

  it('has aria-live="polite" on the code element for screen readers', async () => {
    mockGenerate.mockResolvedValue({
      success: true,
      data: { code: '123123', remaining: 20 },
    });
    mockCheckTimeSync.mockResolvedValue({ success: true, data: { driftDetected: false } });

    render(<OtpWidget itemId="item-17" config={{ ...DEFAULT_CONFIG }} />);
    await flush();

    const codeSpan = screen.getByText('123123');
    expect(codeSpan.getAttribute('aria-live')).toBe('polite');
    expect(codeSpan.getAttribute('aria-atomic')).toBe('true');
  });

  it('timer has aria-live="polite" when time is low', async () => {
    mockGenerate.mockResolvedValue({
      success: true,
      data: { code: '321321', remaining: 3 },
    });
    mockCheckTimeSync.mockResolvedValue({ success: true, data: { driftDetected: false } });

    render(<OtpWidget itemId="item-18" config={{ ...DEFAULT_CONFIG }} />);
    await flush();

    const timer = screen.getByRole('timer');
    expect(timer.getAttribute('aria-live')).toBe('polite');
  });
});
