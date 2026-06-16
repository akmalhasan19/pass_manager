import React, { useState, useCallback } from 'react';
import Modal from '../ui/Modal';
import ColumnMapper from './ColumnMapper';
import DuplicatePreview from './DuplicatePreview';
import { useToast } from '../../hooks/useToast';
import {
  IMPORT_FORMATS,
  IMPORT_FORMAT_LABELS,
  type ImportFormat,
  type ImportPayload,
  type DuplicateReport,
  type DuplicateResolutionMap,
} from '../../../shared/types';
import type { CsvColumnMapping } from '../../../shared/types';

interface ImportDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

type DialogStep =
  | 'select-format'
  | 'select-file'
  | 'column-mapping'
  | 'importing'
  | 'duplicate-preview'
  | 'committing'
  | 'success'
  | 'error';

export default function ImportDialog({ isOpen, onClose }: ImportDialogProps): React.ReactElement {
  const [step, setStep] = useState<DialogStep>('select-format');
  const [selectedFormat, setSelectedFormat] = useState<ImportFormat | null>(null);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<string>('');
  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [csvSampleRow, setCsvSampleRow] = useState<string[]>([]);
  const [parsedPayload, setParsedPayload] = useState<ImportPayload | null>(null);
  const [duplicateReport, setDuplicateReport] = useState<DuplicateReport | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [importResult, setImportResult] = useState<{ itemCount?: number }>({});
  const { showSuccess, showError } = useToast();

  const resetDialog = useCallback(() => {
    setStep('select-format');
    setSelectedFormat(null);
    setSelectedFile(null);
    setFileContent('');
    setCsvHeaders([]);
    setCsvSampleRow([]);
    setParsedPayload(null);
    setDuplicateReport(null);
    setErrorMessage('');
    setImportResult({});
  }, []);

  const handleClose = useCallback(() => {
    resetDialog();
    onClose();
  }, [onClose, resetDialog]);

  const handleFormatSelect = useCallback((format: ImportFormat) => {
    setSelectedFormat(format);
    setStep('select-file');
  }, []);

  const handlePickFile = useCallback(async () => {
    if (!selectedFormat) return;

    setStep('importing');
    try {
      const result = await window.electron.import.openFileDialog(selectedFormat);

      if (!result.success) {
        if (result.error === 'User cancelled file selection.') {
          setStep('select-file');
          return;
        }
        const msg = result.error ?? 'Failed to open file.';
        setErrorMessage(msg);
        setStep('error');
        showError(msg);
        return;
      }

      setSelectedFile(result.data.filePath);
      setFileContent(result.data.content);

      if (selectedFormat === 'generic-csv') {
        const headersResult = await window.electron.import.getCsvHeaders(result.data.content);

        if (!headersResult.success) {
          setErrorMessage(headersResult.error ?? 'Failed to read CSV headers.');
          setStep('error');
          showError(headersResult.error ?? 'Failed to read CSV headers.');
          return;
        }

        setCsvHeaders(headersResult.data.headers);
        setCsvSampleRow(headersResult.data.sampleRow);
        setStep('column-mapping');
      } else {
        await parseAndCheckDuplicates(result.data.content);
      }
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Unknown error.');
      setStep('error');
      showError(err instanceof Error ? err.message : 'Failed to import file.');
    }
  }, [selectedFormat]);

  const parseAndCheckDuplicates = useCallback(async (content: string) => {
    if (!selectedFormat) return;

    try {
      const parseResult = await window.electron.import.parseFile({
        format: selectedFormat,
        filePath: selectedFile ?? '',
        content,
      });

      if (!parseResult.success) {
        setErrorMessage(parseResult.error ?? 'Failed to parse file.');
        setStep('error');
        showError(parseResult.error ?? 'Failed to parse file.');
        return;
      }

      const payload = parseResult.data;
      setParsedPayload(payload);

      const dupResult = await window.electron.import.checkDuplicates(payload);

      if (!dupResult.success) {
        setErrorMessage(dupResult.error ?? 'Failed to check duplicates.');
        setStep('error');
        showError(dupResult.error ?? 'Failed to check duplicates.');
        return;
      }

      const report = dupResult.data;

      if (report.duplicates.length > 0) {
        setDuplicateReport(report);
        setStep('duplicate-preview');
      } else {
        await commitImport(payload, {
          items: [],
          globalResolution: 'skip',
          perItemResolutions: {},
        });
      }
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Unknown error.');
      setStep('error');
      showError(err instanceof Error ? err.message : 'Import failed.');
    }
  }, [selectedFormat, selectedFile]);

  const handleColumnMapping = useCallback(async (mapping: CsvColumnMapping) => {
    if (!fileContent) return;

    setStep('importing');
    try {
      const result = await window.electron.import.parseGenericCsv({
        content: fileContent,
        columnMapping: mapping,
      });

      if (!result.success) {
        setErrorMessage(result.error ?? 'Failed to parse CSV file.');
        setStep('error');
        showError(result.error ?? 'Failed to parse CSV file.');
        return;
      }

      const payload = result.data;
      setParsedPayload(payload);

      const dupResult = await window.electron.import.checkDuplicates(payload);

      if (!dupResult.success) {
        setErrorMessage(dupResult.error ?? 'Failed to check duplicates.');
        setStep('error');
        showError(dupResult.error ?? 'Failed to check duplicates.');
        return;
      }

      const report = dupResult.data;

      if (report.duplicates.length > 0) {
        setDuplicateReport(report);
        setStep('duplicate-preview');
      } else {
        await commitImport(payload, {
          items: [],
          globalResolution: 'skip',
          perItemResolutions: {},
        });
      }
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Unknown error.');
      setStep('error');
      showError(err instanceof Error ? err.message : 'Import failed.');
    }
  }, [fileContent]);

  const handleDuplicateConfirm = useCallback(
    async (resolutionMap: DuplicateResolutionMap) => {
      if (!parsedPayload) return;
      await commitImport(parsedPayload, resolutionMap);
    },
    [parsedPayload],
  );

  const commitImport = useCallback(
    async (payload: ImportPayload, resolutionMap: DuplicateResolutionMap) => {
      setStep('committing');
      try {
        const result = await window.electron.import.commitImport({
          payload,
          resolutionMap,
        });

        if (!result.success) {
          setErrorMessage(result.error ?? 'Failed to import data.');
          setStep('error');
          showError(result.error ?? 'Failed to import data.');
          return;
        }

        setImportResult({ itemCount: result.data.importedCount });
        setStep('success');
        showSuccess(
          result.data.importedCount > 0
            ? `Successfully imported ${result.data.importedCount} items`
            : 'Import completed',
        );
      } catch (err) {
        setErrorMessage(err instanceof Error ? err.message : 'Unknown error.');
        setStep('error');
        showError(err instanceof Error ? err.message : 'Import failed.');
      }
    },
    [showSuccess, showError],
  );

  const handleBackToFileSelect = useCallback(() => {
    setStep('select-file');
  }, []);

  const handleBackToParsing = useCallback(() => {
    setStep('importing');
    setDuplicateReport(null);
  }, []);

  const handleTryAgain = useCallback(() => {
    setStep('select-format');
    setSelectedFormat(null);
    setSelectedFile(null);
    setFileContent('');
    setCsvHeaders([]);
    setCsvSampleRow([]);
    setParsedPayload(null);
    setDuplicateReport(null);
    setErrorMessage('');
  }, []);

  const formatIcons: Record<ImportFormat, string> = {
    'keepass-xml': '🗝️',
    'bitwarden-json': '🟦',
    '1password-csv': '🔑',
    'generic-csv': '📄',
    'encrypted-json': '🔒',
  };

  const formatDescriptions: Record<ImportFormat, string> = {
    'keepass-xml': 'Import from KeePass XML export (.xml)',
    'bitwarden-json': 'Import from Bitwarden JSON export (.json)',
    '1password-csv': 'Import from 1Password CSV export (.csv)',
    'generic-csv': 'Import any CSV file with custom column mapping',
    'encrypted-json': 'Import a SecurePass Manager encrypted backup (.spm)',
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      className="max-w-xl"
      ariaLabel="Import data dialog"
    >
      <div className="p-6">
        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-surface-900 dark:text-surface-50">
            Import Data
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
              Choose the format of the file you want to import:
            </p>
            <div className="grid gap-2">
              {IMPORT_FORMATS.map((fmt) => (
                <button
                  key={fmt}
                  type="button"
                  onClick={() => handleFormatSelect(fmt)}
                  className="flex items-start gap-3 rounded-lg border border-surface-200 p-3 text-left transition-all hover:border-accent-400 hover:bg-accent-50 dark:border-surface-700 dark:hover:border-accent-600 dark:hover:bg-accent-900/20"
                >
                  <span className="mt-0.5 text-xl" role="img" aria-hidden="true">
                    {formatIcons[fmt]}
                  </span>
                  <div className="flex-1">
                    <span className="text-sm font-medium text-surface-800 dark:text-surface-200">
                      {IMPORT_FORMAT_LABELS[fmt]}
                    </span>
                    <p className="mt-0.5 text-xs text-surface-400 dark:text-surface-500">
                      {formatDescriptions[fmt]}
                    </p>
                  </div>
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className="mt-1 h-4 w-4 shrink-0 text-surface-300 dark:text-surface-600"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                  </svg>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Step: Select File */}
        {step === 'select-file' && selectedFormat && (
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setStep('select-format')}
                className="text-xs text-accent-500 hover:text-accent-600 dark:text-accent-400"
              >
                &larr; Change format
              </button>
            </div>
            <div className="rounded-lg border border-surface-200 bg-surface-50 p-6 text-center dark:border-surface-700 dark:bg-surface-800">
              <p className="mb-1 text-sm font-medium text-surface-700 dark:text-surface-300">
                {IMPORT_FORMAT_LABELS[selectedFormat]}
              </p>
              <p className="mb-4 text-xs text-surface-400">
                Select a file to import
              </p>
              <button
                type="button"
                onClick={handlePickFile}
                className="notion-button-primary inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm"
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
                    d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13"
                  />
                </svg>
                Browse Files
              </button>
            </div>
          </div>
        )}

        {/* Step: Column Mapping (only for generic-csv) */}
        {step === 'column-mapping' && selectedFormat === 'generic-csv' && (
          <ColumnMapper
            csvHeaders={csvHeaders}
            sampleRow={csvSampleRow}
            onConfirm={handleColumnMapping}
            onBack={handleBackToFileSelect}
          />
        )}

        {/* Step: Importing */}
        {step === 'importing' && (
          <div className="flex flex-col items-center justify-center py-8">
            <svg
              className="mb-4 h-8 w-8 animate-spin text-accent-500"
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
            >
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            <p className="text-sm text-surface-500 dark:text-surface-400">
              Reading file...
            </p>
          </div>
        )}

        {/* Step: Duplicate Preview */}
        {step === 'duplicate-preview' && parsedPayload && duplicateReport && (
          <DuplicatePreview
            payload={parsedPayload}
            report={duplicateReport}
            onConfirm={handleDuplicateConfirm}
            onBack={handleBackToParsing}
          />
        )}

        {/* Step: Committing */}
        {step === 'committing' && (
          <div className="flex flex-col items-center justify-center py-8">
            <svg
              className="mb-4 h-8 w-8 animate-spin text-accent-500"
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
            >
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            <p className="text-sm text-surface-500 dark:text-surface-400">
              Importing data...
            </p>
          </div>
        )}

        {/* Step: Success */}
        {step === 'success' && (
          <div className="space-y-4">
            <div className="flex flex-col items-center justify-center rounded-lg border border-success-200 bg-success-50 p-6 dark:border-success-800 dark:bg-success-900/20">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="mb-2 h-10 w-10 text-success-500"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p className="text-sm font-medium text-success-700 dark:text-success-300">
                {importResult.itemCount !== undefined
                  ? `Successfully imported ${importResult.itemCount} items`
                  : 'Import completed'}
              </p>
              {selectedFile && (
                <p className="mt-1 text-xs text-success-500">
                  {selectedFile.split(/[/\\]/).pop()}
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
                onClick={handleTryAgain}
                className="notion-button-primary rounded-lg px-4 py-2 text-sm"
              >
                Import Another File
              </button>
            </div>
          </div>
        )}

        {/* Step: Error */}
        {step === 'error' && (
          <div className="space-y-4">
            <div className="flex flex-col items-center justify-center rounded-lg border border-danger-200 bg-danger-50 p-6 dark:border-danger-800 dark:bg-danger-900/20">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="mb-2 h-10 w-10 text-danger-500"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p className="text-sm font-medium text-danger-700 dark:text-danger-300">
                Import Failed
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
                onClick={handleTryAgain}
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
