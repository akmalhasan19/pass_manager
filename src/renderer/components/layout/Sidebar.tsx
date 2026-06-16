import React, { useState, useCallback, useRef, useEffect } from 'react';
import { useUIStore } from '../../stores/uiStore';
import { useFolderStore } from '../../stores/folderStore';
import { useItemStore } from '../../stores/itemStore';
import { MAX_FIELD_LENGTHS } from '../../../shared/constants';
import { sanitizeField, validateCharacters } from '../../../shared/validation';
import type { Folder } from '../../../shared/types';
import TreeNode from '../ui/TreeNode';

function generateAlternativeName(baseName: string, existingNames: Set<string>): string {
  let counter = 2;
  let candidate = `${baseName} (${counter})`;
  while (existingNames.has(candidate.toLowerCase())) {
    counter++;
    candidate = `${baseName} (${counter})`;
  }
  return candidate;
}

function collectFolderNames(folders: Folder[]): Set<string> {
  const names = new Set<string>();
  const walk = (list: Folder[]) => {
    for (const f of list) {
      names.add(f.name.toLowerCase());
      if (f.children) walk(f.children);
    }
  };
  walk(folders);
  return names;
}

export default function Sidebar(): React.ReactElement {
  const {
    toggleQuickFind,
    setActiveView,
    toggleCenterPanel,
    centerPanelVisible,
    setCenterPanelVisible,
  } = useUIStore();
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
  const { loadItems, selectedItemId, setSelectedItem } = useItemStore();

  const [newFolderName, setNewFolderName] = useState('');
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);
  const [newFolderParentId, setNewFolderParentId] = useState<string | null>(null);
  const [createFolderError, setCreateFolderError] = useState<string | null>(null);
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
      if (selectedFolderId === id) {
        setCenterPanelVisible(false);
        setTimeout(() => {
          setSelectedFolder(null);
          setActiveView('home');
        }, 320);
      } else {
        const isItemOpen = selectedItemId !== null;
        if (isItemOpen) {
          setSelectedItem(null);
          setCenterPanelVisible(false);
          setTimeout(() => {
            setSelectedFolder(id);
            loadItems(id);
            setActiveView('folder');
            setCenterPanelVisible(true);
          }, 320);
        } else {
          setSelectedFolder(id);
          loadItems(id);
          setActiveView('folder');
          if (!centerPanelVisible) {
            toggleCenterPanel();
          }
        }
      }
    },
    [
      selectedFolderId,
      selectedItemId,
      setSelectedFolder,
      loadItems,
      setActiveView,
      toggleCenterPanel,
      centerPanelVisible,
      setSelectedItem,
      setCenterPanelVisible,
    ],
  );

  const handleNewFolder = useCallback((parentId: string | null = null) => {
    setNewFolderParentId(parentId);
    setNewFolderName('');
    setCreateFolderError(null);
    setIsCreatingFolder(true);
  }, []);

  const handleCreateFolderSubmit = useCallback(async () => {
    const sanitized = sanitizeField('folderName', newFolderName);
    const name = sanitized.trim();
    if (sanitized !== newFolderName) {
      setNewFolderName(sanitized);
    }
    if (!name) {
      setIsCreatingFolder(false);
      setCreateFolderError(null);
      return;
    }

    const charError = validateCharacters('folderName', name);
    if (charError) {
      setCreateFolderError(charError);
      return;
    }

    const folder = await createFolder(newFolderParentId, name);
    if (folder) {
      setSelectedFolder(folder.id);
      loadItems(folder.id);
      setIsCreatingFolder(false);
      setNewFolderName('');
      setNewFolderParentId(null);
      setCreateFolderError(null);
    } else {
      const existingNames = collectFolderNames(folders);
      if (existingNames.has(name.toLowerCase())) {
        const suggestion = generateAlternativeName(name, existingNames);
        setNewFolderName(suggestion);
        setCreateFolderError(`A folder with this name already exists. Suggested: "${suggestion}"`);
      }
    }
  }, [newFolderName, newFolderParentId, createFolder, setSelectedFolder, loadItems, folders]);

  const handleNewFolderNameChange = useCallback((value: string) => {
    const sanitized = sanitizeField('folderName', value);
    setNewFolderName(sanitized);
    setCreateFolderError(null);
  }, []);

  const handleCreateFolderKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        handleCreateFolderSubmit();
      } else if (e.key === 'Escape') {
        setIsCreatingFolder(false);
        setNewFolderName('');
        setNewFolderParentId(null);
        setCreateFolderError(null);
      }
    },
    [handleCreateFolderSubmit],
  );

  const handleRename = useCallback(
    async (id: string, newName: string): Promise<boolean> => {
      try {
        const result = await window.electron.folders.update(id, { name: newName });
        if (!result.success) {
          return false;
        }
        await loadTree();
        return true;
      } catch {
        return false;
      }
    },
    [loadTree],
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
    <aside className="flex h-full w-[220px] shrink-0 flex-col bg-[#f5f5f7] dark:bg-surface-850">
      {/* User Profile */}
      <div className="flex shrink-0 items-center gap-3 px-4 pb-3 pt-4">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-blue-400 to-blue-600">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-5 w-5 text-white"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.5}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z"
            />
          </svg>
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-surface-800 dark:text-surface-100">
            Alex Riverside
          </p>
          <p className="text-xs text-surface-500 dark:text-surface-400">Pro Plan</p>
        </div>
      </div>

      {/* Quick Find */}
      <div className="px-3 pb-2">
        <button
          onClick={toggleQuickFind}
          className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-surface-500 transition-colors hover:bg-surface-200/60 dark:text-surface-400 dark:hover:bg-surface-700/60"
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
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
          <span>Quick Find</span>
        </button>
      </div>

      {/* Content area */}
      <div className="relative flex-1 overflow-y-auto px-3 pb-2">
        {/* VAULTS Section */}
        <div className="mb-1">
          <p className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-surface-400 dark:text-surface-500">
            Vaults
          </p>
          <div className="space-y-0.5" role="tree">
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

            {folders.length === 0 && !isCreatingFolder && (
              <p className="px-2 py-2 text-xs italic text-surface-400 dark:text-surface-500">
                No vaults yet
              </p>
            )}

            {/* Inline new folder creation */}
            {isCreatingFolder && (
              <div
                className="rounded-md px-2 py-1.5 text-sm"
                style={{ paddingLeft: `${(newFolderParentId ? 20 : 0) + 8}px` }}
              >
                <div className="flex items-center gap-1.5">
                  <span className="shrink-0 text-base leading-none">📁</span>
                  <input
                    ref={newFolderInputRef}
                    className={`min-w-0 flex-1 rounded border bg-white px-1 py-0 text-sm outline-none ring-1 dark:bg-surface-800 ${
                      createFolderError
                        ? 'border-danger-400 ring-danger-400/50'
                        : 'border-accent-400 ring-accent-400/50'
                    }`}
                    placeholder="Vault name..."
                    value={newFolderName}
                    maxLength={MAX_FIELD_LENGTHS.FOLDER_NAME}
                    onChange={(e) => {
                      handleNewFolderNameChange(e.target.value);
                    }}
                    onBlur={handleCreateFolderSubmit}
                    onKeyDown={handleCreateFolderKeyDown}
                  />
                </div>
                {createFolderError && (
                  <p className="mt-0.5 pl-6 text-[11px] text-danger-500">{createFolderError}</p>
                )}
              </div>
            )}
          </div>
        </div>

        {/* SHARED Section */}
        <div className="mb-1">
          <p className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-surface-400 dark:text-surface-500">
            Shared
          </p>
          <button
            className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm text-surface-700 transition-colors hover:bg-surface-200/60 dark:text-surface-300 dark:hover:bg-surface-700/60"
            onClick={() => setActiveView('folder')}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-4 w-4 shrink-0 text-surface-500 dark:text-surface-400"
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
            <span className="flex-1 truncate text-left">Marketing Team</span>
            <span className="rounded bg-accent-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-accent-700 dark:bg-accent-900/40 dark:text-accent-300">
              Team
            </span>
          </button>
        </div>

        {/* Password Health */}
        <button
          className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm text-surface-700 transition-colors hover:bg-surface-200/60 dark:text-surface-300 dark:hover:bg-surface-700/60"
          onClick={() => setActiveView('health')}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-4 w-4 shrink-0 text-blue-500"
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
          <span className="flex-1 truncate text-left">Password Health</span>
          <span className="rounded bg-green-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-green-700 dark:bg-green-900/40 dark:text-green-300">
            Good
          </span>
        </button>

        {/* Trash */}
        <button
          className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm text-surface-700 transition-colors hover:bg-surface-200/60 dark:text-surface-300 dark:hover:bg-surface-700/60"
          onClick={() => setActiveView('trash')}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-4 w-4 shrink-0 text-surface-500 dark:text-surface-400"
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
          <span className="truncate">Trash</span>
        </button>
      </div>

      {/* Footer */}
      <div className="shrink-0 space-y-0.5 border-t border-surface-200/80 px-3 py-2 dark:border-surface-700/80">
        <button
          className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm text-surface-700 transition-colors hover:bg-surface-200/60 dark:text-surface-300 dark:hover:bg-surface-700/60"
          onClick={() => {}}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-4 w-4 shrink-0 text-surface-500 dark:text-surface-400"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.75M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9 5.25h.008v.008H12v-.008z"
            />
          </svg>
          <span className="truncate">Help Center</span>
        </button>
        <button
          className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm text-surface-700 transition-colors hover:bg-surface-200/60 dark:text-surface-300 dark:hover:bg-surface-700/60"
          onClick={() => setActiveView('settings')}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-4 w-4 shrink-0 text-surface-500 dark:text-surface-400"
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
      </div>
    </aside>
  );
}
