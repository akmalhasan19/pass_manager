import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { useFolderStore } from '../../stores/folderStore';
import { useItemStore } from '../../stores/itemStore';
import { useUIStore } from '../../stores/uiStore';
import { MAX_FIELD_LENGTHS } from '../../../shared/constants';
import { sanitizeField, validateField } from '../../../shared/validation';
import { useTranslation } from '../../i18n/useTranslation';
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
  const { t } = useTranslation();

  const [isCreating, setIsCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [nameError, setNameError] = useState('');
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
    const sanitized = sanitizeField('folderName', newName);
    const name = sanitized.trim();
    if (!name) {
      if (sanitized.length > 0) {
        setNameError(t('validation.whitespaceOnly'));
        return;
      }
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
    setNameError('');
  }, [newName, createFolder, setSelectedFolder, loadItems, setActiveView, t]);

  const handleNameChange = useCallback(
    (raw: string) => {
      const sanitized = sanitizeField('folderName', raw);
      setNewName(sanitized);
      setNameError('');
      if (sanitized.length > MAX_FIELD_LENGTHS.FOLDER_NAME) {
        setNameError(t('validation.maxLength', { max: MAX_FIELD_LENGTHS.FOLDER_NAME }));
      }
      const err = validateField('folderName', sanitized);
      if (err && err !== 'validation.maxLength') {
        setNameError(t(err));
      }
    },
    [t],
  );

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
              maxLength={MAX_FIELD_LENGTHS.FOLDER_NAME}
              onChange={(e) => handleNameChange(e.target.value)}
              onBlur={() => {
                if (!newName.trim()) {
                  setIsCreating(false);
                }
              }}
              onKeyDown={handleKeyDown}
            />
            {nameError && <p className="ml-8 mt-1 text-xs text-danger-500">{nameError}</p>}
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
