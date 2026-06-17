import React, { useState, useEffect, useCallback } from 'react';
import qrcode from 'qrcode';
import type { TotpConfig } from '../../../shared/types';
import {
  OTP_DEFAULTS,
  OTP_VALID_PERIODS,
  OTP_VALID_DIGITS,
  OTP_VALID_ALGORITHMS,
} from '../../../shared/constants';
import { sanitizeBase32Secret, validateTotpSecret } from '../../../shared/validation';
import Modal from '../ui/Modal';

interface OtpSectionProps {
  itemTitle: string;
  otpConfig: TotpConfig | null | undefined;
  isEditMode: boolean;
  onChange: (config: TotpConfig | null) => void;
}

function getConfigOrDefault(config: TotpConfig | null | undefined): TotpConfig {
  return {
    secret: config?.secret ?? '',
    period: config?.period ?? OTP_DEFAULTS.PERIOD,
    digits: config?.digits ?? OTP_DEFAULTS.DIGITS,
    algorithm: config?.algorithm ?? OTP_DEFAULTS.ALGORITHM,
  };
}

function buildOtpauthUri(title: string, config: TotpConfig): string {
  const label = encodeURIComponent(title || 'SecurePass');
  const issuer = encodeURIComponent(title || 'SecurePass');
  return `otpauth://totp/${label}?secret=${config.secret}&issuer=${issuer}&algorithm=${config.algorithm}&digits=${config.digits}&period=${config.period}`;
}

const ERROR_MESSAGES: Record<string, string> = {
  'validation.required': 'Secret is required',
  'validation.invalidBase32': 'Secret must be valid base32 characters',
  'validation.otpSecretTooShort': 'Secret must be at least 16 characters',
};

