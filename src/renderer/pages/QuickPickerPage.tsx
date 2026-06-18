/**
 * Quick Picker Overlay Page
 *
 * A minimal, always-on-top overlay that allows users to quickly search
 * and act on vault items via fuzzy search. Triggered by global shortcut
 * or tray icon click.
 *
 * ARCHITECTURE:
 * - Receives items from main process via IPC `quick-picker:items`
 * - Performs local fuzzy search for instant feedback
 * - Actions (copy, open) are sent via IPC back to main process
 * - Supports keyboard navigation (↑↓, Enter, Escape)
 *
 * SECURITY:
 * - Never persists sensitive data; only receives item metadata
 * - All actual credential operations happen in the main process
 */

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import type { IpcResult } from '../electron.d';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface QuickPickerItem {
  id: string;
  title: string;
  username: string;
  url: string;
  emoji: string | null;
  isFavorite: boolean;
}

type QuickPickerAction = 'copy_username' | 'copy_password' | 'copy_otp' | 'open_url';

interface Toast {
  id: string;
  message: string;
  type: 'success' | 'error' | 'info';
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function generateId(prefix = 'id'): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 11)}`;
}

/**
 * Perform fuzzy matching locally for instant feedback.
 * Mirrors the scoring logic in quickPickerManager.
 */
function fuzzySearch(items: QuickPickerItem[], query: string): QuickPickerItem[] {
  if (!query || query.trim().length === 0) {
    return items.slice(0, 50);
  }

  const normalizedQuery = query.toLowerCase().trim();
  const queryTokens = normalizedQuery.split(/\s+/);

  const scored: Array<{ item: QuickPickerItem; score: number }> = [];

  for (const item of items) {
    const title = (item.title ?? '').toLowerCase();
    const username = (item.username ?? '').toLowerCase();
    const url = (item.url ?? '').toLowerCase();

    let score = 0;

    for (const token of queryTokens) {
      if (title === token) {
        score += 100;
      } else if (title.startsWith(token)) {
        score += 80;
      } else if (title.includes(token)) {
        score += 60;
      }

      if (username === token) {
        score += 50;
      } else if (username.startsWith(token)) {
        score += 40;
      } else if (username.includes(token)) {
        score += 30;
      }

      if (url.includes(token)) {
        score += 20;
      }

      if (score === 0) {
        let charIndex = 0;
        for (let i = 0; i < title.length && charIndex < token.length; i++) {
          if (title[i] === token[charIndex]) {
            charIndex++;
          }
        }
        if (charIndex === token.length) {
          score += 10;
        }
      }
    }

    if (item.isFavorite) {
      score += 5;
    }

    if (score > 0) {
      scored.push({ item, score });
    }
  }

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, 50)
    .map(({ item }) => item);
}

// ---------------------------------------------------------------------------
// Toast Manager
// ---------------------------------------------------------------------------

function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const addToast = useCallback((message: string, type: Toast['type'] = 'info') => {
    const id = generateId('toast');
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3000);
  }, []);

  return { toasts, addToast };
}

// ---------------------------------------------------------------------------
// IPC Helpers
// ---------------------------------------------------------------------------

async function invokeQuickPickerSearch(query: string): Promise<QuickPickerItem[]> {
  if (!window.electron?.quickPicker?.search) {
    return [];
  }
  try {
    const result = await window.electron.quickPicker.search(query);
    return (result.data ?? []) as QuickPickerItem[];
  } catch {
    return [];
  }
}

async function invokeQuickPickerAction(itemId: string, action: QuickPickerAction): Promise<void> {
  if (!window.electron?.quickPicker?.action) return;
  try {
    await window.electron.quickPicker.action(itemId, action);
  } catch {
    // Ignore errors from action
  }
}

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

export default function QuickPickerPage(): React.ReactElement {
  const [items, setItems] = useState<QuickPickerItem[]>([]);
  const [query, setQuery] = useState('');
  const [filteredItems, setFilteredItems] = useState<QuickPickerItem[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const { toasts, addToast } = useToasts();

  // -------------------------------------------------------------------------
  // Receive items from main process
  // -------------------------------------------------------------------------

  useEffect(() => {
    const handleItems = (receivedItems: unknown[]) => {
      setItems(receivedItems as QuickPickerItem[]);
      setFilteredItems((receivedItems as QuickPickerItem[]).slice(0, 50));
      setIsLoaded(true);
      setSelectedIndex(0);
    };

    const handleFocusSearch = () => {
      inputRef.current?.focus();
    };

    if (window.electron?.quickPicker?.onItems) {
      window.electron.quickPicker.onItems(handleItems);
    }
    if (window.electron?.quickPicker?.onFocusSearch) {
      window.electron.quickPicker.onFocusSearch(handleFocusSearch);
    }

    // Request initial items if available
    if (window.electron?.quickPicker?.getItems) {
      window.electron.quickPicker.getItems().then((result: { success: boolean; data: unknown[] }) => {
        if (result?.data) {
          const items = result.data as QuickPickerItem[];
          setItems(items);
          setFilteredItems(items.slice(0, 50));
          setIsLoaded(true);
        }
      }).catch(() => {
        // If getItems fails, wait for push from main process
      });
    }

    return () => {
      if (window.electron?.quickPicker?.removeItemsListener) {
        window.electron.quickPicker.removeItemsListener();
      }
      if (window.electron?.quickPicker?.removeFocusSearchListener) {
        window.electron.quickPicker.removeFocusSearchListener();
      }
    };
  }, []);

  // -------------------------------------------------------------------------
  // Keyboard navigation
  // -------------------------------------------------------------------------

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (window.electron?.quickPicker?.hide) {
          window.electron.quickPicker.hide();
        }
        return;
      }

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((prev) => {
          const next = Math.min(prev + 1, filteredItems.length - 1);
          return Math.max(next, 0);
        });
        return;
      }

      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((prev) => Math.max(prev - 1, 0));
        return;
      }

      if (e.key === 'Enter') {
        e.preventDefault();
        const item = filteredItems[selectedIndex];
        if (item) {
          setSelectedItemId(item.id);
        }
        return;
      }

      // Quick action keybinds when an item is selected
      if (selectedItemId && (e.ctrlKey || e.metaKey)) {
        switch (e.key.toLowerCase()) {
          case 'c':
            e.preventDefault();
            performAction(selectedItemId, 'copy_username');
            break;
          case 'v':
            e.preventDefault();
            performAction(selectedItemId, 'copy_password');
            break;
          case 'o':
            e.preventDefault();
            performAction(selectedItemId, 'open_url');
            break;
          case 't':
            e.preventDefault();
            performAction(selectedItemId, 'copy_otp');
            break;
        }
      }
    },
    [filteredItems, selectedIndex, selectedItemId],
  );

  // -------------------------------------------------------------------------
  // Search
  // -------------------------------------------------------------------------

  useEffect(() => {
    const timer = setTimeout(async () => {
      if (!query.trim()) {
        setFilteredItems(items.slice(0, 50));
        setSelectedIndex(0);
        return;
      }

      // Try IPC search first (more accurate, more data)
      if (typeof window.electron?.quickPicker?.search === 'function') {
        try {
          const results = await invokeQuickPickerSearch(query);
          setFilteredItems(results);
          setSelectedIndex(0);
          return;
        } catch {
          // Fallback to local search
        }
      }

      // Local fuzzy search fallback
      const results = fuzzySearch(items, query);
      setFilteredItems(results);
      setSelectedIndex(0);
    }, 150);

    return () => clearTimeout(timer);
  }, [query, items]);

  // -------------------------------------------------------------------------
  // Scroll selected into view
  // -------------------------------------------------------------------------

  useEffect(() => {
    if (listRef.current && filteredItems.length > 0) {
      const child = listRef.current.children[selectedIndex] as HTMLElement | undefined;
      if (child) {
        child.scrollIntoView({ block: 'nearest' });
      }
    }
  }, [selectedIndex, filteredItems]);

  // -------------------------------------------------------------------------
  // Action handlers
  // -------------------------------------------------------------------------

  const performAction = useCallback(
    async (itemId: string, action: QuickPickerAction) => {
      await invokeQuickPickerAction(itemId, action);

      const actionLabels: Record<QuickPickerAction, string> = {
        copy_username: 'Username copied to clipboard',
        copy_password: 'Password copied to clipboard',
        copy_otp: 'OTP copied to clipboard',
        open_url: 'URL opened in browser',
      };

      addToast(actionLabels[action], 'success');

      // Hide overlay after action unless it's open_url
      if (action !== 'open_url') {
        setTimeout(() => {
          if (window.electron?.quickPicker?.hide) {
            window.electron.quickPicker.hide();
          }
        }, 600);
      }
    },
    [addToast],
  );

  const handleItemClick = useCallback(
    (item: QuickPickerItem) => {
      setSelectedItemId(item.id);
    },
    [],
  );

  const handleAction = useCallback(
    (action: QuickPickerAction) => {
      if (!selectedItemId) return;
      performAction(selectedItemId, action);
    },
    [selectedItemId, performAction],
  );

  // -------------------------------------------------------------------------
  // Selected item details
  // -------------------------------------------------------------------------

  const selectedItem = useMemo(
    () => items.find((i) => i.id === selectedItemId) ?? null,
    [items, selectedItemId],
  );

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <div
      className="flex h-screen w-full flex-col overflow-hidden bg-surface-900/95 text-surface-100 backdrop-blur-sm"
      onKeyDown={handleKeyDown}
    >
      {/* Header / Search */}
      <div className="flex items-center gap-3 border-b border-surface-700/50 px-4 py-3">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className="h-5 w-5 shrink-0 text-surface-400"
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
        <input
          ref={inputRef}
          type="text"
          className="w-full bg-transparent text-sm text-surface-100 placeholder-surface-400 outline-none"
          placeholder="Search vault items..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoFocus
          aria-label="Search vault items"
        />
        {isLoaded && (
          <span className="text-xs text-surface-500">
            {filteredItems.length}
          </span>
        )}
      </div>

      {/* Results list */}
      <div ref={listRef} className="notion-scrollbar min-h-0 flex-1 overflow-y-auto">
        {!isLoaded && (
          <div className="flex items-center justify-center py-12">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-6 w-6 animate-spin text-surface-500"
              fill="none"
              viewBox="0 0 24 24"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
              />
            </svg>
          </div>
        )}

        {isLoaded && filteredItems.length === 0 && (
          <div className="py-12 text-center">
            <p className="text-sm text-surface-400">
              No items found for "{query}"
            </p>
          </div>
        )}

        {isLoaded &&
          filteredItems.map((item, index) => {
            const isSelected = index === selectedIndex;
            const isSelectedId = selectedItemId === item.id;

            return (
              <button
                key={item.id}
                className={`flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                  isSelected
                    ? 'bg-accent-600/30'
                    : isSelectedId
                      ? 'bg-accent-600/20'
                      : 'hover:bg-surface-800/50'
                }`}
                onClick={() => handleItemClick(item)}
                onMouseEnter={() => setSelectedIndex(index)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    handleItemClick(item);
                  }
                }}
                tabIndex={0}
                aria-label={`${item.title} ${item.username}`}
              >
                <span className="shrink-0 text-lg">{item.emoji || '\u{1F511}'}</span>
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm font-medium text-surface-100">
                    {item.title}
                  </span>
                  <span className="truncate text-xs text-surface-400">
                    {item.username || item.url || 'No username'}
                  </span>
                </div>
                {item.isFavorite && (
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className="h-4 w-4 shrink-0 text-yellow-400"
                    viewBox="0 0 20 20"
                    fill="currentColor"
                  >
                    <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.967 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.03c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                  </svg>
                )}
              </button>
            );
          })}
      </div>

      {/* Selected item detail / action bar */}
      {selectedItem && (
        <div className="border-t border-surface-700/50 px-4 py-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="truncate text-sm font-medium text-surface-100">
              {selectedItem.title}
            </span>
            <span className="text-xs text-surface-500">
              {selectedItem.username}
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            <ActionButton
              label="Copy Username"
              shortcut="Ctrl+C"
              onClick={() => handleAction('copy_username')}
              variant="primary"
            />
            <ActionButton
              label="Copy Password"
              shortcut="Ctrl+V"
              onClick={() => handleAction('copy_password')}
              variant="primary"
            />
            <ActionButton
              label="Copy OTP"
              shortcut="Ctrl+T"
              onClick={() => handleAction('copy_otp')}
              variant="secondary"
            />
            <ActionButton
              label="Open URL"
              shortcut="Ctrl+O"
              onClick={() => handleAction('open_url')}
              variant="secondary"
              disabled={!selectedItem.url}
            />
          </div>
        </div>
      )}

      {/* Footer hint */}
      <div className="flex items-center justify-between border-t border-surface-700/50 px-4 py-2 text-xs text-surface-500">
        <span>
          {filteredItems.length} item{filteredItems.length !== 1 ? 's' : ''}
        </span>
        <span className="flex items-center gap-3">
          <span className="flex items-center gap-1">
            <kbd className="rounded bg-surface-800 px-1 py-0.5 font-mono text-[10px]">{'\u2191\u2193'}</kbd>
            Navigate
          </span>
          <span className="flex items-center gap-1">
            <kbd className="rounded bg-surface-800 px-1 py-0.5 font-mono text-[10px]">{'\u23CE'}</kbd>
            Select
          </span>
          <span className="flex items-center gap-1">
            <kbd className="rounded bg-surface-800 px-1 py-0.5 font-mono text-[10px]">Esc</kbd>
            Close
          </span>
        </span>
      </div>

      {/* Toast notifications */}
      <div className="pointer-events-none absolute bottom-4 left-0 right-0 z-50 flex flex-col items-center gap-2 px-4">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`pointer-events-auto rounded-md px-4 py-2 text-sm shadow-lg animation-fade-in ${
              toast.type === 'success'
                ? 'bg-green-600 text-white'
                : toast.type === 'error'
                  ? 'bg-red-600 text-white'
                  : 'bg-surface-700 text-surface-100'
            }`}
          >
            {toast.message}
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

interface ActionButtonProps {
  label: string;
  shortcut: string;
  onClick: () => void;
  variant: 'primary' | 'secondary';
  disabled?: boolean;
}

function ActionButton({ label, shortcut, onClick, variant, disabled }: ActionButtonProps): React.ReactElement {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center gap-1.5 rounded px-2.5 py-1.5 text-xs font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-accent-400/50 ${
        variant === 'primary'
          ? 'bg-accent-600 text-white hover:bg-accent-700 disabled:bg-accent-800 disabled:text-accent-300'
          : 'bg-surface-700 text-surface-200 hover:bg-surface-600 disabled:text-surface-500'
      }`}
    >
      <span>{label}</span>
      <span className="rounded bg-surface-800/50 px-1 py-0.5 font-mono text-[10px] opacity-70">
        {shortcut}
      </span>
    </button>
  );
}