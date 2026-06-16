import React, { useState, useCallback, useMemo, useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import Breadcrumb from './Breadcrumb';
import { useUIStore } from '../../stores/uiStore';
import { useAuthStore } from '../../stores/authStore';
import { useFolderStore } from '../../stores/folderStore';
import { useItemStore } from '../../stores/itemStore';
import ItemDetailView from '../views/ItemDetailView';
import type { Folder, Item, Tag, ItemDecrypted } from '../../../shared/types';

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
  const { activeView, setActiveView, toggleQuickFind, centerPanelVisible } = useUIStore();
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

  const handleHomeClick = useCallback(() => {
    setActiveView('home');
    setSelectedFolder(null);
    setSelectedItem(null);
  }, [setActiveView, setSelectedFolder, setSelectedItem]);

  const handleBreadcrumbClick = useCallback(
    (folderId: string) => {
      setSelectedFolder(folderId);
      setSelectedItem(null);
      setActiveView('folder');
      loadItems(folderId);
    },
    [setSelectedFolder, setSelectedItem, setActiveView, loadItems],
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
      if (id === selectedItemId) {
        setSelectedItem(null);
        setActiveView('folder');
        return;
      }
      setIsNewItem(false);
      setSelectedItem(id);
      setActiveView('item');
    },
    [selectedItemId, setSelectedItem, setActiveView],
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
  const currentItem = selectedItemId ? (items[selectedItemId] as Item | ItemDecrypted | undefined) : null;
  const breadcrumbFolderId = showDetailPanel
    ? selectedFolderId || currentItem?.folderId || null
    : centerPanelVisible
      ? selectedFolderId
      : null;
  const breadcrumbSelectedItem = showDetailPanel
    ? selectedItemDecrypted || currentItem || null
    : null;

  return (
    <div className="relative flex flex-1 overflow-hidden">
      {/* Center Panel - Folder List */}
      <AnimatePresence>
        {showFolderList && (
          <motion.div
            key="center-panel"
            className="flex h-full shrink-0 flex-col border-r border-surface-200 bg-white dark:border-surface-700 dark:bg-surface-850"
            initial={{ x: '-100%', opacity: 0 }}
            animate={{
              x: centerPanelVisible ? 0 : '-100%',
              opacity: centerPanelVisible ? 1 : 0,
              width: centerPanelVisible ? (showDetailPanel ? 320 : '100%') : 0,
            }}
            exit={{ x: '-100%', opacity: 0 }}
            transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
          >
          {/* Header */}
          <div className="flex shrink-0 flex-col">
            {/* Breadcrumb */}
            <div className="flex h-12 shrink-0 items-center px-4">
              <Breadcrumb
                folders={folders}
                selectedFolderId={selectedFolderId}
                selectedItem={null}
                onHomeClick={handleHomeClick}
                onFolderClick={handleBreadcrumbClick}
              />
            </div>
            {/* Divider */}
            <div className="border-t border-surface-200 dark:border-surface-700" />
            {/* Title Row */}
            <div className="flex h-14 shrink-0 items-center justify-between border-b border-surface-200 px-4 dark:border-surface-700">
              <h1 className="truncate text-lg font-semibold text-surface-800 dark:text-surface-200">
                {currentFolder?.name || 'All Items'}
              </h1>
              <div className="flex items-center gap-1">
                <button
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-surface-500 transition-colors hover:bg-surface-100 dark:hover:bg-surface-800"
                  aria-label="Share"
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
                      d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z"
                    />
                  </svg>
                </button>
                <button
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-surface-500 transition-colors hover:bg-surface-100 dark:hover:bg-surface-800"
                  aria-label="Filter"
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
                      d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z"
                    />
                  </svg>
                </button>
                <button
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-accent-600 transition-colors hover:bg-accent-50 dark:text-accent-400 dark:hover:bg-accent-900/20"
                  onClick={handleNewItem}
                  aria-label="New Item"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className="h-4 w-4"
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
                      className={`flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition-all duration-200 ${
                        isActive
                          ? 'bg-surface-100 dark:bg-surface-800'
                          : 'hover:bg-surface-50 dark:hover:bg-surface-800/50'
                      }`}
                      onClick={() => handleSelectItem(item.id)}
                    >
                      <div
                        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-xl ${
                          isActive
                            ? 'bg-white shadow-sm dark:bg-surface-700'
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
                            <span className="ml-2 shrink-0 whitespace-nowrap text-[11px] text-surface-400">
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
                  <div className="mb-3 text-4xl"></div>
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

          {/* New Item Button */}
          <div className="border-t border-surface-200 p-3 dark:border-surface-700">
            <button
              className="flex w-full items-center justify-center gap-2 rounded-xl py-3 text-sm font-medium text-white shadow-lg transition-all active:scale-[0.98]"
              style={{ backgroundColor: '#5E5CE6' }}
              onClick={handleNewItem}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-4 w-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2.5}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </svg>
              <span>New Item</span>
            </button>
          </div>
        </motion.div>
        )}
      </AnimatePresence>

      {/* Right Panel - Detail View (slides in from right) */}
      <AnimatePresence>
        {showDetailPanel && (
          <motion.div
            key="detail-panel"
            initial={{ x: '100%', opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: '100%', opacity: 0 }}
            transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
            className="absolute right-0 top-0 flex h-full flex-col overflow-hidden bg-white dark:bg-surface-900"
            style={{ width: centerPanelVisible ? 'calc(100% - 320px)' : '100%' }}
          >
            {/* Toolbar */}
            <div className="flex h-12 shrink-0 items-center justify-between border-b border-surface-200 bg-white/50 px-4 backdrop-blur-sm dark:border-surface-700 dark:bg-surface-850/50">
              <Breadcrumb
                folders={folders}
                selectedFolderId={breadcrumbFolderId}
                selectedItem={breadcrumbSelectedItem}
                onHomeClick={handleHomeClick}
                onFolderClick={handleBreadcrumbClick}
              />

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
                  <span className="hidden text-xs text-surface-400 sm:inline">K</span>
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

            {/* Content area */}
            <div className="notion-scrollbar relative flex-1 overflow-y-auto">
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
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Right Panel - Empty State (shown when no detail item is selected) */}
      <AnimatePresence>
        {!showDetailPanel && (
          <motion.div
            key="empty-panel"
            initial={{ opacity: 1 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
            className="flex flex-1 flex-col overflow-hidden bg-white dark:bg-surface-900"
          >
            {/* Toolbar */}
            <div className="flex h-12 shrink-0 items-center justify-between border-b border-surface-200 bg-white/50 px-4 backdrop-blur-sm dark:border-surface-700 dark:bg-surface-850/50">
              <Breadcrumb
                folders={folders}
                selectedFolderId={breadcrumbFolderId}
                selectedItem={breadcrumbSelectedItem}
                onHomeClick={handleHomeClick}
                onFolderClick={handleBreadcrumbClick}
              />

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
                  <span className="hidden text-xs text-surface-400 sm:inline">K</span>
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

            {/* Content area */}
            <div className="notion-scrollbar relative flex-1 overflow-y-auto">
              <div className="flex h-full flex-col items-center justify-center px-6 text-center">
                <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-2xl bg-surface-100 dark:bg-surface-800">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className="h-10 w-10 text-surface-400 dark:text-surface-500"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={1.5}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"
                    />
                  </svg>
                </div>
                <h2 className="mb-2 text-xl font-semibold text-surface-800 dark:text-surface-200">
                  Select an item to view details
                </h2>
                <p className="max-w-xs text-sm text-surface-500 dark:text-surface-400">
                  Choose a password or secure note from the list to see its full information here.
                </p>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
