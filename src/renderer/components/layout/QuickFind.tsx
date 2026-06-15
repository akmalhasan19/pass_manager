import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useUIStore } from '../../stores/uiStore';
import { useFolderStore } from '../../stores/folderStore';
import { useItemStore } from '../../stores/itemStore';
import Modal from '../ui/Modal';
import type { Folder, Item, Tag } from '../../../shared/types';

interface SearchResult {
  type: 'folder' | 'item' | 'tag';
  id: string;
  title: string;
  subtitle: string;
  emoji: string | null;
  data: Folder | Item | Tag;
}

function fuzzyMatch(text: string, query: string): boolean {
  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();
  let queryIndex = 0;
  for (let i = 0; i < lowerText.length && queryIndex < lowerQuery.length; i++) {
    if (lowerText[i] === lowerQuery[queryIndex]) {
      queryIndex++;
    }
  }
  return queryIndex === lowerQuery.length;
}

function highlightFuzzy(text: string, query: string): React.ReactNode {
  if (!query) return text;
  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const parts: React.ReactNode[] = [];
  let queryIndex = 0;
  let lastIndex = 0;

  for (let i = 0; i < lowerText.length && queryIndex < lowerQuery.length; i++) {
    if (lowerText[i] === lowerQuery[queryIndex]) {
      if (i > lastIndex) {
        parts.push(text.slice(lastIndex, i));
      }
      parts.push(
        <span
          key={i}
          className="rounded bg-yellow-200 px-0.5 text-surface-900 dark:bg-yellow-800 dark:text-surface-100"
        >
          {text[i]}
        </span>,
      );
      lastIndex = i + 1;
      queryIndex++;
    }
  }
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }
  return parts;
}

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

