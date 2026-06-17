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
let mockActiveVaultId: string | null = 'vault-1';

vi.mock('@renderer/stores/authStore', () => ({
  useAuthStore: (
    selector?: (s: {
      isAuthenticated: boolean;
      lock: () => Promise<void>;
      activeVaultId: string | null;
    }) => unknown,
  ) => {
    const state = {
      isAuthenticated: mockIsAuthenticated,
      lock: mockLock,
      activeVaultId: mockActiveVaultId,
    };
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
    mockActiveVaultId = 'vault-1';
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

  // --- Vault-aware auto-lock tests ---

  it('should not lock when activeVaultId is null (no vault open)', () => {
    mockActiveVaultId = null;
    mockIsAuthenticated = false; // No vault open means not authenticated
    mockSettings = { autoLockTime: 5000 };
    render(React.createElement(TestComp, { onResult: () => {} }));

    act(() => {
      vi.advanceTimersByTime(10000);
    });
    // When no vault is open and not authenticated, the hook should not lock
    expect(mockLock).not.toHaveBeenCalled();
  });

  it('should reset timer when activeVaultId changes (vault switch)', () => {
    mockSettings = { autoLockTime: 10000 };

    const { rerender } = render(
      React.createElement(TestComp, { onResult: () => {} }),
    );

    // Advance 8 seconds (near lock threshold)
    act(() => {
      vi.advanceTimersByTime(8000);
    });
    expect(mockLock).not.toHaveBeenCalled();

    // Simulate vault switch: change activeVaultId
    mockActiveVaultId = 'vault-2';
    rerender(React.createElement(TestComp, { onResult: () => {} }));

    // Advance 8 seconds after switch — should NOT lock because timer was reset
    act(() => {
      vi.advanceTimersByTime(8000);
    });
    expect(mockLock).not.toHaveBeenCalled();

    // Advance remaining 2 seconds — should lock now (full 10s from vault switch)
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(mockLock).toHaveBeenCalledTimes(1);
  });

  it('should not carry idle state from old vault to new vault', () => {
    mockSettings = { autoLockTime: 5000 };

    const { rerender } = render(
      React.createElement(TestComp, { onResult: () => {} }),
    );

    // Advance 4 seconds (close to lock)
    act(() => {
      vi.advanceTimersByTime(4000);
    });

    // Switch vault — this should reset the timer
    mockActiveVaultId = 'vault-new';
    rerender(React.createElement(TestComp, { onResult: () => {} }));

    // Advance only 3 seconds after switch — should NOT lock
    // (old 4s idle should not carry over)
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(mockLock).not.toHaveBeenCalled();

    // Advance to full 5s from switch — should lock
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(mockLock).toHaveBeenCalledTimes(1);
  });

  it('should lock the active vault (not assume single global vault)', () => {
    mockActiveVaultId = 'vault-specific';
    mockSettings = { autoLockTime: 5000 };
    render(React.createElement(TestComp, { onResult: () => {} }));

    act(() => {
      vi.advanceTimersByTime(6000);
    });

    // lock() is called — the authStore.lock() handles locking the active vault
    expect(mockLock).toHaveBeenCalledTimes(1);
  });

  it('should not reset timer on vault change when not authenticated', () => {
    mockSettings = { autoLockTime: 5000 };
    mockIsAuthenticated = true;

    const { rerender } = render(
      React.createElement(TestComp, { onResult: () => {} }),
    );

    // Switch vault while authenticated
    mockActiveVaultId = 'vault-2';
    rerender(React.createElement(TestComp, { onResult: () => {} }));

    // Now become unauthenticated
    mockIsAuthenticated = false;
    mockActiveVaultId = null;
    rerender(React.createElement(TestComp, { onResult: () => {} }));

    act(() => {
      vi.advanceTimersByTime(10000);
    });

    // Should not lock when not authenticated
    expect(mockLock).not.toHaveBeenCalled();
  });

  it('should reset the lock-in-progress flag when the active vault changes after a lock', () => {
    mockSettings = { autoLockTime: 5000 };

    const { rerender } = render(
      React.createElement(TestComp, { onResult: () => {} }),
    );

    // Let the timer lock the old vault.
    act(() => {
      vi.advanceTimersByTime(6000);
    });
    expect(mockLock).toHaveBeenCalledTimes(1);

    // Simulate a vault switch/unlock after the lock. The hook must reset its
    // internal locking flag so the new vault gets a fresh timer instead of
    // staying disabled or firing a stale lock callback.
    mockLock.mockClear();
    mockActiveVaultId = 'vault-after-lock';
    rerender(React.createElement(TestComp, { onResult: () => {} }));

    act(() => {
      vi.advanceTimersByTime(4000);
    });
    expect(mockLock).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(mockLock).toHaveBeenCalledTimes(1);
  });
});
