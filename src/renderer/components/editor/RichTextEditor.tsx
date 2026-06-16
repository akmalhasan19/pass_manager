import { useCallback, useEffect, useRef, useState, useMemo } from 'react';
import { useEditor, EditorContent, BubbleMenu, FloatingMenu } from '@tiptap/react';
import type { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import LinkExtension from '@tiptap/extension-link';
import CodeBlock from '@tiptap/extension-code-block';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import { sanitizeRichText, sanitizeRichTextForPaste, MAX_RICH_TEXT_LENGTH } from '../../../shared/sanitizeRichText';
import MarkdownToolbar from './MarkdownToolbar';
import SlashCommandMenu from './SlashCommandMenu';
import type { Command } from './SlashCommandMenu';

export interface RichTextEditorProps {
  content: string | null;
  onChange: (html: string) => void;
  placeholder?: string;
  editable?: boolean;
}

export type PasteMode = 'rich' | 'plain';

function isInCodeBlock(editor: { isActive: (name: string) => boolean } | null): boolean {
  if (!editor) return true;
  return editor.isActive('codeBlock');
}

export default function RichTextEditor({
  content,
  onChange,
  placeholder,
  editable = true,
}: RichTextEditorProps): React.ReactElement {
  const [slashOpen, setSlashOpen] = useState(false);
  const [slashQuery, setSlashQuery] = useState('');
  const [slashPos, setSlashPos] = useState<{ top: number; left: number } | null>(null);
  const slashNodeRangeRef = useRef<{ from: number; to: number } | null>(null);

  const [pasteMode, setPasteMode] = useState<PasteMode>('rich');
  const pasteModeRef = useRef<PasteMode>('rich');
  pasteModeRef.current = pasteMode;

  const editorRef = useRef<Editor | null>(null);

  const togglePasteMode = useCallback(() => {
    setPasteMode((prev) => (prev === 'rich' ? 'plain' : 'rich'));
  }, []);

  const extensions = useMemo(
    () => [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        codeBlock: false,
      }),
      CodeBlock.configure({
        HTMLAttributes: {
          class: 'notion-code-block',
        },
      }),
      Placeholder.configure({
        placeholder: placeholder || "Type '/' for commands...",
      }),
      LinkExtension.configure({
        openOnClick: false,
        autolink: true,
        HTMLAttributes: {
          class: 'text-accent-600 dark:text-accent-400 underline cursor-pointer',
        },
      }),
      TaskList.configure({
        HTMLAttributes: {
          class: 'notion-task-list',
        },
      }),
      TaskItem.configure({
        HTMLAttributes: {
          class: 'notion-task-item',
        },
        nested: true,
      }),
    ],
    [placeholder],
  );

  const editor = useEditor({
    extensions,
    content: null,
    editable,
    onUpdate: ({ editor: ed }: { editor: Editor }) => {
      const html = ed.getHTML();
      if (html.length > MAX_RICH_TEXT_LENGTH) {
        const truncated = html.slice(0, MAX_RICH_TEXT_LENGTH);
        const sanitized = sanitizeRichText(truncated);
        onChange(sanitized);
        return;
      }
      const sanitized = sanitizeRichText(html);
      onChange(sanitized);
    },
    editorProps: {
      handlePaste: (_view, event) => {
        const clipboardData = event.clipboardData;
        if (!clipboardData) return false;

        const evt = event as unknown as {
          ctrlKey: boolean;
          shiftKey: boolean;
          altKey: boolean;
          metaKey: boolean;
          clipboardData: DataTransfer | null;
          preventDefault: () => void;
        };

        const isCtrlShiftV =
          (evt.ctrlKey || evt.metaKey) && evt.shiftKey &&
          !evt.altKey;
        const shouldPastePlain = isCtrlShiftV || pasteModeRef.current === 'plain';

        if (shouldPastePlain) {
          const plain = clipboardData.getData('text/plain');
          if (plain) {
            event.preventDefault();
            editorRef.current?.commands.insertContent(plain);
            return true;
          }
          return false;
        }

        const html = clipboardData.getData('text/html');
        if (html) {
          event.preventDefault();
          const sanitized = sanitizeRichTextForPaste(html);
          if (sanitized) {
            editorRef.current?.commands.insertContent(sanitized);
          }
          return true;
        }

        const plain = clipboardData.getData('text/plain');
        if (plain) {
          event.preventDefault();
          editorRef.current?.commands.insertContent(plain);
          return true;
        }

        return false;
      },
    },
  });

  editorRef.current = editor;

  useEffect(() => {
    if (!editor || !editable) return;
    const editorEl = editor.view.dom;
    const observer = new MutationObserver((mutations) => {
      let needsCleanup = false;
      for (const mutation of mutations) {
        for (const node of Array.from(mutation.addedNodes)) {
          if (node instanceof HTMLElement) {
            const tag = node.tagName.toLowerCase();
            if (
              tag.includes('grammarly') ||
              tag.includes('languagetool') ||
              tag.includes('ginger') ||
              tag.includes('prowritingaid')
            ) {
              needsCleanup = true;
              break;
            }
            const grAttrs = Array.from(node.attributes).some(
              (a) => /^data-gr-/i.test(a.name) || /^data-lt-/i.test(a.name) || /^gramm$/i.test(a.name),
            );
            if (grAttrs) {
              needsCleanup = true;
              break;
            }
          }
        }
        if (needsCleanup) break;
      }
      if (needsCleanup) {
        const html = editor.getHTML();
        const sanitized = sanitizeRichText(html);
        editor.commands.setContent(sanitized);
      }
    });
    observer.observe(editorEl, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-gr-cs-loaded', 'data-new-gr-cs-loaded', 'data-gr-id', 'data-lt-tmp-id', 'gramm'] });
    return () => observer.disconnect();
  }, [editor, editable]);

  useEffect(() => {
    if (!editor) return;
    if (editor.isDestroyed) return;

    const currentHtml = editor.getHTML();
    const currentSanitized = sanitizeRichText(currentHtml);
    if (content && currentSanitized === content) return;

    try {
      const truncated = content && content.length > MAX_RICH_TEXT_LENGTH
        ? content.slice(0, MAX_RICH_TEXT_LENGTH)
        : content;
      const sanitizedContent = truncated ? sanitizeRichText(truncated) : '';
      if (sanitizedContent) {
        editor.commands.setContent(sanitizedContent);
      } else {
        editor.commands.setContent('');
      }
    } catch {
      editor.commands.setContent('');
    }
  }, [editor, content]);

  useEffect(() => {
    if (!editor) return;
    editor.setEditable(editable);
  }, [editor, editable]);

  const closeSlash = useCallback(() => {
    setSlashOpen(false);
    setSlashQuery('');
    slashNodeRangeRef.current = null;
  }, []);

  useEffect(() => {
    if (!editor) return;

    const checkSlash = () => {
      if (isInCodeBlock(editor)) {
        if (slashOpen) closeSlash();
        return;
      }

      const { $from } = editor.state.selection;
      const node = $from.node();
      const text = node.textContent || '';

      if (text.startsWith('/') && node.type.name === 'paragraph') {
        const start = $from.start();
        const end = $from.end();
        slashNodeRangeRef.current = { from: start, to: end };
        setSlashQuery(text.slice(1));

        const coords = editor.view.coordsAtPos($from.pos);
        const editorEl = editor.view.dom.closest('.rich-text-editor-wrapper');
        if (editorEl) {
          const rect = editorEl.getBoundingClientRect();
          setSlashPos({
            top: coords.bottom - rect.top + 4,
            left: coords.left - rect.left,
          });
        } else {
          setSlashPos({ top: coords.bottom + 4, left: coords.left });
        }
        setSlashOpen(true);
      } else {
        if (slashOpen) closeSlash();
      }
    };

    editor.on('selectionUpdate', checkSlash);
    editor.on('update', checkSlash);

    return () => {
      editor.off('selectionUpdate', checkSlash);
      editor.off('update', checkSlash);
    };
  }, [editor, slashOpen, closeSlash]);

  const handleCommandExecute = useCallback(
    (cmd: Command) => {
      if (!editor) return;
      const range = slashNodeRangeRef.current;
      if (range && range.to > range.from) {
        editor.chain().focus().deleteRange(range).run();
      }
      cmd.execute(editor);
      closeSlash();
    },
    [editor, closeSlash],
  );

  if (!editor) {
    return (
      <div className="rounded-md border border-surface-200 bg-white dark:border-surface-700 dark:bg-surface-850">
        <div className="flex h-40 items-center justify-center text-sm text-surface-400">
          Loading editor...
        </div>
      </div>
    );
  }

  return (
    <div className="rich-text-editor-wrapper overflow-hidden rounded-md border border-surface-200 bg-white dark:border-surface-700 dark:bg-surface-850">
      {editable && (
        <MarkdownToolbar
          editor={editor}
          pasteMode={pasteMode}
          onTogglePasteMode={togglePasteMode}
        />
      )}

      <BubbleMenu
        editor={editor}
        tippyOptions={{ duration: 150, placement: 'top' }}
        className="flex items-center gap-0.5 rounded-lg border border-surface-200 bg-white px-1 py-1 shadow-lg dark:border-surface-700 dark:bg-surface-850"
      >
        <BubbleBtn
          active={editor.isActive('bold')}
          label="Bold"
          onClick={() => editor.chain().focus().toggleBold().run()}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M6 4h8a4 4 0 014 4 4 4 0 01-4 4H6z M6 12h9a4 4 0 014 4 4 4 0 01-4 4H6z"
          />
        </BubbleBtn>
        <BubbleBtn
          active={editor.isActive('italic')}
          label="Italic"
          onClick={() => editor.chain().focus().toggleItalic().run()}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M10 4h2m0 0a4 4 0 014 4v8a4 4 0 01-4 4h-2m0-16L8 20"
          />
        </BubbleBtn>
        <BubbleBtn
          active={editor.isActive('strike')}
          label="Strikethrough"
          onClick={() => editor.chain().focus().toggleStrike().run()}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M17.5 12H15m-3 0H6m6 0a3 3 0 01-3 3H6m9-3a3 3 0 00-3-3H6m4 0V4m0 16v-4"
          />
        </BubbleBtn>
        <BubbleBtn
          active={editor.isActive('code')}
          label="Code"
          onClick={() => editor.chain().focus().toggleCode().run()}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4"
          />
        </BubbleBtn>
        <div className="mx-0.5 h-4 w-px bg-surface-200 dark:bg-surface-700" />
        <BubbleBtn
          active={editor.isActive('link')}
          label="Link"
          onClick={() => {
            const prev = editor.getAttributes('link').href as string;
            const url = window.prompt('Enter URL:', prev || '');
            if (url === null) return;
            if (url === '') {
              editor.chain().focus().extendMarkRange('link').unsetLink().run();
            } else {
              editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
            }
          }}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"
          />
        </BubbleBtn>
      </BubbleMenu>

      {editable && (
        <FloatingMenu
          editor={editor}
          tippyOptions={{ duration: 150, placement: 'left' }}
          shouldShow={({ editor: ed }) => {
            if (ed.isActive('codeBlock')) return false;
            const { $from } = ed.state.selection;
            const node = $from.node();
            return node.type.name === 'paragraph' && node.content.size === 0;
          }}
          className="flex items-center"
        >
          <button
            className="flex h-6 w-6 items-center justify-center rounded-full border border-surface-200 bg-white text-surface-400 shadow-md transition-colors hover:border-surface-300 hover:text-surface-600 dark:border-surface-700 dark:bg-surface-850 dark:hover:border-surface-600 dark:hover:text-surface-300"
            onClick={() => {
              const { $from } = editor.state.selection;
              const coords = editor.view.coordsAtPos($from.pos);
              const editorEl = editor.view.dom.closest('.rich-text-editor-wrapper');
              if (editorEl) {
                const rect = editorEl.getBoundingClientRect();
                setSlashPos({ top: coords.bottom - rect.top + 4, left: coords.left - rect.left });
              } else {
                setSlashPos({ top: coords.bottom + 4, left: coords.left });
              }
              setSlashQuery('');
              setSlashOpen(true);
            }}
            aria-label="Insert block"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-3 w-3"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
          </button>
        </FloatingMenu>
      )}

      <div className="prose-editor notion-scrollbar max-h-[400px] min-h-[120px] overflow-y-auto px-4 py-3">
        <EditorContent editor={editor} />
      </div>

      <SlashCommandMenu
        editor={editor}
        query={slashQuery}
        position={slashPos}
        isOpen={slashOpen}
        onClose={closeSlash}
        onExecute={handleCommandExecute}
      />
    </div>
  );
}

function BubbleBtn({
  active,
  label,
  onClick,
  children,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      className={`flex h-7 w-7 items-center justify-center rounded transition-colors ${
        active
          ? 'bg-accent-100 text-accent-700 dark:bg-accent-900/40 dark:text-accent-300'
          : 'text-surface-500 hover:bg-surface-100 dark:text-surface-400 dark:hover:bg-surface-800'
      }`}
      title={label}
      onClick={onClick}
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        className="h-3.5 w-3.5"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2}
      >
        {children}
      </svg>
    </button>
  );
}
