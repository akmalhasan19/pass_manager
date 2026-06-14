import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import type { Item, ItemDecrypted } from '../../../shared/types';

type ViewMode = 'list' | 'grid';
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
  isCreatingItem: boolean;
  newItemTitle: string;
  onNewItemTitleChange: (value: string) => void;
  onNewItemSubmit: () => void;
  onNewItemCancel: () => void;
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
  isCreatingItem,
  newItemTitle,
  onNewItemTitleChange,
  onNewItemSubmit,
  onNewItemCancel,
}: FolderViewProps): React.ReactElement {
  const [sortBy, setSortBy] = useState<SortOption>('sortOrder');
  const [sortMenuOpen, setSortMenuOpen] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);

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
    if (isCreatingItem) {
      const timer = setTimeout(() => {
        const input = document.querySelector<HTMLInputElement>('[data-new-item-input]');
        input?.focus();
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [isCreatingItem]);

  return (
    <div className="flex h-full flex-col">
      {/* Sort controls */}
      <div className="flex shrink-0 items-center gap-2 border-b border-surface-200 bg-white px-4 py-2 dark:border-surface-700 dark:bg-surface-850">
        <div className="flex items-center gap-1 rounded-lg bg-surface-100 p-0.5 dark:bg-surface-800">
          <button
            className={`flex items-center gap-1 rounded px-2.5 py-1 text-xs font-medium transition-colors ${
              viewMode === 'list'
                ? 'bg-white text-surface-800 shadow-sm dark:bg-surface-750 dark:text-surface-200'
                : 'text-surface-500 hover:text-surface-700 dark:hover:text-surface-300'
            }`}
            onClick={() => setViewMode('list')}
            aria-label="List view"
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
                d="M4 6h16M4 10h16M4 14h16M4 18h16"
              />
            </svg>
          </button>
          <button
            className={`flex items-center gap-1 rounded px-2.5 py-1 text-xs font-medium transition-colors ${
              viewMode === 'grid'
                ? 'bg-white text-surface-800 shadow-sm dark:bg-surface-750 dark:text-surface-200'
                : 'text-surface-500 hover:text-surface-700 dark:hover:text-surface-300'
            }`}
            onClick={() => setViewMode('grid')}
            aria-label="Grid view"
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
                d="M4 5a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1V5zm10 0a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1V5zM4 15a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1v-4zm10 0a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z"
              />
            </svg>
          </button>
        </div>

        <div className="relative">
          <button
            className="notion-button-ghost h-7 gap-1.5 text-xs"
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
            <span className="text-surface-500 dark:text-surface-400">{SORT_LABELS[sortBy]}</span>
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
                      ? 'bg-accent-50 text-accent-600 dark:bg-accent-900/20 dark:text-accent-400'
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
          viewMode === 'grid' ? (
            <div className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {sortedItemIds.map((itemId) => {
                const item = items[itemId];
                if (!item) return null;
                return (
                  <button
                    key={item.id}
                    className="notion-card group flex flex-col gap-2 p-4 text-left"
                    onClick={() => onSelectItem(item.id)}
                    onContextMenu={(e) => handleContextMenu(e, item.id)}
                  >
                    <div className="flex items-start justify-between">
                      <span className="text-2xl">{item.emoji || '🔑'}</span>
                      {item.isFavorite && (
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          className="h-4 w-4 shrink-0 text-yellow-500"
                          fill="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
                        </svg>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-surface-800 dark:text-surface-200">
                        {item.title}
                      </p>
                      {item.username && (
                        <p className="mt-0.5 truncate text-xs text-surface-500 dark:text-surface-400">
                          {item.username}
                        </p>
                      )}
                    </div>
                    {item.url && (
                      <p className="truncate text-xs text-surface-400 dark:text-surface-500">
                        {(() => {
                          try {
                            return new URL(item.url).hostname;
                          } catch {
                            return item.url;
                          }
                        })()}
                      </p>
                    )}
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="divide-y divide-surface-200 dark:divide-surface-700">
              {sortedItemIds.map((itemId) => {
                const item = items[itemId];
                if (!item) return null;
                return (
                  <button
                    key={item.id}
                    className="group flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-50 dark:hover:bg-surface-800/50"
                    onClick={() => onSelectItem(item.id)}
                    onContextMenu={(e) => handleContextMenu(e, item.id)}
                  >
                    <span className="shrink-0 text-xl">{item.emoji || '🔑'}</span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-surface-800 dark:text-surface-200">
                        {item.title}
                      </p>
                      {item.username && (
                        <p className="truncate text-xs text-surface-500 dark:text-surface-400">
                          {item.username}
                        </p>
                      )}
                    </div>
                    {item.url && (
                      <span className="hidden max-w-[200px] truncate text-xs text-surface-400 dark:text-surface-500 md:block">
                        {(() => {
                          try {
                            return new URL(item.url).hostname;
                          } catch {
                            return item.url;
                          }
                        })()}
                      </span>
                    )}
                    {item.isFavorite && (
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        className="h-4 w-4 shrink-0 text-yellow-500"
                        fill="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
                      </svg>
                    )}
                  </button>
                );
              })}
            </div>
          )
        ) : (
          <div className="notion-empty-state h-full">
            <div className="notion-empty-state-icon">📂</div>
            <p className="notion-empty-state-title">No items yet</p>
            <p className="notion-empty-state-description">
              {currentFolderId
                ? 'Click "New Item" to add your first password entry.'
                : 'Select a folder from the sidebar to view its items.'}
            </p>
            {isCreatingItem && (
              <div className="mt-4 flex items-center gap-2">
                <input
                  data-new-item-input
                  className="notion-input h-8 w-56 text-xs"
                  placeholder="Item title..."
                  value={newItemTitle}
                  onChange={(e) => onNewItemTitleChange(e.target.value)}
                  onBlur={() => {
                    if (!newItemTitle.trim()) {
                      onNewItemCancel();
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      onNewItemSubmit();
                    } else if (e.key === 'Escape') {
                      onNewItemCancel();
                    }
                  }}
                  autoFocus
                />
                <button className="notion-button-primary h-8 text-xs" onClick={onNewItemSubmit}>
                  Add
                </button>
                <button className="notion-button-ghost h-8 text-xs" onClick={onNewItemCancel}>
                  Cancel
                </button>
              </div>
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
