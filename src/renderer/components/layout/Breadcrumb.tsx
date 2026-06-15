import React, { useMemo } from 'react';
import type { Folder, Item, ItemDecrypted } from '../../../shared/types';

interface BreadcrumbProps {
  folders: Folder[];
  selectedFolderId: string | null;
  selectedItem: Item | ItemDecrypted | null;
  onHomeClick: () => void;
  onFolderClick: (folderId: string) => void;
}

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

export default function Breadcrumb({
  folders,
  selectedFolderId,
  selectedItem,
  onHomeClick,
  onFolderClick,
}: BreadcrumbProps): React.ReactElement {
  const breadcrumb = useMemo(() => {
    if (!selectedFolderId) return [];
    return buildBreadcrumbPath(folders, selectedFolderId) || [];
  }, [folders, selectedFolderId]);

  const showBreadcrumb = selectedFolderId !== null || selectedItem !== null;

  return (
    <nav className="min-w-0" aria-label="Breadcrumb">
      <div className="flex items-center gap-1.5 text-sm">
        {/* Home button */}
        <button
          className="flex items-center gap-1 text-surface-400 transition-colors hover:text-surface-600 dark:hover:text-surface-300"
          onClick={onHomeClick}
          aria-label="Go to home"
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

        {/* Show trailing slash when only home is displayed */}
        {!showBreadcrumb && <span className="text-surface-300 dark:text-surface-600">/</span>}

        {/* Folder breadcrumbs */}
        {breadcrumb.map((folder, index) => (
          <React.Fragment key={folder.id}>
            <span className="text-surface-300 dark:text-surface-600">/</span>
            <button
              className={`max-w-[150px] truncate transition-colors hover:text-surface-600 dark:hover:text-surface-300 ${
                index === breadcrumb.length - 1 && !selectedItem
                  ? 'font-medium text-surface-700 dark:text-surface-300'
                  : 'text-surface-400'
              }`}
              onClick={() => onFolderClick(folder.id)}
            >
              {folder.emoji && <span className="mr-1">{folder.emoji}</span>}
              {folder.name}
            </button>
          </React.Fragment>
        ))}

        {/* Item name when selected */}
        {selectedItem && (
          <>
            <span className="text-surface-300 dark:text-surface-600">/</span>
            <span className="max-w-[150px] truncate font-medium text-surface-700 dark:text-surface-300">
              {selectedItem.emoji && <span className="mr-1">{selectedItem.emoji}</span>}
              {selectedItem.title}
            </span>
          </>
        )}
      </div>
    </nav>
  );
}
