import { beforeEach, describe, expect, it, vi } from 'vitest';

const clipboardState = {
  text: '',
  cleared: false,
};

vi.mock('electron', () => ({
  clipboard: {
    write: vi.fn(({ text }: { text: string }) => {
      clipboardState.text = text;
      clipboardState.cleared = false;
    }),
    readText: vi.fn(() => clipboardState.text),
    clear: vi.fn(() => {
      clipboardState.text = '';
      clipboardState.cleared = true;
    }),
  },
  Notification: class MockNotification {
    static isSupported = vi.fn(() => false);
    show = vi.fn();
  },
}));

describe('clipboardService', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    clipboardState.text = '';
    clipboardState.cleared = false;
    vi.resetModules();
  });

  it('copies text with a bounded auto-clear timeout and user-facing message', async () => {
    const { clipboard } = await import('electron');
    const { getClipboardStatus, writeToClipboard } = await import(
      '../../../src/main/services/clipboardService'
    );

    const result = writeToClipboard('secret-password', {
      type: 'password',
      clearAfterSeconds: 45,
      showToast: false,
    });

    expect(result).toEqual({
      clearAfterSeconds: 45,
      message: 'Password copied - will clear in 45s',
    });
    expect(clipboard.write).toHaveBeenCalledWith({ text: 'secret-password' });
    expect(getClipboardStatus()).toMatchObject({
      hasAutoClear: true,
      type: 'password',
      message: 'Password copied - will clear in 45s',
    });

    vi.advanceTimersByTime(45_000);

    expect(clipboard.clear).toHaveBeenCalledTimes(1);
    expect(getClipboardStatus()).toEqual({
      hasAutoClear: false,
      clearInSeconds: null,
      message: null,
      type: null,
    });
  });

  it('does not clear clipboard content replaced after SecurePass copy', async () => {
    const { clipboard } = await import('electron');
    const { writeToClipboard } = await import('../../../src/main/services/clipboardService');

    writeToClipboard('secret-password', {
      type: 'password',
      clearAfterSeconds: 30,
      showToast: false,
    });
    clipboardState.text = 'user copied something else';

    vi.advanceTimersByTime(30_000);

    expect(clipboard.clear).not.toHaveBeenCalled();
    expect(clipboardState.text).toBe('user copied something else');
  });
});
