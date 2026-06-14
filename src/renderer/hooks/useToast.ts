import { useCallback } from 'react';
import { useToastStore, type ToastType } from '../stores/toastStore';

export interface UseToastReturn {
  showToast: (message: string, type?: ToastType, durationMs?: number) => void;
  showSuccess: (message: string, durationMs?: number) => void;
  showError: (message: string, durationMs?: number) => void;
  showInfo: (message: string, durationMs?: number) => void;
}

/**
 * Convenience hook for pushing transient toast notifications.
 */
export function useToast(): UseToastReturn {
  const addToast = useToastStore((state) => state.addToast);

  const showToast = useCallback(
    (message: string, type: ToastType = 'info', durationMs = 4000) => {
      addToast(message, type, durationMs);
    },
    [addToast],
  );

  const showSuccess = useCallback(
    (message: string, durationMs = 4000) => showToast(message, 'success', durationMs),
    [showToast],
  );

  const showError = useCallback(
    (message: string, durationMs = 4000) => showToast(message, 'error', durationMs),
    [showToast],
  );

  const showInfo = useCallback(
    (message: string, durationMs = 4000) => showToast(message, 'info', durationMs),
    [showToast],
  );

  return { showToast, showSuccess, showError, showInfo };
}
