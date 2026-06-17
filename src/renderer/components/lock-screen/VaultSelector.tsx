import React, { useState, useRef, useEffect, useCallback } from 'react';
import type { VaultRegistryEntry } from '../../../shared/types';
import { useTranslation } from '../../i18n/useTranslation';

interface VaultSelectorProps {
  vaults: VaultRegistryEntry[];
  selectedVaultId: string | null;
  onSelectVault: (vaultId: string) => void;
  disabled?: boolean;
}

/**
 * Format a timestamp into a human-readable "last opened" string.
 * Returns null if the vault has never been opened.
 * Uses i18n keys for localized display.
 */
function formatLastOpened(
  lastOpenedAt: number | null,
  t: (key: string, params?: Record<string, string | number>) => string,
): string | null {
  if (!lastOpenedAt) return null;
  const now = Date.now();
  const diffMs = now - lastOpenedAt;
  const diffMinutes = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMinutes < 1) return t('vault.selector.justNow');
  if (diffMinutes < 60) return t('vault.selector.minutesAgo', { minutes: diffMinutes });
  if (diffHours < 24) return t('vault.selector.hoursAgo', { hours: diffHours });
  if (diffDays < 7) return t('vault.selector.daysAgo', { days: diffDays });
  return new Date(lastOpenedAt).toLocaleDateString();
}

/**
 * Vault selector dropdown for the lock screen.
 * Displays a list of available vaults with safe metadata (name, last opened).
 * No vault content is exposed — only non-sensitive registry metadata.
 */
