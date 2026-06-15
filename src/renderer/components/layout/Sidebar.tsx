import React, { useState, useCallback, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useUIStore } from '../../stores/uiStore';
import { useAuthStore } from '../../stores/authStore';
import { useFolderStore } from '../../stores/folderStore';
import { useItemStore } from '../../stores/itemStore';
import TreeNode from '../ui/TreeNode';

export default function Sidebar(): React.ReactElement {
  const { sidebarOpen, toggleSidebar, toggleQuickFind, setActiveView } = useUIStore();
  const { lock } = useAuthStore();
  const {
    folders,
    selectedFolderId,
    expandedFolderIds,
    setSelectedFolder,
    toggleExpandFolder,
    createFolder,
    updateFolder,
    deleteFolder,
    moveFolder,
    loadTree,
  } = useFolderStore();
  const { loadItems } = useItemStore();

  const [newFolderName, setNewFolderName] = useState('');
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);
  const [newFolderParentId, setNewFolderParentId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const newFolderInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadTree();
  }, [loadTree]);

  useEffect(() => {
    if (isCreatingFolder && newFolderInputRef.current) {
      newFolderInputRef.current.focus();
    }
  }, [isCreatingFolder]);

  const handleSelectFolder = useCallback(
    (id: string) => {
      setSelectedFolder(id);
      loadItems(id);
      setActiveView('folder');
    },
    [setSelectedFolder, loadItems, setActiveView],
  );

  const handleNewFolder = useCallback((parentId: string | null = null) => {
    setNewFolderParentId(parentId);
    setNewFolderName('');
    setIsCreatingFolder(true);
  }, []);

  const handleCreateFolderSubmit = useCallback(async () => {
    const name = newFolderName.trim();
    if (!name) {
      setIsCreatingFolder(false);
      return;
    }
    const folder = await createFolder(newFolderParentId, name);
    if (folder) {
      setSelectedFolder(folder.id);
      loadItems(folder.id);
    }
    setIsCreatingFolder(false);
    setNewFolderName('');
    setNewFolderParentId(null);
  }, [newFolderName, newFolderParentId, createFolder, setSelectedFolder, loadItems]);

  const handleCreateFolderKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        handleCreateFolderSubmit();
      } else if (e.key === 'Escape') {
        setIsCreatingFolder(false);
        setNewFolderName('');
        setNewFolderParentId(null);
      }
    },
    [handleCreateFolderSubmit],
  );

  const handleRename = useCallback(
    async (id: string, newName: string) => {
      await updateFolder(id, { name: newName });
    },
    [updateFolder],
  );

  const handleEmojiChange = useCallback(
    async (id: string, emoji: string) => {
      await updateFolder(id, { emoji });
    },
    [updateFolder],
  );

  const handleDelete = useCallback(
    async (id: string) => {
      await deleteFolder(id);
    },
    [deleteFolder],
  );

  const handleNewSubfolder = useCallback(
    (parentId: string) => {
      handleNewFolder(parentId);
    },
    [handleNewFolder],
  );

  const handleDragStart = useCallback((e: React.DragEvent, folderId: string) => {
    e.dataTransfer.setData('text/plain', folderId);
    e.dataTransfer.effectAllowed = 'move';
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, folderId: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverId(folderId);
  }, []);

  const handleDrop = useCallback(
    async (e: React.DragEvent, targetFolderId: string) => {
      e.preventDefault();
      setDragOverId(null);
      const sourceId = e.dataTransfer.getData('text/plain');
      if (sourceId && sourceId !== targetFolderId) {
        await moveFolder(sourceId, targetFolderId);
      }
    },
    [moveFolder],
  );

  const handleDragLeave = useCallback(() => {
    setDragOverId(null);
  }, []);

  return (
    <motion.aside
      className="notion-sidebar flex shrink-0 flex-col"
      initial={false}
      animate={{ width: sidebarOpen ? 260 : 56 }}
      transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
      role="navigation"
      aria-label="Folder navigation"
    >
      {/* Header */}
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-surface-200 px-3 dark:border-surface-700">
        {sidebarOpen && (
          <span className="truncate text-sm font-semibold text-surface-800 dark:text-surface-200">
            SecurePass
          </span>
        )}
        <div className={`flex items-center gap-1 ${sidebarOpen ? '' : 'w-full justify-center'}`}>
          {sidebarOpen && (
            <>
              <button
                onClick={() => handleNewFolder()}
                className="flex h-7 w-7 items-center justify-center rounded-md text-surface-500 transition-colors hover:bg-surface-100 dark:hover:bg-surface-800"
                aria-label="New Folder"
                title="New Folder"
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
              </button>
              <button
                onClick={toggleQuickFind}
                className="flex h-7 w-7 items-center justify-center rounded-md text-surface-500 transition-colors hover:bg-surface-100 dark:hover:bg-surface-800"
                aria-label="Quick Find"
                title="Quick Find (Ctrl+K)"
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
              </button>
            </>
          )}
          <button
            onClick={toggleSidebar}
            className="flex h-7 w-7 items-center justify-center rounded-md text-surface-500 transition-colors hover:bg-surface-100 dark:hover:bg-surface-800"
            aria-label={sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-4 w-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              {sidebarOpen ? (
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M11 19l-7-7 7-7m8 14l-7-7 7-7"
                />
              ) : (
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 5l7 7-7 7M5 5l7 7-7 7" />
              )}
            </svg>
          </button>
        </div>
      </div>

      {/* Content area */}
      <div className="notion-scrollbar relative flex-1 overflow-y-auto p-2">
        <AnimatePresence mode="wait">
          {sidebarOpen ? (
            <motion.div
              key="expanded"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="space-y-0.5"
              role="tree"
            >
              <p className="px-2 py-1 text-xs font-medium uppercase tracking-wider text-surface-400 dark:text-surface-500">
                Folders
              </p>

              {folders.length === 0 && !isCreatingFolder && (
                <p className="px-2 py-3 text-xs italic text-surface-400 dark:text-surface-500">
                  No folders yet
                </p>
              )}

              {folders.map((folder) => (
                <TreeNode
                  key={folder.id}
                  folder={folder}
                  depth={0}
                  selectedFolderId={selectedFolderId}
                  expandedFolderIds={expandedFolderIds}
                  onSelect={handleSelectFolder}
                  onToggleExpand={toggleExpandFolder}
                  onRename={handleRename}
                  onDelete={handleDelete}
                  onNewSubfolder={handleNewSubfolder}
                  onEmojiChange={handleEmojiChange}
                  onDragStart={handleDragStart}
                  onDragOver={handleDragOver}
                  onDrop={handleDrop}
                  onDragLeave={handleDragLeave}
                  dragOverId={dragOverId}
                />
              ))}

              {/* Inline new folder creation */}
              {isCreatingFolder && (
                <div
                  className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm"
                  style={{ paddingLeft: `${(newFolderParentId ? 24 : 0) + 8}px` }}
                >
                  <span className="shrink-0 text-base leading-none">📁</span>
                  <input
                    ref={newFolderInputRef}
                    className="min-w-0 flex-1 rounded border border-accent-400 bg-white px-1 py-0 text-sm outline-none ring-1 ring-accent-400/50 dark:bg-surface-800"
                    placeholder="Folder name..."
                    value={newFolderName}
                    onChange={(e) => setNewFolderName(e.target.value)}
                    onBlur={handleCreateFolderSubmit}
                    onKeyDown={handleCreateFolderKeyDown}
                  />
                </div>
              )}
            </motion.div>
          ) : (
            <motion.div
              key="collapsed"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="flex flex-col items-center gap-2 pt-2"
            >
              <button
                className="flex h-8 w-8 items-center justify-center rounded-md text-surface-500 transition-colors hover:bg-surface-100 dark:hover:bg-surface-800"
                aria-label="New Folder"
                onClick={() => handleNewFolder()}
                title="New Folder"
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
              </button>
              <button
                className="flex h-8 w-8 items-center justify-center rounded-md text-surface-500 transition-colors hover:bg-surface-100 dark:hover:bg-surface-800"
                aria-label="Quick Find"
                onClick={toggleQuickFind}
                title="Quick Find"
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
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Footer */}
      <div className="shrink-0 space-y-1 border-t border-surface-200 p-2 dark:border-surface-700">
        {sidebarOpen ? (
          <>
            <button className="notion-tree-node w-full" onClick={() => setActiveView('settings')}>
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-4 w-4 shrink-0"
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
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                />
              </svg>
              <span className="truncate">Settings</span>
            </button>
            <button
              className="notion-tree-node w-full text-danger-500 hover:text-danger-600 dark:text-danger-400 dark:hover:text-danger-500"
              onClick={() => lock()}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-4 w-4 shrink-0"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
                />
              </svg>
              <span className="truncate">Lock</span>
            </button>
          </>
        ) : (
          <>
            <button
              className="mx-auto flex h-8 w-8 items-center justify-center rounded-md text-surface-500 transition-colors hover:bg-surface-100 dark:hover:bg-surface-800"
              aria-label="Settings"
              onClick={() => setActiveView('settings')}
              title="Settings"
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
                  d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
                />
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                />
              </svg>
            </button>
            <button
              className="mx-auto flex h-8 w-8 items-center justify-center rounded-md text-danger-500 transition-colors hover:bg-danger-50 dark:hover:bg-danger-500/10"
              onClick={() => lock()}
              aria-label="Lock"
              title="Lock"
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
                  d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
                />
              </svg>
            </button>
          </>
        )}
      </div>
    </motion.aside>
  );
}
