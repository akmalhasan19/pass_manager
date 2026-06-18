import React, { useState, useCallback, useRef, useEffect } from 'react';
import jsQR from 'jsqr';
import Modal from '../ui/Modal';
import { decodeQrImage, type QrScanResult } from '../../utils/parseOtpauthUri';
import type { TotpConfig } from '../../../shared/types';
import { sanitizeBase32Secret, sanitizeTotpConfig } from '../../../shared/validation';
import {
  OTP_DEFAULTS,
  OTP_VALID_PERIODS,
  OTP_VALID_DIGITS,
  OTP_VALID_ALGORITHMS,
} from '../../../shared/constants';
import { useTranslation } from '../../i18n/useTranslation';

interface QrScannerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onScan: (config: TotpConfig, metadata?: { issuer?: string; label?: string }) => void;
}

type EntryMode = 'scan' | 'manual';

const SCAN_ERROR_MESSAGES: Record<string, string> = {
  'qrScan.errorCanvasContext': 'Unable to initialize image canvas.',
  'qrScan.errorReadImage': 'Failed to read image data.',
  'qrScan.errorNoQrCode': 'No QR code detected in image.',
  'qrScan.errorInvalidOtpUri': 'QR code does not contain a valid OTP URI.',
  'qrScan.errorLoadImage': 'Failed to load image.',
};

