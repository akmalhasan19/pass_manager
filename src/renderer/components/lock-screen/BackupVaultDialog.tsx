import React, { useState, useCallback, useEffect } from 'react';
import { useTranslation } from '../../i18n/useTranslation';
import type { VaultRegistryEntry } from '../../../shared/types';

interface BackupVaultDialogProps {
  isOpen: boolean;
  vault: VaultRegistryEntry | null;
  onClose: () => void;
  onBackup: (vaultId: string) => Promise<boolean>;
  isBackingUp: boolean;
}

/**
 * Dialog for creating an encrypted backup of a vault file.
 *
 * Shows vault information and a confirmation button.
 * The actual file save dialog is triggered via IPC.
 * The vault contents are NOT decrypted during backup.
 */
export default function BackupVaultDialog({
  isOpen,
  vault,
  onClose,
  onBackup,
  isBackingUp,
}: BackupVaultDialogProps): React.ReactElement | null {
  const { t } = useTranslation();
  const [localError, setLocalError] = useState('');

  // Reset state when dialog closes
  useEffect(() => {
    if (!isOpen) {
      setLocalError('');
    }
  }, [isOpen]);

  const handleBackup = useCallback(async () => {
    if (!vault) return;

    setLocalError('');
    const success = await onBackup(vault.id);

    if (success) {
      onClose();
    }
  }, [vault, onBackup, onClose]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    },
    [onClose],
  );

  if (!isOpen || !vault) return null;

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
        role="dialog"
        aria-modal="true"
        aria-label={t('vault.manage.backup.button')}
        className="relative z-10 w-full max-w-sm animate-fade-in rounded-xl border border-surface-200 bg-white p-6 shadow-xl dark:border-surface-700 dark:bg-surface-800"
        onKeyDown={handleKeyDown}
      >
        <h2 className="mb-1 text-base font-semibold text-surface-900 dark:text-surface-50">
          {t('vault.manage.backup.button')}
        </h2>
        <p className="mb-5 text-xs text-surface-500 dark:text-surface-400">
          {t('vault.manage.backup.description')}
        </p>

        {/* Vault info */}
        <div className="mb-5 space-y-2 rounded-lg border border-surface-200 bg-surface-50/50 p-3 dark:border-surface-700 dark:bg-surface-800/50">
          <div className="flex items-center gap-2">
            <span
              className="h-3 w-3 shrink-0 rounded-full"
              style={{ backgroundColor: vault.color ?? '#3b82f6' }}
            />
            <span className="text-sm font-medium text-surface-800 dark:text-surface-200">
              {vault.name}
            </span>
          </div>
        </div>

        {/* Error Display */}
        {localError && (
          <div role="alert" aria-live="assertive" className="mb-4 rounded-lg border border-danger-400/30 bg-danger-50 px-4 py-3 dark:bg-danger-500/10">
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
            disabled={isBackingUp}
            className="notion-button-ghost flex-1 rounded-lg py-2.5"
          >
            {t('item.cancel')}
          </button>
          <button
            type="button"
            onClick={handleBackup}
            disabled={isBackingUp}
            className="notion-button-primary flex-1 rounded-lg py-2.5"
          >
            {isBackingUp ? (
              <span className="flex items-center justify-center gap-2">
                <svg className="h-4 w-4 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                {t('vault.manage.backup.backingUp')}
              </span>
            ) : (
              t('vault.manage.backup.button')
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
