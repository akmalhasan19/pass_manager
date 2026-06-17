import React, { useState, useCallback, useEffect, useRef } from 'react';
import { useTranslation } from '../../i18n/useTranslation';
import {
  evaluateStrength,
  getStrengthBarColor,
  getStrengthTextColor,
  type StrengthResult,
} from '../../utils/passwordStrength';

interface CreateVaultDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onCreateVault: (name: string, masterPassword: string) => Promise<boolean>;
  isCreating: boolean;
}

/**
 * Dialog for creating a new vault from the lock screen.
 * Collects vault name, master password, and confirmation.
 * Shows password strength indicator and validates input.
 *
 * Includes focus trap and focus restoration for accessibility.
 */
export default function CreateVaultDialog({
  isOpen,
  onClose,
  onCreateVault,
  isCreating,
}: CreateVaultDialogProps): React.ReactElement | null {
  const { t } = useTranslation();
  const [vaultName, setVaultName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [localError, setLocalError] = useState('');
  const [strength, setStrength] = useState<StrengthResult>({
    score: 0,
    label: 'Very Weak',
    entropy: 0,
  });

  const nameInputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  // Focus trap and focus management
  useEffect(() => {
    if (!isOpen) return;

    // Store the element that triggered the dialog for focus restoration
    previousFocusRef.current = document.activeElement as HTMLElement;

    // Focus name input when dialog opens
    setTimeout(() => nameInputRef.current?.focus(), 100);

    const dialogElement = dialogRef.current;
    if (!dialogElement) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Tab') {
        const focusableElements = Array.from(
          dialogElement.querySelectorAll<HTMLElement>(
            'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
          )
        );
        if (focusableElements.length === 0) return;

        const firstElement = focusableElements[0];
        const lastElement = focusableElements[focusableElements.length - 1];

        if (e.shiftKey) {
          if (document.activeElement === firstElement) {
            e.preventDefault();
            lastElement.focus();
          }
        } else {
          if (document.activeElement === lastElement) {
            e.preventDefault();
            firstElement.focus();
          }
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      // Restore focus to the element that triggered the dialog
      if (previousFocusRef.current) {
        previousFocusRef.current.focus();
        previousFocusRef.current = null;
      }
    };
  }, [isOpen]);

  // Reset form when dialog closes
  useEffect(() => {
    if (!isOpen) {
      setVaultName('');
      setPassword('');
      setConfirmPassword('');
      setShowPassword(false);
      setShowConfirm(false);
      setLocalError('');
    }
  }, [isOpen]);

  // SECURITY: Clear password fields from React state on unmount
  useEffect(() => {
    return () => {
      setPassword('');
      setConfirmPassword('');
    };
  }, []);

  useEffect(() => {
    setStrength(evaluateStrength(password));
  }, [password]);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setLocalError('');

      if (!vaultName.trim()) {
        setLocalError(t('vault.create.error.nameRequired'));
        return;
      }

      if (vaultName.trim().length > 100) {
        setLocalError(t('vault.create.error.nameTooLong'));
        return;
      }

      if (!password) {
        setLocalError(t('auth.error.passwordRequired'));
        return;
      }

      if (password.length < 8) {
        setLocalError(t('auth.error.passwordTooShort'));
        return;
      }

      if (password !== confirmPassword) {
        setLocalError(t('auth.error.passwordMismatch'));
        return;
      }

      const success = await onCreateVault(vaultName.trim(), password);

      // SECURITY: Clear password fields after submission
      setPassword('');
      setConfirmPassword('');

      if (success) {
        onClose();
      }
    },
    [vaultName, password, confirmPassword, onCreateVault, onClose, t],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    },
    [onClose],
  );

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Dialog */}
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={t('vault.create.dialog.title')}
        className="relative z-10 w-full max-w-sm animate-fade-in rounded-xl border border-surface-200 bg-white p-6 shadow-xl dark:border-surface-700 dark:bg-surface-800"
        onKeyDown={handleKeyDown}
      >
        <h2 className="mb-1 text-base font-semibold text-surface-900 dark:text-surface-50">
          {t('vault.create.dialog.title')}
        </h2>
        <p className="mb-5 text-xs text-surface-500 dark:text-surface-400">
          {t('vault.create.dialog.description')}
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Vault Name */}
          <div>
            <label
              htmlFor="vault-name"
              className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-surface-500 dark:text-surface-400"
            >
              {t('vault.create.label.name')}
            </label>
            <input
              ref={nameInputRef}
              id="vault-name"
              type="text"
              value={vaultName}
              onChange={(e) => {
                setVaultName(e.target.value);
                if (localError) setLocalError('');
              }}
              placeholder={t('vault.create.placeholder.name')}
              maxLength={100}
              disabled={isCreating}
              className="notion-input rounded-lg border border-surface-200 dark:border-surface-700"
            />
          </div>

          {/* Master Password */}
          <div>
            <label
              htmlFor="vault-master-password"
              className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-surface-500 dark:text-surface-400"
            >
              {t('auth.label.masterPassword')}
            </label>
            <div className="relative">
              <input
                id="vault-master-password"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  if (localError) setLocalError('');
                }}
                placeholder={t('auth.placeholder.enterPassword')}
                autoComplete="off"
                disabled={isCreating}
                className="notion-input rounded-lg border border-surface-200 pr-10 dark:border-surface-700"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-surface-400 transition-colors hover:text-surface-600 dark:hover:text-surface-300"
                tabIndex={-1}
                aria-label={showPassword ? t('auth.button.hidePassword') : t('auth.button.showPassword')}
              >
                {showPassword ? (
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                  </svg>
                ) : (
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                  </svg>
                )}
              </button>
            </div>
          </div>

          {/* Password Strength Indicator */}
          {password.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs text-surface-500 dark:text-surface-400">
                  {t('lockScreen.passwordStrength')}
                </span>
                <span className={`text-xs font-medium ${getStrengthTextColor(strength.score)}`}>
                  {t(`strength.${strength.score === 0 ? 'veryWeak' : strength.score === 1 ? 'weak' : strength.score === 2 ? 'fair' : strength.score === 3 ? 'strong' : 'veryStrong'}`)}
                </span>
              </div>
              <div className="flex gap-1">
                {[0, 1, 2, 3, 4].map((i) => (
                  <div
                    key={i}
                    className={`h-1 flex-1 rounded-full transition-all duration-300 ${
                      i <= strength.score
                        ? getStrengthBarColor(strength.score)
                        : 'bg-surface-200 dark:bg-surface-700'
                    }`}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Confirm Password */}
          <div>
            <label
              htmlFor="vault-confirm-password"
              className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-surface-500 dark:text-surface-400"
            >
              {t('auth.placeholder.confirmPassword')}
            </label>
            <div className="relative">
              <input
                id="vault-confirm-password"
                type={showConfirm ? 'text' : 'password'}
                value={confirmPassword}
                onChange={(e) => {
                  setConfirmPassword(e.target.value);
                  if (localError) setLocalError('');
                }}
                placeholder={t('auth.placeholder.confirmPassword')}
                autoComplete="off"
                disabled={isCreating}
                className="notion-input rounded-lg border border-surface-200 pr-10 dark:border-surface-700"
              />
              <button
                type="button"
                onClick={() => setShowConfirm(!showConfirm)}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-surface-400 transition-colors hover:text-surface-600 dark:hover:text-surface-300"
                tabIndex={-1}
                aria-label={showConfirm ? t('auth.button.hideConfirm') : t('auth.button.showConfirm')}
              >
                {showConfirm ? (
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                  </svg>
                ) : (
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                  </svg>
                )}
              </button>
            </div>
          </div>

          {/* Error Display */}
          {localError && (
            <div role="alert" aria-live="assertive" className="rounded-lg border border-danger-400/30 bg-danger-50 px-4 py-3 dark:bg-danger-500/10">
              <div className="flex items-start gap-2">
                <svg xmlns="http://www.w3.org/2000/svg" className="mt-0.5 h-4 w-4 shrink-0 text-danger-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <p className="text-sm text-danger-600 dark:text-danger-400">{localError}</p>
              </div>
            </div>
          )}

          {/* Buttons */}
          <div className="flex gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              disabled={isCreating}
              className="notion-button-ghost flex-1 rounded-lg py-2.5"
            >
              {t('item.cancel')}
            </button>
            <button
              type="submit"
              disabled={isCreating || !vaultName.trim() || !password}
              className="notion-button-primary flex-1 rounded-lg py-2.5"
            >
              {isCreating ? (
                <span className="flex items-center gap-2">
                  <svg className="h-4 w-4 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  {t('auth.button.setupLoading')}
                </span>
              ) : (
                t('vault.create.dialog.createButton')
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}