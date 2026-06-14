import React, { useCallback, useEffect, useRef, useState } from 'react';

const GRADIENT_PREFIX = 'gradient:';

export type CoverImageRatio = 'banner' | 'wide';

export interface CoverImageProps {
  /** Current cover value: `gradient:<name>`, a stored image filename, or null/empty. */
  coverImage?: string | null;
  /** Called when the cover changes (gradient name, image filename, or null to remove). */
  onChange: (coverImage: string | null) => void;
  /** Aspect ratio of the cover banner. */
  ratio?: CoverImageRatio;
  /** Accessible label for the cover region. */
  ariaLabel?: string;
}

interface GradientOption {
  id: string;
  label: string;
  className: string;
}

const GRADIENTS: GradientOption[] = [
  {
    id: 'indigo',
    label: 'Indigo',
    className: 'bg-gradient-to-br from-indigo-400 to-purple-500',
  },
  {
    id: 'rose',
    label: 'Rose',
    className: 'bg-gradient-to-br from-rose-400 to-orange-400',
  },
  {
    id: 'emerald',
    label: 'Emerald',
    className: 'bg-gradient-to-br from-emerald-400 to-cyan-500',
  },
  {
    id: 'slate',
    label: 'Slate',
    className: 'bg-gradient-to-br from-slate-300 to-slate-500',
  },
  {
    id: 'sunset',
    label: 'Sunset',
    className: 'bg-gradient-to-br from-amber-300 to-pink-500',
  },
  {
    id: 'ocean',
    label: 'Ocean',
    className: 'bg-gradient-to-br from-blue-400 to-indigo-600',
  },
];

function isGradient(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.startsWith(GRADIENT_PREFIX);
}

function getGradientClass(value: string | null | undefined): string | null {
  if (!isGradient(value)) return null;
  const id = value.slice(GRADIENT_PREFIX.length);
  return GRADIENTS.find((g) => g.id === id)?.className ?? null;
}

function ratioClass(ratio: CoverImageRatio): string {
  return ratio === 'banner' ? 'aspect-[3/1]' : 'aspect-video';
}

/**
 * Notion-style cover image component.
 *
 * Supports:
 * - Drag & drop or click-to-upload image files
 * - Predefined gradient covers
 * - Remove / replace actions
 * - Stored image filenames resolved to data URLs via the main process
 */