export default function OtpSection({
  itemTitle,
  otpConfig,
  isEditMode,
  onChange,
}: OtpSectionProps): React.ReactElement {
  const [config, setConfig] = useState<TotpConfig>(getConfigOrDefault(otpConfig));
  const [showSecret, setShowSecret] = useState(false);
  const [secretError, setSecretError] = useState<string | null>(null);
  const [isQrModalOpen, setIsQrModalOpen] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [isQrRevealed, setIsQrRevealed] = useState(false);

  useEffect(() => {
    setConfig((prev) => {
      const normalized = getConfigOrDefault(otpConfig);
      if (
        normalized.secret !== prev.secret ||
        normalized.period !== prev.period ||
        normalized.digits !== prev.digits ||
        normalized.algorithm !== prev.algorithm
      ) {
        return normalized;
      }
      return prev;
    });
    setSecretError(null);
  }, [otpConfig]);

  const notifyChange = useCallback(
    (newConfig: TotpConfig | null) => {
      onChange(newConfig);
    },
    [onChange],
  );

  const updateConfig = (updates: Partial<TotpConfig>) => {
    const nextConfig = { ...config, ...updates };
    setConfig(nextConfig);

    if ('secret' in updates && updates.secret !== undefined) {
      const rawSecret = updates.secret;
      if (rawSecret.trim().length === 0) {
        setSecretError(null);
        if (!otpConfig) {
          notifyChange(null);
        }
        return;
      }

      const { sanitized, error } = sanitizeBase32Secret(rawSecret);
      if (error) {
        setSecretError(error);
      } else {
        setSecretError(null);
        notifyChange({ ...nextConfig, secret: sanitized });
      }
    } else {
      const { sanitized, error } = sanitizeBase32Secret(nextConfig.secret);
      if (!error) {
        notifyChange({ ...nextConfig, secret: sanitized });
      }
    }
  };

  const handleGenerateQr = async () => {
    const { sanitized, error } = sanitizeBase32Secret(config.secret);
    if (error) {
      setSecretError(error);
      return;
    }
    try {
      const uri = buildOtpauthUri(itemTitle, { ...config, secret: sanitized });
      const dataUrl = await qrcode.toDataURL(uri, { width: 256, margin: 2 });
      setQrDataUrl(dataUrl);
      setIsQrRevealed(false);
      setIsQrModalOpen(true);
    } catch {
      setSecretError('Failed to generate QR code');
    }
  };

  const handleRemoveOtp = () => {
    setConfig(getConfigOrDefault(null));
    setSecretError(null);
    notifyChange(null);
  };

  const isValidSecret = !validateTotpSecret(config.secret) && config.secret.trim().length > 0;

  if (!isEditMode) {
    return (
      <div className="mb-12">
        <h4 className="mb-4 text-xs font-bold uppercase tracking-wider text-surface-400">
          Authenticator (OTP)
        </h4>
        {otpConfig ? (
          <div className="rounded-2xl border border-surface-200/30 bg-surface-50 p-4 dark:bg-surface-800/50">
            <p className="text-sm text-surface-600 dark:text-surface-400">OTP is configured for this item.</p>
          </div>
        ) : (
          <p className="text-sm italic text-surface-400">No OTP configured</p>
        )}
      </div>
    );
  }

  return (
    <div className="mb-12">
      <div className="mb-4 flex items-center justify-between">
        <h4 className="text-xs font-bold uppercase tracking-wider text-surface-400">
          Authenticator (OTP)
        </h4>
        {otpConfig && (
          <button
            className="text-danger-500 hover:text-danger-600 text-xs font-medium transition-colors"
            onClick={handleRemoveOtp}
            type="button"
          >
            Remove OTP
          </button>
        )}
      </div>

      <div className="space-y-4 rounded-2xl border border-surface-200/30 bg-surface-50 p-6 dark:bg-surface-800/50">
        {/* Secret input */}
        <div className="space-y-2">
          <label
            htmlFor="otp-secret"
            className="block text-xs font-medium text-surface-600 dark:text-surface-400"
          >
            Secret
          </label>
          <div className="flex items-center gap-2">
            <input
              id="otp-secret"
              type={showSecret ? 'text' : 'password'}
              value={config.secret}
              onChange={(e) => updateConfig({ secret: e.target.value })}
              placeholder="Enter base32 secret..."
              className="flex-1 rounded-lg border border-surface-200 bg-white px-3 py-2 text-sm text-surface-800 placeholder:text-surface-400 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary dark:border-surface-700 dark:bg-surface-800 dark:text-surface-200"
              autoComplete="off"
              aria-describedby={secretError ? 'otp-secret-error' : undefined}
            />
            <button
              type="button"
              onClick={() => setShowSecret(!showSecret)}
              className="rounded-lg border border-surface-200 p-2 text-surface-500 hover:bg-surface-100 dark:border-surface-700 dark:text-surface-400 dark:hover:bg-surface-700"
              aria-label={showSecret ? 'Hide secret' : 'Show secret'}
            >
              {showSecret ? (
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                </svg>
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                </svg>
              )}
            </button>
          </div>
          {secretError && (
            <p id="otp-secret-error" className="text-danger-500 text-xs">
              {ERROR_MESSAGES[secretError] || secretError}
            </p>
          )}
        </div>

        {/* Dropdowns */}
        <div className="grid grid-cols-3 gap-4">
          <div className="space-y-1">
            <label htmlFor="otp-period" className="block text-xs font-medium text-surface-600 dark:text-surface-400">
              Period
            </label>
            <select
              id="otp-period"
              value={config.period}
              onChange={(e) => updateConfig({ period: Number(e.target.value) })}
              className="w-full rounded-lg border border-surface-200 bg-white px-3 py-2 text-sm text-surface-800 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary dark:border-surface-700 dark:bg-surface-800 dark:text-surface-200"
            >
              {OTP_VALID_PERIODS.map((p) => (
                <option key={String(p)} value={p}>
                  {p}s
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            <label htmlFor="otp-digits" className="block text-xs font-medium text-surface-600 dark:text-surface-400">
              Digits
            </label>
            <select
              id="otp-digits"
              value={config.digits}
              onChange={(e) => updateConfig({ digits: Number(e.target.value) })}
              className="w-full rounded-lg border border-surface-200 bg-white px-3 py-2 text-sm text-surface-800 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary dark:border-surface-700 dark:bg-surface-800 dark:text-surface-200"
            >
              {OTP_VALID_DIGITS.map((d) => (
                <option key={String(d)} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            <label htmlFor="otp-algorithm" className="block text-xs font-medium text-surface-600 dark:text-surface-400">
              Algorithm
            </label>
            <select
              id="otp-algorithm"
              value={config.algorithm}
              onChange={(e) => updateConfig({ algorithm: e.target.value })}
              className="w-full rounded-lg border border-surface-200 bg-white px-3 py-2 text-sm text-surface-800 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary dark:border-surface-700 dark:bg-surface-800 dark:text-surface-200"
            >
              {OTP_VALID_ALGORITHMS.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Generate QR Code button */}
        <button
          type="button"
          onClick={handleGenerateQr}
          disabled={!isValidSecret}
          className="w-full rounded-lg border border-surface-200 bg-white py-2 text-sm font-medium text-surface-700 transition-colors hover:bg-surface-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-surface-600 dark:bg-surface-850 dark:text-surface-300 dark:hover:bg-surface-700"
        >
          Generate QR Code
        </button>
      </div>

      {/* QR Code Modal */}
      <Modal isOpen={isQrModalOpen} onClose={() => setIsQrModalOpen(false)} className="max-w-sm" ariaLabel="OTP QR Code">
        <div className="p-6">
          <h3 className="mb-4 text-lg font-semibold text-surface-900 dark:text-surface-50">OTP QR Code</h3>
          <div className="relative flex items-center justify-center">
            {qrDataUrl && (
              <>
                <img
                  src={qrDataUrl}
                  alt="OTP QR Code"
                  className={`h-64 w-64 transition-all duration-300 ${!isQrRevealed ? 'blur-md' : ''}`}
                />
                {!isQrRevealed && (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <button
                      onClick={() => setIsQrRevealed(true)}
                      className="bg-primary text-on-primary rounded-lg px-4 py-2 text-sm font-medium transition-colors"
                    >
                      Reveal QR Code
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
          <p className="mt-4 text-center text-xs text-surface-500">
            This QR code is sensitive. Do not share it with anyone.
          </p>
          <div className="mt-4 flex justify-center">
            <button
              onClick={() => setIsQrModalOpen(false)}
              className="rounded-lg border border-surface-200 px-4 py-2 text-sm font-medium text-surface-700 transition-colors hover:bg-surface-100 dark:border-surface-600 dark:text-surface-300"
            >
              Close
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
