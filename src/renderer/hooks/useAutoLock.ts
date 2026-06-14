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

export function useAutoLock(): UseAutoLockReturn {
  const { lock, isAuthenticated } = useAuthStore();
  const { settings, loadSettings, isLoaded } = useSettingsStore();

  const [timeRemaining, setTimeRemaining] = useState<number>(Infinity);
  const [showWarning, setShowWarning] = useState(false);
  const [isEnabled, setIsEnabled] = useState(true);

  const lastActivityRef = useRef<number>(Date.now());
  const tickIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lockTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const warningTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isLockingRef = useRef(false);

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

    warningTimerRef.current = setTimeout(() => {
      const elapsed = Date.now() - lastActivityRef.current;
      if (elapsed >= autoLockTime - WARNING_BEFORE_LOCK && !isLockingRef.current) {
        setShowWarning(true);
      }
    }, Math.max(0, autoLockTime - WARNING_BEFORE_LOCK));

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

    const activityEvents = ['mousemove', 'mousedown', 'click', 'keydown', 'scroll', 'wheel', 'touchstart', 'touchmove'];

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
      lastActivityRef.current = Date.now();
      const elapsed = Date.now() - lastActivityRef.current;
      if (elapsed >= autoLockTime && !isLockingRef.current) {
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

  const roundedTimeRemaining = timeRemaining === Infinity ? Infinity : Math.ceil(timeRemaining / 1000) * 1000;

  return {
    timeRemaining: roundedTimeRemaining,
    showWarning,
    extendTimer,
    isEnabled,
  };
}
