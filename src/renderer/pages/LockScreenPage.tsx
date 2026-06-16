import React, { useState, useCallback, useEffect, useRef, useId } from 'react';
import { useAuthStore } from '../stores/authStore';
import {
  evaluateStrength,
  getStrengthBarColor,
  getStrengthTextColor,
  type StrengthResult,
} from '../utils/passwordStrength';
import ImportDialog from '../components/import-export/ImportDialog';
import DropZone from '../components/import-export/DropZone';
import type { ImportFormat } from '../../shared/types';

export default function LockScreenPage(): React.ReactElement {
  const { status, error, initApp, unlock, clearError } = useAuthStore();

  const isSetup = status === 'setup';

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

  const inputRef = useRef<HTMLInputElement>(null);
  const passwordErrorId = useId();
  const confirmPasswordErrorId = useId();

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    setStrength(evaluateStrength(password));
  }, [password]);

  useEffect(() => {
    if (error) {
      setLocalError(error);
    }
  }, [error]);

  const resetForm = useCallback(() => {
    setPassword('');
    setConfirmPassword('');
    setShowPassword(false);
    setShowConfirm(false);
    setLocalError('');
    clearError();
  }, [clearError]);

  const handlePasswordChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setPassword(e.target.value);
      if (localError) {
        setLocalError('');
        clearError();
      }
    },
    [localError, clearError],
  );

  const handleConfirmChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setConfirmPassword(e.target.value);
      if (localError) {
        setLocalError('');
        clearError();
      }
    },
    [localError, clearError],
  );

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setLocalError('');

      if (!password) {
        setLocalError('Please enter a master password');
        return;
      }

      if (isSetup) {
        if (password.length < 8) {
          setLocalError('Master password must be at least 8 characters');
          return;
        }
        if (password !== confirmPassword) {
          setLocalError('Passwords do not match');
          return;
        }
        await initApp(password);
      } else {
        await unlock(password);
      }
    },
    [password, confirmPassword, isSetup, initApp, unlock],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        resetForm();
      }
    },
    [resetForm],
  );

  const isLoading = status === 'checking';
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [droppedFile, setDroppedFile] = useState<{
    format: ImportFormat;
    filePath: string;
    content: string;
  } | null>(null);

  const handleFileDropped = useCallback(
    (file: { format: ImportFormat; filePath: string; content: string }) => {
      setDroppedFile(file);
      setShowImportDialog(true);
    },
    [],
  );

  const handleImportDialogClose = useCallback(() => {
    setShowImportDialog(false);
    setDroppedFile(null);
  }, []);

  return (
    <div className="flex h-screen w-screen items-center justify-center bg-surface-50 dark:bg-surface-900">
      <div className="w-full max-w-sm animate-fade-in px-6" onKeyDown={handleKeyDown}>
        {/* Logo & Branding */}
        <div className="mb-8 flex flex-col items-center">
          <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-accent-50 dark:bg-accent-900/30">
            <span className="text-3xl" role="img" aria-label="SecurePass logo">
              🔐
            </span>
          </div>
          <h1 className="text-xl font-semibold text-surface-900 dark:text-surface-50">
            SecurePass Manager
          </h1>
          <p className="mt-1 text-sm text-surface-500 dark:text-surface-400">
            {isSetup ? 'Create your master password' : 'Enter your master password to unlock'}
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Password Field */}
          <div>
            <label
              htmlFor="master-password"
              className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-surface-500 dark:text-surface-400"
            >
              Master Password
            </label>
            <div className="relative">
              <input
                ref={inputRef}
                id="master-password"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={handlePasswordChange}
                placeholder="Enter master password"
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                disabled={isLoading}
                aria-invalid={!!localError || undefined}
                aria-describedby={localError ? passwordErrorId : undefined}
                className="notion-input rounded-lg border border-surface-200 pr-10 dark:border-surface-700"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-surface-400 transition-colors hover:text-surface-600 dark:hover:text-surface-300"
                tabIndex={-1}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? (
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
                      d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21"
                    />
                  </svg>
                ) : (
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
                )}
              </button>
            </div>
          </div>

          {/* Confirm Password (Setup only) */}
          {isSetup && (
            <div className="animate-slide-up">
              <label
                htmlFor="confirm-password"
                className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-surface-500 dark:text-surface-400"
              >
                Confirm Password
              </label>
              <div className="relative">
                <input
                  id="confirm-password"
                  type={showConfirm ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={handleConfirmChange}
                  placeholder="Confirm master password"
                  autoComplete="off"
                  disabled={isLoading}
                  aria-invalid={!!localError || undefined}
                  aria-describedby={localError ? confirmPasswordErrorId : undefined}
                  className="notion-input rounded-lg border border-surface-200 pr-10 dark:border-surface-700"
                />
                <button
                  type="button"
                  onClick={() => setShowConfirm(!showConfirm)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-surface-400 transition-colors hover:text-surface-600 dark:hover:text-surface-300"
                  tabIndex={-1}
                  aria-label={showConfirm ? 'Hide confirm password' : 'Show confirm password'}
                >
                  {showConfirm ? (
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
                        d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21"
                      />
                    </svg>
                  ) : (
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
                  )}
                </button>
              </div>
            </div>
          )}

          {/* Strength Indicator (Setup only) */}
          {isSetup && password.length > 0 && (
            <div className="animate-slide-up space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs text-surface-500 dark:text-surface-400">
                  Password strength
                </span>
                <span className={`text-xs font-medium ${getStrengthTextColor(strength.score)}`}>
                  {strength.label}
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
              <p className="text-xs text-surface-400 dark:text-surface-500">
                {strength.entropy} bits of entropy
              </p>
            </div>
          )}

          {/* Error Display */}
          {localError && (
            <div 
              role="alert"
              id={passwordErrorId}
              className="animate-slide-up rounded-lg border border-danger-400/30 bg-danger-50 px-4 py-3 dark:bg-danger-500/10"
            >
              <div className="flex items-start gap-2">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="mt-0.5 h-4 w-4 shrink-0 text-danger-500"
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
                <p className="text-sm text-danger-600 dark:text-danger-400">{localError}</p>
              </div>
            </div>
          )}

          {/* Submit Button */}
          <button
            type="submit"
            disabled={isLoading || !password}
            className="notion-button-primary w-full rounded-lg py-2.5"
          >
            {isLoading ? (
              <span className="flex items-center gap-2">
                <svg
                  className="h-4 w-4 animate-spin"
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  />
                </svg>
                {isSetup ? 'Creating vault...' : 'Unlocking...'}
              </span>
            ) : (
              <span className="flex items-center gap-2">
                {isSetup ? (
                  <>
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
                        d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
                      />
                    </svg>
                    Create Vault
                  </>
                ) : (
                  <>
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
                        d="M8 11V7a4 4 0 118 0m-4 8v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2z"
                      />
                    </svg>
                    Unlock
                  </>
                )}
              </span>
            )}
          </button>
        </form>

        {/* Footer */}
        <div className="mt-6 flex flex-col items-center gap-3">
          <p className="text-center text-xs text-surface-400 dark:text-surface-500">
            {isSetup
              ? 'Your master password encrypts all data locally. It cannot be recovered.'
              : 'Press Esc to clear the form'}
          </p>
          {!isSetup && (
            <div className="flex w-full flex-col items-center gap-2">
              <DropZone
                onFileDropped={handleFileDropped}
                disabled={isLoading}
              />
              <div className="relative w-full text-center">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-surface-200 dark:border-surface-700" />
                </div>
                <div className="relative flex justify-center text-xs">
                  <span className="bg-surface-50 px-2 text-surface-400 dark:bg-surface-900 dark:text-surface-500">
                    or
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowImportDialog(true)}
                className="flex items-center gap-1.5 text-xs text-accent-500 transition-colors hover:text-accent-600 dark:text-accent-400 dark:hover:text-accent-300"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="h-3.5 w-3.5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M4 16v-4a1 1 0 011-1h4m6 0h4a1 1 0 011 1v4m-5-5l-3-3m0 0l3-3m-3 3h12"
                  />
                </svg>
                Import Data
              </button>
            </div>
          )}
        </div>
      </div>

      <ImportDialog
        isOpen={showImportDialog}
        onClose={handleImportDialogClose}
        initialFile={droppedFile}
      />
    </div>
  );
}
