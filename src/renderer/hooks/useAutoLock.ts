import { useEffect, useRef, useState, useCallback } from 'react';
import { useAuthStore } from '../stores/authStore';
import { useSettingsStore } from '../stores/settingsStore';

const WARNING_BEFORE_LOCK = 30000;
const TICK_INTERVAL = 1000;

export interface UseAutoLockReturn {
  timeRemaining: number;
  showWarning: boolean;
  extendTimer: () => void;
  isEnabled: boolean;
}

/**
 * Hook that manages the auto-lock timer.
 *
 * When the user is authenticated and `autoLockTime > 0`, this hook:
 * 1. Tracks user activity (mouse, keyboard, scroll)
 * 2. Shows a warning 30 seconds before the lock timer expires
 * 3. Calls `authStore.lock()` when the timer reaches zero
 * 4. Resets the timer on any activity
 * 5. Resets the timer when the active vault changes (vault switch)
 *
 * @returns Object with `timeRemaining`, `showWarning`, `extendTimer`, and `isEnabled`
 */
export function useAutoLock(): UseAutoLockReturn {
  const { lock, isAuthenticated, activeVaultId } = useAuthStore();
  const { settings, loadSettings, isLoaded } = useSettingsStore();

  const [timeRemaining, setTimeRemaining] = useState<number>(Infinity);
  const [showWarning, setShowWarning] = useState(false);
  const [isEnabled, setIsEnabled] = useState(true);

  const lastActivityRef = useRef<number>(Date.now());
  const tickIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lockTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const warningTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isLockingRef = useRef(false);
  const prevVaultIdRef = useRef<string | null>(null);

  const autoLockTime = settings.autoLockTime;

  const clearAllTimers = useCallback(() => {
    if (tickIntervalRef.current) {
      clearInterval(tickIntervalRef.current);
      tickIntervalRef.current = null;
    }
    if (lockTimerRef.current) {
      clearTimeout(lockTimerRef.current);
      lockTimerRef.current = null;
    }
    if (warningTimerRef.current) {
      clearTimeout(warningTimerRef.current);
      warningTimerRef.current = null;
    }
  }, []);

  const startTimers = useCallback(() => {
    if (!isAuthenticated || autoLockTime <= 0) return;
    clearAllTimers();

    const now = Date.now();
    lastActivityRef.current = now;
    setShowWarning(false);
    setTimeRemaining(autoLockTime);

    warningTimerRef.current = setTimeout(
      () => {
        const elapsed = Date.now() - lastActivityRef.current;
        if (elapsed >= autoLockTime - WARNING_BEFORE_LOCK && !isLockingRef.current) {
          setShowWarning(true);
        }
      },
      Math.max(0, autoLockTime - WARNING_BEFORE_LOCK),
    );

    lockTimerRef.current = setTimeout(() => {
      if (!isLockingRef.current) {
        isLockingRef.current = true;
        setShowWarning(true);
        lock();
      }
    }, autoLockTime);

    tickIntervalRef.current = setInterval(() => {
      const elapsed = Date.now() - lastActivityRef.current;
      const remaining = Math.max(0, autoLockTime - elapsed);
      setTimeRemaining(remaining);
      if (remaining <= 0) {
        setTimeRemaining(0);
      }
    }, TICK_INTERVAL);
  }, [autoLockTime, isAuthenticated, lock, clearAllTimers]);

  const resetTimer = useCallback(() => {
    if (!isAuthenticated || autoLockTime <= 0) return;
    lastActivityRef.current = Date.now();
    setShowWarning(false);
    startTimers();
  }, [isAuthenticated, autoLockTime, startTimers]);

  const extendTimer = useCallback(() => {
    resetTimer();
  }, [resetTimer]);

  useEffect(() => {
    if (!isLoaded) {
      loadSettings();
    }
  }, [isLoaded, loadSettings]);

  useEffect(() => {
    setIsEnabled(autoLockTime > 0);
    if (isAuthenticated && autoLockTime > 0) {
      startTimers();
    } else {
      clearAllTimers();
      setShowWarning(false);
      setTimeRemaining(Infinity);
    }
    return () => {
      clearAllTimers();
    };
  }, [autoLockTime, isAuthenticated, startTimers, clearAllTimers]);

  useEffect(() => {
    if (!isAuthenticated || autoLockTime <= 0) return;

    const activityEvents = [
      'mousemove',
      'mousedown',
      'click',
      'keydown',
      'scroll',
      'wheel',
      'touchstart',
      'touchmove',
    ];

    const handleActivity = () => {
      resetTimer();
    };

    for (const event of activityEvents) {
      window.addEventListener(event, handleActivity, { passive: true });
    }

    const handleVisibility = () => {
      if (document.hidden) {
        lastActivityRef.current = Date.now();
      } else {
        const elapsed = Date.now() - lastActivityRef.current;
        if (elapsed >= autoLockTime && !isLockingRef.current) {
          isLockingRef.current = true;
          lock();
        } else {
          resetTimer();
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibility);

    const handlePowerMonitor = (_event: Event) => {
      // SECURITY: On lock-screen or suspend, lock immediately.
      // The power monitor signals the OS is locking/suspending,
      // so we should lock regardless of remaining idle time.
      if (!isLockingRef.current) {
        isLockingRef.current = true;
        lock();
      }
    };

    window.addEventListener('power-monitor-lock-screen', handlePowerMonitor as EventListener);
    window.addEventListener('power-monitor-suspend', handlePowerMonitor as EventListener);

    return () => {
      for (const event of activityEvents) {
        window.removeEventListener(event, handleActivity);
      }
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('power-monitor-lock-screen', handlePowerMonitor as EventListener);
      window.removeEventListener('power-monitor-suspend', handlePowerMonitor as EventListener);
      clearAllTimers();
    };
  }, [isAuthenticated, autoLockTime, lock, resetTimer, clearAllTimers]);

  useEffect(() => {
    if (!isAuthenticated) {
      isLockingRef.current = false;
    }
  }, [isAuthenticated]);

  // Reset auto-lock timer when active vault changes.
  // This prevents carrying over idle time from the old vault to the new one.
  useEffect(() => {
    const prevVaultId = prevVaultIdRef.current;
    prevVaultIdRef.current = activeVaultId;

    // Skip the initial mount (prevVaultId is null on first render)
    if (prevVaultId === null) return;

    // If the vault changed while authenticated, reset the timer
    // so the new vault starts with a fresh idle period.
    if (activeVaultId !== prevVaultId && isAuthenticated && autoLockTime > 0) {
      isLockingRef.current = false;
      startTimers();
    }
  }, [activeVaultId, isAuthenticated, autoLockTime, startTimers]);

  const roundedTimeRemaining =
    timeRemaining === Infinity ? Infinity : Math.ceil(timeRemaining / 1000) * 1000;

  return {
    timeRemaining: roundedTimeRemaining,
    showWarning,
    extendTimer,
    isEnabled,
  };
}
