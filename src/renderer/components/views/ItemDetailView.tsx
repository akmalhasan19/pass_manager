import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import type { ItemDecrypted, Tag, Attachment } from '../../../shared/types';
import PasswordGenerator from '../widgets/PasswordGenerator';
import RichTextEditor from '../editor/RichTextEditor';
import EmojiPicker from '../ui/EmojiPicker';
import CoverImage from '../ui/CoverImage';
import ConfirmDialog from '../ui/ConfirmDialog';
import { useToast } from '../../hooks/useToast';

interface ItemDetailViewProps {
  item: ItemDecrypted | null;
  isLoading?: boolean;
  onUpdate: (id: string, fields: Record<string, unknown>) => Promise<void>;
  onDelete: (id: string) => void;
  onBack: () => void;
  allTags: Tag[];
  onCreateTag: (name: string, color?: string) => Promise<Tag | null>;
  onAttachTag: (itemId: string, tagId: string) => Promise<void>;
  onDetachTag: (itemId: string, tagId: string) => Promise<void>;
  onFileAttach: (itemId: string) => Promise<void>;
  onFileDownload: (attachmentId: string) => Promise<void>;
  onFileDelete: (attachmentId: string) => Promise<void>;
  onDuplicate?: (id: string) => void;
}

function formatDate(ts: number): string {
  if (!ts) return '-';
  const d = new Date(ts);
  return d.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const PASSWORD_COLORS: Record<string, string> = {
  '#ef4444': 'danger-500',
  '#f59e0b': 'warning-500',
  '#22c55e': 'success-500',
  '#6366f1': 'accent-500',
  '#8b5cf6': 'purple-500',
  '#06b6d4': 'cyan-500',
  '#ec4899': 'pink-500',
};

const TAG_COLORS = ['#ef4444', '#f59e0b', '#22c55e', '#6366f1', '#8b5cf6', '#06b6d4', '#ec4899'];

export default function ItemDetailView({
  item,
  isLoading,
  onUpdate,
  onDelete,
  onBack,
  allTags,
  onCreateTag,
  onAttachTag,
  onDetachTag,
  onFileAttach,
  onFileDownload,
  onFileDelete,
  onDuplicate,
}: ItemDetailViewProps): React.ReactElement {
  const [title, setTitle] = useState(item?.title || '');
  const [username, setUsername] = useState(item?.username || '');
  const [password, setPassword] = useState(item?.password || '');
  const [url, setUrl] = useState(item?.url || '');
  const [showPassword, setShowPassword] = useState(false);
  const [notes, setNotes] = useState(item?.notes || '');
  const [emoji, setEmoji] = useState(item?.emoji || '');
  const [coverImage, setCoverImage] = useState(item?.coverImage || '');
  const [isTagDropdownOpen, setIsTagDropdownOpen] = useState(false);
  const [newTagName, setNewTagName] = useState('');
  const [isCreatingTag, setIsCreatingTag] = useState(false);
  const [dirtyFields, setDirtyFields] = useState<Set<string>>(new Set());
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [isLoadingAttachments, setIsLoadingAttachments] = useState(false);
  const [passwordGeneratorOpen, setPasswordGeneratorOpen] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const { showSuccess } = useToast();
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tagDropdownRef = useRef<HTMLDivElement>(null);

  const itemTags = useMemo(() => {
    if (!item?.tags) return [];
    return item.tags;
  }, [item?.tags]);

  useEffect(() => {
    if (!item) return;
    setTitle(item.title);
    setUsername(item.username || '');
    setPassword(item.password || '');
    setUrl(item.url || '');
    setNotes(item.notes || '');
    setEmoji(item.emoji || '');
    setCoverImage(item.coverImage || '');
    setShowPassword(false);
    setDirtyFields(new Set());
  }, [item?.id]);

  useEffect(() => {
    if (!item) return;
    setIsLoadingAttachments(true);
    window.electron.files.getByItem(item.id)
      .then((result) => {
        setAttachments(result || []);
      })
      .catch(() => {
        setAttachments([]);
      })
      .finally(() => {
        setIsLoadingAttachments(false);
      });
  }, [item?.id]);

  useEffect(() => {
    if (!isTagDropdownOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (tagDropdownRef.current && !tagDropdownRef.current.contains(e.target as Node)) {
        setIsTagDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [isTagDropdownOpen]);

  const markDirty = useCallback((field: string) => {
    setDirtyFields((prev) => new Set(prev).add(field));
  }, []);

  const scheduleAutoSave = useCallback(
    (field: string, value: unknown) => {
      if (!item) return;
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        onUpdate(item.id, { [field]: value });
        setDirtyFields((prev) => {
          const next = new Set(prev);
          next.delete(field);
          return next;
        });
      }, 800);
    },
    [item, onUpdate],
  );

  const handleFieldChange = useCallback(
    (field: string, value: unknown, setter: (v: any) => void) => {
      setter(value);
      markDirty(field);
      scheduleAutoSave(field, value);
    },
    [markDirty, scheduleAutoSave],
  );

  const handleBlur = useCallback(
    (field: string, value: unknown) => {
      if (!item) return;
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      onUpdate(item.id, { [field]: value });
      setDirtyFields((prev) => {
        const next = new Set(prev);
        next.delete(field);
        return next;
      });
    },
    [item, onUpdate],
  );

  const handleCopy = useCallback(async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      showSuccess(label);
    } catch {
      // Clipboard not available
    }
  }, [showSuccess]);

  const handleEmojiSelect = useCallback(
    (selectedEmoji: string) => {
      setEmoji(selectedEmoji);
      markDirty('emoji');
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      if (item) {
        onUpdate(item.id, { emoji: selectedEmoji });
      }
    },
    [item, markDirty, onUpdate],
  );

  const handleTagToggle = useCallback(
    async (tagId: string) => {
      if (!item) return;
      const isAttached = itemTags.some((t) => t.id === tagId);
      if (isAttached) {
        await onDetachTag(item.id, tagId);
      } else {
        await onAttachTag(item.id, tagId);
      }
    },
    [item, itemTags, onDetachTag, onAttachTag],
  );

  const handleCreateTag = useCallback(async () => {
    const name = newTagName.trim();
    if (!name) return;
    const color = TAG_COLORS[Math.floor(Math.random() * TAG_COLORS.length)];
    const tag = await onCreateTag(name, color);
    if (tag && item) {
      await onAttachTag(item.id, tag.id);
    }
    setNewTagName('');
    setIsCreatingTag(false);
  }, [newTagName, item, onCreateTag, onAttachTag]);

  const handleFileAttachClick = useCallback(async () => {
    if (!item) return;
    await onFileAttach(item.id);
    const result = await window.electron.files.getByItem(item.id);
    setAttachments(result || []);
  }, [item, onFileAttach]);

  const handleFileDeleteClick = useCallback(
    async (attachmentId: string) => {
      await onFileDelete(attachmentId);
      setAttachments((prev) => prev.filter((a) => a.id !== attachmentId));
    },
    [onFileDelete],
  );

  const getStrengthLabel = useCallback((pw: string): { label: string; color: string; score: number } => {
    if (!pw) return { label: 'Empty', color: 'bg-surface-300', score: 0 };
    let score = 0;
    if (pw.length >= 8) score++;
    if (pw.length >= 12) score++;
    if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score++;
    if (/\d/.test(pw)) score++;
    if (/[^a-zA-Z0-9]/.test(pw)) score++;
    if (pw.length >= 20) score++;
    const labels = ['Weak', 'Fair', 'Good', 'Strong', 'Very Strong'];
    const colors = ['bg-danger-500', 'bg-warning-500', 'bg-warning-400', 'bg-success-400', 'bg-success-500'];
    const idx = Math.min(score, 4);
    return { label: labels[idx], color: colors[idx], score };
  }, []);

  const strength = useMemo(() => getStrengthLabel(password), [password, getStrengthLabel]);

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

  if (!item) {
    return (
      <div className="notion-empty-state h-full">
        <div className="notion-empty-state-icon">🔑</div>
        <p className="notion-empty-state-title">Select an item</p>
        <p className="notion-empty-state-description">
          Choose a password entry from the folder view to see its details.
        </p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-accent-500 border-t-transparent" />
          <p className="text-sm text-surface-400">Loading...</p>
        </div>
      </div>
    );
  }

  const availableTags = allTags.filter((t) => !itemTags.some((it) => it.id === t.id));

  return (
    <div className="h-full overflow-y-auto notion-scrollbar">
      <div className="max-w-3xl mx-auto px-6 py-6 space-y-6">
        {/* Back button */}
        <button
          className="notion-button-ghost h-8 text-xs gap-1.5"
          onClick={onBack}
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          Back
        </button>

        {/* 5.2.1 Cover image */}
        <CoverImage
          coverImage={coverImage || null}
          onChange={(value) => {
            setCoverImage(value ?? '');
            markDirty('coverImage');
            if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
            if (item) {
              onUpdate(item.id, { coverImage: value ?? '' });
            }
          }}
          ratio="banner"
        />

        {/* 5.2.2 Emoji + Title area */}
        <div className="flex items-start gap-3">
          {/* Emoji */}
          <div className="relative shrink-0">
            <EmojiPicker
              value={emoji}
              defaultEmoji="🔑"
              onChange={handleEmojiSelect}
              placement="bottom-start"
              ariaLabel="Change item emoji"
              triggerClassName="h-14 w-14 text-3xl"
            />
          </div>

          {/* Title */}
          <div className="flex-1 min-w-0">
            <input
              className={`w-full border-0 bg-transparent text-2xl font-bold text-surface-900 dark:text-surface-50 placeholder:text-surface-300 dark:placeholder:text-surface-600 focus:outline-none focus:ring-0 ${
                dirtyFields.has('title') ? 'border-b-2 border-accent-400' : ''
              }`}
              placeholder="Untitled"
              value={title}
              onChange={(e) => handleFieldChange('title', e.target.value, setTitle)}
              onBlur={() => handleBlur('title', title)}
            />
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-1 shrink-0">
            <button
              className="notion-button-ghost h-8 w-8 p-0"
              onClick={() => {
                if (item) {
                  onUpdate(item.id, { isFavorite: !item.isFavorite });
                }
              }}
              aria-label={item.isFavorite ? 'Remove from favorites' : 'Add to favorites'}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className={`h-4 w-4 ${item.isFavorite ? 'text-yellow-500' : 'text-surface-400'}`}
                fill={item.isFavorite ? 'currentColor' : 'none'}
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
              </svg>
            </button>
            {onDuplicate && (
              <button
                className="notion-button-ghost h-8 w-8 p-0"
                onClick={() => onDuplicate(item.id)}
                aria-label="Duplicate item"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
              </button>
            )}
            <button
              className="notion-button-ghost h-8 w-8 p-0 text-danger-500 hover:bg-danger-50 dark:hover:bg-danger-500/10"
              onClick={() => setShowDeleteConfirm(true)}
              aria-label="Delete item"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>
          </div>
        </div>

        {/* 5.2.4 Username */}
        <div className="notion-detail-field">
          <label className="notion-detail-label">Username</label>
          <div className="notion-detail-value">
            <input
              className="flex-1 min-w-0 bg-transparent border-0 p-0 text-sm focus:outline-none focus:ring-0 text-surface-800 dark:text-surface-200 placeholder:text-surface-400"
              placeholder="username@example.com"
              value={username}
              onChange={(e) => handleFieldChange('username', e.target.value, setUsername)}
              onBlur={() => handleBlur('username', username)}
            />
            {username && (
              <button
                className="shrink-0 text-surface-400 hover:text-surface-600 dark:hover:text-surface-300 transition-colors"
                onClick={() => handleCopy(username, 'Username copied')}
                aria-label="Copy username"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
              </button>
            )}
          </div>
        </div>

        {/* 5.2.5 Password with strength */}
        <div className="notion-detail-field">
          <label className="notion-detail-label">Password</label>
          <div className="notion-detail-value">
            <div className="flex-1 min-w-0 flex items-center gap-2">
              <input
                className="flex-1 min-w-0 bg-transparent border-0 p-0 text-sm focus:outline-none focus:ring-0 text-surface-800 dark:text-surface-200 placeholder:text-surface-400 font-mono"
                type={showPassword ? 'text' : 'password'}
                placeholder="Enter password"
                value={password}
                onChange={(e) => handleFieldChange('password', e.target.value, setPassword)}
                onBlur={() => handleBlur('password', password)}
              />
              <div className="flex items-center gap-1 shrink-0">
                <button
                  className="text-surface-400 hover:text-accent-600 dark:hover:text-accent-400 transition-colors"
                  onClick={() => setPasswordGeneratorOpen(true)}
                  aria-label="Generate password"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
                  </svg>
                </button>
                <button
                  className="text-surface-400 hover:text-surface-600 dark:hover:text-surface-300 transition-colors"
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? (
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                    </svg>
                  ) : (
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                    </svg>
                  )}
                </button>
                {password && (
                  <button
                    className="text-surface-400 hover:text-surface-600 dark:hover:text-surface-300 transition-colors"
                    onClick={() => handleCopy(password, 'Password copied')}
                    aria-label="Copy password"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                  </button>
                )}
              </div>
            </div>
          </div>
          {password && (
            <div className="mt-2 space-y-1.5">
              <div className="notion-progress-bar">
                <div
                  className={`notion-progress-fill ${strength.color}`}
                  style={{ width: `${((strength.score + 1) / 6) * 100}%` }}
                />
              </div>
              <p className={`text-xs font-medium ${
                strength.score < 2 ? 'text-danger-500' : strength.score < 3 ? 'text-warning-500' : 'text-success-500'
              }`}>
                {strength.label}
              </p>
            </div>
          )}
        </div>

        {/* 5.2.6 URL */}
        <div className="notion-detail-field">
          <label className="notion-detail-label">URL</label>
          <div className="notion-detail-value">
            <input
              className="flex-1 min-w-0 bg-transparent border-0 p-0 text-sm focus:outline-none focus:ring-0 text-surface-800 dark:text-surface-200 placeholder:text-surface-400"
              placeholder="https://example.com"
              value={url}
              onChange={(e) => handleFieldChange('url', e.target.value, setUrl)}
              onBlur={() => handleBlur('url', url)}
            />
            {url && (
              <div className="flex items-center gap-1 shrink-0">
                <button
                  className="text-surface-400 hover:text-surface-600 dark:hover:text-surface-300 transition-colors"
                  onClick={() => {
                    try {
                      const urlObj = new URL(url.startsWith('http') ? url : `https://${url}`);
                      window.open(urlObj.toString(), '_blank');
                    } catch {
                      // Invalid URL
                    }
                  }}
                  aria-label="Open in browser"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                  </svg>
                </button>
                <button
                  className="text-surface-400 hover:text-surface-600 dark:hover:text-surface-300 transition-colors"
                  onClick={() => handleCopy(url, 'URL copied')}
                  aria-label="Copy URL"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                </button>
              </div>
            )}
          </div>
        </div>

        {/* 5.2.7 Tags */}
        <div className="notion-detail-field">
          <label className="notion-detail-label">Tags</label>
          <div className="flex flex-wrap items-center gap-2">
            {itemTags.map((tag) => (
              <span
                key={tag.id}
                className="notion-tag-removable inline-flex items-center gap-1"
                style={{ backgroundColor: tag.color + '20', color: tag.color }}
              >
                {tag.name}
                <button
                  className="ml-0.5 hover:opacity-70"
                  onClick={() => handleTagToggle(tag.id)}
                  aria-label={`Remove tag ${tag.name}`}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </span>
            ))}

            {/* Tag dropdown trigger */}
            <div className="relative">
              <button
                className="notion-button-ghost h-7 text-xs gap-1"
                onClick={() => setIsTagDropdownOpen(!isTagDropdownOpen)}
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                </svg>
                Add tag
              </button>
              {isTagDropdownOpen && (
                <div
                  ref={tagDropdownRef}
                  className="absolute top-full left-0 mt-1 z-50 min-w-[200px] rounded-lg border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-800 shadow-lg py-1"
                  style={{ animation: 'fadeIn 0.1s ease-out' }}
                >
                  {isCreatingTag ? (
                    <div className="p-2">
                      <input
                        className="notion-input h-8 text-xs"
                        placeholder="Tag name..."
                        value={newTagName}
                        onChange={(e) => setNewTagName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleCreateTag();
                          if (e.key === 'Escape') {
                            setIsCreatingTag(false);
                            setNewTagName('');
                          }
                        }}
                        autoFocus
                      />
                      <div className="flex items-center gap-1 mt-1">
                        <button
                          className="notion-button-primary h-7 text-xs flex-1"
                          onClick={handleCreateTag}
                        >
                          Create
                        </button>
                        <button
                          className="notion-button-ghost h-7 text-xs"
                          onClick={() => {
                            setIsCreatingTag(false);
                            setNewTagName('');
                          }}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      {availableTags.length > 0 ? (
                        availableTags.map((tag) => (
                          <button
                            key={tag.id}
                            className="flex w-full items-center gap-2 px-3 py-1.5 text-sm text-surface-700 dark:text-surface-300 hover:bg-surface-100 dark:hover:bg-surface-700 transition-colors"
                            onClick={() => handleTagToggle(tag.id)}
                          >
                            <span
                              className="h-2.5 w-2.5 rounded-full shrink-0"
                              style={{ backgroundColor: tag.color }}
                            />
                            {tag.name}
                          </button>
                        ))
                      ) : (
                        <p className="px-3 py-2 text-xs text-surface-400">No tags available</p>
                      )}
                      <div className="my-1 h-px bg-surface-200 dark:bg-surface-700" />
                      <button
                        className="flex w-full items-center gap-2 px-3 py-1.5 text-sm text-surface-700 dark:text-surface-300 hover:bg-surface-100 dark:hover:bg-surface-700 transition-colors"
                        onClick={() => setIsCreatingTag(true)}
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                        </svg>
                        Create new tag
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* 5.2.8 Notes - Rich Text Editor (TipTap) */}
        <div className="notion-detail-field">
          <label className="notion-detail-label">Notes</label>
          <RichTextEditor
            content={notes}
            onChange={(json) => handleFieldChange('notes', json, setNotes)}
            placeholder="Add notes..."
          />
        </div>

        {/* 5.2.9 Attachments */}
        <div className="notion-detail-field">
          <div className="flex items-center justify-between">
            <label className="notion-detail-label">Attachments</label>
            <button
              className="notion-button-ghost h-7 text-xs gap-1"
              onClick={handleFileAttachClick}
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
              </svg>
              Attach file
            </button>
          </div>
          {isLoadingAttachments ? (
            <p className="text-xs text-surface-400 mt-1">Loading attachments...</p>
          ) : attachments.length > 0 ? (
            <div className="space-y-1 mt-2">
              {attachments.map((att) => (
                <div
                  key={att.id}
                  className="flex items-center gap-3 px-3 py-2 rounded-md border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-850"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-surface-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                  </svg>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-surface-700 dark:text-surface-300 truncate">{att.fileName}</p>
                    <p className="text-xs text-surface-400">{formatFileSize(att.fileSize)}</p>
                  </div>
                  <button
                    className="notion-button-ghost h-7 w-7 p-0"
                    onClick={() => onFileDownload(att.id)}
                    aria-label={`Download ${att.fileName}`}
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                  </button>
                  <button
                    className="notion-button-ghost h-7 w-7 p-0 text-danger-500 hover:bg-danger-50 dark:hover:bg-danger-500/10"
                    onClick={() => {
                      if (confirm(`Delete attachment "${att.fileName}"?`)) {
                        handleFileDeleteClick(att.id);
                      }
                    }}
                    aria-label={`Delete ${att.fileName}`}
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-surface-400 mt-1">No attachments yet.</p>
          )}
        </div>

        {/* 5.2.10 Metadata footer */}
        <div className="pt-4 border-t border-surface-200 dark:border-surface-700">
          <div className="grid grid-cols-3 gap-4 text-xs text-surface-400">
            <div>
              <span className="block font-medium uppercase tracking-wider mb-0.5">Created</span>
              <span>{formatDate(item.createdAt)}</span>
            </div>
            <div>
              <span className="block font-medium uppercase tracking-wider mb-0.5">Modified</span>
              <span>{formatDate(item.updatedAt)}</span>
            </div>
            <div>
              <span className="block font-medium uppercase tracking-wider mb-0.5">ID</span>
              <span className="font-mono text-[11px] break-all">{item.id}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Password Generator modal */}
      {passwordGeneratorOpen && (
        <PasswordGenerator
          onUsePassword={(pw) => {
            setPassword(pw);
            markDirty('password');
            if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
            if (item) {
              onUpdate(item.id, { password: pw });
            }
          }}
          onClose={() => setPasswordGeneratorOpen(false)}
        />
      )}

      <ConfirmDialog
        isOpen={showDeleteConfirm}
        title="Delete item"
        message="Are you sure you want to delete this item? It will be moved to trash."
        confirmLabel="Delete"
        variant="danger"
        onConfirm={() => {
          if (item) {
            onDelete(item.id);
            onBack();
          }
        }}
        onCancel={() => setShowDeleteConfirm(false)}
      />
    </div>
  );
}