export default function QuickFind(): React.ReactElement {
  const { quickFindOpen, setQuickFindOpen, setActiveView } = useUIStore();
  const { folders, setSelectedFolder } = useFolderStore();
  const { setSelectedItem, loadItems } = useItemStore();

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [tags, setTags] = useState<Tag[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (quickFindOpen) {
      setQuery('');
      setResults([]);
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [quickFindOpen]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setQuickFindOpen(!quickFindOpen);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [quickFindOpen, setQuickFindOpen]);

  const search = useCallback(
    async (searchQuery: string) => {
      if (!searchQuery.trim()) {
        setResults([]);
        return;
      }

      setIsLoading(true);
      try {
        const searchResults: SearchResult[] = [];

        // Search folders
        const allFolders = flattenFolders(folders);
        for (const folder of allFolders) {
          if (fuzzyMatch(folder.name, searchQuery)) {
            searchResults.push({
              type: 'folder',
              id: folder.id,
              title: folder.name,
              subtitle: 'Folder',
              emoji: folder.emoji,
              data: folder,
            });
          }
        }

        // Search items via IPC
        try {
          const itemsResult = await window.electron.items.search(searchQuery);
          for (const item of itemsResult.data) {
            searchResults.push({
              type: 'item',
              id: item.id,
              title: item.title,
              subtitle: item.username || item.url || 'Password',
              emoji: item.emoji,
              data: item,
            });
          }
        } catch {
          // Search items might fail if DB is not ready
        }

        // Search tags
        if (tags.length === 0) {
          try {
            const allTags = await window.electron.tags.getAll();
            setTags(allTags);
          } catch {
            // Tags might not be available
          }
        }
        for (const tag of tags) {
          if (fuzzyMatch(tag.name, searchQuery)) {
            searchResults.push({
              type: 'tag',
              id: tag.id,
              title: tag.name,
              subtitle: 'Tag',
              emoji: null,
              data: tag,
            });
          }
        }

        setResults(searchResults);
        setSelectedIndex(0);
      } finally {
        setIsLoading(false);
      }
    },
    [folders, tags],
  );

  useEffect(() => {
    const timer = setTimeout(() => search(query), 150);
    return () => clearTimeout(timer);
  }, [query, search]);

  const handleSelect = useCallback(
    (result: SearchResult) => {
      setQuickFindOpen(false);
      if (result.type === 'folder') {
        setSelectedFolder(result.id);
        loadItems(result.id);
        setActiveView('folder');
      } else if (result.type === 'item') {
        setSelectedItem(result.id);
        setActiveView('item');
      } else if (result.type === 'tag') {
        setActiveView('folder');
      }
    },
    [setQuickFindOpen, setSelectedFolder, loadItems, setActiveView, setSelectedItem],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        setQuickFindOpen(false);
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((prev) => Math.min(prev + 1, results.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((prev) => Math.max(prev - 1, 0));
      } else if (e.key === 'Enter' && results[selectedIndex]) {
        handleSelect(results[selectedIndex]);
      }
    },
    [results, selectedIndex, setQuickFindOpen, handleSelect],
  );

  useEffect(() => {
    if (listRef.current) {
      const selectedEl = listRef.current.children[selectedIndex] as HTMLElement;
      if (selectedEl) {
        selectedEl.scrollIntoView({ block: 'nearest' });
      }
    }
  }, [selectedIndex]);

  const sections = useMemo(() => {
    const foldersResult = results.filter((r) => r.type === 'folder');
    const itemsResult = results.filter((r) => r.type === 'item');
    const tagsResult = results.filter((r) => r.type === 'tag');
    return { folders: foldersResult, items: itemsResult, tags: tagsResult };
  }, [results]);

  return (
    <Modal
      isOpen={quickFindOpen}
      onClose={() => setQuickFindOpen(false)}
      position="top"
      className="max-w-xl"
      ariaLabel="Quick Find"
    >
      <div onKeyDown={handleKeyDown}>
        {/* Search input */}
        <div className="flex items-center border-b border-surface-200 dark:border-surface-700">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="ml-5 h-5 w-5 shrink-0 text-surface-400 dark:text-surface-500"
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
            className="notion-quick-find-input"
            placeholder="Search folders, items, tags..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          {isLoading && (
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="mr-5 h-5 w-5 shrink-0 animate-spin text-surface-400 dark:text-surface-500"
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
          )}
        </div>

        {/* Results */}
        <div ref={listRef} className="notion-scrollbar max-h-[400px] overflow-y-auto">
          {results.length === 0 && query.trim() && !isLoading && (
            <div className="px-5 py-8 text-center">
              <p className="text-sm text-surface-500 dark:text-surface-400">
                No results found for "{query}"
              </p>
            </div>
          )}

          {results.length === 0 && !query.trim() && (
            <div className="px-5 py-8 text-center">
              <p className="text-sm text-surface-500 dark:text-surface-400">
                Type to search across folders, items, and tags...
              </p>
              <div className="mt-4 flex items-center justify-center gap-4 text-xs text-surface-400 dark:text-surface-500">
                <span className="flex items-center gap-1">
                  <kbd className="rounded bg-surface-100 px-1.5 py-0.5 font-mono dark:bg-surface-800">
                    ↑↓
                  </kbd>
                  Navigate
                </span>
                <span className="flex items-center gap-1">
                  <kbd className="rounded bg-surface-100 px-1.5 py-0.5 font-mono dark:bg-surface-800">
                    ↵
                  </kbd>
                  Select
                </span>
                <span className="flex items-center gap-1">
                  <kbd className="rounded bg-surface-100 px-1.5 py-0.5 font-mono dark:bg-surface-800">
                    Esc
                  </kbd>
                  Close
                </span>
              </div>
            </div>
          )}

          {/* Folders section */}
          {sections.folders.length > 0 && (
            <div>
              <div className="px-5 py-2 text-xs font-medium uppercase tracking-wider text-surface-400 dark:text-surface-500">
                Folders
              </div>
              {sections.folders.map((result) => {
                const globalIndex = results.indexOf(result);
                return (
                  <button
                    key={`folder-${result.id}`}
                    className={`flex w-full items-center gap-3 px-5 py-2.5 text-left transition-colors ${
                      globalIndex === selectedIndex
                        ? 'bg-accent-50 dark:bg-accent-900/20'
                        : 'hover:bg-surface-50 dark:hover:bg-surface-800/50'
                    }`}
                    onClick={() => handleSelect(result)}
                    onMouseEnter={() => setSelectedIndex(globalIndex)}
                  >
                    <span className="shrink-0 text-lg">{result.emoji || '📁'}</span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-surface-800 dark:text-surface-200">
                        {highlightFuzzy(result.title, query)}
                      </p>
                      <p className="text-xs text-surface-500 dark:text-surface-400">
                        {result.subtitle}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {/* Items section */}
          {sections.items.length > 0 && (
            <div>
              <div className="px-5 py-2 text-xs font-medium uppercase tracking-wider text-surface-400 dark:text-surface-500">
                Items
              </div>
              {sections.items.map((result) => {
                const globalIndex = results.indexOf(result);
                return (
                  <button
                    key={`item-${result.id}`}
                    className={`flex w-full items-center gap-3 px-5 py-2.5 text-left transition-colors ${
                      globalIndex === selectedIndex
                        ? 'bg-accent-50 dark:bg-accent-900/20'
                        : 'hover:bg-surface-50 dark:hover:bg-surface-800/50'
                    }`}
                    onClick={() => handleSelect(result)}
                    onMouseEnter={() => setSelectedIndex(globalIndex)}
                  >
                    <span className="shrink-0 text-lg">{result.emoji || '🔑'}</span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-surface-800 dark:text-surface-200">
                        {highlightFuzzy(result.title, query)}
                      </p>
                      <p className="truncate text-xs text-surface-500 dark:text-surface-400">
                        {highlightFuzzy(result.subtitle, query)}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {/* Tags section */}
          {sections.tags.length > 0 && (
            <div>
              <div className="px-5 py-2 text-xs font-medium uppercase tracking-wider text-surface-400 dark:text-surface-500">
                Tags
              </div>
              {sections.tags.map((result) => {
                const globalIndex = results.indexOf(result);
                const tag = result.data as Tag;
                return (
                  <button
                    key={`tag-${result.id}`}
                    className={`flex w-full items-center gap-3 px-5 py-2.5 text-left transition-colors ${
                      globalIndex === selectedIndex
                        ? 'bg-accent-50 dark:bg-accent-900/20'
                        : 'hover:bg-surface-50 dark:hover:bg-surface-800/50'
                    }`}
                    onClick={() => handleSelect(result)}
                    onMouseEnter={() => setSelectedIndex(globalIndex)}
                  >
                    <span
                      className="h-3 w-3 shrink-0 rounded-full"
                      style={{ backgroundColor: tag.color || '#6366f1' }}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-surface-800 dark:text-surface-200">
                        {highlightFuzzy(result.title, query)}
                      </p>
                      <p className="text-xs text-surface-500 dark:text-surface-400">
                        {result.subtitle}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer hint */}
        <div className="flex items-center justify-between border-t border-surface-200 px-5 py-2.5 text-xs text-surface-400 dark:border-surface-700 dark:text-surface-500">
          <span>
            {results.length} result{results.length !== 1 ? 's' : ''}
          </span>
          <span className="flex items-center gap-3">
            <span className="flex items-center gap-1">
              <kbd className="rounded bg-surface-100 px-1 py-0.5 font-mono dark:bg-surface-800">
                ↑↓
              </kbd>
              Navigate
            </span>
            <span className="flex items-center gap-1">
              <kbd className="rounded bg-surface-100 px-1 py-0.5 font-mono dark:bg-surface-800">
                ↵
              </kbd>
              Open
            </span>
          </span>
        </div>
      </div>
    </Modal>
  );
}