export default function CoverImage({
  coverImage,
  onChange,
  ratio = 'banner',
  ariaLabel = 'Cover image',
}: CoverImageProps): React.ReactElement {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [showGradientPicker, setShowGradientPicker] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load a stored cover image as a data URL.
  useEffect(() => {
    if (!coverImage || isGradient(coverImage)) {
      setDataUrl(null);
      setLoadError(null);
      return;
    }

    let cancelled = false;
    setIsLoading(true);
    setLoadError(null);

    window.electron.covers
      .read(coverImage)
      .then((url) => {
        if (!cancelled) setDataUrl(url);
      })
      .catch((err) => {
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : 'Failed to load cover');
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [coverImage]);

  const handleFileSelect = useCallback(
    async (fileList: FileList | null) => {
      const file = fileList?.[0];
      if (!file) return;

      // In Electron, File objects expose a `path` property when sandboxing is disabled.
      const filePath = (file as unknown as { path?: string }).path;
      if (!filePath) {
        setLoadError('Unable to read file path. Try dragging the file into the app.');
        return;
      }

      setIsLoading(true);
      setLoadError(null);
      try {
        const coverName = await window.electron.covers.upload(filePath);
        onChange(coverName);
      } catch (err) {
        setLoadError(err instanceof Error ? err.message : 'Failed to upload cover');
      } finally {
        setIsLoading(false);
      }
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    },
    [onChange],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);
      handleFileSelect(e.dataTransfer.files);
    },
    [handleFileSelect],
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleRemove = useCallback(async () => {
    if (coverImage && !isGradient(coverImage)) {
      try {
        await window.electron.covers.delete(coverImage);
      } catch {
        // Ignore deletion errors; the file may already be gone.
      }
    }
    onChange(null);
    setDataUrl(null);
  }, [coverImage, onChange]);

  const handleGradientSelect = useCallback(
    (gradientId: string) => {
      onChange(`${GRADIENT_PREFIX}${gradientId}`);
      setShowGradientPicker(false);
    },
    [onChange],
  );

  const gradientClass = getGradientClass(coverImage);
  const hasCover = !!coverImage;

  return (
    <div
      className={`group relative w-full overflow-hidden rounded-t-lg ${ratioClass(ratio)} ${
        gradientClass ?? 'bg-surface-100 dark:bg-surface-800'
      } ${isDragging ? 'ring-2 ring-accent-400 ring-offset-2' : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      role="img"
      aria-label={ariaLabel}
    >
      {/* Uploaded image */}
      {!gradientClass && dataUrl && (
        <img src={dataUrl} alt="Cover" className="absolute inset-0 h-full w-full object-cover" />
      )}

      {/* Loading state */}
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-surface-100/80 dark:bg-surface-800/80">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-accent-500 border-t-transparent" />
        </div>
      )}

      {/* Empty / drag overlay */}
      {!hasCover && !isLoading && (
        <button
          type="button"
          className="absolute inset-0 flex flex-col items-center justify-center text-surface-400 transition-colors hover:bg-surface-150/50 dark:hover:bg-surface-750/50"
          onClick={() => fileInputRef.current?.click()}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="mb-2 h-8 w-8"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.5}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
            />
          </svg>
          <span className="text-sm font-medium">
            {isDragging ? 'Drop cover image here' : 'Add a cover image'}
          </span>
          <span className="mt-1 text-xs text-surface-400">Drag & drop or click to upload</span>
        </button>
      )}

      {/* Error message */}
      {loadError && !isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-danger-50/90 p-4 text-center dark:bg-danger-500/10">
          <p className="text-sm text-danger-600 dark:text-danger-400">{loadError}</p>
        </div>
      )}

      {/* Hover toolbar */}
      <div
        className={`absolute right-2 top-2 flex items-center gap-1 rounded-lg border border-surface-200/60 bg-white/90 p-1 shadow-sm backdrop-blur-sm transition-opacity dark:border-surface-700/60 dark:bg-surface-800/90 ${
          hasCover ? 'opacity-0 group-hover:opacity-100' : 'opacity-0'
        }`}
      >
        <button
          type="button"
          className="flex h-7 items-center gap-1 rounded px-2 text-xs font-medium text-surface-600 transition-colors hover:bg-surface-100 dark:text-surface-300 dark:hover:bg-surface-700"
          onClick={() => fileInputRef.current?.click()}
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
              d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"
            />
          </svg>
          Replace
        </button>
        <button
          type="button"
          className="flex h-7 items-center gap-1 rounded px-2 text-xs font-medium text-surface-600 transition-colors hover:bg-surface-100 dark:text-surface-300 dark:hover:bg-surface-700"
          onClick={() => setShowGradientPicker(!showGradientPicker)}
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
              d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01"
            />
          </svg>
          Gradient
        </button>
        <button
          type="button"
          className="flex h-7 items-center gap-1 rounded px-2 text-xs font-medium text-danger-600 transition-colors hover:bg-danger-50 dark:text-danger-400 dark:hover:bg-danger-500/10"
          onClick={handleRemove}
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
          Remove
        </button>
      </div>

      {/* Gradient picker popover */}
      {showGradientPicker && (
        <div
          className="absolute right-2 top-12 z-20 w-56 rounded-xl border border-surface-200 bg-white p-2 shadow-lg dark:border-surface-700 dark:bg-surface-850"
          style={{ animation: 'fadeIn 0.1s ease-out' }}
        >
          <p className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-wider text-surface-400 dark:text-surface-500">
            Choose gradient
          </p>
          <div className="grid grid-cols-2 gap-2">
            {GRADIENTS.map((gradient) => (
              <button
                key={gradient.id}
                type="button"
                className={`relative h-12 w-full overflow-hidden rounded-lg ${gradient.className} ring-offset-2 transition-all hover:scale-[1.02] ${
                  coverImage === `${GRADIENT_PREFIX}${gradient.id}`
                    ? 'ring-2 ring-white dark:ring-surface-400'
                    : ''
                }`}
                onClick={() => handleGradientSelect(gradient.id)}
                aria-label={`Select ${gradient.label} gradient`}
              >
                <span className="absolute bottom-1 left-2 text-[10px] font-semibold text-white/90 drop-shadow">
                  {gradient.label}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/jpg,image/gif,image/webp,image/svg+xml"
        className="hidden"
        onChange={(e) => handleFileSelect(e.target.files)}
      />
    </div>
  );
}

export { GRADIENTS };
