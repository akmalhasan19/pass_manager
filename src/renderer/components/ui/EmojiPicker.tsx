import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Picker, { EmojiClickData, EmojiStyle, Theme } from 'emoji-picker-react';

const RECENT_EMOJIS_KEY = 'securepass_recent_emojis';
const MAX_RECENT_EMOJIS = 12;

export type EmojiPickerPlacement = 'bottom-start' | 'bottom-end' | 'top-start' | 'top-end';

export interface EmojiPickerProps {
  /** Currently selected emoji. */
  value?: string | null;
  /** Called when the user selects an emoji. */
  onChange: (emoji: string) => void;
  /** Optional trigger element. When omitted, a button showing the current emoji is rendered. */
  children?: React.ReactNode;
  /** Popover placement relative to the trigger. */
  placement?: EmojiPickerPlacement;
  /** Controlled open state. */
  open?: boolean;
  /** Callback when open state changes (controlled mode). */
  onOpenChange?: (open: boolean) => void;
  /** Emoji shown when no value is provided. */
  defaultEmoji?: string;
  /** Additional classes for the trigger button (when children are not provided). */
  triggerClassName?: string;
  /** Accessible label for the trigger button. */
  ariaLabel?: string;
}

function loadRecentEmojis(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_EMOJIS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.filter((e) => typeof e === 'string' && e.length > 0);
    }
  } catch {
    // Ignore localStorage parse errors
  }
  return [];
}

function saveRecentEmojis(emojis: string[]): void {
  try {
    localStorage.setItem(RECENT_EMOJIS_KEY, JSON.stringify(emojis.slice(0, MAX_RECENT_EMOJIS)));
  } catch {
    // Ignore localStorage write errors (e.g. private mode)
  }
}

function addRecentEmoji(emoji: string): string[] {
  const current = loadRecentEmojis();
  const next = [emoji, ...current.filter((e) => e !== emoji)];
  const limited = next.slice(0, MAX_RECENT_EMOJIS);
  saveRecentEmojis(limited);
  return limited;
}

function placementClasses(placement: EmojiPickerPlacement): string {
  switch (placement) {
    case 'bottom-start':
      return 'top-full left-0 mt-2';
    case 'bottom-end':
      return 'top-full right-0 mt-2';
    case 'top-start':
      return 'bottom-full left-0 mb-2';
    case 'top-end':
      return 'bottom-full right-0 mb-2';
    default:
      return 'top-full left-0 mt-2';
  }
}

/**
 * Notion-style emoji picker popover.
 *
 * Wraps `emoji-picker-react` with a custom "recently used" section, dark-mode
 * awareness, and a focus-managed, accessible popover.
 */
export default function EmojiPicker({
  value,
  onChange,
  children,
  placement = 'bottom-start',
  open: controlledOpen,
  onOpenChange,
  defaultEmoji = '🔑',
  triggerClassName = '',
  ariaLabel = 'Choose emoji',
}: EmojiPickerProps): React.ReactElement {
  const isControlled = controlledOpen !== undefined;
  const [internalOpen, setInternalOpen] = useState(false);
  const open = isControlled ? controlledOpen : internalOpen;
  const setOpen = useCallback(
    (next: boolean) => {
      if (!isControlled) setInternalOpen(next);
      onOpenChange?.(next);
    },
    [isControlled, onOpenChange],
  );

  const [recentEmojis, setRecentEmojis] = useState<string[]>([]);
  const [isDark, setIsDark] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    setRecentEmojis(loadRecentEmojis());
  }, []);

  useEffect(() => {
    // Detect dark mode using Tailwind's `dark` class strategy.
    const html = document.documentElement;
    const updateTheme = () => setIsDark(html.classList.contains('dark'));
    updateTheme();

    const observer = new MutationObserver(updateTheme);
    observer.observe(html, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  // Close popover on click outside or Escape key.
  useEffect(() => {
    if (!open) return;

    const handleClick = (event: MouseEvent) => {
      const target = event.target as Node;
      if (containerRef.current && !containerRef.current.contains(target)) {
        setOpen(false);
      }
    };

    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };

    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [open, setOpen]);

  const handleEmojiClick = useCallback(
    (emojiData: EmojiClickData) => {
      const emoji = emojiData.emoji;
      addRecentEmoji(emoji);
      setRecentEmojis(loadRecentEmojis());
      onChange(emoji);
      setOpen(false);
    },
    [onChange, setOpen],
  );

  const handleRecentClick = useCallback(
    (emoji: string) => {
      addRecentEmoji(emoji);
      setRecentEmojis(loadRecentEmojis());
      onChange(emoji);
      setOpen(false);
    },
    [onChange, setOpen],
  );

  const displayEmoji = value || defaultEmoji;

  const pickerTheme = useMemo(() => {
    return isDark ? Theme.DARK : Theme.LIGHT;
  }, [isDark]);

  return (
    <div ref={containerRef} className="relative inline-flex">
      {children ? (
        <button
          ref={triggerRef}
          type="button"
          className="inline-flex items-center justify-center"
          onClick={() => setOpen(!open)}
          aria-label={ariaLabel}
          aria-haspopup="dialog"
          aria-expanded={open}
        >
          {children}
        </button>
      ) : (
        <button
          ref={triggerRef}
          type="button"
          className={`inline-flex items-center justify-center rounded-lg bg-surface-100 text-2xl transition-colors hover:bg-surface-200 dark:bg-surface-800 dark:hover:bg-surface-750 ${triggerClassName}`}
          onClick={() => setOpen(!open)}
          aria-label={ariaLabel}
          aria-haspopup="dialog"
          aria-expanded={open}
        >
          {displayEmoji}
        </button>
      )}

      {open && (
        <div
          className={`absolute z-50 w-[320px] rounded-xl border border-surface-200 bg-white shadow-xl dark:border-surface-700 dark:bg-surface-850 ${placementClasses(placement)}`}
          role="dialog"
          aria-label="Emoji picker"
          style={{ animation: 'fadeIn 0.12s ease-out' }}
        >
          {/* Recently used section */}
          {recentEmojis.length > 0 && (
            <div className="border-b border-surface-200 px-3 py-2 dark:border-surface-700">
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-surface-400 dark:text-surface-500">
                Recently used
              </p>
              <div className="flex flex-wrap gap-1">
                {recentEmojis.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    className={`flex h-8 w-8 items-center justify-center rounded-md text-lg transition-colors hover:bg-surface-100 dark:hover:bg-surface-700 ${
                      value === emoji
                        ? 'bg-accent-100 ring-1 ring-accent-400 dark:bg-accent-900/30'
                        : ''
                    }`}
                    onClick={() => handleRecentClick(emoji)}
                    aria-label={`Select ${emoji}`}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Emoji picker */}
          <div className="emoji-picker-wrapper p-2">
            <Picker
              onEmojiClick={handleEmojiClick}
              autoFocusSearch
              theme={pickerTheme}
              width="100%"
              height={320}
              previewConfig={{ showPreview: false }}
              searchPlaceholder="Search emojis..."
              lazyLoadEmojis
              emojiStyle={EmojiStyle.NATIVE}
            />
          </div>
        </div>
      )}
    </div>
  );
}
