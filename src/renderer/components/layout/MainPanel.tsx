import React, { useState, useCallback, useMemo, useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useUIStore, type ActiveView } from '../../stores/uiStore';
import { useAuthStore } from '../../stores/authStore';
import { useFolderStore } from '../../stores/folderStore';
import { useItemStore } from '../../stores/itemStore';
import HomeView from '../views/HomeView';
import FolderView from '../views/FolderView';
import ItemDetailView from '../views/ItemDetailView';
import TrashView from '../views/TrashView';
import SettingsView from '../views/SettingsView';
import PasswordHealthView from '../views/PasswordHealthView';
import type { Folder, Tag, ItemDecrypted } from '../../../shared/types';

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

export default function MainPanel(): React.ReactElement {
  const { activeView, setActiveView, sidebarOpen, toggleQuickFind } = useUIStore();
  const { lock } = useAuthStore();
  const { folders, selectedFolderId, setSelectedFolder } = useFolderStore();
  const {
    items,
    itemIds,
    currentFolderId,
    selectedItemId,
    loadItems,
    loadItemById,
    createItem,
    updateItem,
    deleteItem,
    setSelectedItem,
  } = useItemStore();

  const [selectedItemDecrypted, setSelectedItemDecrypted] = useState<ItemDecrypted | null>(null);
  const [allTags, setAllTags] = useState<Tag[]>([]);
  const [isItemLoading, setIsItemLoading] = useState(false);
  const [isNewItem, setIsNewItem] = useState(false);

  const breadcrumb = useMemo(() => {
    if (!selectedFolderId) return [];
    return buildBreadcrumbPath(folders, selectedFolderId) || [];
  }, [folders, selectedFolderId]);

  const currentFolder = useMemo(() => {
    if (!selectedFolderId) return null;
    const findFolder = (list: Folder[]): Folder | null => {
      for (const f of list) {
        if (f.id === selectedFolderId) return f;
        if (f.children) {
          const found = findFolder(f.children);
          if (found) return found;
        }
      }
      return null;
    };
    return findFolder(folders);
  }, [folders, selectedFolderId]);

  const handleBreadcrumbClick = useCallback(
    (folderId: string | null) => {
      setSelectedFolder(folderId);
      if (folderId) {
        loadItems(folderId);
      }
    },
    [setSelectedFolder, loadItems],
  );

  const handleNewItem = useCallback(async () => {
    if (!currentFolderId) return;
    try {
      const newItem = await createItem(currentFolderId, { title: 'Untitled' });
      if (newItem) {
        setIsNewItem(true);
        setSelectedItem(newItem.id);
        setActiveView('item');
        await loadItems(currentFolderId);
      }
    } catch (err) {
      console.error('Failed to create new item:', err);
    }
  }, [currentFolderId, createItem, setSelectedItem, setActiveView, loadItems]);

  const handleSelectItem = useCallback(
    (id: string) => {
      setIsNewItem(false);
      setSelectedItem(id);
      setActiveView('item');
    },
    [setSelectedItem, setActiveView],
  );

  const handleBackToFolder = useCallback(() => {
    setActiveView('folder');
    setSelectedItem(null);
  }, [setActiveView, setSelectedItem]);

  useEffect(() => {
    if (activeView === 'item' && selectedItemId) {
      setIsItemLoading(true);
      loadItemById(selectedItemId)
        .then(() => {
          setIsItemLoading(false);
        })
        .catch(() => {
          setIsItemLoading(false);
        });
    }
  }, [selectedItemId, activeView, loadItemById]);

  useEffect(() => {
    const currentItem = selectedItemId ? items[selectedItemId] : null;
    if (currentItem && 'password' in currentItem) {
      setSelectedItemDecrypted(currentItem as ItemDecrypted);
    } else {
      setSelectedItemDecrypted(null);
    }
  }, [items, selectedItemId]);

  useEffect(() => {
    window.electron.tags
      .getAll()
      .then((tags) => {
        setAllTags(tags);
      })
      .catch(() => {
        setAllTags([]);
      });
  }, []);

  const handleItemUpdate = useCallback(
    async (id: string, fields: Record<string, unknown>) => {
      await updateItem(id, fields);
    },
    [updateItem],
  );

  const handleItemDelete = useCallback(
    (id: string) => {
      deleteItem(id)
        .then(() => {
          handleBackToFolder();
        })
        .catch(() => {});
    },
    [deleteItem, handleBackToFolder],
  );

  const handleCreateTag = useCallback(async (name: string, color?: string): Promise<Tag | null> => {
    try {
      const tag = await window.electron.tags.create(name, color);
      setAllTags((prev) => [...prev, tag]);
      return tag;
    } catch {
      return null;
    }
  }, []);

  const handleAttachTag = useCallback(
    async (itemId: string, tagId: string) => {
      await window.electron.tags.attach(itemId, tagId);
      if (selectedItemId) {
        await loadItemById(selectedItemId);
      }
    },
    [selectedItemId, loadItemById],
  );

  const handleDetachTag = useCallback(
    async (itemId: string, tagId: string) => {
      await window.electron.tags.detach(itemId, tagId);
      if (selectedItemId) {
        await loadItemById(selectedItemId);
      }
    },
    [selectedItemId, loadItemById],
  );

  const handleFileAttach = useCallback(async (itemId: string) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        await window.electron.files.attach(itemId, (file as File & { path: string }).path);
      } catch (err) {
        console.error('Failed to attach file:', err);
      }
    };
    input.click();
  }, []);

  const handleFileDownload = useCallback(async (attachmentId: string) => {
    try {
      await window.electron.files.download(attachmentId);
    } catch (err) {
      console.error('Failed to download file:', err);
    }
  }, []);

  const handleFileDelete = useCallback(async (attachmentId: string) => {
    try {
      await window.electron.files.delete(attachmentId);
    } catch (err) {
      console.error('Failed to delete file:', err);
    }
  }, []);

  const showDetailPanel = activeView === 'item' && selectedItemId;
  const showFolderList = activeView !== 'home';

  const renderMainContent = (): React.ReactNode => {
    switch (activeView) {
      case 'home':
        return <HomeView />;
      case 'folder':
      case 'item':
        return (
          <FolderView
            items={items}
            itemIds={itemIds}
            currentFolderId={currentFolderId}
            onSelectItem={handleSelectItem}
            onDeleteItem={(id) => deleteItem(id)}
            onToggleFavorite={(id) => {
              const item = items[id];
              if (item) {
                updateItem(id, { isFavorite: !item.isFavorite });
              }
            }}
            onNewItem={handleNewItem}
          />
        );
      case 'health':
        return <PasswordHealthView onSelectItem={handleSelectItem} />;
      case 'trash':
        return <TrashView />;
      case 'settings':
        return <SettingsView />;
      default:
        return null;
    }
  };

  return (
    <motion.main
      className="flex flex-1 overflow-hidden"
      initial={false}
      animate={{
        marginLeft: sidebarOpen ? 261 : 57,
      }}
      transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
    >
      {/* Center Panel - Folder List */}
      {showFolderList && (
        <div
          className="flex h-full shrink-0 flex-col border-r border-surface-200 bg-white dark:border-surface-700 dark:bg-surface-850"
          style={{
            width: showDetailPanel ? 320 : '100%',
            minWidth: showDetailPanel ? 320 : undefined,
            maxWidth: showDetailPanel ? 320 : undefined,
          }}
        >
          {/* Header */}
          <div className="flex h-16 shrink-0 items-center justify-between border-b border-surface-200 px-6 backdrop-blur-sm dark:border-surface-700">
            <h1 className="truncate text-lg font-semibold text-surface-800 dark:text-surface-200">
              {currentFolder?.name || 'All Items'}
            </h1>
            <div className="flex gap-2">
              <button
                className="rounded-lg p-1.5 transition-all hover:bg-surface-100 active:scale-95 dark:hover:bg-surface-800"
                aria-label="Filter"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="h-5 w-5 text-surface-500"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z"
                  />
                </svg>
              </button>
              <button
                className="rounded-lg p-1.5 transition-all hover:bg-surface-100 active:scale-95 dark:hover:bg-surface-800"
                onClick={handleNewItem}
                aria-label="New Item"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="h-5 w-5 font-bold text-primary"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2.5}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                </svg>
              </button>
            </div>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto">
            <div className="space-y-0.5 p-2">
              {itemIds.length > 0 ? (
                itemIds.map((itemId) => {
                  const item = items[itemId];
                  if (!item) return null;
                  const isActive = selectedItemId === itemId;
                  return (
                    <button
                      key={item.id}
                      className={`flex w-full items-center gap-4 rounded-xl p-4 text-left transition-all duration-200 ${
                        isActive
                          ? 'bg-surface-50 dark:bg-surface-800/50'
                          : 'hover:bg-surface-50 dark:hover:bg-surface-800/50'
                      }`}
                      onClick={() => handleSelectItem(item.id)}
                    >
                      <div
                        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-xl shadow-sm ${
                          isActive
                            ? 'bg-primary/10'
                            : 'bg-surface-100 dark:bg-surface-800'
                        }`}
                      >
                        {item.emoji || '🔑'}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between">
                          <h3 className="truncate text-sm font-semibold text-surface-800 dark:text-surface-200">
                            {item.title || 'Untitled'}
                          </h3>
                          {item.updatedAt && (
                            <span className="ml-2 whitespace-nowrap text-[10px] text-surface-400">
                              {formatDateShort(item.updatedAt)}
                            </span>
                          )}
                        </div>
                        <p className="truncate text-sm text-surface-500 dark:text-surface-400">
                          {item.username || ''}
                        </p>
                      </div>
                    </button>
                  );
                })
              ) : (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <div className="mb-3 text-4xl">📂</div>
                  <p className="text-sm font-medium text-surface-600 dark:text-surface-400">
                    No items yet
                  </p>
                  <p className="mt-1 text-xs text-surface-400 dark:text-surface-500">
                    Click &quot;+&quot; above to add your first password
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Floating New Item Button */}
          <div className="border-t border-surface-200/30 p-4 dark:border-surface-700/30">
            <button
              className="flex w-full items-center justify-center gap-2 rounded-xl py-3 font-medium text-white shadow-lg transition-all active:scale-[0.98]"
              style={{ backgroundColor: '#5E5CE6' }}
              onClick={handleNewItem}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-5 w-5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2.5}
                style={{ fontVariationSettings: "'wght' 600" }}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </svg>
              <span>New Item</span>
            </button>
          </div>
        </div>
      )}

      {/* Right Panel - Detail View / Other Views */}
      <div className="flex flex-1 flex-col overflow-hidden bg-surface-50 dark:bg-surface-900">
        {/* Toolbar */}
        <div className="flex h-12 shrink-0 items-center justify-between border-b border-surface-200 bg-white/50 px-4 backdrop-blur-sm dark:border-surface-700 dark:bg-surface-850/50">
          <nav className="min-w-0" aria-label="Breadcrumb">
            <div className="flex items-center gap-1.5 text-sm">
              <button
                className="flex items-center gap-1 text-surface-400 transition-colors hover:text-surface-600 dark:hover:text-surface-300"
                onClick={() => {
                  setActiveView('home');
                  setSelectedFolder(null);
                }}
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
                    d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"
                  />
                </svg>
                <span className="hidden sm:inline">Home</span>
              </button>
              {breadcrumb.map((folder, index) => (
                <React.Fragment key={folder.id}>
                  <span className="text-surface-300 dark:text-surface-600">/</span>
                  <button
                    className={`max-w-[150px] truncate transition-colors hover:text-surface-600 dark:hover:text-surface-300 ${
                      index === breadcrumb.length - 1
                        ? 'font-medium text-surface-700 dark:text-surface-300'
                        : 'text-surface-400'
                    }`}
                    onClick={() => handleBreadcrumbClick(folder.id)}
                  >
                    {folder.emoji && <span className="mr-1">{folder.emoji}</span>}
                    {folder.name}
                  </button>
                </React.Fragment>
              ))}
            </div>
          </nav>

          <div className="flex shrink-0 items-center gap-1">
            <button
              className="flex h-8 items-center gap-1.5 rounded-lg px-2 text-xs transition-colors hover:bg-surface-100 dark:hover:bg-surface-800"
              onClick={toggleQuickFind}
              aria-label="Quick Find"
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
                  d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                />
              </svg>
              <span className="hidden text-xs text-surface-400 sm:inline">⌘K</span>
            </button>
            <button
              className="flex h-8 items-center rounded-lg px-2 transition-colors hover:bg-surface-100 dark:hover:bg-surface-800"
              onClick={() => lock()}
              aria-label="Lock vault"
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
                  d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
                />
              </svg>
            </button>
          </div>
        </div>

        {/* Navigation tabs */}
        {!showDetailPanel && activeView !== 'home' && (
          <div className="flex border-b border-surface-200 bg-white dark:border-surface-700 dark:bg-surface-850">
            {(['home', 'folder', 'health', 'trash', 'settings'] as const).map((view) => (
              <button
                key={view}
                onClick={() => {
                  setActiveView(view);
                  if (view === 'home') {
                    setSelectedFolder(null);
                  }
                }}
                className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium transition-colors ${
                  activeView === view
                    ? 'border-b-2 border-primary text-primary'
                    : 'text-surface-500 hover:text-surface-700 dark:text-surface-400 dark:hover:text-surface-300'
                }`}
              >
                {VIEW_ICONS[view]}
                <span className="hidden md:inline">{VIEW_LABELS[view]}</span>
              </button>
            ))}
          </div>
        )}

        {/* Content area */}
        <div className="notion-scrollbar relative flex-1 overflow-y-auto">
          <AnimatePresence mode="wait">
            <motion.div
              key={showDetailPanel ? `detail-${selectedItemId}` : activeView}
              initial={{ opacity: 0, x: showDetailPanel ? 12 : 0 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: showDetailPanel ? -12 : 0 }}
              transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
              className="absolute inset-0"
            >
              {showDetailPanel ? (
                <ItemDetailView
                  item={selectedItemDecrypted}
                  isLoading={isItemLoading}
                  isNewItem={isNewItem}
                  onUpdate={handleItemUpdate}
                  onDelete={handleItemDelete}
                  onBack={handleBackToFolder}
                  allTags={allTags}
                  onCreateTag={handleCreateTag}
                  onAttachTag={handleAttachTag}
                  onDetachTag={handleDetachTag}
                  onFileAttach={handleFileAttach}
                  onFileDownload={handleFileDownload}
                  onFileDelete={handleFileDelete}
                />
              ) : (
                renderMainContent()
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </motion.main>
  );
}

const VIEW_LABELS: Record<ActiveView, string> = {
  home: 'Home',
  folder: 'All Items',
  item: 'Item Detail',
  health: 'Password Health',
  trash: 'Trash',
  settings: 'Settings',
};

const VIEW_ICONS: Record<ActiveView, React.ReactNode> = {
  home: (
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
        d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"
      />
    </svg>
  ),
  folder: (
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
        d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
      />
    </svg>
  ),
  item: (
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
        d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z"
      />
    </svg>
  ),
  health: (
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
        d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
      />
    </svg>
  ),
  trash: (
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
  ),
  settings: (
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
        d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
      />
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  ),
};
