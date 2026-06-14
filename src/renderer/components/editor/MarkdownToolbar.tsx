import React, { useCallback } from 'react';
import type { Editor } from '@tiptap/core';

interface ToolbarButton {
  label: string;
  icon: React.ReactNode;
  action: () => void;
  isActive?: () => boolean;
  title: string;
}

interface ToolbarGroup {
  buttons: ToolbarButton[];
}

interface MarkdownToolbarProps {
  editor: Editor | null;
}

function btn(
  label: string,
  title: string,
  icon: React.ReactNode,
  action: () => void,
  isActive?: () => boolean,
): ToolbarButton {
  return { label, title, icon, action, isActive };
}

export default function MarkdownToolbar({ editor }: MarkdownToolbarProps): React.ReactElement {
  const handleLinkAdd = useCallback(() => {
    if (!editor) return;
    const previousUrl = editor.getAttributes('link').href as string;
    const url = window.prompt('Enter URL:', previousUrl || '');
    if (url === null) return;
    if (url === '') {
      editor.chain().focus().extendMarkRange('link').unsetLink().run();
    } else {
      editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
    }
  }, [editor]);

  if (!editor) {
    return <div className="h-10 border-b border-surface-200 dark:border-surface-700" />;
  }

  const groups: ToolbarGroup[] = [
    {
      buttons: [
        btn('Undo', 'Undo (Ctrl+Z)',
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 15L3 9m0 0l6-6M3 9h12a6 6 0 010 12h-3" />,
          () => editor.chain().focus().undo().run(),
          () => editor.can().undo(),
        ),
        btn('Redo', 'Redo (Ctrl+Y)',
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 15l6-6m0 0l-6-6m6 6H9a6 6 0 000 12h3" />,
          () => editor.chain().focus().redo().run(),
          () => editor.can().redo(),
        ),
      ],
    },
    {
      buttons: [
        btn('Bold', 'Bold (Ctrl+B)',
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 4h8a4 4 0 014 4 4 4 0 01-4 4H6z M6 12h9a4 4 0 014 4 4 4 0 01-4 4H6z" />,
          () => editor.chain().focus().toggleBold().run(),
          () => editor.isActive('bold'),
        ),
        btn('Italic', 'Italic (Ctrl+I)',
          <path strokeLinecap="round" strokeLinejoin="round" d="M10 4h2m0 0a4 4 0 014 4v8a4 4 0 01-4 4h-2m0-16L8 20" />,
          () => editor.chain().focus().toggleItalic().run(),
          () => editor.isActive('italic'),
        ),
        btn('Strike', 'Strikethrough',
          <path strokeLinecap="round" strokeLinejoin="round" d="M17.5 12H15m-3 0H6m6 0a3 3 0 01-3 3H6m9-3a3 3 0 00-3-3H6m4 0V4m0 16v-4" />,
          () => editor.chain().focus().toggleStrike().run(),
          () => editor.isActive('strike'),
        ),
        btn('Code', 'Inline code',
          <path strokeLinecap="round" strokeLinejoin="round" d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />,
          () => editor.chain().focus().toggleCode().run(),
          () => editor.isActive('code'),
        ),
        btn('Link', 'Add link',
          <path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />,
          handleLinkAdd,
          () => editor.isActive('link'),
        ),
      ],
    },
    {
      buttons: [
        btn('Heading 1', 'Heading 1',
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h8m-8 6h16" />,
          () => editor.chain().focus().toggleHeading({ level: 1 }).run(),
          () => editor.isActive('heading', { level: 1 }),
        ),
        btn('Heading 2', 'Heading 2',
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h12m-12 6h16" />,
          () => editor.chain().focus().toggleHeading({ level: 2 }).run(),
          () => editor.isActive('heading', { level: 2 }),
        ),
        btn('Heading 3', 'Heading 3',
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16m-16 6h16" />,
          () => editor.chain().focus().toggleHeading({ level: 3 }).run(),
          () => editor.isActive('heading', { level: 3 }),
        ),
      ],
    },
    {
      buttons: [
        btn('Bullet List', 'Bullet list',
          <path strokeLinecap="round" strokeLinejoin="round" d="M8 9h8M8 13h6m-2 4H8" />,
          () => editor.chain().focus().toggleBulletList().run(),
          () => editor.isActive('bulletList'),
        ),
        btn('Ordered List', 'Ordered list',
          <path strokeLinecap="round" strokeLinejoin="round" d="M7 8h8M7 12h8m-8 4h8M4 6h.01M4 10h.01M4 14h.01" />,
          () => editor.chain().focus().toggleOrderedList().run(),
          () => editor.isActive('orderedList'),
        ),
        btn('Task List', 'Task list',
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />,
          () => editor.chain().focus().toggleTaskList().run(),
          () => editor.isActive('taskList'),
        ),
      ],
    },
    {
      buttons: [
        btn('Blockquote', 'Blockquote',
          <path strokeLinecap="round" strokeLinejoin="round" d="M8 14v3m4-3v3m4-3v3M3 21h18M3 10h18M3 3h18" />,
          () => editor.chain().focus().toggleBlockquote().run(),
          () => editor.isActive('blockquote'),
        ),
        btn('Code Block', 'Code block',
          <path strokeLinecap="round" strokeLinejoin="round" d="M8 9l3 3-3 3m5 0l-3-3 3-3" />,
          () => editor.chain().focus().toggleCodeBlock().run(),
          () => editor.isActive('codeBlock'),
        ),
        btn('Divider', 'Horizontal rule',
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 12h16" />,
          () => editor.chain().focus().setHorizontalRule().run(),
        ),
      ],
    },
  ];

  return (
    <div className="border-b border-surface-200 dark:border-surface-700 flex items-center gap-0.5 px-2 py-1.5 overflow-x-auto flex-shrink-0 bg-surface-50 dark:bg-surface-850 rounded-t-md">
      {groups.map((group, gi) => (
        <React.Fragment key={gi}>
          {gi > 0 && (
            <div className="w-px h-5 bg-surface-200 dark:bg-surface-700 mx-1 shrink-0" />
          )}
          <div className="flex items-center gap-0.5">
            {group.buttons.map((b) => {
              const active = b.isActive ? b.isActive() : false;
              return (
                <button
                  key={b.label}
                  className={`shrink-0 h-7 w-7 flex items-center justify-center rounded text-xs transition-colors ${
                    active
                      ? 'bg-accent-100 dark:bg-accent-900/40 text-accent-700 dark:text-accent-300'
                      : 'text-surface-500 dark:text-surface-400 hover:bg-surface-200 dark:hover:bg-surface-700 hover:text-surface-700 dark:hover:text-surface-200'
                  }`}
                  title={b.title}
                  onClick={b.action}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    {b.icon}
                  </svg>
                </button>
              );
            })}
          </div>
        </React.Fragment>
      ))}
    </div>
  );
}
