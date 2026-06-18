/**
 * OtpWidget.tsx
 *
 * Displays the current TOTP code with a smooth countdown animation.
 *
 * PERFORMANCE DESIGN:
 * - Uses a SINGLE global timer (otpTimerService) instead of per-widget
 *   setInterval calls. All OtpWidget instances share one interval.
 * - IPC calls are made ONCE per TOTP period (e.g., every 30s) instead of
 *   once per second. The remaining-seconds countdown is calculated locally.
 * - The circular progress animation uses requestAnimationFrame for smooth
 *   60fps rendering without blocking the main thread.
 * - The global interval is ONLY active when at least one OtpWidget is mounted.
 *
 * SECURITY: OTP codes are generated entirely in the main process via IPC.
 * The plaintext secret is never sent to the renderer.
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import type { TotpConfig } from '../../../shared/types';
import { useToast } from '../../hooks/useToast';
import { useSettingsStore } from '../../stores/settingsStore';
import { useTranslation } from '../../i18n/useTranslation';
import { otpTimerService } from '../../services/otpTimerService';

interface OtpWidgetProps {
  itemId: string;
  config: TotpConfig;
}

const CIRCLE_RADIUS = 18;
const CIRCLE_STROKE = 3;
const CIRCLE_CIRCUMFERENCE = 2 * Math.PI * CIRCLE_RADIUS;

/**
 * Animate the circular countdown progress smoothly using
 * requestAnimationFrame. This provides 60fps rendering without
 * blocking the main thread.
 */
