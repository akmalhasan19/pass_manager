import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import type { Item, ItemDecrypted, TotpConfig } from '../../../shared/types';
import { useToast } from '../../hooks/useToast';
import { useTranslation } from '../../i18n/useTranslation';

type SortOption = 'name' | 'createdAt' | 'updatedAt' | 'sortOrder';

interface ContextMenuState {
  itemId: string;
  x: number;
  y: number;
}

interface FolderViewProps {
  items: Record<string, Item | ItemDecrypted>;
  itemIds: string[];
  currentFolderId: string | null;
  onSelectItem: (id: string) => void;
  onDeleteItem: (id: string) => void;
  onToggleFavorite: (id: string) => void;
  onDuplicateItem?: (id: string) => void;
  onEditItem?: (id: string) => void;
  onNewItem?: () => void;
}

function formatDateShort(ts: number): string {
  if (!ts) return '';
  const now = Date.now();
  const diff = now - ts;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

const SORT_LABELS: Record<SortOption, string> = {
  name: 'Name',
  createdAt: 'Date Created',
  updatedAt: 'Date Modified',
  sortOrder: 'Custom',
};

export default function FolderView({
  items,
  itemIds,
  currentFolderId,
  onSelectItem,
  onDeleteItem,
  onToggleFavorite,
  onDuplicateItem,
  onEditItem,
  onNewItem,
}: FolderViewProps): React.ReactElement {
  const [sortBy, setSortBy] = useState<SortOption>('sortOrder');
  const [sortMenuOpen, setSortMenuOpen] = useState(false);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const [copiedOtpItemId, setCopiedOtpItemId] = useState<string | null>(null);
  const copiedOtpTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { showSuccess } = useToast();
  const { t } = useTranslation();

  const sortedItemIds = useMemo(() => {
    const ids = [...itemIds];
    switch (sortBy) {
      case 'name':
        return ids.sort((a, b) => {
          const itemA = items[a];
          const itemB = items[b];
          return (itemA?.title || '').localeCompare(itemB?.title || '');
        });
      case 'createdAt':
        return ids.sort((a, b) => {
          const itemA = items[a];
          const itemB = items[b];
          return (itemB?.createdAt || 0) - (itemA?.createdAt || 0);
        });
      case 'updatedAt':
        return ids.sort((a, b) => {
          const itemA = items[a];
          const itemB = items[b];
          return (itemB?.updatedAt || 0) - (itemA?.updatedAt || 0);
        });
      case 'sortOrder':
      default:
        return ids.sort((a, b) => {
          const itemA = items[a];
          const itemB = items[b];
          return (itemA?.sortOrder || 0) - (itemB?.sortOrder || 0);
        });
    }
  }, [itemIds, items, sortBy]);

  const handleContextMenu = useCallback((e: React.MouseEvent, itemId: string) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ itemId, x: e.clientX, y: e.clientY });
  }, []);

  const closeContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  const handleCopyOtp = useCallback(
    async (e: React.MouseEvent, itemId: string, _otpConfig: TotpConfig) => {
      e.stopPropagation();
      try {
        // SECURITY: OTP code is generated in the main process.
        // The plaintext secret is never sent to the renderer.
        const result = await window.electron.otp.generate(itemId);
        if (!result.success || !result.data) return;
        await navigator.clipboard.writeText(result.data.code);
        if (copiedOtpTimerRef.current) clearTimeout(copiedOtpTimerRef.current);
        setCopiedOtpItemId(itemId);
        showSuccess(t('item.otpBadge.copied'));
        copiedOtpTimerRef.current = setTimeout(() => setCopiedOtpItemId(null), 2000);
      } catch {
        // Silently ignore clipboard failures
      }
    },
    [showSuccess, t],
  );

  useEffect(() => {
    if (!contextMenu) return;
    const handleClick = (e: MouseEvent) => {
      if (contextMenuRef.current && !contextMenuRef.current.contains(e.target as Node)) {
        closeContextMenu();
      }
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeContextMenu();
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [contextMenu, closeContextMenu]);

  useEffect(() => {
    return () => {
      if (copiedOtpTimerRef.current) {
        clearTimeout(copiedOtpTimerRef.current);
      }
    };
  }, []);

  return (
    <div className="flex h-full flex-col">
      {/* Sort controls */}
      <div className="flex shrink-0 items-center gap-2 border-b border-surface-200 bg-white px-4 py-2 dark:border-surface-700 dark:bg-surface-850">
        <div className="relative">
          <button
            className="flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium text-surface-500 transition-colors hover:bg-surface-100 dark:text-surface-400 dark:hover:bg-surface-800"
            onClick={() => setSortMenuOpen(!sortMenuOpen)}
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
                d="M3 4h13M3 8h9m-9 4h6m4 0l4-4m0 0l4 4m-4-4v12"
              />
            </svg>
            <span>{SORT_LABELS[sortBy]}</span>
          </button>
          {sortMenuOpen && (
            <div
              className="absolute left-0 top-full z-50 mt-1 min-w-[160px] rounded-lg border border-surface-200 bg-white py-1 shadow-lg dark:border-surface-700 dark:bg-surface-800"
              style={{ animation: 'fadeIn 0.1s ease-out' }}
            >
              {(Object.keys(SORT_LABELS) as SortOption[]).map((option) => (
                <button
                  key={option}
                  className={`flex w-full items-center gap-2 px-3 py-1.5 text-sm transition-colors ${
                    sortBy === option
                      ? 'bg-primary/5 text-primary dark:bg-primary/10'
                      : 'text-surface-700 hover:bg-surface-100 dark:text-surface-300 dark:hover:bg-surface-700'
                  }`}
                  onClick={() => {
                    setSortBy(option);
                    setSortMenuOpen(false);
                  }}
                >
                  {sortBy === option && (
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      className="h-3.5 w-3.5"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                  {SORT_LABELS[option]}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="notion-scrollbar flex-1 overflow-y-auto">
        {sortedItemIds.length > 0 ? (
          <div className="space-y-0.5 p-2">
            {sortedItemIds.map((itemId) => {
              const item = items[itemId];
              if (!item) return null;
              return (
                <button
                  key={item.id}
                  className="flex w-full items-center gap-4 rounded-xl p-4 text-left transition-all duration-200 hover:bg-surface-50 dark:hover:bg-surface-800/50"
                  onClick={() => onSelectItem(item.id)}
                  onContextMenu={(e) => handleContextMenu(e, item.id)}
                >
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-surface-100 text-xl shadow-sm dark:bg-surface-800">
                    {item.emoji || '🔑'}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between">
                      <h3 className="truncate text-sm font-semibold text-surface-800 dark:text-surface-200">
                        {item.title || 'Untitled'}
                      </h3>
                      <div className="ml-2 flex items-center gap-1.5">
                        {item.otp && (
                          <span
                            role="button"
                            tabIndex={0}
                            className="group/otp relative flex shrink-0 items-center"
                            onClick={(e) => handleCopyOtp(e, item.id, item.otp!)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                handleCopyOtp(e as unknown as React.MouseEvent, item.id, item.otp!);
                              }
                            }}
                            aria-label={t('item.otpBadge.tooltip')}
                            title={t('item.otpBadge.tooltip')}
                          >
                            <svg
                              xmlns="http://www.w3.org/2000/svg"
                              className={`h-4 w-4 transition-colors ${
                                copiedOtpItemId === item.id
                                  ? 'text-success-500'
                                  : 'text-primary/60 hover:text-primary'
                              }`}
                              fill="none"
                              viewBox="0 0 24 24"
                              stroke="currentColor"
                              strokeWidth={2}
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
                              />
                            </svg>
                            <span className="absolute -bottom-6 left-1/2 z-50 -translate-x-1/2 whitespace-nowrap rounded bg-surface-800 px-1.5 py-0.5 text-[10px] text-white opacity-0 shadow-lg transition-opacity group-hover/otp:opacity-100 dark:bg-surface-200 dark:text-surface-800">
                              {copiedOtpItemId === item.id
                                ? t('item.otpBadge.copied')
                                : t('item.otpBadge.tooltip')}
                            </span>
                          </span>
                        )}
                        {item.updatedAt && (
                          <span className="whitespace-nowrap text-[10px] text-surface-400">
                            {formatDateShort(item.updatedAt)}
                          </span>
                        )}
                      </div>
                    </div>
                    <p className="truncate text-sm text-surface-500 dark:text-surface-400">
                      {item.username || ''}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <div className="mb-3 text-4xl">📂</div>
            <p className="text-sm font-medium text-surface-600 dark:text-surface-400">
              No items yet
            </p>
            <p className="mt-1 text-xs text-surface-400 dark:text-surface-500">
              {currentFolderId
                ? 'Click "+ New Item" to add your first password entry.'
                : 'Select a folder from the sidebar to view its items.'}
            </p>
            {currentFolderId && onNewItem && (
              <button
                className="mt-4 flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-on-primary transition-colors hover:bg-primary-container"
                onClick={onNewItem}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="h-4 w-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                </svg>
                New Item
              </button>
            )}
          </div>
        )}
      </div>

      {/* Context menu */}
      {contextMenu && (
        <div
          ref={contextMenuRef}
          className="fixed z-50 min-w-[180px] rounded-lg border border-surface-200 bg-white py-1 shadow-lg dark:border-surface-700 dark:bg-surface-800"
          style={{ top: contextMenu.y, left: contextMenu.x, animation: 'fadeIn 0.1s ease-out' }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            className="flex w-full items-center gap-2 px-3 py-1.5 text-sm text-surface-700 transition-colors hover:bg-surface-100 dark:text-surface-300 dark:hover:bg-surface-700"
            onClick={() => {
              onSelectItem(contextMenu.itemId);
              closeContextMenu();
            }}
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
            </svg>
            Open
          </button>
          {onEditItem && (
            <button
              className="flex w-full items-center gap-2 px-3 py-1.5 text-sm text-surface-700 transition-colors hover:bg-surface-100 dark:text-surface-300 dark:hover:bg-surface-700"
              onClick={() => {
                onEditItem(contextMenu.itemId);
                closeContextMenu();
              }}
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
                  d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                />
              </svg>
              Edit
            </button>
          )}
          <button
            className="flex w-full items-center gap-2 px-3 py-1.5 text-sm text-surface-700 transition-colors hover:bg-surface-100 dark:text-surface-300 dark:hover:bg-surface-700"
            onClick={() => {
              onToggleFavorite(contextMenu.itemId);
              closeContextMenu();
            }}
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
                d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z"
              />
            </svg>
            {items[contextMenu.itemId]?.isFavorite ? 'Remove Favorite' : 'Add to Favorites'}
          </button>
          {onDuplicateItem && (
            <button
              className="flex w-full items-center gap-2 px-3 py-1.5 text-sm text-surface-700 transition-colors hover:bg-surface-100 dark:text-surface-300 dark:hover:bg-surface-700"
              onClick={() => {
                onDuplicateItem(contextMenu.itemId);
                closeContextMenu();
              }}
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
                  d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                />
              </svg>
              Duplicate
            </button>
          )}
          <div className="my-1 h-px bg-surface-200 dark:bg-surface-700" />
          <button
            className="flex w-full items-center gap-2 px-3 py-1.5 text-sm text-danger-600 transition-colors hover:bg-danger-50 dark:text-danger-400 dark:hover:bg-danger-500/10"
            onClick={() => {
              onDeleteItem(contextMenu.itemId);
              closeContextMenu();
            }}
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
                d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
              />
            </svg>
            Delete
          </button>
        </div>
      )}
    </div>
  );
}
