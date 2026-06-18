import React, { useState, useEffect, useCallback, useRef } from 'react';
import { TOTP } from 'otpauth';
import type { TotpConfig } from '../../../shared/types';
import type { TotpAlgorithm } from '../../../shared/constants';
import { normalizeBase32Secret } from '../../../shared/validation';
import { useToast } from '../../hooks/useToast';

interface OtpWidgetProps {
  config: TotpConfig;
}

function generateCode(config: TotpConfig): string {
  const normalized = normalizeBase32Secret(config.secret);
  const totp = new TOTP({
    secret: normalized,
    digits: config.digits,
    period: config.period,
    algorithm: config.algorithm as TotpAlgorithm,
  });
  return totp.generate();
}

function getRemainingSeconds(period: number): number {
  const epoch = Math.floor(Date.now() / 1000);
  return period - (epoch % period);
}

function getProgressPercent(period: number, remaining: number): number {
  return (remaining / period) * 100;
}

const CIRCLE_RADIUS = 18;
const CIRCLE_STROKE = 3;
const CIRCLE_CIRCUMFERENCE = 2 * Math.PI * CIRCLE_RADIUS;

export default function OtpWidget({ config }: OtpWidgetProps): React.ReactElement {
  const [code, setCode] = useState<string>(() => {
    try {
      return generateCode(config);
    } catch {
      return '';
    }
  });
  const [remaining, setRemaining] = useState<number>(() => getRemainingSeconds(config.period));
  const [error, setError] = useState<string | null>(null);
  const [isCopied, setIsCopied] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const { showSuccess } = useToast();

  const refreshCode = useCallback(() => {
    try {
      const newCode = generateCode(config);
      setCode(newCode);
      setError(null);
    } catch {
      setError('Unable to generate OTP code');
      setCode('');
    }
  }, [config]);

  useEffect(() => {
    refreshCode();
    setRemaining(getRemainingSeconds(config.period));

    intervalRef.current = setInterval(() => {
      const newRemaining = getRemainingSeconds(config.period);
      setRemaining(newRemaining);

      if (newRemaining === config.period) {
        refreshCode();
      }
    }, 1000);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [config, refreshCode]);

  const handleCopy = useCallback(async () => {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      setIsCopied(true);
      showSuccess('OTP code copied');
      setTimeout(() => setIsCopied(false), 2000);
    } catch {
      // Silently ignore clipboard failures
    }
  }, [code, showSuccess]);

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

  const progress = getProgressPercent(config.period, remaining);
  const dashOffset = CIRCLE_CIRCUMFERENCE * (1 - progress / 100);
  const isLowTime = remaining <= 5;

  return (
    <div className="mb-12">
      <h4 className="mb-4 text-xs font-bold uppercase tracking-wider text-surface-400">
        Authenticator (OTP)
      </h4>
      <button
        type="button"
        onClick={handleCopy}
        className="group flex w-full items-center gap-4 rounded-2xl border border-surface-200/30 bg-surface-50 p-6 transition-colors hover:bg-surface-100 dark:bg-surface-800/50 dark:hover:bg-surface-700/50"
        aria-label={`Copy OTP code ${code}`}
      >
        {/* Circular Countdown */}
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
              className={`transition-all duration-1000 ease-linear ${
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
            className="font-mono text-3xl font-semibold tracking-widest text-surface-900 dark:text-surface-50"
            aria-live="polite"
            aria-atomic="true"
          >
            {code}
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
    </div>
  );
}
