import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import type { ItemDecrypted, Tag, Attachment, TotpConfig } from '../../../shared/types';
import { MAX_FIELD_LENGTHS } from '../../../shared/constants';
import { validateField as validateFieldUtil, sanitizeField } from '../../../shared/validation';
import PasswordGenerator from '../widgets/PasswordGenerator';
import RichTextEditor from '../editor/RichTextEditor';
import EmojiPicker from '../ui/EmojiPicker';
import CoverImage from '../ui/CoverImage';
import ConfirmDialog from '../ui/ConfirmDialog';
import { InlineFormField } from '../ui/FormField';
import OtpSection from '../otp/OtpSection';
import { useToast } from '../../hooks/useToast';
import { useTranslation } from '../../i18n/useTranslation';

interface ItemDetailViewProps {
  item: ItemDecrypted | null;
  isLoading?: boolean;
  isNewItem?: boolean;
  onUpdate: (id: string, fields: Record<string, unknown>) => Promise<boolean>;
  onDelete: (id: string) => void;
  onBack: () => void;
  allTags: Tag[];
  onCreateTag: (name: string, color?: string) => Promise<Tag | null>;
  onAttachTag: (itemId: string, tagId: string) => Promise<void>;
  onDetachTag: (itemId: string, tagId: string) => Promise<void>;
  onFileAttach: (itemId: string) => Promise<void>;
  onFileDownload: (attachmentId: string) => Promise<void>;
  onFileDelete: (attachmentId: string) => Promise<void>;
  _onDuplicate?: (id: string) => void;
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

const FIELD_NAME_MAP: Record<string, 'itemTitle' | 'username' | 'password' | 'url' | 'notes'> = {
  title: 'itemTitle',
  username: 'username',
  password: 'password',
  url: 'url',
  notes: 'notes',
};

function sanitizeInputValue(field: string, value: string): string {
  const mappedField = FIELD_NAME_MAP[field];
  if (!mappedField) return value;
  return sanitizeField(mappedField, value);
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const TAG_COLORS = ['#ef4444', '#f59e0b', '#22c55e', '#6366f1', '#8b5cf6', '#06b6d4', '#ec4899'];

function isContentEmpty(field: string, value: unknown): boolean {
  if (value === null || value === undefined) return true;
  const str = typeof value === 'string' ? value : '';
  if (field === 'notes') {
    const stripped = str.replace(/<[^>]*>/g, '').trim();
    return stripped.length === 0;
  }
  return str.trim().length === 0;
}

export default function ItemDetailView({
  item,
  isLoading,
  isNewItem = false,
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
  _onDuplicate,
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
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [isLoadingAttachments, setIsLoadingAttachments] = useState(false);
  const [passwordGeneratorOpen, setPasswordGeneratorOpen] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [editMode, setEditMode] = useState(isNewItem);

  const { showSuccess } = useToast();
  const { t } = useTranslation();
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isSavingRef = useRef(false);
  const pendingSaveRef = useRef<{ field: string; value: unknown } | null>(null);
  const tagDropdownRef = useRef<HTMLDivElement>(null);
  const otpSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

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
  }, [item]);

  useEffect(() => {
    if (!item) return;
    setIsLoadingAttachments(true);
    window.electron.files
      .getByItem(item.id)
      .then((result) => {
        setAttachments(result.data || []);
      })
      .catch(() => {
        setAttachments([]);
      })
      .finally(() => {
        setIsLoadingAttachments(false);
      });
  }, [item]);

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

  const markDirty = useCallback((_field: string) => {
    // Dirty tracking is handled by auto-save debouncing
  }, []);

  const applyFieldSetter = useCallback((field: string, value: string) => {
    switch (field) {
      case 'title':
        setTitle(value);
        break;
      case 'username':
        setUsername(value);
        break;
      case 'password':
        setPassword(value);
        break;
      case 'url':
        setUrl(value);
        break;
      case 'notes':
        setNotes(value);
        break;
      default:
        break;
    }
  }, []);

  const validateField = useCallback(
    (field: string, value: string): string | null => {
      const fieldMap: Record<string, 'itemTitle' | 'username' | 'password' | 'url' | 'notes'> = {
        title: 'itemTitle',
        username: 'username',
        password: 'password',
        url: 'url',
        notes: 'notes',
      };

      const mappedField = fieldMap[field];
      if (mappedField) {
        const errorKey = validateFieldUtil(mappedField, value);
        if (errorKey) {
          const limits: Record<string, number> = {
            title: MAX_FIELD_LENGTHS.ITEM_TITLE,
            username: MAX_FIELD_LENGTHS.USERNAME,
            password: MAX_FIELD_LENGTHS.PASSWORD,
            url: MAX_FIELD_LENGTHS.URL,
            notes: MAX_FIELD_LENGTHS.NOTES,
          };
          const max = limits[field];
          if (errorKey === 'validation.maxLength' && max !== undefined) {
            return t('validation.maxLength', { max });
          }
          return t(errorKey);
        }
      }

      if (field === 'username' && value.length > 0) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(value)) {
          return t('validation.emailWarning');
        }
      }

      return null;
    },
    [t],
  );

  const executeSave = useCallback(
    async (field: string, value: unknown) => {
      if (!item) return;
      if (isSavingRef.current) {
        pendingSaveRef.current = { field, value };
        return;
      }
      isSavingRef.current = true;
      try {
        await onUpdate(item.id, { [field]: value });
      } finally {
        isSavingRef.current = false;
        if (pendingSaveRef.current) {
          const next = pendingSaveRef.current;
          pendingSaveRef.current = null;
          executeSave(next.field, next.value);
        }
      }
    },
    [item, onUpdate],
  );

  const scheduleAutoSave = useCallback(
    (field: string, value: unknown) => {
      if (!item) return;
      if (isContentEmpty(field, value)) return;
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        executeSave(field, value);
      }, 800);
    },
    [item, executeSave],
  );

  const handleFieldChange = useCallback(
    (field: string, value: unknown, setter: (v: string) => void) => {
      const rawValue = typeof value === 'string' ? value : '';
      const sanitized = sanitizeInputValue(field, rawValue);
      setter(sanitized);
      const error = validateField(field, sanitized);
      setFieldErrors((prev) => {
        if (error) return { ...prev, [field]: error };
        const next = { ...prev };
        delete next[field];
        return next;
      });
      markDirty(field);
      scheduleAutoSave(field, sanitized);
    },
    [markDirty, scheduleAutoSave, validateField],
  );

  const handleOtpChange = useCallback(
    (newConfig: TotpConfig | null) => {
      if (!item) return;
      if (otpSaveTimerRef.current) clearTimeout(otpSaveTimerRef.current);

      if (newConfig === null) {
        onUpdate(item.id, { otpConfig: null });
        return;
      }

      otpSaveTimerRef.current = setTimeout(() => {
        onUpdate(item.id, { otpConfig: newConfig });
      }, 800);
    },
    [item, onUpdate],
  );

  const handleBlur = useCallback(
    async (field: string, value: unknown) => {
      if (!item) return;
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      const rawValue = typeof value === 'string' ? value : '';
      const sanitized = sanitizeInputValue(field, rawValue);
      const trimmedValue = typeof sanitized === 'string' ? sanitized.trim() : sanitized;
      if (field === 'title' && typeof sanitized === 'string' && trimmedValue !== sanitized) {
        setTitle(trimmedValue as string);
      } else if (field !== 'title' && typeof sanitized === 'string' && sanitized !== rawValue) {
        applyFieldSetter(field, sanitized);
      }
      if (isContentEmpty(field, trimmedValue)) return;
      if (isSavingRef.current) {
        pendingSaveRef.current = { field, value: trimmedValue };
        return;
      }
      isSavingRef.current = true;
      try {
        const success = await onUpdate(item.id, { [field]: trimmedValue });
        if (field === 'title' && !success) {
          setFieldErrors((prev) => ({
            ...prev,
            title: t('item.error.duplicateTitle'),
          }));
        } else if (field === 'title' && success) {
          setFieldErrors((prev) => {
            const next = { ...prev };
            delete next['title'];
            return next;
          });
        }
      } finally {
        isSavingRef.current = false;
        if (pendingSaveRef.current) {
          const next = pendingSaveRef.current;
          pendingSaveRef.current = null;
          executeSave(next.field, next.value);
        }
      }
    },
    [item, onUpdate, applyFieldSetter, executeSave, t],
  );

  const handleCopy = useCallback(
    async (text: string, label: string) => {
      try {
        await navigator.clipboard.writeText(text);
        showSuccess(label);
      } catch {
        // Clipboard not available
      }
    },
    [showSuccess],
  );

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
    const name = sanitizeField('tagName', newTagName).trim();
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
    setAttachments(result.data || []);
  }, [item, onFileAttach]);

  const handleFileDeleteClick = useCallback(
    async (attachmentId: string) => {
      await onFileDelete(attachmentId);
      setAttachments((prev) => prev.filter((a) => a.id !== attachmentId));
    },
    [onFileDelete],
  );

  const getStrengthLabel = useCallback(
    (pw: string): { label: string; color: string; score: number; borderColor: string } => {
      if (!pw)
        return {
          label: t('strength.empty'),
          color: 'bg-surface-300',
          score: 0,
          borderColor: 'border-surface-300',
        };
      let score = 0;
      if (pw.length >= 8) score++;
      if (pw.length >= 12) score++;
      if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score++;
      if (/\d/.test(pw)) score++;
      if (/[^a-zA-Z0-9]/.test(pw)) score++;
      if (pw.length >= 20) score++;
      const labelKeys = ['strength.weak', 'strength.fair', 'strength.strong', 'strength.strong', 'strength.veryStrong'];
      const colors = [
        'bg-danger-500',
        'bg-warning-500',
        'bg-warning-400',
        'bg-success-400',
        'bg-success-500',
      ];
      const borderColors = [
        'border-danger-500',
        'border-warning-500',
        'border-warning-400',
        'border-success-400',
        'border-success-500',
      ];
      const idx = Math.min(score, 4);
      return { label: t(labelKeys[idx]), color: colors[idx], score, borderColor: borderColors[idx] };
    },
    [t],
  );

  const strength = useMemo(() => getStrengthLabel(password), [password, getStrengthLabel]);

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      if (otpSaveTimerRef.current) clearTimeout(otpSaveTimerRef.current);
      // SECURITY: Wipe sensitive data from pendingSaveRef before releasing reference.
      // The ref may hold a plaintext password if a save was queued.
      if (pendingSaveRef.current) {
        pendingSaveRef.current = null;
      }
      // SECURITY: Clear password field from React state on unmount to minimize
      // the window where plaintext password is held in memory.
      setPassword('');
    };
  }, []);

  if (!item) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <div className="mb-3 text-5xl">🔑</div>
          <p className="text-lg font-semibold text-surface-600 dark:text-surface-400">
            {t('item.selectPrompt')}
          </p>
          <p className="mt-1 text-sm text-surface-400 dark:text-surface-500">
            {t('item.selectDescription')}
          </p>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="border-primary h-8 w-8 animate-spin rounded-full border-2 border-t-transparent" />
          <p className="text-sm text-surface-400">{t('item.loading')}</p>
        </div>
      </div>
    );
  }

  const availableTags = allTags.filter((t) => !itemTags.some((it) => it.id === t.id));

  return (
    <div className="notion-scrollbar h-full overflow-y-auto">
      {/* Cover Area */}
      <div className="to-primary/20 relative h-48 w-full bg-gradient-to-br from-red-50 opacity-50">
        {coverImage && (
          <CoverImage
            coverImage={coverImage}
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
        )}
      </div>

      <div className="relative z-10 -mt-12 px-6 lg:px-16">
        {/* Large Emoji / Avatar */}
        <div className="mb-6 inline-flex h-24 w-24 items-center justify-center rounded-2xl border border-surface-200/30 bg-white text-5xl shadow-xl dark:bg-surface-800">
          <EmojiPicker
            value={emoji}
            defaultEmoji="🔑"
            onChange={handleEmojiSelect}
            placement="bottom-start"
            ariaLabel="Change item emoji"
            triggerClassName="h-20 w-20 text-5xl"
          />
        </div>

        {/* Title + Action buttons */}
        <div className="mb-10 flex items-start justify-between">
          <div className="flex-1">
            {editMode ? (
              <div>
                <InlineFormField
                  error={fieldErrors.title}
                  showCharCount={!fieldErrors.title}
                  charCount={{ current: title.length, max: MAX_FIELD_LENGTHS.ITEM_TITLE }}
                >
                  <input
                    className="w-full border-0 bg-transparent text-3xl font-semibold text-surface-900 placeholder:text-surface-300 focus:outline-none focus:ring-0 dark:text-surface-50 dark:placeholder:text-surface-600"
                    placeholder={t('item.untitled')}
                    value={title}
                    maxLength={MAX_FIELD_LENGTHS.ITEM_TITLE}
                    onChange={(e) => handleFieldChange('title', e.target.value, setTitle)}
                    onBlur={() => handleBlur('title', title)}
                    autoFocus={isNewItem}
                  />
                </InlineFormField>
              </div>
            ) : (
              <h2 className="text-3xl font-semibold text-surface-900 dark:text-surface-50">
                {item.title || t('item.untitled')}
              </h2>
            )}
            <p className="mt-1 text-sm text-surface-500">
              {isNewItem
                ? t('item.newItem')
                : t('item.lastUpdated', { date: formatDate(item.updatedAt) })}
            </p>
          </div>
          <div className="flex gap-2">
            <button
              className={`rounded-lg border border-surface-200 px-4 py-2 font-medium transition-colors ${
                editMode
                  ? 'bg-primary text-on-primary border-primary'
                  : 'hover:bg-surface-100 dark:border-surface-700 dark:hover:bg-surface-800'
              }`}
              onClick={() => setEditMode(!editMode)}
            >
              {editMode ? t('item.done') : t('item.edit')}
            </button>
            <button
              className="rounded-lg border border-surface-200 p-2 transition-colors hover:bg-surface-100 dark:border-surface-700 dark:hover:bg-surface-800"
              aria-label="More options"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-5 w-5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M5 12h.01M12 12h.01M19 12h.01M6 12a1 1 0 11-2 0 1 1 0 012 0zm7 0a1 1 0 11-2 0 1 1 0 012 0zm7 0a1 1 0 11-2 0 1 1 0 012 0z"
                />
              </svg>
            </button>
          </div>
        </div>

        {/* Fields Grid */}
        <div className="mb-12 grid grid-cols-1 gap-y-8">
          {/* Website / URL */}
          <div className="group space-y-2">
            <label className="text-xs font-bold uppercase tracking-wider text-surface-400">
              {t('item.website')}
            </label>
            <div className="group-focus-within:border-primary flex items-center justify-between border-b border-surface-200 py-1 transition-colors dark:border-surface-700">
              {editMode ? (
                <div className="min-w-0 flex-1">
                  <InlineFormField
                    error={fieldErrors.url}
                    showCharCount={!fieldErrors.url}
                    charCount={{ current: url.length, max: MAX_FIELD_LENGTHS.URL }}
                  >
                    <input
                      className="w-full border-0 bg-transparent p-0 text-base text-surface-800 placeholder:text-surface-400 focus:outline-none focus:ring-0 dark:text-surface-200"
                      placeholder={t('item.websitePlaceholder')}
                      value={url}
                      maxLength={MAX_FIELD_LENGTHS.URL}
                      onChange={(e) => handleFieldChange('url', e.target.value, setUrl)}
                      onBlur={() => handleBlur('url', url)}
                    />
                  </InlineFormField>
                </div>
              ) : (
                <span
                  className="hover:text-primary cursor-pointer text-base text-surface-800 dark:text-surface-200"
                  onClick={() => {
                    if (url) {
                      try {
                        const urlObj = new URL(url.startsWith('http') ? url : `https://${url}`);
                        window.open(urlObj.toString(), '_blank');
                      } catch {
                        // Invalid URL
                      }
                    }
                  }}
                >
                  {url || '-'}
                </span>
              )}
              {url && (
                <button
                  className="hover:text-primary p-1 transition-colors"
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
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className="h-5 w-5"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                    />
                  </svg>
                </button>
              )}
            </div>
          </div>

          {/* Username */}
          <div className="group space-y-2">
            <label className="text-xs font-bold uppercase tracking-wider text-surface-400">
              {t('item.username')}
            </label>
            <div className="group-focus-within:border-primary flex items-center justify-between border-b border-surface-200 py-1 transition-colors dark:border-surface-700">
              {editMode ? (
                <div className="min-w-0 flex-1">
                  <InlineFormField
                    error={fieldErrors.username}
                    showCharCount={!fieldErrors.username}
                    charCount={{ current: username.length, max: MAX_FIELD_LENGTHS.USERNAME }}
                  >
                    <input
                      className="w-full border-0 bg-transparent p-0 text-base text-surface-800 placeholder:text-surface-400 focus:outline-none focus:ring-0 dark:text-surface-200"
                      placeholder={t('item.usernamePlaceholder')}
                      value={username}
                      maxLength={MAX_FIELD_LENGTHS.USERNAME}
                      onChange={(e) => handleFieldChange('username', e.target.value, setUsername)}
                      onBlur={() => handleBlur('username', username)}
                    />
                  </InlineFormField>
                </div>
              ) : (
                <span className="text-base text-surface-800 dark:text-surface-200">
                  {username || '-'}
                </span>
              )}
              {username && (
                <button
                  className="hover:text-primary p-1 transition-colors"
                    onClick={() => handleCopy(username, t('item.usernameCopied'))}
                  aria-label="Copy username"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className="h-5 w-5"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                    />
                  </svg>
                </button>
              )}
            </div>
          </div>

          {/* Password */}
          <div className="group space-y-2">
            <label className="text-xs font-bold uppercase tracking-wider text-surface-400">
              {t('item.passwordLabel')}
            </label>
            <div className="group-focus-within:border-primary flex items-center justify-between border-b border-surface-200 py-1 transition-colors dark:border-surface-700">
              {editMode ? (
                <div className="min-w-0 flex-1">
                  <InlineFormField
                    error={fieldErrors.password}
                    showCharCount={!fieldErrors.password}
                    charCount={{ current: password.length, max: MAX_FIELD_LENGTHS.PASSWORD }}
                  >
                    <input
                      className="w-full border-0 bg-transparent p-0 font-mono text-lg tracking-widest text-surface-800 placeholder:text-surface-400 focus:outline-none focus:ring-0 dark:text-surface-200"
                      type={showPassword ? 'text' : 'password'}
                      placeholder={t('item.passwordPlaceholder')}
                      value={password}
                      maxLength={MAX_FIELD_LENGTHS.PASSWORD}
                      onChange={(e) => handleFieldChange('password', e.target.value, setPassword)}
                      onBlur={() => handleBlur('password', password)}
                    />
                  </InlineFormField>
                </div>
              ) : (
                <span className="font-mono text-lg tracking-widest text-surface-800 dark:text-surface-200">
                  {password ? '\u2022'.repeat(Math.min(password.length, 12)) : '-'}
                </span>
              )}
              <div className="flex gap-1">
                {password && (
                  <button
                    className="hover:text-primary p-1 transition-colors"
                    onClick={() => setShowPassword(!showPassword)}
                    aria-label={showPassword ? t('item.hidePassword') : t('item.showPassword')}
                  >
                    {showPassword ? (
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        className="h-5 w-5"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={2}
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21"
                        />
                      </svg>
                    ) : (
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        className="h-5 w-5"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={2}
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                        />
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
                        />
                      </svg>
                    )}
                  </button>
                )}
                {password && (
                  <button
                    className="hover:text-primary p-1 transition-colors"
                    onClick={() => handleCopy(password, t('item.passwordCopied'))}
                    aria-label="Copy password"
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      className="h-5 w-5"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                      />
                    </svg>
                  </button>
                )}
              </div>
            </div>
            {password && (
              <div className="mt-2">
                <div className="h-1 w-full overflow-hidden rounded-full bg-surface-200 dark:bg-surface-700">
                  <div
                    className={`h-full transition-all ${strength.color}`}
                    style={{ width: `${((strength.score + 1) / 6) * 100}%` }}
                  />
                </div>
                <p
                  className={`mt-1 text-xs font-medium ${
                    strength.score < 2
                      ? 'text-danger-500'
                      : strength.score < 3
                        ? 'text-warning-500'
                        : 'text-success-500'
                  }`}
                >
                  {strength.label}
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Bento Widgets Section */}
        <div className="mb-12 grid grid-cols-2 gap-6">
          {/* Password Generator Widget */}
          <div className="flex flex-col gap-4 rounded-2xl border border-surface-200/30 bg-surface-50 p-6 dark:bg-surface-800/50">
            <div className="flex items-center justify-between">
              <h4 className="font-semibold text-surface-800 dark:text-surface-200">{t('item.generator')}</h4>
              <span className="text-primary text-xs font-bold">{t('item.secure')}</span>
            </div>
            <div className="text-primary rounded-xl border border-surface-200/50 bg-white p-3 text-center font-mono tracking-tight dark:bg-surface-800">
              {password || t('item.clickGenerate')}
            </div>
            <div className="space-y-2">
              <div className="flex justify-between text-[10px] font-bold text-surface-400">
                <span>{t('item.strength')}</span>
                <span>{strength.label}</span>
              </div>
              <div className="h-1 w-full overflow-hidden rounded-full bg-surface-200 dark:bg-surface-700">
                <div
                  className={`h-full transition-all ${strength.color}`}
                  style={{ width: `${((strength.score + 1) / 6) * 100}%` }}
                />
              </div>
            </div>
            <button
              className="bg-primary text-on-primary hover:bg-primary-container w-full rounded-lg py-2 text-sm font-medium transition-colors"
              onClick={() => setPasswordGeneratorOpen(true)}
            >
              {t('item.generatePassword')}
            </button>
          </div>

          {/* Security Score Widget */}
          <div className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-surface-200/30 bg-surface-50 p-6 text-center dark:bg-surface-800/50">
            <div
              className={`flex h-12 w-12 items-center justify-center rounded-full border-4 ${strength.borderColor} border-t-transparent`}
            >
              <span className="text-sm font-bold text-surface-600 dark:text-surface-300">
                {Math.round(((strength.score + 1) / 6) * 100)}
              </span>
            </div>
            <p className="font-semibold text-surface-800 dark:text-surface-200">{strength.label}</p>
            <p className="text-[10px] text-surface-400">
              {isNewItem ? t('item.newItem') : t('item.lastUpdated', { date: formatDate(item.updatedAt) })}
            </p>
          </div>
        </div>

        {/* OTP Section */}
        <OtpSection
          itemTitle={item.title}
          otpConfig={item.otp}
          isEditMode={editMode}
          onChange={handleOtpChange}
        />

        {/* Tags */}
        <div className="mb-8">
          <label className="mb-3 block text-xs font-bold uppercase tracking-wider text-surface-400">
            {t('item.tags')}
          </label>
          <div className="flex flex-wrap items-center gap-2">
            {itemTags.map((tag) => (
              <span
                key={tag.id}
                className="inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium"
                style={{ backgroundColor: tag.color + '20', color: tag.color }}
              >
                {tag.name}
                {editMode && (
                  <button
                    className="ml-0.5 hover:opacity-70"
                    onClick={() => handleTagToggle(tag.id)}
                    aria-label={`Remove tag ${tag.name}`}
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      className="h-3 w-3"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                )}
              </span>
            ))}

            {editMode && (
              <div className="relative">
                <button
                  className="hover:border-primary hover:text-primary flex items-center gap-1 rounded-full border border-dashed border-surface-300 px-3 py-1 text-xs text-surface-500 transition-colors dark:border-surface-600"
                  onClick={() => setIsTagDropdownOpen(!isTagDropdownOpen)}
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
                  {t('item.addTag')}
                </button>
                {isTagDropdownOpen && (
                  <div
                    ref={tagDropdownRef}
                    className="absolute left-0 top-full z-50 mt-1 min-w-[200px] rounded-lg border border-surface-200 bg-white py-1 shadow-lg dark:border-surface-700 dark:bg-surface-800"
                    style={{ animation: 'fadeIn 0.1s ease-out' }}
                  >
                    {isCreatingTag ? (
                      <div className="p-2">
                        <input
                          className="focus:border-primary h-8 w-full rounded-lg border border-surface-200 px-2 text-xs focus:outline-none dark:border-surface-700 dark:bg-surface-800"
                          placeholder={t('item.tagNamePlaceholder')}
                          value={newTagName}
                          maxLength={MAX_FIELD_LENGTHS.TAG_NAME}
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
                        <div className="mt-1 flex items-center gap-1">
                          <button
                            className="bg-primary text-on-primary hover:bg-primary-container flex-1 rounded-lg py-1 text-xs font-medium"
                            onClick={handleCreateTag}
                          >
                            {t('item.create')}
                          </button>
                          <button
                            className="rounded-lg px-2 py-1 text-xs text-surface-500 hover:bg-surface-100 dark:hover:bg-surface-700"
                            onClick={() => {
                              setIsCreatingTag(false);
                              setNewTagName('');
                            }}
                          >
                            {t('item.cancel')}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        {availableTags.length > 0 ? (
                          availableTags.map((tag) => (
                            <button
                              key={tag.id}
                              className="flex w-full items-center gap-2 px-3 py-1.5 text-sm text-surface-700 transition-colors hover:bg-surface-100 dark:text-surface-300 dark:hover:bg-surface-700"
                              onClick={() => handleTagToggle(tag.id)}
                            >
                              <span
                                className="h-2.5 w-2.5 shrink-0 rounded-full"
                                style={{ backgroundColor: tag.color }}
                              />
                              {tag.name}
                            </button>
                          ))
                        ) : (
                          <p className="px-3 py-2 text-xs text-surface-400">{t('item.noTags')}</p>
                        )}
                        <div className="my-1 h-px bg-surface-200 dark:bg-surface-700" />
                        <button
                          className="flex w-full items-center gap-2 px-3 py-1.5 text-sm text-surface-700 transition-colors hover:bg-surface-100 dark:text-surface-300 dark:hover:bg-surface-700"
                          onClick={() => setIsCreatingTag(true)}
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
                          {t('item.createNewTag')}
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Notes Section */}
        <div className="mb-20">
          <h4 className="mb-4 text-xs font-bold uppercase tracking-wider text-surface-400">
            {t('item.notes')}
          </h4>
          {editMode ? (
            <RichTextEditor
              content={notes}
              onChange={(json) => handleFieldChange('notes', json, setNotes)}
              placeholder={t('item.addNotes')}
            />
          ) : notes ? (
            <div className="prose prose-sm max-w-none leading-relaxed text-surface-600 dark:text-surface-400">
              {typeof notes === 'string' ? <p>{notes}</p> : <p>{JSON.stringify(notes)}</p>}
            </div>
          ) : (
            <p className="text-sm italic text-surface-400">{t('item.noNotes')}</p>
          )}
        </div>

        {/* Attachments */}
        <div className="mb-20">
          <div className="mb-4 flex items-center justify-between">
            <h4 className="text-xs font-bold uppercase tracking-wider text-surface-400">
              {t('item.attachments')}
            </h4>
            {editMode && (
              <button
                className="text-primary hover:text-primary-container flex items-center gap-1 text-xs"
                onClick={handleFileAttachClick}
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
                    d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13"
                  />
                </svg>
                {t('item.attachFile')}
              </button>
            )}
          </div>
          {isLoadingAttachments ? (
            <p className="text-xs text-surface-400">{t('item.loadingAttachments')}</p>
          ) : attachments.length > 0 ? (
            <div className="space-y-2">
              {attachments.map((att) => (
                <div
                  key={att.id}
                  className="flex items-center gap-3 rounded-lg border border-surface-200 bg-white px-3 py-2 dark:border-surface-700 dark:bg-surface-850"
                >
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
                      d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13"
                    />
                  </svg>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-surface-700 dark:text-surface-300">
                      {att.fileName}
                    </p>
                    <p className="text-xs text-surface-400">{formatFileSize(att.fileSize)}</p>
                  </div>
                  <button
                    className="rounded-lg p-1.5 text-surface-400 transition-colors hover:bg-surface-100 hover:text-surface-600 dark:hover:bg-surface-700 dark:hover:text-surface-300"
                    onClick={() => onFileDownload(att.id)}
                    aria-label={`Download ${att.fileName}`}
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
                        d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                      />
                    </svg>
                  </button>
                  {editMode && (
                    <button
                      className="rounded-lg p-1.5 text-danger-500 transition-colors hover:bg-danger-50 dark:hover:bg-danger-500/10"
                      onClick={() => {
                        if (confirm(t('item.deleteAttachmentConfirm', { name: att.fileName }))) {
                          handleFileDeleteClick(att.id);
                        }
                      }}
                      aria-label={`Delete ${att.fileName}`}
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
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-surface-400">{t('item.noAttachments')}</p>
          )}
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
        title={t('item.deleteItem')}
        message={t('item.deleteItemConfirm')}
        confirmLabel={t('item.delete')}
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
