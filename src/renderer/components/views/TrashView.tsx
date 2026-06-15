import React, { useState, useEffect, useCallback } from 'react';
import type { TrashEntry } from '../../../shared/types';

function formatDate(ts: number): string {
  if (!ts) return '-';
  const d = new Date(ts);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffMinutes = Math.floor(diffMs / (1000 * 60));

  if (diffMinutes < 1) return 'Just now';
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;

  return d.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function TrashView(): React.ReactElement {
  const [entries, setEntries] = useState<TrashEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRestoring, setIsRestoring] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState<string | null>(null);
  const [isEmptying, setIsEmptying] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [confirmEmpty, setConfirmEmpty] = useState(false);

  const loadTrash = useCallback(async () => {
    setIsLoading(true);
    try {
      const result = await window.electron.trash.get();
      if (!result.success) throw new Error(result.error || 'Failed to load trash');
      setEntries(result.data || []);
    } catch {
      setEntries([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadTrash();
  }, [loadTrash]);

  const handleRestore = useCallback(async (entry: TrashEntry) => {
    setIsRestoring(entry.id);
    try {
      await window.electron.trash.restore(entry.originalId, entry.originalType);
      setEntries((prev) => prev.filter((e) => e.id !== entry.id));
    } catch {
      // Error handled silently
    } finally {
      setIsRestoring(null);
    }
  }, []);

  const handlePermanentDelete = useCallback(async (id: string) => {
    setIsDeleting(id);
    try {
      await window.electron.trash.permanentDelete(id);
      setEntries((prev) => prev.filter((e) => e.id !== id));
      setConfirmDeleteId(null);
    } catch {
      // Error handled silently
    } finally {
      setIsDeleting(null);
    }
  }, []);

  const handleEmptyTrash = useCallback(async () => {
    setIsEmptying(true);
    try {
      await window.electron.trash.empty();
      setEntries([]);
      setConfirmEmpty(false);
    } catch {
      // Error handled silently
    } finally {
      setIsEmptying(false);
    }
  }, []);

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-accent-500 border-t-transparent" />
          <p className="text-sm text-surface-400">Loading trash...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      {entries.length > 0 && (
        <div className="flex shrink-0 items-center justify-between border-b border-surface-200 bg-white px-4 py-3 dark:border-surface-700 dark:bg-surface-850">
          <p className="text-sm text-surface-500 dark:text-surface-400">
            {entries.length} {entries.length === 1 ? 'item' : 'items'} in trash
          </p>
          {confirmEmpty ? (
            <div className="flex items-center gap-2">
              <p className="text-xs text-danger-500">Empty trash permanently?</p>
              <button
                className="notion-button-danger h-7 text-xs"
                onClick={handleEmptyTrash}
                disabled={isEmptying}
              >
                {isEmptying ? 'Emptying...' : 'Yes, empty'}
              </button>
              <button
                className="notion-button-ghost h-7 text-xs"
                onClick={() => setConfirmEmpty(false)}
                disabled={isEmptying}
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              className="notion-button-danger h-7 text-xs"
              onClick={() => setConfirmEmpty(true)}
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
                  d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                />
              </svg>
              Empty Trash
            </button>
          )}
        </div>
      )}

      {/* Content */}
      <div className="notion-scrollbar flex-1 overflow-y-auto">
        {entries.length > 0 ? (
          <div className="divide-y divide-surface-200 dark:divide-surface-700">
            {entries.map((entry) => (
              <div
                key={entry.id}
                className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-50 dark:hover:bg-surface-800/50"
              >
                {/* Icon */}
                <span className="shrink-0 text-xl">
                  {entry.originalType === 'folder' ? '📁' : '🔑'}
                </span>

                {/* Info */}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-surface-800 dark:text-surface-200">
                    {entry.originalType === 'folder' ? 'Folder' : 'Item'}
                  </p>
                  <p className="text-xs text-surface-500 dark:text-surface-400">
                    Deleted {formatDate(entry.deletedAt)}
                  </p>
                </div>

                {/* Actions */}
                {confirmDeleteId === entry.id ? (
                  <div className="flex shrink-0 items-center gap-1.5">
                    <button
                      className="notion-button-danger h-7 text-xs"
                      onClick={() => handlePermanentDelete(entry.id)}
                      disabled={isDeleting === entry.id}
                    >
                      {isDeleting === entry.id ? '...' : 'Confirm'}
                    </button>
                    <button
                      className="notion-button-ghost h-7 text-xs"
                      onClick={() => setConfirmDeleteId(null)}
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      className="notion-button-ghost h-7 gap-1 text-xs"
                      onClick={() => handleRestore(entry)}
                      disabled={isRestoring === entry.id}
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
                          d="M4 16v-4a1 1 0 011-1h4m6 0h4a1 1 0 011 1v4m-5-5l-3-3m0 0l3-3m-3 3h12"
                        />
                      </svg>
                      {isRestoring === entry.id ? '...' : 'Restore'}
                    </button>
                    <button
                      className="notion-button-ghost h-7 w-7 p-0 text-danger-500 hover:bg-danger-50 dark:hover:bg-danger-500/10"
                      onClick={() => setConfirmDeleteId(entry.id)}
                      aria-label="Permanently delete"
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
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="notion-empty-state h-full">
            <div className="notion-empty-state-icon">🗑️</div>
            <p className="notion-empty-state-title">Trash is empty</p>
            <p className="notion-empty-state-description">
              Deleted items will appear here. You can restore them or permanently delete them.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
