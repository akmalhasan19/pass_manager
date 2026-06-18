import React, { useCallback } from 'react';
import { useSettingsStore } from '../../stores/settingsStore';
import { useTranslation } from '../../i18n/useTranslation';

/**
 * OtpOnboardingBanner
 *
 * Displays a one-time informational banner on the first update after
 * OTP / 2FA support was added. The banner is shown once and dismissed
 * permanently by setting `otpOnboardingShown = true` in user settings.
 *
 * PERFORMANCE: This component renders nothing once dismissed. It does not
 * create timers, intervals, or network requests. It uses the existing
 * Zustand settings store which is already loaded on app startup.
 */
export default function OtpOnboardingBanner(): React.ReactElement | null {
  const { settings, updateSetting } = useSettingsStore();
  const { t } = useTranslation();

  const handleDismiss = useCallback(() => {
    updateSetting('otpOnboardingShown', true);
  }, [updateSetting]);

  if (settings.otpOnboardingShown) {
    return null;
  }

  return (
    <div
      role="status"
      className="mx-4 mb-4 rounded-xl border border-primary/20 bg-primary/5 p-4 dark:border-primary/30 dark:bg-primary/10"
    >
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-4 w-4 text-primary"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
            />
          </svg>
        </div>
        <div className="flex-1">
          <h3 className="text-sm font-semibold text-surface-900 dark:text-surface-100">
            {t('otp.onboarding.title')}
          </h3>
          <p className="mt-1 text-xs leading-relaxed text-surface-600 dark:text-surface-400">
            {t('otp.onboarding.description')}
          </p>
          <p className="mt-1 text-[10px] italic text-surface-400 dark:text-surface-500">
            {t('otp.onboarding.optional')}
          </p>
        </div>
        <button
          type="button"
          onClick={handleDismiss}
          className="shrink-0 rounded-lg border border-surface-200 bg-white px-3 py-1.5 text-xs font-medium text-surface-700 transition-colors hover:bg-surface-100 dark:border-surface-600 dark:bg-surface-800 dark:text-surface-300 dark:hover:bg-surface-700"
          aria-label={t('otp.onboarding.dismiss')}
        >
          {t('otp.onboarding.dismiss')}
        </button>
      </div>
    </div>
  );
}
