import React, { useState, useCallback, useMemo } from 'react';
import { useUIStore, type ActiveView } from '../../stores/uiStore';
import { useAuthStore } from '../../stores/authStore';
import { useFolderStore } from '../../stores/folderStore';
import { useItemStore } from '../../stores/itemStore';
import type { Folder } from '../../../shared/types';

function buildBreadcrumbPath(
  folders: Folder[],
  targetId: string,
  path: Folder[] = [],
): Folder[] | null {
  for (const folder of folders) {
    if (folder.id === targetId) {
      return [...path, folder];
    }
    if (folder.children) {
      const found = buildBreadcrumbPath(folder.children, targetId, [...path, folder]);
      if (found) return found;
    }
  }
  return null;
}

type SortOption = 'name' | 'createdAt' | 'updatedAt' | 'sortOrder';

const SORT_LABELS: Record<SortOption, string> = {
  name: 'Name',
  createdAt: 'Date Created',
  updatedAt: 'Date Modified',
  sortOrder: 'Custom',
};

export default function MainPanel(): React.ReactElement {
  const { activeView, setActiveView, sidebarOpen, toggleQuickFind } = useUIStore();
  const { lock } = useAuthStore();
  const {
    folders,
    selectedFolderId,
    setSelectedFolder,
    createFolder,
  } = useFolderStore();
  const {
    items,
    itemIds,
    currentFolderId,
    loadItems,
    createItem,
    setSelectedItem,
  } = useItemStore();

  const [sortBy, setSortBy] = useState<SortOption>('sortOrder');
  const [sortMenuOpen, setSortMenuOpen] = useState(false);
  const [newItemTitle, setNewItemTitle] = useState('');
  const [isCreatingItem, setIsCreatingItem] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);

  const breadcrumb = useMemo(() => {
    if (!selectedFolderId) return [];
    return buildBreadcrumbPath(folders, selectedFolderId) || [];
  }, [folders, selectedFolderId]);

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

  const handleBreadcrumbClick = useCallback(
    (folderId: string | null) => {
      setSelectedFolder(folderId);
      if (folderId) {
        loadItems(folderId);
      }
    },
    [setSelectedFolder, loadItems],
  );

  const handleNewItemSubmit = useCallback(async () => {
    const title = newItemTitle.trim();
    if (!title || !currentFolderId) return;
    await createItem(currentFolderId, { title });
    setNewItemTitle('');
    setIsCreatingItem(false);
  }, [newItemTitle, currentFolderId, createItem]);

  const handleNewItemKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        handleNewItemSubmit();
      } else if (e.key === 'Escape') {
        setIsCreatingItem(false);
        setNewItemTitle('');
      }
    },
    [handleNewItemSubmit],
  );

  const handleNewFolderSubmit = useCallback(async () => {
    const name = newFolderName.trim();
    if (!name) return;
    const parentId = selectedFolderId || null;
    await createFolder(parentId, name);
    setNewFolderName('');
    setIsCreatingFolder(false);
  }, [newFolderName, selectedFolderId, createFolder]);

  const handleNewFolderKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        handleNewFolderSubmit();
      } else if (e.key === 'Escape') {
        setIsCreatingFolder(false);
        setNewFolderName('');
      }
    },
    [handleNewFolderSubmit],
  );

  const handleSelectItem = useCallback(
    (id: string) => {
      setSelectedItem(id);
      setActiveView('item');
    },
    [setSelectedItem, setActiveView],
  );

  const isFolderView = activeView === 'folder';

  return (
    <main
      className={`flex-1 flex flex-col overflow-hidden transition-all duration-200 ease-out ${
        sidebarOpen ? 'ml-[var(--sidebar-width)]' : 'ml-[var(--sidebar-collapsed-width)]'
      }`}
    >
      {/* Toolbar */}
      <div className="notion-toolbar h-12 shrink-0 items-center justify-between">
        <div className="flex items-center gap-2 min-w-0">
          {/* Breadcrumb */}
          <nav className="notion-breadcrumb min-w-0" aria-label="Breadcrumb">
            <button
              className={`notion-breadcrumb-item ${!selectedFolderId ? 'current' : ''} flex items-center gap-1`}
              onClick={() => handleBreadcrumbClick(null)}
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
              </svg>
              <span className="hidden sm:inline">Home</span>
            </button>

            {breadcrumb.map((folder, index) => (
              <React.Fragment key={folder.id}>
                <span className="notion-breadcrumb-separator">/</span>
                <button
                  className={`notion-breadcrumb-item ${
                    index === breadcrumb.length - 1 ? 'current' : ''
                  } flex items-center gap-1 max-w-[150px]`}
                  onClick={() => handleBreadcrumbClick(folder.id)}
                >
                  <span className="truncate">
                    {folder.emoji && <span className="mr-1">{folder.emoji}</span>}
                    {folder.name}
                  </span>
                </button>
              </React.Fragment>
            ))}
          </nav>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {/* Quick Find trigger */}
          <button
            className="notion-button-ghost h-8 px-2 gap-1.5"
            onClick={toggleQuickFind}
            aria-label="Quick Find"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <span className="text-xs text-surface-400 dark:text-surface-500 hidden sm:inline">
              ⌘K
            </span>
          </button>

          {/* Lock button */}
          <button
            className="notion-button-ghost h-8 px-2"
            onClick={() => lock()}
            aria-label="Lock vault"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
          </button>
        </div>
      </div>

      {/* Navigation tabs */}
      <div className="flex border-b border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-850">
        {(['folder', 'health', 'trash', 'settings'] as const).map((view) => (
          <button
            key={view}
            onClick={() => setActiveView(view)}
            className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium transition-colors ${
              activeView === view
                ? 'text-accent-600 dark:text-accent-400 border-b-2 border-accent-600 dark:border-accent-400'
                : 'text-surface-500 dark:text-surface-400 hover:text-surface-700 dark:hover:text-surface-300'
            }`}
          >
            {VIEW_ICONS[view]}
            <span className="hidden md:inline">{VIEW_LABELS[view]}</span>
          </button>
        ))}
      </div>

      {/* Action toolbar (for folder view) */}
      {isFolderView && (
        <div className="flex items-center gap-2 px-4 py-2 border-b border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-850">
          {/* New Item button */}
          {currentFolderId && (
            <button
              className="notion-button-primary h-8 text-xs gap-1.5"
              onClick={() => {
                setIsCreatingItem(true);
                setNewItemTitle('');
              }}
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </svg>
              New Item
            </button>
          )}

          {/* New Folder button */}
          <button
            className="notion-button-ghost h-8 text-xs gap-1.5"
            onClick={() => {
              setIsCreatingFolder(true);
              setNewFolderName('');
            }}
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 13h6m-3-3v6m-9 1V7a2 2 0 012-2h6l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
            </svg>
            New Folder
          </button>

          {/* Sort dropdown */}
          <div className="relative ml-auto">
            <button
              className="notion-button-ghost h-8 text-xs gap-1.5"
              onClick={() => setSortMenuOpen(!sortMenuOpen)}
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 4h13M3 8h9m-9 4h6m4 0l4-4m0 0l4 4m-4-4v12" />
              </svg>
              Sort: {SORT_LABELS[sortBy]}
            </button>
            {sortMenuOpen && (
              <div
                className="absolute right-0 top-full mt-1 z-50 min-w-[160px] rounded-lg border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-800 shadow-lg py-1"
                style={{ animation: 'fadeIn 0.1s ease-out' }}
              >
                {(Object.keys(SORT_LABELS) as SortOption[]).map((option) => (
                  <button
                    key={option}
                    className={`flex w-full items-center gap-2 px-3 py-1.5 text-sm transition-colors ${
                      sortBy === option
                        ? 'text-accent-600 dark:text-accent-400 bg-accent-50 dark:bg-accent-900/20'
                        : 'text-surface-700 dark:text-surface-300 hover:bg-surface-100 dark:hover:bg-surface-700'
                    }`}
                    onClick={() => {
                      setSortBy(option);
                      setSortMenuOpen(false);
                    }}
                  >
                    {sortBy === option && (
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                    {SORT_LABELS[option]}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Inline new item creation */}
          {isCreatingItem && (
            <div className="flex items-center gap-2 ml-2">
              <input
                className="notion-input h-8 text-xs w-48"
                placeholder="Item title..."
                value={newItemTitle}
                onChange={(e) => setNewItemTitle(e.target.value)}
                onBlur={() => {
                  if (!newItemTitle.trim()) {
                    setIsCreatingItem(false);
                  }
                }}
                onKeyDown={handleNewItemKeyDown}
                autoFocus
              />
            </div>
          )}

          {/* Inline new folder creation */}
          {isCreatingFolder && (
            <div className="flex items-center gap-2 ml-2">
              <input
                className="notion-input h-8 text-xs w-48"
                placeholder="Folder name..."
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                onBlur={() => {
                  if (!newFolderName.trim()) {
                    setIsCreatingFolder(false);
                  }
                }}
                onKeyDown={handleNewFolderKeyDown}
                autoFocus
              />
            </div>
          )}
        </div>
      )}

      {/* Content area */}
      <div className="flex-1 overflow-y-auto notion-scrollbar">
        {/* Folder view - list items */}
        {activeView === 'folder' && (
          <div className="h-full">
            {sortedItemIds.length > 0 ? (
              <div className="divide-y divide-surface-200 dark:divide-surface-700">
                {sortedItemIds.map((itemId) => {
                  const item = items[itemId];
                  if (!item) return null;
                  return (
                    <button
                      key={item.id}
                      className="flex items-center gap-3 w-full px-4 py-3 text-left hover:bg-surface-50 dark:hover:bg-surface-800/50 transition-colors"
                      onClick={() => handleSelectItem(item.id)}
                    >
                      <span className="text-xl shrink-0">{item.emoji || '🔑'}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-surface-800 dark:text-surface-200 truncate">
                          {item.title}
                        </p>
                        {item.username && (
                          <p className="text-xs text-surface-500 dark:text-surface-400 truncate">
                            {item.username}
                          </p>
                        )}
                      </div>
                      {item.url && (
                        <span className="text-xs text-surface-400 dark:text-surface-500 truncate max-w-[200px] hidden md:block">
                          {new URL(item.url).hostname}
                        </span>
                      )}
                      {item.isFavorite && (
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-yellow-500 shrink-0" fill="currentColor" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={0}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
                        </svg>
                      )}
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="notion-empty-state h-full">
                <div className="notion-empty-state-icon">📂</div>
                <p className="notion-empty-state-title">No items yet</p>
                <p className="notion-empty-state-description">
                  {currentFolderId
                    ? 'Click "New Item" to add your first password entry.'
                    : 'Select a folder from the sidebar to view its items.'}
                </p>
                {currentFolderId && (
                  <button
                    className="notion-button-primary mt-4 text-xs"
                    onClick={() => {
                      setIsCreatingItem(true);
                      setNewItemTitle('');
                    }}
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                    </svg>
                    New Item
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {/* Item detail view */}
        {activeView === 'item' && (
          <div className="notion-empty-state h-full">
            <div className="notion-empty-state-icon">🔑</div>
            <p className="notion-empty-state-title">Item Detail</p>
            <p className="notion-empty-state-description">
              Select an item from the folder view to see its details.
            </p>
          </div>
        )}

        {/* Health view */}
        {activeView === 'health' && (
          <div className="notion-empty-state h-full">
            <div className="notion-empty-state-icon">🛡️</div>
            <p className="notion-empty-state-title">Password Health</p>
            <p className="notion-empty-state-description">
              Add some passwords to see your security health report.
            </p>
          </div>
        )}

        {/* Trash view */}
        {activeView === 'trash' && (
          <div className="notion-empty-state h-full">
            <div className="notion-empty-state-icon">🗑️</div>
            <p className="notion-empty-state-title">Trash is empty</p>
            <p className="notion-empty-state-description">
              Deleted items will appear here.
            </p>
          </div>
        )}

        {/* Settings view */}
        {activeView === 'settings' && (
          <div className="p-6">
            <p className="text-sm text-surface-400 dark:text-surface-500 italic">
              Settings — Coming in Phase 5
            </p>
          </div>
        )}
      </div>
    </main>
  );
}

const VIEW_LABELS: Record<ActiveView, string> = {
  folder: 'All Items',
  item: 'Item Detail',
  health: 'Password Health',
  trash: 'Trash',
  settings: 'Settings',
};

const VIEW_ICONS: Record<ActiveView, React.ReactNode> = {
  folder: (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
    </svg>
  ),
  item: (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
    </svg>
  ),
  health: (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
    </svg>
  ),
  trash: (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
    </svg>
  ),
  settings: (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  ),
};
