import React, { useState, useCallback, useEffect, useRef } from 'react';
import Modal from '../ui/Modal';
import { useToast } from '../../hooks/useToast';

type ExportFormat = 'encrypted-json' | 'json-plain' | 'csv';

type DialogStep = 'select-format' | 'warning' | 'exporting' | 'success' | 'error';

interface ExportDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

const PHASE_LABELS: Record<string, string> = {
  preparing: 'Preparing...',
  'reading-data': 'Reading vault data...',
  serializing: 'Processing and serializing...',
  encrypting: 'Encrypting...',
  writing: 'Writing file...',
  done: 'Finishing up...',
};

export default function ExportDialog({ isOpen, onClose }: ExportDialogProps): React.ReactElement {
  const [selectedFormat, setSelectedFormat] = useState<ExportFormat>('encrypted-json');
  const [step, setStep] = useState<DialogStep>('select-format');
  const [errorMessage, setErrorMessage] = useState('');
  const [exportedFilePath, setExportedFilePath] = useState('');
  const [progress, setProgress] = useState({ percent: 0, phase: 'preparing' });
  const cleanupRef = useRef<(() => void) | null>(null);
  const { showSuccess, showError } = useToast();

  const resetDialog = useCallback(() => {
    setSelectedFormat('encrypted-json');
    setStep('select-format');
    setErrorMessage('');
    setExportedFilePath('');
    setProgress({ percent: 0, phase: 'preparing' });
    if (cleanupRef.current) {
      cleanupRef.current();
      cleanupRef.current = null;
    }
  }, []);

  const handleClose = useCallback(() => {
    resetDialog();
    onClose();
  }, [onClose, resetDialog]);

  useEffect(() => {
    return () => {
      if (cleanupRef.current) {
        cleanupRef.current();
        cleanupRef.current = null;
      }
    };
  }, []);

  const handleFormatSelect = useCallback((format: ExportFormat) => {
    setSelectedFormat(format);
    if (format === 'encrypted-json') {
      setStep('exporting');
      performExport(format);
    } else {
      setStep('warning');
    }
  }, []);

  const handleConfirmWarning = useCallback(() => {
    setStep('exporting');
    performExport(selectedFormat);
  }, [selectedFormat]);

  const handleBackToFormat = useCallback(() => {
    setStep('select-format');
  }, []);

  const performExport = useCallback(async (format: ExportFormat) => {
    try {
      setProgress({ percent: 0, phase: 'preparing' });

      window.electron.export.onProgress((p) => {
        setProgress(p);
      });

      const result = await window.electron.export.exportData(format);

      if (cleanupRef.current) {
        cleanupRef.current();
        cleanupRef.current = null;
      }

      if (!result.success) {
        setErrorMessage(result.error ?? 'Export failed.');
        setStep('error');
        showError(result.error ?? 'Export failed.');
        return;
      }

      setExportedFilePath(result.data.filePath);
      setStep('success');
      showSuccess(`Exported to ${result.data.filePath}`);
    } catch (err) {
      if (cleanupRef.current) {
        cleanupRef.current();
        cleanupRef.current = null;
      }
      const msg = err instanceof Error ? err.message : 'Unknown error during export.';
      setErrorMessage(msg);
      setStep('error');
      showError(msg);
    }
  }, [showSuccess, showError]);

  const handleExportAnother = useCallback(() => {
    resetDialog();
  }, [resetDialog]);

  const formatOptions: Array<{ value: ExportFormat; label: string; description: string; icon: string }> = [
    {
      value: 'encrypted-json',
      label: 'Encrypted JSON (.spm)',
      description: 'Secure, encrypted backup using your vault key. Recommended.',
      icon: '🔒',
    },
    {
      value: 'json-plain',
      label: 'JSON Plain Text',
      description: 'Human-readable JSON. Passwords will be visible in plain text.',
      icon: '📄',
    },
    {
      value: 'csv',
      label: 'CSV Plain Text',
      description: 'Spreadsheet-compatible CSV. Passwords will be visible in plain text.',
      icon: '📊',
    },
  ];

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      className="max-w-lg"
      ariaLabel="Export data dialog"
      closeOnOverlayClick={step !== 'exporting'}
    >
      <div className="p-6">
        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-surface-900 dark:text-surface-50">
            Export Data
          </h2>
          <button
            type="button"
            onClick={handleClose}
            className="rounded p-1 text-surface-400 transition-colors hover:text-surface-600 dark:hover:text-surface-300"
            aria-label="Close dialog"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Step: Select Format */}
        {step === 'select-format' && (
          <div className="space-y-3">
            <p className="text-sm text-surface-500 dark:text-surface-400">
              Choose the format you want to export your data to:
            </p>
            <div className="grid gap-2">
              {formatOptions.map((fmt) => (
                <button
                  key={fmt.value}
                  type="button"
                  onClick={() => handleFormatSelect(fmt.value)}
                  className={`flex items-start gap-3 rounded-lg border p-3 text-left transition-all hover:border-accent-400 hover:bg-accent-50 dark:border-surface-700 dark:hover:border-accent-600 dark:hover:bg-accent-900/20 ${
                    selectedFormat === fmt.value
                      ? 'border-accent-400 bg-accent-50 dark:border-accent-600 dark:bg-accent-900/20'
                      : 'border-surface-200'
                  }`}
                >
                  <span className="mt-0.5 text-xl" role="img" aria-hidden="true">
                    {fmt.icon}
                  </span>
                  <div className="flex-1">
                    <span className="text-sm font-medium text-surface-800 dark:text-surface-200">
                      {fmt.label}
                    </span>
                    <p className="mt-0.5 text-xs text-surface-400 dark:text-surface-500">
                      {fmt.description}
                    </p>
                  </div>
                  {selectedFormat === fmt.value && (
                    <svg xmlns="http://www.w3.org/2000/svg" className="mt-1 h-4 w-4 shrink-0 text-accent-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Step: Security Warning */}
        {step === 'warning' && (
          <div className="space-y-4">
            <div className="rounded-lg border border-warning-300 bg-warning-50 p-4 dark:border-warning-700 dark:bg-warning-900/20">
              <div className="flex items-start gap-3">
                <svg xmlns="http://www.w3.org/2000/svg" className="mt-0.5 h-6 w-6 shrink-0 text-warning-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                <div>
                  <h3 className="text-sm font-semibold text-warning-700 dark:text-warning-300">
                    Security Warning
                  </h3>
                  <p className="mt-1 text-xs text-warning-600 dark:text-warning-400">
                    You are about to export your data in <strong>plain text</strong>. Your passwords and
                    notes will be stored unencrypted in the file. Anyone with access to this file can read
                    your credentials.
                  </p>
                  <ul className="mt-2 list-inside list-disc text-xs text-warning-600 dark:text-warning-400">
                    <li>Do not share this file with anyone.</li>
                    <li>Delete the file as soon as you no longer need it.</li>
                    <li>Consider using Encrypted JSON for safer backups.</li>
                  </ul>
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={handleBackToFormat}
                className="notion-button-ghost rounded-lg px-4 py-2 text-sm"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmWarning}
                className="notion-button-danger rounded-lg px-4 py-2 text-sm"
              >
                I understand — Export Plain Text
              </button>
            </div>
          </div>
        )}

        {/* Step: Exporting */}
        {step === 'exporting' && (
          <div className="flex flex-col items-center justify-center py-8">
            <svg className="mb-4 h-8 w-8 animate-spin text-accent-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            <p className="mb-3 text-sm text-surface-500 dark:text-surface-400">
              {PHASE_LABELS[progress.phase] ?? 'Exporting your data...'}
            </p>
            <div className="w-full max-w-xs">
              <div className="mb-1 flex items-center justify-between">
                <span className="text-xs text-surface-400 dark:text-surface-500">
                  Progress
                </span>
                <span className="text-xs font-medium text-accent-500">
                  {progress.percent}%
                </span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-surface-200 dark:bg-surface-700">
                <div
                  className="h-full rounded-full bg-accent-500 transition-all duration-300 ease-out"
                  style={{ width: `${progress.percent}%` }}
                />
              </div>
            </div>
          </div>
        )}

        {/* Step: Success */}
        {step === 'success' && (
          <div className="space-y-4">
            <div className="flex flex-col items-center justify-center rounded-lg border border-success-200 bg-success-50 p-6 dark:border-success-800 dark:bg-success-900/20">
              <svg xmlns="http://www.w3.org/2000/svg" className="mb-2 h-10 w-10 text-success-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p className="text-sm font-medium text-success-700 dark:text-success-300">
                Export completed successfully
              </p>
              {exportedFilePath && (
                <p className="mt-1 max-w-full truncate text-xs text-success-500" title={exportedFilePath}>
                  {exportedFilePath.split(/[/\\]/).pop()}
                </p>
              )}
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={handleClose}
                className="notion-button-ghost rounded-lg px-4 py-2 text-sm"
              >
                Done
              </button>
              <button
                type="button"
                onClick={handleExportAnother}
                className="notion-button-primary rounded-lg px-4 py-2 text-sm"
              >
                Export Another
              </button>
            </div>
          </div>
        )}

        {/* Step: Error */}
        {step === 'error' && (
          <div className="space-y-4">
            <div className="flex flex-col items-center justify-center rounded-lg border border-danger-200 bg-danger-50 p-6 dark:border-danger-800 dark:bg-danger-900/20">
              <svg xmlns="http://www.w3.org/2000/svg" className="mb-2 h-10 w-10 text-danger-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p className="text-sm font-medium text-danger-700 dark:text-danger-300">
                Export Failed
              </p>
              <p className="mt-1 text-xs text-danger-500">{errorMessage}</p>
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={handleClose}
                className="notion-button-ghost rounded-lg px-4 py-2 text-sm"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleExportAnother}
                className="notion-button-primary rounded-lg px-4 py-2 text-sm"
              >
                Try Again
              </button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
