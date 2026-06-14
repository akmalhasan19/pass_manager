import React, { useState, useCallback, useMemo, useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useUIStore, type ActiveView } from '../../stores/uiStore';
import { useAuthStore } from '../../stores/authStore';
import { useFolderStore } from '../../stores/folderStore';
import { useItemStore } from '../../stores/itemStore';
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

export default function MainPanel(): React.ReactElement {
  const { activeView, setActiveView, sidebarOpen, toggleQuickFind } = useUIStore();
  const { lock } = useAuthStore();
  const { folders, selectedFolderId, setSelectedFolder, createFolder } = useFolderStore();
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

  const [newItemTitle, setNewItemTitle] = useState('');
  const [isCreatingItem, setIsCreatingItem] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);

  const breadcrumb = useMemo(() => {
    if (!selectedFolderId) return [];
    return buildBreadcrumbPath(folders, selectedFolderId) || [];
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

  // File attachment operations
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

  const isFolderView = activeView === 'folder';

  const renderActiveView = (): React.ReactNode => {
    switch (activeView) {
      case 'folder':
        return (
          <FolderView
            items={items}
            itemIds={itemIds}
            currentFolderId={currentFolderId}
            onSelectItem={handleSelectItem}
            onDeleteItem={(id) => {
              deleteItem(id);
            }}
            onToggleFavorite={(id) => {
              const item = items[id];
              if (item) {
                updateItem(id, { isFavorite: !item.isFavorite });
              }
            }}
            isCreatingItem={isCreatingItem}
            newItemTitle={newItemTitle}
            onNewItemTitleChange={setNewItemTitle}
            onNewItemSubmit={handleNewItemSubmit}
            onNewItemCancel={() => {
              setIsCreatingItem(false);
              setNewItemTitle('');
            }}
          />
        );
      case 'item':
        return (
          <ItemDetailView
            item={selectedItemDecrypted}
            isLoading={isItemLoading}
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
      className="flex flex-1 flex-col overflow-hidden"
      initial={false}
      animate={{ marginLeft: sidebarOpen ? 260 : 56 }}
      transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
    >
      {/* Toolbar */}
      <div className="notion-toolbar h-12 shrink-0 items-center justify-between">
        <div className="flex min-w-0 items-center gap-2">
          {/* Breadcrumb */}
          <nav className="notion-breadcrumb min-w-0" aria-label="Breadcrumb">
            <button
              className={`notion-breadcrumb-item ${!selectedFolderId ? 'current' : ''} flex items-center gap-1`}
              onClick={() => handleBreadcrumbClick(null)}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-3.5 w-3.5 shrink-0"
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
                <span className="notion-breadcrumb-separator">/</span>
                <button
                  className={`notion-breadcrumb-item ${
                    index === breadcrumb.length - 1 ? 'current' : ''
                  } flex max-w-[150px] items-center gap-1`}
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

        <div className="flex shrink-0 items-center gap-1">
          {/* Quick Find trigger */}
          <button
            className="notion-button-ghost h-8 gap-1.5 px-2"
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
            <span className="hidden text-xs text-surface-400 dark:text-surface-500 sm:inline">
              ⌘K
            </span>
          </button>

          {/* Lock button */}
          <button
            className="notion-button-ghost h-8 px-2"
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
      <div className="flex border-b border-surface-200 bg-white dark:border-surface-700 dark:bg-surface-850">
        {(['folder', 'health', 'trash', 'settings'] as const).map((view) => (
          <button
            key={view}
            onClick={() => setActiveView(view)}
            className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium transition-colors ${
              activeView === view
                ? 'border-b-2 border-accent-600 text-accent-600 dark:border-accent-400 dark:text-accent-400'
                : 'text-surface-500 hover:text-surface-700 dark:text-surface-400 dark:hover:text-surface-300'
            }`}
          >
            {VIEW_ICONS[view]}
            <span className="hidden md:inline">{VIEW_LABELS[view]}</span>
          </button>
        ))}
      </div>

      {/* Action toolbar (for folder view) */}
      {isFolderView && (
        <div className="flex items-center gap-2 border-b border-surface-200 bg-white px-4 py-2 dark:border-surface-700 dark:bg-surface-850">
          {/* New Item button */}
          {currentFolderId && (
            <button
              className="notion-button-primary h-8 gap-1.5 text-xs"
              onClick={() => {
                setIsCreatingItem(true);
                setNewItemTitle('');
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
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </svg>
              New Item
            </button>
          )}

          {/* New Folder button */}
          <button
            className="notion-button-ghost h-8 gap-1.5 text-xs"
            onClick={() => {
              setIsCreatingFolder(true);
              setNewFolderName('');
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
                d="M9 13h6m-3-3v6m-9 1V7a2 2 0 012-2h6l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z"
              />
            </svg>
            New Folder
          </button>

          {/* Spacer to push inline inputs to the right */}
          <div className="ml-auto" />

          {/* Inline new item creation */}
          {isCreatingItem && (
            <div className="ml-2 flex items-center gap-2">
              <input
                className="notion-input h-8 w-48 text-xs"
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
            <div className="ml-2 flex items-center gap-2">
              <input
                className="notion-input h-8 w-48 text-xs"
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
      <div className="notion-scrollbar relative flex-1 overflow-y-auto">
        <AnimatePresence mode="wait">
          <motion.div
            key={activeView}
            initial={{ opacity: 0, x: 12 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -12 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            className="absolute inset-0"
          >
            {renderActiveView()}
          </motion.div>
        </AnimatePresence>
      </div>
    </motion.main>
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
