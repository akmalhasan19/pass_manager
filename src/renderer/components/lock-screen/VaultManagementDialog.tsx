import React, { useState, useCallback, useEffect } from 'react';
import Modal from '../ui/Modal';
import BackupVaultDialog from './BackupVaultDialog';
import { useAuthStore } from '../../stores/authStore';
import { useTranslation } from '../../i18n/useTranslation';
import { sanitizeField, validateCharacters } from '../../../shared/validation';
import { MAX_FIELD_LENGTHS } from '../../../shared/constants';
import type { VaultRegistryEntry } from '../../../shared/types';

interface VaultManagementDialogProps {
  isOpen: boolean;
  vault: VaultRegistryEntry | null;
  onClose: () => void;
}

/**
 * Vault Management Dialog for managing a specific vault.
 *
 * Features:
 * - View vault information (name, path, created date, last opened, default status)
 * - Rename vault
 * - Set as default vault
 * - Reveal file location in system file manager
 * - Delete vault with explicit confirmation
 *
 * SECURITY: If the vault being deleted is currently active, it will be locked
 * and all encryption keys will be wiped from memory before the file is removed.
 * Delete confirmation requires the user to type the vault name explicitly.
 */
export default function VaultManagementDialog({
  isOpen,
  vault,
  onClose,
}: VaultManagementDialogProps): React.ReactElement {
  const { t } = useTranslation();
  const {
    activeVaultId,
    isRenamingVault,
    isSettingDefaultVault,
    isDeletingVault,
    isBackingUpVault,
    renameVault,
    setDefaultVault,
    deleteVault,
    backupVault,
    lock,
  } = useAuthStore();

  // --- Rename state ---
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const [renameError, setRenameError] = useState<string | null>(null);

  // --- Delete state ---
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteConfirmationName, setDeleteConfirmationName] = useState('');
  const [keepDatabase, setKeepDatabase] = useState(false);
  const [keepAttachments, setKeepAttachments] = useState(false);

  // --- Backup state ---
  const [showBackupDialog, setShowBackupDialog] = useState(false);

  const isActiveVault = vault !== null && activeVaultId === vault.id;

  // Reset state when vault changes or dialog opens/closes
  useEffect(() => {
    if (!isOpen || !vault) {
      setIsRenaming(false);
      setRenameValue('');
      setRenameError(null);
      setShowDeleteConfirm(false);
      setDeleteConfirmationName('');
      setKeepDatabase(false);
      setKeepAttachments(false);
      setShowBackupDialog(false);
    }
  }, [isOpen, vault]);

  // --- Rename handlers ---
  const handleStartRename = useCallback(() => {
    if (!vault) return;
    setIsRenaming(true);
    setRenameValue(vault.name);
    setRenameError(null);
  }, [vault]);

  const handleCancelRename = useCallback(() => {
    setIsRenaming(false);
    setRenameValue('');
    setRenameError(null);
  }, []);

  const handleRenameSubmit = useCallback(async () => {
    if (!vault) return;

    const sanitized = sanitizeField('vaultName', renameValue);
    const name = sanitized.trim();

    if (sanitized !== renameValue) {
      setRenameValue(sanitized);
    }

    if (!name) {
      setRenameError(t('vault.create.error.nameRequired'));
      return;
    }

    const charError = validateCharacters('vaultName', name);
    if (charError) {
      setRenameError(t(charError));
      return;
    }

    if (name.length > MAX_FIELD_LENGTHS.VAULT_NAME) {
      setRenameError(t('vault.create.error.nameTooLong'));
      return;
    }

    if (name === vault.name) {
      // No change, just close rename mode
      setIsRenaming(false);
      return;
    }

    const success = await renameVault(vault.id, name);
    if (success) {
      setIsRenaming(false);
      setRenameValue('');
      setRenameError(null);
    } else {
      // Error is set in the store
    }
  }, [vault, renameValue, renameVault, t]);

  const handleRenameKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        handleRenameSubmit();
      } else if (e.key === 'Escape') {
        handleCancelRename();
      }
    },
    [handleRenameSubmit, handleCancelRename],
  );

  // --- Set default handler ---
  const handleSetDefault = useCallback(async () => {
    if (!vault) return;
    await setDefaultVault(vault.id);
  }, [vault, setDefaultVault]);

  // --- Reveal location handler ---
  const handleRevealLocation = useCallback(async () => {
    if (!vault || !window.electron) return;
    try {
      await window.electron.vaults.revealLocation(vault.id);
    } catch {
      // Non-critical: file explorer may not be available
    }
  }, [vault]);

  // --- Backup handler ---
  const handleOpenBackup = useCallback(() => {
    setShowBackupDialog(true);
  }, []);

  const handleCloseBackup = useCallback(() => {
    setShowBackupDialog(false);
  }, []);

  // --- Delete handlers ---
  const handleOpenDeleteConfirm = useCallback(() => {
    setShowDeleteConfirm(true);
    setDeleteConfirmationName('');
    setKeepDatabase(false);
    setKeepAttachments(false);
  }, []);

  const handleCloseDeleteConfirm = useCallback(() => {
    setShowDeleteConfirm(false);
    setDeleteConfirmationName('');
  }, []);

  const handleDeleteVault = useCallback(async () => {
    if (!vault) return;

    // If the vault is active, lock it first to wipe memory
    if (isActiveVault) {
      try {
        await lock();
      } catch {
        // Lock should proceed even if it fails
      }
    }

    const success = await deleteVault(vault.id, !keepDatabase, !keepAttachments);
    if (success) {
      setShowDeleteConfirm(false);
      setDeleteConfirmationName('');
      onClose();
    }
  }, [vault, isActiveVault, keepDatabase, keepAttachments, deleteVault, lock, onClose]);

  // Format dates for display
  const formatTimestamp = (ts: number | null): string => {
    if (ts === null) return t('vault.manage.info.neverOpened');
    return new Date(ts).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  if (!vault) return <></>;

  const isDeleteConfirmValid = deleteConfirmationName === vault.name;

  return (
    <>
      {/* Main management dialog */}
      <Modal
        isOpen={isOpen}
        onClose={onClose}
        position="center"
        className="max-w-lg"
        ariaLabel={t('vault.manage.dialog.ariaLabel')}
      >
        <div className="space-y-5 p-5">
          {/* Header */}
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-surface-900 dark:text-surface-50">
              {t('vault.manage.dialog.title')}
            </h2>
            <button
              type="button"
              className="flex h-8 w-8 items-center justify-center rounded-lg text-surface-400 transition-colors hover:bg-surface-100 hover:text-surface-600 dark:hover:bg-surface-700 dark:hover:text-surface-300"
              onClick={onClose}
              aria-label={t('import.dialog.ariaLabelClose')}
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Vault color indicator and name */}
          <div className="flex items-center gap-3">
            <span
              className="h-3 w-3 shrink-0 rounded-full"
              style={{ backgroundColor: vault.color ?? '#3b82f6' }}
            />
            {isRenaming ? (
              <div className="flex flex-1 items-center gap-2">
                <input
                  type="text"
                  className={`flex-1 rounded-md border bg-white px-2.5 py-1.5 text-sm outline-none ring-1 dark:bg-surface-800 ${
                    renameError
                      ? 'border-danger-400 ring-danger-400/50'
                      : 'border-surface-300 ring-accent-400/50 focus:border-accent-400 dark:border-surface-600'
                  }`}
                  value={renameValue}
                  onChange={(e) => {
                    const sanitized = sanitizeField('vaultName', e.target.value);
                    setRenameValue(sanitized);
                    setRenameError(null);
                  }}
                  onKeyDown={handleRenameKeyDown}
                  maxLength={MAX_FIELD_LENGTHS.VAULT_NAME}
                  autoFocus
                  aria-label={t('vault.manage.rename.placeholder')}
                />
                <button
                  type="button"
                  className="notion-button h-8 text-xs"
                  onClick={handleRenameSubmit}
                  disabled={isRenamingVault}
                >
                  {isRenamingVault ? t('vault.manage.rename.renaming') : t('vault.manage.rename.button')}
                </button>
                <button
                  type="button"
                  className="notion-button-ghost h-8 text-xs"
                  onClick={handleCancelRename}
                  disabled={isRenamingVault}
                >
                  {t('vault.manage.close')}
                </button>
              </div>
            ) : (
              <div className="flex flex-1 items-center justify-between">
                <span className="text-base font-medium text-surface-800 dark:text-surface-100">
                  {vault.name}
                </span>
                <button
                  type="button"
                  className="notion-button-ghost h-7 text-xs"
                  onClick={handleStartRename}
                >
                  {t('item.edit')}
                </button>
              </div>
            )}
          </div>

          {/* Rename error */}
          {renameError && (
            <p className="text-xs text-danger-500">{renameError}</p>
          )}

          {/* Vault Information */}
          <div className="space-y-3 rounded-lg border border-surface-200 bg-surface-50/50 p-3 dark:border-surface-700 dark:bg-surface-800/50">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-surface-500 dark:text-surface-400">
              {t('vault.manage.info.title')}
            </h3>

            {/* Database path */}
            <div className="flex items-start justify-between gap-2">
              <span className="text-xs text-surface-500 dark:text-surface-400">
                {t('vault.manage.info.path')}
              </span>
              <span
                className="max-w-[250px] truncate text-right text-xs text-surface-700 dark:text-surface-300"
                title={vault.databasePath}
              >
                {vault.databasePath}
              </span>
            </div>

            {/* Created */}
            <div className="flex items-center justify-between">
              <span className="text-xs text-surface-500 dark:text-surface-400">
                {t('vault.manage.info.created')}
              </span>
              <span className="text-xs text-surface-700 dark:text-surface-300">
                {formatTimestamp(vault.createdAt)}
              </span>
            </div>

            {/* Last opened */}
            <div className="flex items-center justify-between">
              <span className="text-xs text-surface-500 dark:text-surface-400">
                {t('vault.manage.info.lastOpened')}
              </span>
              <span className="text-xs text-surface-700 dark:text-surface-300">
                {formatTimestamp(vault.lastOpenedAt)}
              </span>
            </div>

            {/* Default vault */}
            <div className="flex items-center justify-between">
              <span className="text-xs text-surface-500 dark:text-surface-400">
                {t('vault.manage.info.isDefault')}
              </span>
              <span className="text-xs text-surface-700 dark:text-surface-300">
                {vault.isDefault ? t('vault.manage.info.yes') : t('vault.manage.info.no')}
              </span>
            </div>
          </div>

          {/* Action buttons */}
          <div className="space-y-2">
            {/* Set as default */}
            {!vault.isDefault && (
              <button
                type="button"
                className="flex w-full items-center gap-2.5 rounded-lg border border-surface-200 px-3 py-2.5 text-sm text-surface-700 transition-colors hover:bg-surface-100 dark:border-surface-700 dark:text-surface-300 dark:hover:bg-surface-700"
                onClick={handleSetDefault}
                disabled={isSettingDefaultVault}
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 shrink-0 text-accent-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
                </svg>
                <span>{t('vault.manage.setDefault.button')}</span>
              </button>
            )}

            {/* Reveal file location */}
            <button
              type="button"
              className="flex w-full items-center gap-2.5 rounded-lg border border-surface-200 px-3 py-2.5 text-sm text-surface-700 transition-colors hover:bg-surface-100 dark:border-surface-700 dark:text-surface-300 dark:hover:bg-surface-700"
              onClick={handleRevealLocation}
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 shrink-0 text-surface-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
              </svg>
              <span>{t('vault.manage.revealLocation.button')}</span>
            </button>

            {/* Backup vault */}
            <button
              type="button"
              className="flex w-full items-center gap-2.5 rounded-lg border border-surface-200 px-3 py-2.5 text-sm text-surface-700 transition-colors hover:bg-surface-100 dark:border-surface-700 dark:text-surface-300 dark:hover:bg-surface-700"
              onClick={handleOpenBackup}
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 shrink-0 text-accent-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              <span>{t('vault.manage.backup.button')}</span>
            </button>

            {/* Delete vault */}
            <button
              type="button"
              className="flex w-full items-center gap-2.5 rounded-lg border border-danger-200 px-3 py-2.5 text-sm text-danger-600 transition-colors hover:bg-danger-50 dark:border-danger-800/50 dark:text-danger-400 dark:hover:bg-danger-900/20"
              onClick={handleOpenDeleteConfirm}
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
              <span>{t('vault.manage.delete.button')}</span>
            </button>
          </div>

          {/* Close button */}
          <div className="flex justify-end">
            <button type="button" className="notion-button h-9 text-sm" onClick={onClose}>
              {t('vault.manage.close')}
            </button>
          </div>
        </div>
      </Modal>

      {/* Delete confirmation dialog — custom dialog with delete confirmation input */}
      <Modal
        isOpen={showDeleteConfirm}
        onClose={handleCloseDeleteConfirm}
        position="center"
        className="max-w-sm"
        ariaLabel={t('vault.manage.delete.confirmTitle', { vaultName: vault.name })}
      >
        <div className="space-y-4 p-5">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-danger-50 text-danger-500 dark:bg-danger-500/10">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            <div>
              <h3 className="text-base font-semibold text-surface-900 dark:text-surface-50">
                {t('vault.manage.delete.confirmTitle', { vaultName: vault.name })}
              </h3>
              <p className="mt-1 text-sm text-surface-500 dark:text-surface-400">
                {t('vault.manage.delete.confirmMessage', { vaultName: vault.name })}
              </p>
              <p className="mt-2 text-sm font-medium text-danger-600 dark:text-danger-400">
                {t('vault.manage.delete.warning')}
              </p>
              {isActiveVault && (
                <p className="mt-1 text-sm font-medium text-danger-600 dark:text-danger-400">
                  {t('vault.manage.delete.isActiveWarning')}
                </p>
              )}
            </div>
          </div>

          {/* Type vault name confirmation */}
          <div>
            <label className="mb-1 block text-xs text-surface-500 dark:text-surface-400">
              {t('vault.manage.delete.typeToConfirm', { vaultName: vault.name })}
            </label>
            <input
              type="text"
              className="w-full rounded-md border border-surface-300 bg-white px-2.5 py-1.5 text-sm outline-none ring-1 ring-transparent transition-colors focus:border-danger-400 focus:ring-danger-400/50 dark:border-surface-600 dark:bg-surface-800"
              value={deleteConfirmationName}
              onChange={(e) => setDeleteConfirmationName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && isDeleteConfirmValid) {
                  handleDeleteVault();
                }
              }}
              autoFocus
            />
          </div>

          <div className="flex items-center justify-end gap-2">
            <button type="button" className="notion-button-ghost h-9 text-sm" onClick={handleCloseDeleteConfirm}>
              {t('vault.manage.delete.cancelButton')}
            </button>
            <button
              type="button"
              className="notion-button h-9 text-sm notion-button-danger"
              disabled={!isDeleteConfirmValid}
              onClick={handleDeleteVault}
            >
              {isDeletingVault ? t('vault.manage.delete.deleting') : t('vault.manage.delete.confirmButton')}
            </button>
          </div>
        </div>
      </Modal>

      {/* Backup dialog */}
      <BackupVaultDialog
        isOpen={showBackupDialog}
        vault={vault}
        onClose={handleCloseBackup}
        onBackup={backupVault}
        isBackingUp={isBackingUpVault}
      />
    </>
  );
}