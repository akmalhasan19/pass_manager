import React, { useState, useCallback, useRef } from 'react';
import { useTranslation } from '../../i18n/useTranslation';
import { IMPORT_FORMAT_EXTENSIONS, type ImportFormat } from '../../../shared/types';

interface DropZoneProps {
  onFileDropped: (file: { format: ImportFormat; filePath: string; content: string }) => void;
  disabled?: boolean;
}

const ACCEPTED_EXTENSIONS = Object.values(IMPORT_FORMAT_EXTENSIONS).flat();

function detectFormatFromExtension(fileName: string): ImportFormat | null {
  const lower = fileName.toLowerCase();
  for (const [format, exts] of Object.entries(IMPORT_FORMAT_EXTENSIONS)) {
    if (exts.some((ext) => lower.endsWith(ext))) {
      return format as ImportFormat;
    }
  }
  return null;
}

export default function DropZone({ onFileDropped, disabled = false }: DropZoneProps): React.ReactElement {
  const { t } = useTranslation();
  const [isDragOver, setIsDragOver] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState('');
  const dragCounterRef = useRef(0);

  const handleDragEnter = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (disabled) return;

      dragCounterRef.current++;
      if (e.dataTransfer.types.includes('Files')) {
        setIsDragOver(true);
      }
    },
    [disabled],
  );

  const handleDragLeave = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (disabled) return;

      dragCounterRef.current--;
      if (dragCounterRef.current === 0) {
        setIsDragOver(false);
      }
    },
    [disabled],
  );

  const handleDragOver = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (disabled) return;

      if (e.dataTransfer.types.includes('Files')) {
        e.dataTransfer.dropEffect = 'copy';
      }
    },
    [disabled],
  );

  const processFile = useCallback(
    async (file: File) => {
      setError('');

      const format = detectFormatFromExtension(file.name);
      if (!format) {
        const supported = ACCEPTED_EXTENSIONS.join(', ');
        setError(
          t('dropZone.error.unsupported', { extensions: supported }) ??
            `Unsupported file format. Supported: ${supported}`,
        );
        return;
      }

      setIsProcessing(true);
      try {
        const content = await file.text();
        if (!content || content.trim().length === 0) {
          setError(t('dropZone.error.empty') ?? 'File is empty.');
          setIsProcessing(false);
          return;
        }

        onFileDropped({
          format,
          filePath: file.name,
          content,
        });
      } catch {
        setError(t('dropZone.error.readFailed') ?? 'Failed to read file.');
      } finally {
        setIsProcessing(false);
      }
    },
    [onFileDropped, t],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dragCounterRef.current = 0;
      setIsDragOver(false);
      if (disabled) return;

      const files = Array.from(e.dataTransfer.files);
      if (files.length === 0) return;

      processFile(files[0]);
    },
    [disabled, processFile],
  );

  return (
    <div
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      className={`relative mt-4 rounded-lg border-2 border-dashed transition-all duration-200 ${
        isDragOver
          ? 'border-accent-400 bg-accent-50 dark:border-accent-500 dark:bg-accent-900/20'
          : 'border-surface-200 bg-surface-50/50 dark:border-surface-700 dark:bg-surface-800/50'
      } ${disabled ? 'pointer-events-none opacity-50' : 'cursor-pointer'}`}
    >
      <div className="flex flex-col items-center justify-center px-4 py-6">
        {isProcessing ? (
          <svg
            className="mb-2 h-6 w-6 animate-spin text-accent-500"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
          >
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        ) : (
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className={`mb-2 h-6 w-6 transition-colors ${
              isDragOver ? 'text-accent-500' : 'text-surface-400 dark:text-surface-500'
            }`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.5}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 16.5V9.75m0 0l3 3m-3-3l-3 3M6.75 19.5a4.5 4.5 0 01-1.41-8.775 5.25 5.25 0 0110.233-2.33 3 3 0 013.758 3.848A3.752 3.752 0 0118 19.5H6.75z"
            />
          </svg>
        )}
        <p className="text-center text-xs text-surface-500 dark:text-surface-400">
          {isDragOver
            ? (t('dropZone.dropHere') ?? 'Drop your file here')
            : (t('dropZone.instruction') ?? 'Drag & drop a CSV, JSON, or XML file to import')}
        </p>
        <p className="mt-1 text-center text-[10px] text-surface-400 dark:text-surface-500">
          {t('dropZone.supportedFormats') ?? 'Supported: .csv, .json, .xml, .spm'}
        </p>
      </div>
      {error && (
        <div className="border-t border-surface-200 px-4 py-2 dark:border-surface-700">
          <p role="alert" className="text-center text-xs text-danger-500">{error}</p>
        </div>
      )}
    </div>
  );
}
