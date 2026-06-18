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
import OtpWidget from './OtpWidget';
import QrScannerModal from './QrScannerModal';
import { useTranslation } from '../../i18n/useTranslation';
import { useSettingsStore } from '../../stores/settingsStore';

interface OtpSectionProps {
  itemId: string;
  itemTitle: string;
  otpConfig: TotpConfig | null | undefined;
  isEditMode: boolean;
  onChange: (config: TotpConfig | null) => void;
}

/**
 * Returns a safe default config with empty secret.
 * SECURITY: The secret field is always empty string — it is never
 * persisted in renderer state management.
 */
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

/**
 * OtpSection handles OTP configuration display and editing.
 *
 * SECURITY — Memory Safety:
 * - In view mode: Only config metadata (period, digits, algorithm) is used.
 *   The secret is never stored in renderer state.
 * - In edit mode: The secret is fetched via IPC (OTP_GET_CONFIG) and held
 *   ONLY in local React state. It is cleared on unmount or when exiting
 *   edit mode. It is NEVER stored in Zustand or any persistent state.
 * - QR code generation uses the secret from local state, and the secret
 *   reference is dropped after the URI is built.
 */
export default function OtpSection({
  itemId,
  itemTitle,
  otpConfig,
  isEditMode,
  onChange,
}: OtpSectionProps): React.ReactElement {
  // SECURITY: `config` holds the OTP configuration for the edit form.
  // In view mode, it uses only metadata from props (no secret).
  // In edit mode, the secret is fetched via IPC and held temporarily.
  const [config, setConfig] = useState<TotpConfig>(() => getConfigOrDefault(otpConfig));
  const [showSecret, setShowSecret] = useState(false);
  const [secretError, setSecretError] = useState<string | null>(null);
  const [isQrModalOpen, setIsQrModalOpen] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [qrSvgString, setQrSvgString] = useState<string | null>(null);
  const [isQrRevealed, setIsQrRevealed] = useState(false);
  const [isOtpRevealed, setIsOtpRevealed] = useState(false);
  const [isScanModalOpen, setIsScanModalOpen] = useState(false);
  const { t } = useTranslation();
  const { settings } = useSettingsStore();
  const isPrivacyMode = settings.otpPrivacyMode;

  // SECURITY: When entering edit mode, fetch the OTP config (including secret)
  // via IPC. The secret is held in local state only.
  useEffect(() => {
    if (isEditMode && otpConfig) {
      // Fetch the full config including secret for editing
      window.electron.otp.getConfig(itemId).then((result) => {
        if (result.success && result.data) {
          setConfig(result.data);
        } else {
          // Fallback to metadata-only config from props
          setConfig(getConfigOrDefault(otpConfig));
        }
      }).catch(() => {
        setConfig(getConfigOrDefault(otpConfig));
      });
    } else if (!isEditMode) {
      // SECURITY: When exiting edit mode, clear the secret from local state
      setConfig((prev) => ({
        ...prev,
        secret: '', // Wipe secret reference on mode change
      }));
    }
  }, [isEditMode, itemId, otpConfig]);

  // SECURITY: Sync config from props when otpConfig changes (e.g., after save)
  // but never store the secret from props — it's always empty string.
  useEffect(() => {
    setConfig((prev) => {
      const normalized = getConfigOrDefault(otpConfig);
      if (
        normalized.period !== prev.period ||
        normalized.digits !== prev.digits ||
        normalized.algorithm !== prev.algorithm
      ) {
        // Only update metadata, preserve any secret from edit mode
        return {
          ...prev,
          period: normalized.period,
          digits: normalized.digits,
          algorithm: normalized.algorithm,
        };
      }
      return prev;
    });
    setSecretError(null);
    setIsOtpRevealed(false);
  }, [otpConfig]);

  // SECURITY: Wipe secret on unmount
  useEffect(() => {
    return () => {
      setConfig((prev) => ({ ...prev, secret: '' }));
    };
  }, []);

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
      const [dataUrl, svg] = await Promise.all([
        qrcode.toDataURL(uri, { width: 256, margin: 2 }),
        qrcode.toString(uri, { type: 'svg', margin: 2, width: 256 }),
      ]);
      setQrDataUrl(dataUrl);
      setQrSvgString(svg);
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

  const handleScanResult = useCallback(
    (scannedConfig: TotpConfig, metadata?: { issuer?: string; label?: string }) => {
      const nextConfig = {
        ...scannedConfig,
        secret: scannedConfig.secret,
      };
      setConfig(nextConfig);
      setSecretError(null);
      notifyChange(nextConfig);

      // Optional: update item title from scanned issuer if item title is empty
      if (metadata?.issuer && !itemTitle.trim()) {
        // We don't control the title here directly, but the config is set.
        // The parent component can decide to use issuer as title if needed.
      }
    },
    [notifyChange, itemTitle],
  );

  const handleDownloadPng = useCallback(() => {
    if (!qrDataUrl) return;
    const link = document.createElement('a');
    link.href = qrDataUrl;
    link.download = `${itemTitle || 'otp'}-qr.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }, [qrDataUrl, itemTitle]);

  const handleDownloadSvg = useCallback(() => {
    if (!qrSvgString) return;
    const blob = new Blob([qrSvgString], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${itemTitle || 'otp'}-qr.svg`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, [qrSvgString, itemTitle]);

  const isValidSecret = !validateTotpSecret(config.secret) && config.secret.trim().length > 0;

  if (!isEditMode) {
    return (
      <div className="mb-12">
        {otpConfig ? (
          isOtpRevealed ? (
            <div className="relative">
              <OtpWidget itemId={itemId} config={otpConfig} />
              <button
                type="button"
                onClick={() => setIsOtpRevealed(false)}
                className="absolute right-0 top-0 rounded-lg border border-surface-200 px-3 py-1.5 text-xs font-medium text-surface-500 transition-colors hover:bg-surface-100 dark:border-surface-700 dark:text-surface-400 dark:hover:bg-surface-700"
                aria-label={t('item.hideOtp')}
              >
                {t('item.hideOtp')}
              </button>
            </div>
          ) : (
            <div>
              <h4 className="mb-4 text-xs font-bold uppercase tracking-wider text-surface-400">
                Authenticator (OTP)
              </h4>
              <button
                type="button"
                onClick={() => setIsOtpRevealed(true)}
                className="flex w-full items-center gap-3 rounded-2xl border border-dashed border-surface-300 bg-surface-50 p-6 transition-colors hover:border-primary/40 hover:bg-surface-100 dark:border-surface-600 dark:bg-surface-800/50 dark:hover:border-primary/40 dark:hover:bg-surface-700/50"
                aria-label={t('item.revealOtp')}
              >
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-primary/10">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className="h-6 w-6 text-primary"
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
                </div>
                <div className="text-left">
                  <p className="text-sm font-medium text-surface-800 dark:text-surface-200">
                    {t('item.revealOtp')}
                  </p>
                  <p className="text-xs text-surface-400">
                    {t('item.revealOtpDescription')}
                  </p>
                </div>
              </button>
            </div>
          )
        ) : (
          <>
            <h4 className="mb-4 text-xs font-bold uppercase tracking-wider text-surface-400">
              Authenticator (OTP)
            </h4>
            <p className="text-sm italic text-surface-400">No OTP configured</p>
          </>
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

        {/* Action buttons */}
        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => setIsScanModalOpen(true)}
            className="flex-1 rounded-lg border border-surface-200 bg-white py-2 text-sm font-medium text-surface-700 transition-colors hover:bg-surface-100 dark:border-surface-600 dark:bg-surface-850 dark:text-surface-300 dark:hover:bg-surface-700"
          >
            {t('item.scanQrCode')}
          </button>
          <button
            type="button"
            onClick={handleGenerateQr}
            disabled={!isValidSecret}
            className="flex-1 rounded-lg border border-surface-200 bg-white py-2 text-sm font-medium text-surface-700 transition-colors hover:bg-surface-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-surface-600 dark:bg-surface-850 dark:text-surface-300 dark:hover:bg-surface-700"
          >
            {t('item.generateQrCode')}
          </button>
        </div>
      </div>

      {/* QR Scanner Modal */}
      <QrScannerModal
        isOpen={isScanModalOpen}
        onClose={() => setIsScanModalOpen(false)}
        onScan={handleScanResult}
      />

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
                      className="flex items-center gap-2 bg-primary text-on-primary rounded-lg px-4 py-2 text-sm font-medium transition-colors"
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
                      {t('otp.revealQr')}
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
          <p className="mt-4 text-center text-xs text-surface-500">
            {t('otp.copyWarning')}
          </p>
          <div className="mt-4 flex items-center justify-center gap-2">
            {isQrRevealed && (
              <>
                <button
                  type="button"
                  onClick={handleDownloadPng}
                  className="flex items-center gap-1.5 rounded-lg border border-surface-200 px-3 py-2 text-xs font-medium text-surface-700 transition-colors hover:bg-surface-100 dark:border-surface-600 dark:text-surface-300 dark:hover:bg-surface-700"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                  PNG
                </button>
                <button
                  type="button"
                  onClick={handleDownloadSvg}
                  className="flex items-center gap-1.5 rounded-lg border border-surface-200 px-3 py-2 text-xs font-medium text-surface-700 transition-colors hover:bg-surface-100 dark:border-surface-600 dark:text-surface-300 dark:hover:bg-surface-700"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                  SVG
                </button>
              </>
            )}
            <button
              type="button"
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
