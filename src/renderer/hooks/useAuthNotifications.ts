import { useEffect, useRef } from 'react';
import { useAuthStore } from '../stores/authStore';
import { useToastStore } from '../stores/toastStore';
import { useTranslation } from '../i18n/useTranslation';

/**
 * Hook that displays toast notifications for authentication state changes.
 *
 * SECURITY: Shows reassuring messages to users when the vault is locked,
 * confirming that encryption keys have been securely wiped from memory.
 *
 * This hook runs on the renderer process and can safely use i18n for localization.
 */
export function useAuthNotifications(): void {
  const { status } = useAuthStore();
  const { addToast } = useToastStore();
  const { t } = useTranslation();

  const previousStatusRef = useRef<string | null>(null);

  useEffect(() => {
    const previousStatus = previousStatusRef.current;
    previousStatusRef.current = status;

    // Show notification when vault transitions to locked state
    if (previousStatus === 'unlocked' && status === 'locked') {
      addToast(t('security.lock.success'), 'success', 5000);
    }
  }, [status, addToast, t]);
}
