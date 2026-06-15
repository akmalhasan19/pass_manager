import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { useFolderStore } from '../../stores/folderStore';
import { useItemStore } from '../../stores/itemStore';
import { useUIStore } from '../../stores/uiStore';
import type { Folder } from '../../../shared/types';

function flattenFolders(folders: Folder[]): Folder[] {
  const result: Folder[] = [];
  for (const folder of folders) {
    result.push(folder);
    if (folder.children) {
      result.push(...flattenFolders(folder.children));
    }
  }
  return result;
}

export default function HomeView(): React.ReactElement {
  const { folders, createFolder, setSelectedFolder } = useFolderStore();
  const { loadItems } = useItemStore();
  const { setActiveView } = useUIStore();

  const [isCreating, setIsCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isCreating && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isCreating]);

  const allFolders = useMemo(() => flattenFolders(folders), [folders]);

  const handleFolderClick = useCallback(
    (id: string) => {
      setSelectedFolder(id);
      loadItems(id);
      setActiveView('folder');
    },
    [setSelectedFolder, loadItems, setActiveView],
  );

  const handleCreateFolder = useCallback(async () => {
    const name = newName.trim();
    if (!name) {
      setIsCreating(false);
      return;
    }
    const folder = await createFolder(null, name);
    if (folder) {
      setSelectedFolder(folder.id);
      loadItems(folder.id);
      setActiveView('folder');
    }
    setIsCreating(false);
    setNewName('');
  }, [newName, createFolder, setSelectedFolder, loadItems, setActiveView]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        handleCreateFolder();
      } else if (e.key === 'Escape') {
        setIsCreating(false);
        setNewName('');
      }
    },
    [handleCreateFolder],
  );

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center justify-between border-b border-surface-200 px-6 py-4 dark:border-surface-700">
        <h1 className="text-xl font-semibold text-surface-800 dark:text-surface-200">Home</h1>
        <button
          className="notion-button-primary flex h-8 items-center gap-1.5 text-xs"
          onClick={() => {
            setIsCreating(true);
            setNewName('');
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
          + New Folder
        </button>
      </div>

      <div className="notion-scrollbar flex-1 overflow-y-auto p-6">
        {isCreating && (
          <div className="mb-6 flex items-center gap-2">
            <span className="text-base leading-none">📁</span>
            <input
              ref={inputRef}
              className="notion-input h-8 w-56 text-xs"
              placeholder="Folder name..."
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onBlur={() => {
                if (!newName.trim()) {
                  setIsCreating(false);
                }
              }}
              onKeyDown={handleKeyDown}
            />
            <button className="notion-button-primary h-8 text-xs" onClick={handleCreateFolder}>
              Create
            </button>
            <button
              className="notion-button-ghost h-8 text-xs"
              onClick={() => {
                setIsCreating(false);
                setNewName('');
              }}
            >
              Cancel
            </button>
          </div>
        )}

        {allFolders.length === 0 && !isCreating ? (
          <div className="notion-empty-state h-full">
            <div className="notion-empty-state-icon">📂</div>
            <p className="notion-empty-state-title">No folders yet</p>
            <p className="notion-empty-state-description">
              Click "+ New Folder" to create your first folder.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {allFolders.map((folder) => (
              <button
                key={folder.id}
                className="notion-card group flex flex-col items-center gap-3 p-6 text-center"
                onClick={() => handleFolderClick(folder.id)}
              >
                <span className="text-4xl">{folder.emoji || '📁'}</span>
                <span className="text-sm font-medium text-surface-800 dark:text-surface-200">
                  {folder.name}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
