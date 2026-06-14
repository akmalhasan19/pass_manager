import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Editor } from '@tiptap/core';

export interface Command {
  label: string;
  description: string;
  icon: React.ReactNode;
  execute: (editor: Editor) => void;
}

interface SlashCommandMenuProps {
  editor: Editor | null;
  query: string;
  position: { top: number; left: number } | null;
  isOpen: boolean;
  onClose: () => void;
  onExecute?: (cmd: Command) => void;
}

const COMMANDS: Command[] = [
  {
    label: 'Heading 1',
    description: 'Large section heading',
    icon: <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h8m-8 6h16" />,
    execute: (editor) => editor.chain().focus().toggleHeading({ level: 1 }).run(),
  },
  {
    label: 'Heading 2',
    description: 'Medium section heading',
    icon: <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h12m-12 6h16" />,
    execute: (editor) => editor.chain().focus().toggleHeading({ level: 2 }).run(),
  },
  {
    label: 'Bullet List',
    description: 'Simple bullet list',
    icon: <path strokeLinecap="round" strokeLinejoin="round" d="M8 9h8M8 13h6m-2 4H8" />,
    execute: (editor) => editor.chain().focus().toggleBulletList().run(),
  },
  {
    label: 'Numbered List',
    description: 'List with numbering',
    icon: (
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M7 8h8M7 12h8m-8 4h8M4 6h.01M4 10h.01M4 14h.01"
      />
    ),
    execute: (editor) => editor.chain().focus().toggleOrderedList().run(),
  },
  {
    label: 'Code Block',
    description: 'Code snippet with syntax',
    icon: <path strokeLinecap="round" strokeLinejoin="round" d="M8 9l3 3-3 3m5 0l-3-3 3-3" />,
    execute: (editor) => editor.chain().focus().toggleCodeBlock().run(),
  },
  {
    label: 'Blockquote',
    description: 'Capture a quote',
    icon: (
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M8 14v3m4-3v3m4-3v3M3 21h18M3 10h18M3 3h18"
      />
    ),
    execute: (editor) => editor.chain().focus().toggleBlockquote().run(),
  },
  {
    label: 'Divider',
    description: 'Visually divide sections',
    icon: <path strokeLinecap="round" strokeLinejoin="round" d="M4 12h16" />,
    execute: (editor) => editor.chain().focus().setHorizontalRule().run(),
  },
  {
    label: 'Checkbox',
    description: 'Trackable to-do item',
    icon: (
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"
      />
    ),
    execute: (editor) => editor.chain().focus().toggleTaskList().run(),
  },
];

export default function SlashCommandMenu({
  editor,
  query,
  position,
  isOpen,
  onClose,
  onExecute,
}: SlashCommandMenuProps): React.ReactElement | null {
  const [activeIndex, setActiveIndex] = useState(0);
  const menuRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    if (!query) return COMMANDS;
    const lower = query.toLowerCase();
    return COMMANDS.filter((c) => c.label.toLowerCase().includes(lower));
  }, [query]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIndex((prev) => (prev + 1) % filtered.length);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIndex((prev) => (prev - 1 + filtered.length) % filtered.length);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (filtered[activeIndex]) {
          if (onExecute) {
            onExecute(filtered[activeIndex]);
          } else if (editor) {
            filtered[activeIndex].execute(editor);
          }
          onClose();
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [isOpen, filtered, activeIndex, editor, onClose, onExecute]);

  useEffect(() => {
    if (!isOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [isOpen, onClose]);

  const handleSelect = useCallback(
    (index: number) => {
      if (filtered[index]) {
        if (onExecute) {
          onExecute(filtered[index]);
        } else if (editor) {
          filtered[index].execute(editor);
        }
        onClose();
      }
    },
    [editor, filtered, onClose, onExecute],
  );

  if (!isOpen || !position || filtered.length === 0) return null;

  return (
    <div
      ref={menuRef}
      className="fixed z-50 w-64 overflow-hidden rounded-lg border border-surface-200 bg-white py-1 shadow-2xl dark:border-surface-700 dark:bg-surface-850"
      style={{
        top: position.top,
        left: position.left,
        animation: 'fadeIn 0.1s ease-out',
      }}
    >
      <div className="border-b border-surface-100 px-3 py-1.5 text-[11px] font-medium uppercase tracking-wider text-surface-400 dark:border-surface-800 dark:text-surface-500">
        Basic blocks
      </div>
      <div className="notion-scrollbar max-h-64 overflow-y-auto">
        {filtered.map((cmd, i) => (
          <button
            key={cmd.label}
            className={`flex w-full items-center gap-3 px-3 py-2 text-left transition-colors ${
              i === activeIndex
                ? 'bg-accent-50 dark:bg-accent-900/20'
                : 'hover:bg-surface-100 dark:hover:bg-surface-800'
            }`}
            onClick={() => handleSelect(i)}
            onMouseEnter={() => setActiveIndex(i)}
          >
            <div
              className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md ${
                i === activeIndex
                  ? 'bg-accent-100 text-accent-700 dark:bg-accent-900/40 dark:text-accent-300'
                  : 'bg-surface-100 text-surface-500 dark:bg-surface-800 dark:text-surface-400'
              }`}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-4 w-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                {cmd.icon}
              </svg>
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium text-surface-700 dark:text-surface-200">
                {cmd.label}
              </div>
              <div className="truncate text-xs text-surface-400 dark:text-surface-500">
                {cmd.description}
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
