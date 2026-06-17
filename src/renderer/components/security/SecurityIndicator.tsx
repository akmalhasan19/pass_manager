import React from 'react';
import { useTranslation } from '../../i18n/useTranslation';

export interface SecurityIndicatorProps {
  /**
   * Whether to show the indicator (typically when vault is locked)
   */
  isVisible: boolean;
  /**
   * Custom CSS class name
   */
  className?: string;
}

/**
 * SecurityIndicator Component
 *
 * Displays a visual indicator and reassuring message that the vault is locked
 * and encryption keys have been securely wiped from memory.
 *
 * SECURITY: This component provides visual confirmation to users that the
 * application has performed the memory wipe operation as documented in the
 * security audit. It builds user confidence in the zero-knowledge architecture.
 */
export default function SecurityIndicator({ isVisible, className = '' }: SecurityIndicatorProps): React.ReactElement | null {
  const { t } = useTranslation();

  if (!isVisible) {
    return null;
  }

  return (
    <div className={`animate-slide-up rounded-lg border border-success-400/30 bg-success-50 px-4 py-3 dark:border-success-500/40 dark:bg-success-500/10 ${className}`}>
      <div className="flex items-start gap-3">
        {/* Lock Icon */}
        <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center text-success-600 dark:text-success-400">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-5 w-5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
            />
          </svg>
        </div>

        {/* Content */}
        <div className="flex-1 space-y-1">
          <p className="text-sm font-medium text-success-700 dark:text-success-300">
            {t('security.lockScreen.indicator')}
          </p>
          <p className="text-xs text-success-600 dark:text-success-400">
            {t('security.lockScreen.memoryWiped')}
          </p>
        </div>
      </div>
    </div>
  );
}