function useSmoothProgress(remaining: number, period: number): number {
  const [progress, setProgress] = useState<number>(() =>
    period > 0 ? (remaining / period) * 100 : 0,
  );
  const rafRef = useRef<number | null>(null);
  const startTimeRef = useRef<number>(performance.now());
  const startProgressRef = useRef<number>(progress);
  const targetProgressRef = useRef<number>(progress);

  useEffect(() => {
    // When remaining changes (code refreshed), reset the animation target
    const now = performance.now();
    startTimeRef.current = now;
    const newProgress = period > 0 ? (remaining / period) * 100 : 0;
    startProgressRef.current = progress;
    targetProgressRef.current = newProgress;

    const animate = (time: number) => {
      const elapsed = time - startTimeRef.current;
      // Duration should be ~1s to match the tick interval
      const duration = 1000;
      const t = Math.min(elapsed / duration, 1);
      // Ease-out cubic for a smooth decelerating feel
      const eased = 1 - Math.pow(1 - t, 3);
      const current = startProgressRef.current + (targetProgressRef.current - startProgressRef.current) * eased;
      setProgress(current);

      if (t < 1) {
        rafRef.current = requestAnimationFrame(animate);
      }
    };

    rafRef.current = requestAnimationFrame(animate);

    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [remaining, period]);

  return progress;
}

export default function OtpWidget({ itemId, config }: OtpWidgetProps): React.ReactElement {
  const [code, setCode] = useState<string>('');
  const [remaining, setRemaining] = useState<number>(config.period);
  const [error, setError] = useState<string | null>(null);
  const [isCopied, setIsCopied] = useState(false);
  const [showCopyWarning, setShowCopyWarning] = useState(false);
  const [isCodeRevealed, setIsCodeRevealed] = useState(false);
  const [clockDriftDetected, setClockDriftDetected] = useState(false);

  const secondsSinceLastRefresh = useRef<number>(0);
  const isFetchingRef = useRef<boolean>(false);
  const { showSuccess } = useToast();
  const { t } = useTranslation();
  const { settings } = useSettingsStore();
  const isPrivacyMode = settings.otpPrivacyMode;

  const progress = useSmoothProgress(remaining, config.period);
  const dashOffset = CIRCLE_CIRCUMFERENCE * (1 - progress / 100);
  const isLowTime = remaining <= 5;
  const shouldBlur = isPrivacyMode && !isCodeRevealed;

  /**
   * Fetch the latest OTP code from the main process via IPC.
   * This is called ONCE per TOTP period (e.g., every 30 seconds)
   * rather than once per second.
   */
  const refreshCode = useCallback(async () => {
    if (isFetchingRef.current) return; // Prevent concurrent fetches
    isFetchingRef.current = true;

    try {
      const result = await window.electron.otp.generate(itemId);
      if (result.success) {
        setCode(result.data.code);
        setRemaining(result.data.remaining);
        setError(null);
        secondsSinceLastRefresh.current = 0;
      } else {
        setError(result.error || 'Unable to generate OTP code');
        setCode('');
      }
    } catch {
      setError('Unable to generate OTP code');
      setCode('');
    } finally {
      isFetchingRef.current = false;
    }
  }, [itemId]);

  /**
   * Called once per second by the global timer aggregator.
   * Decrements the local remaining countdown without IPC calls.
   * When the countdown reaches 0, fetches a new code.
   */
  const onGlobalTick = useCallback(
    (_elapsedSeconds: number) => {
      secondsSinceLastRefresh.current += 1;

      setRemaining((prev) => {
        const next = prev - 1;
        // When the code period expires, fetch a new code
        if (next <= 0) {
          // Schedule the refresh asynchronously to avoid state update conflicts
          setTimeout(() => refreshCode(), 0);
          return 0;
        }
        return next;
      });
    },
    [refreshCode],
  );

  /**
   * Check for system clock drift via IPC.
   * Shows a gentle warning if the clock has shifted significantly.
   */
  const checkClockDrift = useCallback(async () => {
    try {
      const result = await window.electron.otp.checkTimeSync();
      if (result.success && result.data.driftDetected) {
        setClockDriftDetected(true);
      }
    } catch {
      // Silently ignore — clock drift check is non-critical
    }
  }, []);

  useEffect(() => {
    // Fetch initial code
    refreshCode();

    // Subscribe to the GLOBAL timer service (only 1 interval for all widgets)
    const unsubscribe = otpTimerService.subscribe(onGlobalTick);

    return () => {
      unsubscribe();
    };
  }, [refreshCode, onGlobalTick]);

  // Separate effect for clock drift (runs on mount + every 60s)
  useEffect(() => {
    checkClockDrift();
    // Clock drift check is handled separately via its own IPC interval
    // defined in clockDrift.ts. No need for another interval here.
  }, [checkClockDrift]);

  const handleCopy = useCallback(async () => {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      setIsCopied(true);
      showSuccess('OTP code copied');
      if (isPrivacyMode) {
        setShowCopyWarning(true);
        setTimeout(() => setShowCopyWarning(false), 5000);
      }
      setTimeout(() => setIsCopied(false), 2000);
    } catch {
      // Silently ignore clipboard failures
    }
  }, [code, showSuccess, isPrivacyMode]);

  if (error) {
    return (
      <div className="mb-12">
        <h4 className="mb-4 text-xs font-bold uppercase tracking-wider text-surface-400">
          Authenticator (OTP)
        </h4>
        <div className="rounded-2xl border border-surface-200/30 bg-surface-50 p-4 dark:bg-surface-800/50">
          <p className="text-sm text-danger-500">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="mb-12">
      <h4 className="mb-4 text-xs font-bold uppercase tracking-wider text-surface-400">
        Authenticator (OTP)
      </h4>

      {/* Clock drift warning banner */}
      {clockDriftDetected && (
        <div
          role="alert"
          className="mb-4 flex items-start gap-2 rounded-lg border border-warning-200 bg-warning-50 px-3 py-2 text-xs text-warning-700 dark:border-warning-800 dark:bg-warning-900/20 dark:text-warning-300"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="mt-0.5 h-4 w-4 shrink-0"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          <div>
            <p className="font-medium">{t('otp.clockDriftTitle')}</p>
            <p className="mt-0.5">{t('otp.clockDriftWarning')}</p>
          </div>
        </div>
      )}
      <div className="relative">
        <button
          type="button"
          onClick={handleCopy}
          disabled={shouldBlur}
          className={`group flex w-full items-center gap-4 rounded-2xl border border-surface-200/30 bg-surface-50 p-6 transition-colors hover:bg-surface-100 dark:bg-surface-800/50 dark:hover:bg-surface-700/50 ${shouldBlur ? 'cursor-not-allowed opacity-60' : ''}`}
          aria-label={shouldBlur ? t('otp.blurHint') : `Copy OTP code ${code}`}
        >
          {/* Circular Countdown — animated via requestAnimationFrame */}
          <div className="relative h-12 w-12 shrink-0">
            <svg
              className="h-12 w-12 -rotate-90"
              viewBox={`0 0 ${CIRCLE_RADIUS * 2 + CIRCLE_STROKE * 2} ${CIRCLE_RADIUS * 2 + CIRCLE_STROKE * 2}`}
              aria-hidden="true"
            >
              <circle
                cx={CIRCLE_RADIUS + CIRCLE_STROKE}
                cy={CIRCLE_RADIUS + CIRCLE_STROKE}
                r={CIRCLE_RADIUS}
                fill="none"
                stroke="currentColor"
                strokeWidth={CIRCLE_STROKE}
                className="text-surface-200 dark:text-surface-700"
              />
              <circle
                cx={CIRCLE_RADIUS + CIRCLE_STROKE}
                cy={CIRCLE_RADIUS + CIRCLE_STROKE}
                r={CIRCLE_RADIUS}
                fill="none"
                stroke="currentColor"
                strokeWidth={CIRCLE_STROKE}
                strokeLinecap="round"
                strokeDasharray={CIRCLE_CIRCUMFERENCE}
                strokeDashoffset={dashOffset}
                className={`transition-none ${
                  isLowTime ? 'text-danger-500' : 'text-primary'
                }`}
              />
            </svg>
            <span
              className={`absolute inset-0 flex items-center justify-center text-[10px] font-bold ${
                isLowTime ? 'text-danger-500' : 'text-surface-500 dark:text-surface-400'
              }`}
              aria-live={isLowTime ? 'polite' : 'off'}
              aria-atomic="true"
              role="timer"
            >
              {remaining}
            </span>
          </div>

          {/* Code */}
          <div className="flex flex-1 items-center gap-3">
            <span
              className={`font-mono text-3xl font-semibold tracking-widest text-surface-900 dark:text-surface-50 transition-all duration-300 ${shouldBlur ? 'blur-md select-none' : ''}`}
              aria-live={shouldBlur ? 'off' : 'polite'}
              aria-atomic="true"
            >
              {shouldBlur ? '••••••' : code}
            </span>
            <span
              className={`text-xs font-medium transition-opacity ${
                isCopied
                  ? 'text-success-500 opacity-100'
                  : 'text-surface-400 opacity-0 group-hover:opacity-100'
              }`}
            >
              {isCopied ? 'Copied!' : 'Click to copy'}
            </span>
          </div>

          {/* Copy Icon */}
          <div className="text-surface-400 transition-colors group-hover:text-surface-600 dark:group-hover:text-surface-300">
            {isCopied ? (
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-5 w-5 text-success-500"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            ) : (
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
                  d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                />
              </svg>
            )}
          </div>
        </button>

        {/* Reveal button overlay when privacy mode is on */}
        {shouldBlur && (
          <div className="absolute inset-0 flex items-center justify-center rounded-2xl bg-surface-50/80 dark:bg-surface-800/80">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setIsCodeRevealed(true);
              }}
              className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-on-primary transition-colors hover:bg-primary/90"
              aria-label={t('otp.reveal')}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-4 w-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                />
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
                />
              </svg>
              {t('otp.reveal')}
            </button>
          </div>
        )}
      </div>

      {/* Copy-paste warning when privacy mode is on */}
      {isPrivacyMode && showCopyWarning && (
        <div
          role="alert"
          className="mt-3 flex items-center gap-2 rounded-lg border border-warning-200 bg-warning-50 px-3 py-2 text-xs text-warning-700 dark:border-warning-800 dark:bg-warning-900/20 dark:text-warning-300"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-4 w-4 shrink-0"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
            />
          </svg>
          {t('otp.copyWarning')}
        </div>
      )}
    </div>
  );
}