// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { useAutoLock } from '@renderer/hooks/useAutoLock';

// Mock stores
const mockLock = vi.fn();
const mockLoadSettings = vi.fn();

let mockIsAuthenticated = true;
let mockIsLoaded = true;
let mockSettings = { autoLockTime: 60000 };

vi.mock('@renderer/stores/authStore', () => ({
  useAuthStore: (
    selector?: (s: { isAuthenticated: boolean; lock: () => Promise<void> }) => unknown,
  ) => {
    const state = { isAuthenticated: mockIsAuthenticated, lock: mockLock };
    return selector ? selector(state) : state;
  },
}));

vi.mock('@renderer/stores/settingsStore', () => ({
  useSettingsStore: (
    selector?: (s: {
      settings: { autoLockTime: number };
      loadSettings: () => void;
      isLoaded: boolean;
    }) => unknown,
  ) => {
    const state = {
      settings: mockSettings,
      loadSettings: mockLoadSettings,
      isLoaded: mockIsLoaded,
    };
    return selector ? selector(state) : state;
  },
}));

// Minimal test component
function TestComp({ onResult }: { onResult: (r: ReturnType<typeof useAutoLock>) => void }) {
  const r = useAutoLock();
  React.useEffect(() => {
    onResult(r);
  });
  return React.createElement('div');
}

describe('Auto-Lock Timer Integration', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockIsAuthenticated = true;
    mockIsLoaded = true;
    mockSettings = { autoLockTime: 60000 };
    mockLock.mockClear();
    mockLoadSettings.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should enable timer when authenticated', () => {
    let result: ReturnType<typeof useAutoLock> | null = null;
    render(
      React.createElement(TestComp, {
        onResult: (r) => {
          result = r;
        },
      }),
    );
    expect(result!.isEnabled).toBe(true);
    expect(result!.showWarning).toBe(false);
  });

  it('should disable timer when autoLockTime is 0', () => {
    mockSettings = { autoLockTime: 0 };
    let result: ReturnType<typeof useAutoLock> | null = null;
    render(
      React.createElement(TestComp, {
        onResult: (r) => {
          result = r;
        },
      }),
    );
    expect(result!.isEnabled).toBe(false);
  });

  it('should call lock after autoLockTime expires', () => {
    mockSettings = { autoLockTime: 5000 };
    render(React.createElement(TestComp, { onResult: () => {} }));

    expect(mockLock).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(6000);
    });
    expect(mockLock).toHaveBeenCalledTimes(1);
  });

  it('should reset timer on mouse activity', () => {
    mockSettings = { autoLockTime: 10000 };
    render(React.createElement(TestComp, { onResult: () => {} }));

    act(() => {
      vi.advanceTimersByTime(9000);
    });
    expect(mockLock).not.toHaveBeenCalled();

    act(() => {
      window.dispatchEvent(new MouseEvent('mousemove'));
    });
    act(() => {
      vi.advanceTimersByTime(9000);
    });
    expect(mockLock).not.toHaveBeenCalled();

    // Now past the full 10s from reset
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(mockLock).toHaveBeenCalledTimes(1);
  });

  it('should reset timer on keyboard activity', () => {
    mockSettings = { autoLockTime: 10000 };
    render(React.createElement(TestComp, { onResult: () => {} }));

    act(() => {
      vi.advanceTimersByTime(8000);
    });
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
    });

    act(() => {
      vi.advanceTimersByTime(8000);
    });
    expect(mockLock).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(mockLock).toHaveBeenCalledTimes(1);
  });

  it('should not lock before time elapses', () => {
    mockSettings = { autoLockTime: 30000 };
    render(React.createElement(TestComp, { onResult: () => {} }));

    act(() => {
      vi.advanceTimersByTime(29000);
    });
    expect(mockLock).not.toHaveBeenCalled();
  });

  it('should lock only once even with excess time', () => {
    mockSettings = { autoLockTime: 5000 };
    render(React.createElement(TestComp, { onResult: () => {} }));

    act(() => {
      vi.advanceTimersByTime(20000);
    });
    expect(mockLock).toHaveBeenCalledTimes(1);
  });

  it('should not lock when not authenticated', () => {
    mockIsAuthenticated = false;
    mockSettings = { autoLockTime: 5000 };
    render(React.createElement(TestComp, { onResult: () => {} }));

    act(() => {
      vi.advanceTimersByTime(10000);
    });
    expect(mockLock).not.toHaveBeenCalled();
  });

  it('should reset on scroll activity', () => {
    mockSettings = { autoLockTime: 10000 };
    render(React.createElement(TestComp, { onResult: () => {} }));

    act(() => {
      vi.advanceTimersByTime(8000);
    });
    act(() => {
      window.dispatchEvent(new Event('scroll'));
    });

    act(() => {
      vi.advanceTimersByTime(9000);
    });
    expect(mockLock).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(mockLock).toHaveBeenCalled();
  });
});
