import React, { useState, useCallback, useRef, useEffect } from 'react';
import { useAuthStore } from '../../stores/authStore';
import { useTranslation } from '../../i18n/useTranslation';
import ConfirmDialog from '../ui/ConfirmDialog';
import VaultManagementDialog from '../lock-screen/VaultManagementDialog';
import type { VaultRegistryEntry } from '../../../shared/types';

/**
 * Screen-reader-only live region for announcing vault switch status.
 * Visually hidden but accessible to assistive technology.
 */
function VaultSwitchStatus({ message }: { message: string | null }): React.ReactElement {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className="sr-only"
    >
      {message}
    </div>
  );
}

/**
 * VaultSwitcher component displayed in the sidebar header area.
 *
 * Shows the currently active vault name with a colored indicator.
 * Clicking opens a dropdown listing all available vaults.
 * Selecting a different vault shows a confirmation dialog,
 * then locks the current vault and redirects to the lock screen
 * for the target vault.
 */
export default function VaultSwitcher(): React.ReactElement {
  const { t } = useTranslation();
  const {
    vaults,
    activeVaultId,
    activeVaultName,
    selectedVaultId,
    isSwitchingVault,
    lock,
    setSelectedVaultId,
    loadVaults,
  } = useAuthStore();

  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [targetVault, setTargetVault] = useState<VaultRegistryEntry | null>(null);
  const [manageVault, setManageVault] = useState<VaultRegistryEntry | null>(null);
  const [switchStatusMessage, setSwitchStatusMessage] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Load vaults on mount if not already loaded
  useEffect(() => {
    if (vaults.length === 0) {
      loadVaults();
    }
  }, [vaults.length, loadVaults]);

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!isDropdownOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsDropdownOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isDropdownOpen]);

  // Close dropdown on Escape key
  useEffect(() => {
    if (!isDropdownOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsDropdownOpen(false);
        buttonRef.current?.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isDropdownOpen]);

  const handleToggleDropdown = useCallback(() => {
    setIsDropdownOpen((prev) => !prev);
  }, []);

  const handleSelectVault = useCallback(
    (vault: VaultRegistryEntry) => {
      if (vault.id === activeVaultId) {
        // Already the active vault, just close dropdown
        setIsDropdownOpen(false);
        return;
      }
      // Show confirmation dialog for vault switch
      setTargetVault(vault);
      setIsDropdownOpen(false);
    },
    [activeVaultId],
  );

  const handleConfirmSwitch = useCallback(async () => {
    if (!targetVault) return;

    // Announce switching status to screen readers
    setSwitchStatusMessage(t('vault.switcher.statusSwitching', { vaultName: targetVault.name }));

    // Set the target vault as selected so the lock screen pre-selects it
    setSelectedVaultId(targetVault.id);
    // Lock the current vault — this transitions to 'locked' status
    // and the App will render LockScreenPage with the target vault pre-selected
    await lock();
    setTargetVault(null);

    // Announce successful switch after a brief delay
    setTimeout(() => {
      setSwitchStatusMessage(t('vault.switcher.statusSwitched', { vaultName: targetVault.name }));
    }, 500);
  }, [targetVault, setSelectedVaultId, lock, t]);

  const handleCancelSwitch = useCallback(() => {
    setTargetVault(null);
  }, []);

  const handleManageVault = useCallback(
    (e: React.MouseEvent, vault: VaultRegistryEntry) => {
      e.stopPropagation();
      setIsDropdownOpen(false);
      setManageVault(vault);
    },
    [],
  );

  const handleCloseManageVault = useCallback(() => {
    setManageVault(null);
  }, []);

  const handleDropdownKeyDown = useCallback(
    (e: React.KeyboardEvent, vault: VaultRegistryEntry) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        handleSelectVault(vault);
      }
    },
    [handleSelectVault],
  );

  const handleDropdownKeyDownOnButton = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        if (!isDropdownOpen) {
          setIsDropdownOpen(true);
        }
      }
    },
    [isDropdownOpen],
  );

  // Resolve the active vault entry for display
  const activeVault = vaults.find((v) => v.id === activeVaultId) ?? null;
  const displayName = activeVaultName ?? activeVault?.name ?? t('vault.switcher.noVault');
  const displayColor = activeVault?.color ?? null;

  // Sort vaults: active vault first, then by sortOrder
  const sortedVaults = [...vaults].sort((a, b) => {
    if (a.id === activeVaultId) return -1;
    if (b.id === activeVaultId) return 1;
    return a.sortOrder - b.sortOrder;
  });

  return (
    <>
      {/* Screen reader live region for vault switch status */}
      <VaultSwitchStatus message={switchStatusMessage} />

      <div className="relative px-3 pb-2" ref={dropdownRef}>
        {/* Vault switcher button */}
        <button
          ref={buttonRef}
          type="button"
          className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors ${
            isDropdownOpen
              ? 'bg-surface-200/80 dark:bg-surface-700/80'
              : 'hover:bg-surface-200/60 dark:hover:bg-surface-700/60'
          }`}
          onClick={handleToggleDropdown}
          onKeyDown={handleDropdownKeyDownOnButton}
          aria-haspopup="listbox"
          aria-expanded={isDropdownOpen}
          aria-label={t('vault.switcher.ariaLabel')}
          disabled={isSwitchingVault}
        >
          {/* Vault color indicator */}
          <span
            className="h-2.5 w-2.5 shrink-0 rounded-full"
            style={{
              backgroundColor: displayColor ?? '#3b82f6',
            }}
          />
          <span className="min-w-0 flex-1 truncate text-left font-medium text-surface-800 dark:text-surface-100">
            {displayName}
          </span>
          {vaults.length > 1 && (
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className={`h-4 w-4 shrink-0 text-surface-400 transition-transform dark:text-surface-500 ${
                isDropdownOpen ? 'rotate-180' : ''
              }`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          )}
        </button>

        {/* Dropdown */}
        {isDropdownOpen && (
          <div
            className="absolute left-3 right-3 top-full z-50 mt-1 overflow-hidden rounded-lg border border-surface-200 bg-white shadow-lg dark:border-surface-700 dark:bg-surface-800"
            role="listbox"
            aria-label={t('vault.switcher.dropdownAriaLabel')}
          >
            <div className="max-h-60 overflow-y-auto py-1">
              {sortedVaults.map((vault) => {
                const isActive = vault.id === activeVaultId;
                return (
                <div key={vault.id} className="group flex items-center">
                  <button
                    type="button"
                    className={`flex flex-1 items-center gap-2.5 px-3 py-2 text-sm transition-colors ${
                      isActive
                        ? 'bg-accent-50 text-accent-700 dark:bg-accent-900/20 dark:text-accent-300'
                        : 'text-surface-700 hover:bg-surface-100 dark:text-surface-300 dark:hover:bg-surface-700'
                    }`}
                    role="option"
                    aria-selected={isActive}
                    onClick={() => handleSelectVault(vault)}
                    onKeyDown={(e) => handleDropdownKeyDown(e, vault)}
                  >
                    {/* Vault color indicator */}
                    <span
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{
                        backgroundColor: vault.color ?? '#3b82f6',
                      }}
                    />
                    <span className="min-w-0 flex-1 truncate text-left">{vault.name}</span>
                    {isActive && (
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        className="h-4 w-4 shrink-0 text-accent-500"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={2}
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </button>
                  {/* Manage vault button (gear icon) */}
                  <button
                    type="button"
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-surface-400 opacity-0 transition-opacity hover:bg-surface-200 hover:text-surface-600 group-hover:opacity-100 dark:hover:bg-surface-600 dark:hover:text-surface-300"
                    onClick={(e) => handleManageVault(e, vault)}
                    aria-label={t('vault.switcher.manageVault')}
                    title={t('vault.switcher.manageVault')}
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                  </button>
                </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Vault Management Dialog */}
      <VaultManagementDialog
        isOpen={manageVault !== null}
        vault={manageVault}
        onClose={handleCloseManageVault}
      />

      {/* Switch vault confirmation dialog */}
      <ConfirmDialog
        isOpen={targetVault !== null}
        title={t('vault.switcher.confirmTitle')}
        message={t('vault.switcher.confirmMessage', {
          currentVault: displayName,
          targetVault: targetVault?.name ?? '',
        })}
        confirmLabel={t('vault.switcher.confirmButton')}
        cancelLabel={t('vault.switcher.cancelButton')}
        variant="primary"
        onConfirm={handleConfirmSwitch}
        onCancel={handleCancelSwitch}
      />
    </>
  );
}