export default function QrScannerModal({
  isOpen,
  onClose,
  onScan,
}: QrScannerModalProps): React.ReactElement {
  const [mode, setMode] = useState<EntryMode>('scan');
  const [dragActive, setDragActive] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pasteTargetRef = useRef<HTMLDivElement>(null);

  // Manual entry state
  const [secret, setSecret] = useState('');
  const [showSecret, setShowSecret] = useState(false);
  const [period, setPeriod] = useState<number>(OTP_DEFAULTS.PERIOD);
  const [digits, setDigits] = useState<number>(OTP_DEFAULTS.DIGITS);
  const [algorithm, setAlgorithm] = useState<string>(OTP_DEFAULTS.ALGORITHM);
  const [issuer, setIssuer] = useState('');
  const [label, setLabel] = useState('');
  const [manualError, setManualError] = useState<string | null>(null);

  const { t } = useTranslation();

  useEffect(() => {
    if (!isOpen) {
      setMode('scan');
      setDragActive(false);
      setScanning(false);
      setError(null);
      setPreviewUrl(null);
      setSecret('');
      setShowSecret(false);
      setPeriod(OTP_DEFAULTS.PERIOD);
      setDigits(OTP_DEFAULTS.DIGITS);
      setAlgorithm(OTP_DEFAULTS.ALGORITHM);
      setIssuer('');
      setLabel('');
      setManualError(null);
    }
  }, [isOpen]);

  const handleResult = useCallback(
    (result: QrScanResult) => {
      if (result.success && result.config) {
        onScan(result.config, { issuer: result.issuer, label: result.label });
        onClose();
      } else {
        setError(SCAN_ERROR_MESSAGES[result.error || ''] || t('qrScan.errorUnknown'));
        setScanning(false);
      }
    },
    [onScan, onClose, t],
  );

  const processImageSrc = useCallback(
    async (src: string) => {
      setScanning(true);
      setError(null);
      setPreviewUrl(src);
      try {
        const result = await decodeQrImage(src, jsQR);
        handleResult(result);
      } catch {
        setError(t('qrScan.errorUnknown'));
        setScanning(false);
      }
    },
    [handleResult, t],
  );

  const handleFile = useCallback(
    async (file: File) => {
      if (!file.type.startsWith('image/')) {
        setError(t('qrScan.errorNotImage'));
        return;
      }
      const reader = new FileReader();
      reader.onload = (e) => {
        const dataUrl = e.target?.result as string | undefined;
        if (dataUrl) {
          processImageSrc(dataUrl);
        } else {
          setError(t('qrScan.errorReadFailed'));
        }
      };
      reader.onerror = () => {
        setError(t('qrScan.errorReadFailed'));
      };
      reader.readAsDataURL(file);
    },
    [processImageSrc, t],
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDragActive(false);
      const file = e.dataTransfer.files?.[0];
      if (file) {
        handleFile(file);
      }
    },
    [handleFile],
  );

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) {
        handleFile(file);
      }
    },
    [handleFile],
  );

  const handlePaste = useCallback(
    async (e: ClipboardEvent) => {
      if (!isOpen) return;
      const items = e.clipboardData?.items;
      if (!items) return;

      for (const item of Array.from(items)) {
        if (item.type.startsWith('image/')) {
          e.preventDefault();
          const blob = item.getAsFile();
          if (blob) {
            const reader = new FileReader();
            reader.onload = (ev) => {
              const dataUrl = ev.target?.result as string | undefined;
              if (dataUrl) {
                processImageSrc(dataUrl);
              }
            };
            reader.readAsDataURL(blob);
          }
          return;
        }
      }

      // Also try pasting a raw otpauth:// URI string
      const text = e.clipboardData?.getData('text/plain');
      if (text) {
        const { parseOtpauthUri, parsedToTotpConfig } = await import('../../utils/parseOtpauthUri');
        const parsed = parseOtpauthUri(text.trim());
        if (parsed) {
          e.preventDefault();
          onScan(parsedToTotpConfig(parsed), { issuer: parsed.issuer, label: parsed.label });
          onClose();
        }
      }
    },
    [isOpen, processImageSrc, onScan, onClose],
  );

  useEffect(() => {
    if (isOpen) {
      document.addEventListener('paste', handlePaste);
      return () => {
        document.removeEventListener('paste', handlePaste);
      };
    }
  }, [isOpen, handlePaste]);

  const handleManualSubmit = useCallback(() => {
    setManualError(null);

    // Validate secret using the same strict sanitizeTotpConfig function
    // that is used for scanned secrets, ensuring equal validation strictness.
    const result = sanitizeTotpConfig({
      secret,
      period,
      digits,
      algorithm,
    });

    if (result.error) {
      setManualError(result.error);
      return;
    }

    onScan(result.sanitized, {
      issuer: issuer.trim() || undefined,
      label: label.trim() || undefined,
    });
    onClose();
  }, [secret, period, digits, algorithm, issuer, label, onScan, onClose]);

  const handleSecretChange = useCallback((value: string) => {
    setSecret(value);
    // Real-time validation feedback using sanitizeBase32Secret
    const { error: secretErr } = sanitizeBase32Secret(value);
    setManualError(secretErr);
  }, []);

  return (
    <Modal isOpen={isOpen} onClose={onClose} className="max-w-md" ariaLabel={t('qrScan.dialogAriaLabel')}>
      <div className="p-6" ref={pasteTargetRef} tabIndex={-1}>
        <h3 className="mb-1 text-lg font-semibold text-surface-900 dark:text-surface-50">
          {t('qrScan.title')}
        </h3>
        <p className="mb-4 text-sm text-surface-500 dark:text-surface-400">
          {mode === 'scan' ? t('qrScan.description') : t('qrScan.manualDescription')}
        </p>

        {/* Mode toggle tabs */}
        <div className="mb-4 flex rounded-lg border border-surface-200 bg-surface-100 p-1 dark:border-surface-700 dark:bg-surface-800/50" role="tablist" aria-label={t('qrScan.modeAriaLabel')}>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'scan'}
            onClick={() => { setMode('scan'); setError(null); setManualError(null); }}
            className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              mode === 'scan'
                ? 'bg-white text-surface-900 shadow-sm dark:bg-surface-700 dark:text-surface-50'
                : 'text-surface-500 hover:text-surface-700 dark:text-surface-400 dark:hover:text-surface-300'
            }`}
          >
            <div className="flex items-center justify-center gap-1.5">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
              </svg>
              {t('qrScan.tabScan')}
            </div>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'manual'}
            onClick={() => { setMode('manual'); setError(null); setManualError(null); }}
            className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              mode === 'manual'
                ? 'bg-white text-surface-900 shadow-sm dark:bg-surface-700 dark:text-surface-50'
                : 'text-surface-500 hover:text-surface-700 dark:text-surface-400 dark:hover:text-surface-300'
            }`}
          >
            <div className="flex items-center justify-center gap-1.5">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
              {t('qrScan.tabManual')}
            </div>
          </button>
        </div>

        {/* Scan mode content */}
        {mode === 'scan' && (
          <>
            {/* Drop zone */}
            <div
              className={`relative flex flex-col items-center justify-center rounded-2xl border-2 border-dashed p-8 transition-colors ${
                dragActive
                  ? 'border-primary bg-primary/5'
                  : 'border-surface-300 bg-surface-50 dark:border-surface-700 dark:bg-surface-800/50'
              }`}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              role="button"
              tabIndex={0}
              aria-label={t('qrScan.dropZoneAria')}
              onClick={() => fileInputRef.current?.click()}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  fileInputRef.current?.click();
                }
              }}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleInputChange}
                aria-hidden="true"
              />

              {previewUrl ? (
                <img
                  src={previewUrl}
                  alt={t('qrScan.previewAlt')}
                  className={`max-h-48 rounded-lg object-contain ${scanning ? 'opacity-50' : ''}`}
                />
              ) : (
                <>
                  <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
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
                        d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"
                      />
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M15 13a3 3 0 11-6 0 3 3 0 016 0z"
                      />
                    </svg>
                  </div>
                  <p className="text-sm font-medium text-surface-700 dark:text-surface-300">
                    {t('qrScan.dropText')}
                  </p>
                  <p className="mt-1 text-xs text-surface-400">{t('qrScan.pasteHint')}</p>
                </>
              )}

              {scanning && (
                <div className="absolute inset-0 flex items-center justify-center rounded-2xl bg-white/60 backdrop-blur-sm dark:bg-surface-900/60">
                  <div className="flex flex-col items-center gap-2">
                    <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                    <span className="text-xs font-medium text-surface-600 dark:text-surface-300">
                      {t('qrScan.scanning')}
                    </span>
                  </div>
                </div>
              )}
            </div>

            {/* Scan error */}
            {error && (
              <div className="mt-4 rounded-lg border border-danger-200 bg-danger-50 p-3 dark:border-danger-900/30 dark:bg-danger-900/10">
                <p className="flex items-center gap-2 text-xs text-danger-600 dark:text-danger-400">
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
                      d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  </svg>
                  {error}
                </p>
              </div>
            )}
          </>
        )}

        {/* Manual entry mode content */}
        {mode === 'manual' && (
          <div className="space-y-4">
            {/* Secret (required) */}
            <div className="space-y-2">
              <label
                htmlFor="manual-otp-secret"
                className="block text-xs font-medium text-surface-600 dark:text-surface-400"
              >
                {t('qrScan.manual.secret')} *
              </label>
              <div className="flex items-center gap-2">
                <input
                  id="manual-otp-secret"
                  type={showSecret ? 'text' : 'password'}
                  value={secret}
                  onChange={(e) => handleSecretChange(e.target.value)}
                  placeholder={t('qrScan.manual.secretPlaceholder')}
                  className="flex-1 rounded-lg border border-surface-200 bg-white px-3 py-2 text-sm text-surface-800 placeholder:text-surface-400 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary dark:border-surface-700 dark:bg-surface-800 dark:text-surface-200"
                  autoComplete="off"
                  aria-describedby="manual-otp-secret-error"
                />
                <button
                  type="button"
                  onClick={() => setShowSecret(!showSecret)}
                  className="rounded-lg border border-surface-200 p-2 text-surface-500 hover:bg-surface-100 dark:border-surface-700 dark:text-surface-400 dark:hover:bg-surface-700"
                  aria-label={showSecret ? t('auth.button.hidePassword') : t('auth.button.showPassword')}
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
              {manualError && (
                <p id="manual-otp-secret-error" className="text-xs text-danger-500">
                  {manualError}
                </p>
              )}
            </div>

            {/* Issuer and Label (optional) */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <label htmlFor="manual-otp-issuer" className="block text-xs font-medium text-surface-600 dark:text-surface-400">
                  {t('qrScan.manual.issuer')}
                </label>
                <input
                  id="manual-otp-issuer"
                  type="text"
                  value={issuer}
                  onChange={(e) => setIssuer(e.target.value)}
                  placeholder={t('qrScan.manual.issuerPlaceholder')}
                  className="w-full rounded-lg border border-surface-200 bg-white px-3 py-2 text-sm text-surface-800 placeholder:text-surface-400 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary dark:border-surface-700 dark:bg-surface-800 dark:text-surface-200"
                />
              </div>
              <div className="space-y-1">
                <label htmlFor="manual-otp-label" className="block text-xs font-medium text-surface-600 dark:text-surface-400">
                  {t('qrScan.manual.label')}
                </label>
                <input
                  id="manual-otp-label"
                  type="text"
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder={t('qrScan.manual.labelPlaceholder')}
                  className="w-full rounded-lg border border-surface-200 bg-white px-3 py-2 text-sm text-surface-800 placeholder:text-surface-400 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary dark:border-surface-700 dark:bg-surface-800 dark:text-surface-200"
                />
              </div>
            </div>

            {/* Period, Digits, Algorithm */}
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-1">
                <label htmlFor="manual-otp-period" className="block text-xs font-medium text-surface-600 dark:text-surface-400">
                  Period
                </label>
                <select
                  id="manual-otp-period"
                  value={period}
                  onChange={(e) => setPeriod(Number(e.target.value))}
                  className="w-full rounded-lg border border-surface-200 bg-white px-3 py-2 text-sm text-surface-800 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary dark:border-surface-700 dark:bg-surface-800 dark:text-surface-200"
                >
                  {OTP_VALID_PERIODS.map((p) => (
                    <option key={String(p)} value={p}>{p}s</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <label htmlFor="manual-otp-digits" className="block text-xs font-medium text-surface-600 dark:text-surface-400">
                  Digits
                </label>
                <select
                  id="manual-otp-digits"
                  value={digits}
                  onChange={(e) => setDigits(Number(e.target.value))}
                  className="w-full rounded-lg border border-surface-200 bg-white px-3 py-2 text-sm text-surface-800 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary dark:border-surface-700 dark:bg-surface-800 dark:text-surface-200"
                >
                  {OTP_VALID_DIGITS.map((d) => (
                    <option key={String(d)} value={d}>{d}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <label htmlFor="manual-otp-algorithm" className="block text-xs font-medium text-surface-600 dark:text-surface-400">
                  Algorithm
                </label>
                <select
                  id="manual-otp-algorithm"
                  value={algorithm}
                  onChange={(e) => setAlgorithm(e.target.value)}
                  className="w-full rounded-lg border border-surface-200 bg-white px-3 py-2 text-sm text-surface-800 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary dark:border-surface-700 dark:bg-surface-800 dark:text-surface-200"
                >
                  {OTP_VALID_ALGORITHMS.map((a) => (
                    <option key={a} value={a}>{a}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Submit button */}
            <div className="flex justify-end">
              <button
                type="button"
                onClick={handleManualSubmit}
                disabled={!secret.trim()}
                className="rounded-lg bg-primary px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-50"
              >
                {t('qrScan.manual.apply')}
              </button>
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="mt-6 flex items-center justify-end gap-3">
          {mode === 'scan' && previewUrl && !scanning && (
            <button
              type="button"
              onClick={() => {
                setPreviewUrl(null);
                setError(null);
                if (fileInputRef.current) fileInputRef.current.value = '';
              }}
              className="rounded-lg border border-surface-200 px-4 py-2 text-sm font-medium text-surface-700 transition-colors hover:bg-surface-100 dark:border-surface-600 dark:text-surface-300 dark:hover:bg-surface-700"
            >
              {t('qrScan.clear')}
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-surface-100 px-4 py-2 text-sm font-medium text-surface-700 transition-colors hover:bg-surface-200 dark:bg-surface-700 dark:text-surface-200 dark:hover:bg-surface-600"
          >
            {t('qrScan.cancel')}
          </button>
        </div>
      </div>
    </Modal>
  );
}