export default function VaultSelector({
  vaults,
  selectedVaultId,
  onSelectVault,
  disabled = false,
}: VaultSelectorProps): React.ReactElement {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState<number>(() => {
    if (!selectedVaultId) return 0;
    const idx = vaults.findIndex((v) => v.id === selectedVaultId);
    return idx >= 0 ? idx : 0;
  });
  const dropdownRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listboxId = useId();

  const selectedVault = vaults.find((v) => v.id === selectedVaultId) ?? vaults[0];

  useEffect(() => {
    setActiveIndex(() => {
      if (!selectedVaultId) return 0;
      const idx = vaults.findIndex((v) => v.id === selectedVaultId);
      return idx >= 0 ? idx : 0;
    });
  }, [selectedVaultId, vaults]);

  // Close dropdown on outside click
  useEffect(() => {
    if (!isOpen) return;
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [isOpen]);

  const handleSelect = useCallback(
    (vaultId: string) => {
      onSelectVault(vaultId);
      setIsOpen(false);
    },
    [onSelectVault],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (disabled) return;

      switch (e.key) {
        case 'Enter':
        case ' ':
          e.preventDefault();
          if (isOpen && vaults[activeIndex]) {
            handleSelect(vaults[activeIndex].id);
          } else {
            setIsOpen(true);
          }
          break;
        case 'ArrowDown':
          e.preventDefault();
          if (!isOpen) {
            setIsOpen(true);
          } else {
            setActiveIndex((prev) => (prev + 1) % vaults.length);
          }
          break;
        case 'ArrowUp':
          e.preventDefault();
          if (isOpen) {
            setActiveIndex((prev) => (prev - 1 + vaults.length) % vaults.length);
          }
          break;
        case 'Escape':
          e.preventDefault();
          setIsOpen(false);
          buttonRef.current?.focus();
          break;
        default:
          break;
      }
    },
    [disabled, isOpen, activeIndex, vaults, handleSelect],
  );

  if (vaults.length <= 1) {
    // No selector needed for single vault — just show vault name as static text
    if (vaults.length === 1 && selectedVault) {
      return (
        <div className="mb-4 text-center">
          <div className="flex items-center justify-center gap-2">
            <span className="text-lg" role="img" aria-hidden="true">
              {selectedVault.icon ?? '🔐'}
            </span>
            <span className="text-sm font-medium text-surface-800 dark:text-surface-200">
              {selectedVault.name}
            </span>
          </div>
        </div>
      );
    }
    return <></>;
  }

  return (
    <div className="mb-4" ref={dropdownRef}>
      <label
        id={`${listboxId}-label`}
        className="mb-1.5 block text-center text-xs font-medium uppercase tracking-wider text-surface-500 dark:text-surface-400"
      >
        {t('vault.selector.label')}
      </label>
      <div className="relative">
        <button
          ref={buttonRef}
          type="button"
          role="combobox"
          aria-expanded={isOpen}
          aria-haspopup="listbox"
          aria-labelledby={`${listboxId}-label`}
          aria-controls={isOpen ? listboxId : undefined}
          aria-activedescendant={isOpen && vaults[activeIndex] ? `${listboxId}-option-${activeIndex}` : undefined}
          disabled={disabled}
          onClick={() => {
            if (!disabled) setIsOpen(!isOpen);
          }}
          onKeyDown={handleKeyDown}
          className="flex w-full items-center justify-between gap-2 rounded-lg border border-surface-200 bg-white px-3 py-2.5 text-left transition-colors hover:border-surface-300 focus:outline-none focus:ring-2 focus:ring-accent-400/50 disabled:opacity-50 dark:border-surface-700 dark:bg-surface-800 dark:hover:border-surface-600"
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="text-lg shrink-0" role="img" aria-hidden="true">
              {selectedVault?.icon ?? '🔐'}
            </span>
            <div className="min-w-0">
              <div className="text-sm font-medium text-surface-800 dark:text-surface-200 truncate">
                {selectedVault?.name ?? t('vault.selector.selectVault')}
              </div>
              {selectedVault && (
                <div className="text-xs text-surface-400 dark:text-surface-500">
                  {selectedVault.lastOpenedAt
                    ? `${t('vault.selector.lastOpened')} ${formatLastOpened(selectedVault.lastOpenedAt, t)}`
                    : t('vault.selector.neverOpened')}
                </div>
              )}
            </div>
          </div>
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className={`h-4 w-4 shrink-0 text-surface-400 transition-transform duration-150 ${isOpen ? 'rotate-180' : ''}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {isOpen && (
          <div
            role="listbox"
            id={listboxId}
            aria-labelledby={`${listboxId}-label`}
            className="absolute z-50 mt-1 w-full overflow-hidden rounded-lg border border-surface-200 bg-white shadow-lg dark:border-surface-700 dark:bg-surface-800"
          >
            {vaults.map((vault, index) => {
              const isSelected = vault.id === selectedVaultId;
              const isHighlighted = index === activeIndex;
              const lastOpened = formatLastOpened(vault.lastOpenedAt, t);

              return (
                <div
                  key={vault.id}
                  id={`${listboxId}-option-${index}`}
                  role="option"
                  aria-selected={isSelected}
                  className={`flex cursor-pointer items-center gap-2.5 px-3 py-2.5 transition-colors ${
                    isHighlighted
                      ? 'bg-accent-50 dark:bg-accent-900/20'
                      : 'hover:bg-surface-50 dark:hover:bg-surface-750'
                  } ${index > 0 ? 'border-t border-surface-100 dark:border-surface-700' : ''}`}
                  onClick={() => handleSelect(vault.id)}
                  onMouseEnter={() => setActiveIndex(index)}
                >
                  <span className="text-lg shrink-0" role="img" aria-hidden="true">
                    {vault.icon ?? '🔐'}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-surface-800 dark:text-surface-200 truncate">
                        {vault.name}
                      </span>
                      {vault.isDefault && (
                        <span className="shrink-0 rounded bg-accent-100 px-1.5 py-0.5 text-[10px] font-medium text-accent-600 dark:bg-accent-900/30 dark:text-accent-400">
                          {t('vault.selector.default')}
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-surface-400 dark:text-surface-500">
                      {lastOpened
                        ? `${t('vault.selector.lastOpened')} ${lastOpened}`
                        : t('vault.selector.neverOpened')}
                    </div>
                  </div>
                  {isSelected && (
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
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function useId(): string {
  const idRef = useRef(`vault-selector-${Math.random().toString(36).slice(2, 9)}`);
  return idRef.current;
}