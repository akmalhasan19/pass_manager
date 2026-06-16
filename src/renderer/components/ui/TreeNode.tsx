import React, { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { Folder } from '../../../shared/types';
import { MAX_FIELD_LENGTHS } from '../../../shared/constants';
import { sanitizeField, validateCharacters } from '../../../shared/validation';
import EmojiPicker from './EmojiPicker';

interface TreeNodeProps {
  folder: Folder;
  depth: number;
  selectedFolderId: string | null;
  expandedFolderIds: Set<string>;
  onSelect: (id: string) => void;
  onToggleExpand: (id: string) => void;
  onRename: (id: string, newName: string) => Promise<boolean>;
  onDelete: (id: string) => void;
  onNewSubfolder: (parentId: string) => void;
  onEmojiChange?: (id: string, emoji: string) => void;
  onDragStart: (e: React.DragEvent, folderId: string) => void;
  onDragOver: (e: React.DragEvent, folderId: string) => void;
  onDrop: (e: React.DragEvent, folderId: string) => void;
  onDragLeave: (e: React.DragEvent) => void;
  dragOverId: string | null;
}

export default function TreeNode({
  folder,
  depth,
  selectedFolderId,
  expandedFolderIds,
  onSelect,
  onToggleExpand,
  onRename,
  onDelete,
  onNewSubfolder,
  onEmojiChange,
  onDragStart,
  onDragOver,
  onDrop,
  onDragLeave,
  dragOverId,
}: TreeNodeProps): React.ReactElement {
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(folder.name);
  const [renameError, setRenameError] = useState<string | null>(null);
  const [showContextMenu, setShowContextMenu] = useState(false);
  const [contextMenuPos, setContextMenuPos] = useState({ x: 0, y: 0 });
  const inputRef = useRef<HTMLInputElement>(null);
  const nodeRef = useRef<HTMLDivElement>(null);

  const isExpanded = expandedFolderIds.has(folder.id);
  const isSelected = selectedFolderId === folder.id;
  const isDragOver = dragOverId === folder.id;
  const hasChildren = folder.children && folder.children.length > 0;

  useEffect(() => {
    if (isRenaming && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isRenaming]);

  useEffect(() => {
    if (!showContextMenu) return;
    const handleClick = () => setShowContextMenu(false);
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowContextMenu(false);
    };
    document.addEventListener('click', handleClick);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('click', handleClick);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [showContextMenu]);

  const handleDoubleClick = useCallback(() => {
    setRenameError(null);
    setIsRenaming(true);
    setRenameValue(folder.name);
  }, [folder.name]);

  const handleRenameSubmit = useCallback(async () => {
    const sanitized = sanitizeField('folderName', renameValue);
    const trimmed = sanitized.trim();
    if (sanitized !== renameValue) {
      setRenameValue(sanitized);
    }
    if (trimmed && trimmed !== folder.name) {
      const charError = validateCharacters('folderName', trimmed);
      if (charError) {
        setRenameError(charError);
        return;
      }
      const success = await onRename(folder.id, trimmed);
      if (!success) {
        setRenameError('A folder with this name already exists.');
        return;
      }
    }
    setRenameError(null);
    setIsRenaming(false);
  }, [renameValue, folder.name, folder.id, onRename]);

  const handleRenameKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        handleRenameSubmit();
      } else if (e.key === 'Escape') {
        setRenameError(null);
        setIsRenaming(false);
        setRenameValue(folder.name);
      }
    },
    [handleRenameSubmit, folder.name],
  );

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenuPos({ x: e.clientX, y: e.clientY });
    setShowContextMenu(true);
  }, []);

  const handleClick = useCallback(() => {
    onSelect(folder.id);
    if (hasChildren) {
      onToggleExpand(folder.id);
    }
  }, [folder.id, hasChildren, onSelect, onToggleExpand]);

  const chevronClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onToggleExpand(folder.id);
    },
    [folder.id, onToggleExpand],
  );

  return (
    <div ref={nodeRef}>
      <div
        className={`group flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm transition-colors duration-100 ${
          isSelected
            ? 'bg-surface-200/80 text-surface-800 dark:bg-surface-700/80 dark:text-surface-100'
            : 'text-surface-700 hover:bg-surface-200/60 dark:text-surface-300 dark:hover:bg-surface-700/60'
        } ${isDragOver ? 'ring-2 ring-accent-400' : ''}`}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
        onClick={handleClick}
        onContextMenu={handleContextMenu}
        draggable
        onDragStart={(e) => onDragStart(e, folder.id)}
        onDragOver={(e) => onDragOver(e, folder.id)}
        onDrop={(e) => onDrop(e, folder.id)}
        onDragLeave={onDragLeave}
        role="treeitem"
        aria-expanded={hasChildren ? isExpanded : undefined}
        aria-selected={isSelected}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter') handleClick();
        }}
      >
        {/* Chevron */}
        <button
          className={`flex h-4 w-4 shrink-0 items-center justify-center rounded transition-transform duration-150 ${
            hasChildren
              ? 'text-surface-400 hover:text-surface-600 dark:hover:text-surface-300'
              : 'text-transparent'
          } ${isExpanded ? 'rotate-90' : ''}`}
          onClick={chevronClick}
          tabIndex={-1}
          aria-hidden={!hasChildren}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-3 w-3"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </button>

        {/* Emoji or folder icon */}
        <span className="shrink-0 text-base leading-none" onClick={(e) => e.stopPropagation()}>
          {onEmojiChange ? (
            <EmojiPicker
              value={folder.emoji}
              defaultEmoji="📁"
              onChange={(emoji) => onEmojiChange(folder.id, emoji)}
              placement="bottom-start"
              ariaLabel={`Change emoji for ${folder.name}`}
            >
              <span className="flex h-5 w-5 cursor-pointer items-center justify-center rounded transition-colors hover:bg-surface-300/50 dark:hover:bg-surface-600/50">
                {folder.emoji || '📁'}
              </span>
            </EmojiPicker>
          ) : (
            <span>{folder.emoji || '📁'}</span>
          )}
        </span>

        {/* Name or rename input */}
        {isRenaming ? (
          <div className="min-w-0 flex-1">
            <input
              ref={inputRef}
              className={`w-full min-w-0 rounded border bg-white px-1 py-0 text-sm outline-none ring-1 dark:bg-surface-800 ${
                renameError
                  ? 'border-danger-400 ring-danger-400/50'
                  : 'border-accent-400 ring-accent-400/50'
              }`}
              value={renameValue}
              maxLength={MAX_FIELD_LENGTHS.FOLDER_NAME}
              onChange={(e) => {
                const sanitized = sanitizeField('folderName', e.target.value);
                setRenameValue(sanitized);
                if (renameError) setRenameError(null);
              }}
              onBlur={handleRenameSubmit}
              onKeyDown={handleRenameKeyDown}
              onClick={(e) => e.stopPropagation()}
            />
            {renameError && <p className="mt-0.5 text-[11px] text-danger-500">{renameError}</p>}
          </div>
        ) : (
          <span className="min-w-0 flex-1 truncate text-sm">{folder.name}</span>
        )}
      </div>

      {/* Children */}
      <AnimatePresence initial={false}>
        {isExpanded && folder.children && (
          <motion.div
            key="children"
            role="group"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            style={{ overflow: 'hidden' }}
          >
            {folder.children.map((child) => (
              <TreeNode
                key={child.id}
                folder={child}
                depth={depth + 1}
                selectedFolderId={selectedFolderId}
                expandedFolderIds={expandedFolderIds}
                onSelect={onSelect}
                onToggleExpand={onToggleExpand}
                onRename={onRename}
                onDelete={onDelete}
                onNewSubfolder={onNewSubfolder}
                onEmojiChange={onEmojiChange}
                onDragStart={onDragStart}
                onDragOver={onDragOver}
                onDrop={onDrop}
                onDragLeave={onDragLeave}
                dragOverId={dragOverId}
              />
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Context menu */}
      {showContextMenu && (
        <div
          className="fixed z-50 min-w-[180px] rounded-lg border border-surface-200 bg-white py-1 shadow-lg dark:border-surface-700 dark:bg-surface-800"
          style={{
            top: contextMenuPos.y,
            left: contextMenuPos.x,
            animation: 'fadeIn 0.1s ease-out',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            className="flex w-full items-center gap-2 px-3 py-1.5 text-sm text-surface-700 transition-colors hover:bg-surface-100 dark:text-surface-300 dark:hover:bg-surface-700"
            onClick={() => {
              setShowContextMenu(false);
              onNewSubfolder(folder.id);
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
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            New Subfolder
          </button>
          <button
            className="flex w-full items-center gap-2 px-3 py-1.5 text-sm text-surface-700 transition-colors hover:bg-surface-100 dark:text-surface-300 dark:hover:bg-surface-700"
            onClick={() => {
              setShowContextMenu(false);
              handleDoubleClick();
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
            Rename
          </button>
          <div className="my-1 h-px bg-surface-200 dark:bg-surface-700" />
          <button
            className="flex w-full items-center gap-2 px-3 py-1.5 text-sm text-danger-600 transition-colors hover:bg-danger-50 dark:text-danger-400 dark:hover:bg-danger-500/10"
            onClick={() => {
              setShowContextMenu(false);
              onDelete(folder.id);
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
