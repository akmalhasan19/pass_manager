import React, { useState, useCallback, useEffect, useRef } from 'react';
import { useTranslation } from '../../i18n/useTranslation';

interface ImportVaultDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onImportVault: (filePath: string, name: string) => Promise<boolean>;
  isImporting: boolean;
}

/**
 * Dialog for importing an existing vault database file from the lock screen.
 * Opens a file dialog to select a .db file, then collects a vault name
 * and registers the vault in the registry.
 *
 * Includes focus trap and focus restoration for accessibility.
 */
export default function ImportVaultDialog({
  isOpen,
  onClose,
  onImportVault,
  isImporting,
}: ImportVaultDialogProps): React.ReactElement | null {
  const { t } = useTranslation();
  const [selectedFile, setSelectedFile] = useState<{ filePath: string; fileName: string } | null>(null);
  const [vaultName, setVaultName] = useState('');
  const [localError, setLocalError] = useState('');

  const nameInputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  // Focus trap and focus management
  useEffect(() => {
    if (!isOpen) return;

    // Store the element that triggered the dialog for focus restoration
    previousFocusRef.current = document.activeElement as HTMLElement;

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
      setSelectedFile(null);
      setVaultName('');
      setLocalError('');
    }
  }, [isOpen]);

  const handleSelectFile = useCallback(async () => {
    if (!window.electron) return;

    setLocalError('');
    const result = await window.electron.vaults.openFileDialog();

    if (result.success && result.data) {
      setSelectedFile(result.data);
      // Pre-fill vault name from file name (strip extension)
      const baseName = result.data.fileName.replace(/\.(db|sqlite|sqlite3)$/i, '');
      setVaultName(baseName);
      // Focus the name input
      setTimeout(() => nameInputRef.current?.focus(), 100);
    }
    // If cancelled, do nothing
  }, []);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setLocalError('');

      if (!selectedFile) {
        setLocalError(t('vault.import.error.fileRequired'));
        return;
      }

      if (!vaultName.trim()) {
        setLocalError(t('vault.create.error.nameRequired'));
        return;
      }

      if (vaultName.trim().length > 100) {
        setLocalError(t('vault.create.error.nameTooLong'));
        return;
      }

      const success = await onImportVault(selectedFile.filePath, vaultName.trim());

      if (success) {
        onClose();
      }
    },
    [selectedFile, vaultName, onImportVault, onClose, t],
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
        aria-label={t('vault.import.dialog.title')}
        className="relative z-10 w-full max-w-sm animate-fade-in rounded-xl border border-surface-200 bg-white p-6 shadow-xl dark:border-surface-700 dark:bg-surface-800"
        onKeyDown={handleKeyDown}
      >
        <h2 className="mb-1 text-base font-semibold text-surface-900 dark:text-surface-50">
          {t('vault.import.dialog.title')}
        </h2>
        <p className="mb-5 text-xs text-surface-500 dark:text-surface-400">
          {t('vault.import.dialog.description')}
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* File Selection */}
          <div>
            <label className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-surface-500 dark:text-surface-400">
              {t('vault.import.label.file')}
            </label>
            <button
              type="button"
              onClick={handleSelectFile}
              disabled={isImporting}
              className="flex w-full items-center gap-3 rounded-lg border border-surface-200 bg-surface-50 px-4 py-3 text-left transition-colors hover:border-surface-300 hover:bg-surface-100 dark:border-surface-700 dark:bg-surface-850 dark:hover:border-surface-600 dark:hover:bg-surface-750"
            >
              {selectedFile ? (
                <>
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 shrink-0 text-accent-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-surface-800 dark:text-surface-200 truncate">
                      {selectedFile.fileName}
                    </div>
                  </div>
                  <span className="shrink-0 text-xs text-accent-500">{t('vault.import.changeFile')}</span>
                </>
              ) : (
                <>
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 shrink-0 text-surface-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                  </svg>
                  <span className="text-sm text-surface-600 dark:text-surface-300">
                    {t('vault.import.selectFile')}
                  </span>
                </>
              )}
            </button>
          </div>

          {/* Vault Name (shown after file is selected) */}
          {selectedFile && (
            <div className="animate-slide-up">
              <label
                htmlFor="import-vault-name"
                className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-surface-500 dark:text-surface-400"
              >
                {t('vault.create.label.name')}
              </label>
              <input
                ref={nameInputRef}
                id="import-vault-name"
                type="text"
                value={vaultName}
                onChange={(e) => {
                  setVaultName(e.target.value);
                  if (localError) setLocalError('');
                }}
                placeholder={t('vault.create.placeholder.name')}
                maxLength={100}
                disabled={isImporting}
                className="notion-input rounded-lg border border-surface-200 dark:border-surface-700"
              />
            </div>
          )}

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
              disabled={isImporting}
              className="notion-button-ghost flex-1 rounded-lg py-2.5"
            >
              {t('item.cancel')}
            </button>
            <button
              type="submit"
              disabled={isImporting || !selectedFile || !vaultName.trim()}
              className="notion-button-primary flex-1 rounded-lg py-2.5"
            >
              {isImporting ? (
                <span className="flex items-center gap-2">
                  <svg className="h-4 w-4 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  {t('vault.import.importing')}
                </span>
              ) : (
                t('vault.import.dialog.importButton')
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}