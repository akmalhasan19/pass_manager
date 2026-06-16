import React, { useState, useCallback, useId } from 'react';
import { useTranslation } from '../../i18n/useTranslation';
import type { CsvColumn, CsvColumnMapping } from '../../../shared/types';

interface ColumnMapperProps {
  csvHeaders: string[];
  sampleRow: string[];
  onConfirm: (mapping: CsvColumnMapping) => void;
  onBack: () => void;
}

export default function ColumnMapper({
  csvHeaders,
  sampleRow,
  onConfirm,
  onBack,
}: ColumnMapperProps): React.ReactElement {
  const { t } = useTranslation();
  const errorId = useId();
  const [mapping, setMapping] = useState<CsvColumnMapping>(() => {
    const auto: CsvColumnMapping = {};
    const lowerHeaders = csvHeaders.map((h) => h.toLowerCase().trim());

    const fields: CsvColumn[] = ['title', 'username', 'password', 'url', 'notes', 'tags'];
    for (const key of fields) {
      const idx = lowerHeaders.indexOf(key);
      if (idx !== -1) {
        auto[key] = csvHeaders[idx];
      }
    }
    return auto;
  });

  const [error, setError] = useState('');

  const usedColumns = new Set(Object.values(mapping).filter(Boolean));

  const handleSelect = useCallback(
    (fieldKey: CsvColumn, csvColumn: string) => {
      setMapping((prev) => {
        const next = { ...prev };

        for (const [k, v] of Object.entries(next)) {
          if (v === csvColumn) {
            delete next[k as CsvColumn];
          }
        }

        if (csvColumn === '') {
          delete next[fieldKey];
        } else {
          next[fieldKey] = csvColumn;
        }

        return next;
      });
      setError('');
    },
    [],
  );

  const hasDuplicates = useCallback(() => {
    const values = Object.values(mapping).filter(Boolean);
    return new Set(values).size !== values.length;
  }, [mapping]);

  const handleConfirm = useCallback(() => {
    const fields: { key: CsvColumn; labelKey: string; required: boolean }[] = [
      { key: 'title', labelKey: 'columnMapper.fields.title', required: true },
      { key: 'username', labelKey: 'columnMapper.fields.username', required: true },
      { key: 'password', labelKey: 'columnMapper.fields.password', required: true },
      { key: 'url', labelKey: 'columnMapper.fields.url', required: false },
      { key: 'notes', labelKey: 'columnMapper.fields.notes', required: false },
      { key: 'tags', labelKey: 'columnMapper.fields.tags', required: false },
    ];

    const missing = fields.filter(
      (f) => f.required && !mapping[f.key],
    );

    if (missing.length > 0) {
      setError(
        t('columnMapper.error.requiredFields', {
          fields: missing.map((f) => t(f.labelKey)).join(', '),
        }),
      );
      return;
    }

    if (hasDuplicates()) {
      setError(t('columnMapper.error.duplicateColumns'));
      return;
    }

    onConfirm(mapping);
  }, [mapping, onConfirm, hasDuplicates, t]);

  const getAvailableColumns = (fieldKey: CsvColumn): string[] => {
    const current = mapping[fieldKey];
    return ['', ...csvHeaders].filter(
      (col) => col === '' || col === current || !usedColumns.has(col),
    );
  };

  const fieldDefs: { key: CsvColumn; labelKey: string; descKey: string; required: boolean }[] = [
    { key: 'title', labelKey: 'columnMapper.fields.title', descKey: 'columnMapper.fields.title.desc', required: true },
    { key: 'username', labelKey: 'columnMapper.fields.username', descKey: 'columnMapper.fields.username.desc', required: true },
    { key: 'password', labelKey: 'columnMapper.fields.password', descKey: 'columnMapper.fields.password.desc', required: true },
    { key: 'url', labelKey: 'columnMapper.fields.url', descKey: 'columnMapper.fields.url.desc', required: false },
    { key: 'notes', labelKey: 'columnMapper.fields.notes', descKey: 'columnMapper.fields.notes.desc', required: false },
    { key: 'tags', labelKey: 'columnMapper.fields.tags', descKey: 'columnMapper.fields.tags.desc', required: false },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onBack}
          className="text-xs text-accent-500 hover:text-accent-600 dark:text-accent-400"
        >
          {t('columnMapper.changeFile')}
        </button>
      </div>

      <div>
        <p className="text-sm text-surface-500 dark:text-surface-400">
          {t('columnMapper.instruction')}
        </p>
      </div>

      <div className="overflow-hidden rounded-lg border border-surface-200 dark:border-surface-700">
        <div className="bg-surface-50 px-3 py-1.5 text-xs font-medium text-surface-500 dark:bg-surface-800 dark:text-surface-400">
          {t('columnMapper.csvPreview')}
        </div>
        <div className="overflow-x-auto p-3">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="text-surface-500 dark:text-surface-400">
                {csvHeaders.map((header, idx) => (
                  <th key={idx} className="px-2 py-1 font-medium">
                    {header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr className="text-surface-700 dark:text-surface-300">
                {sampleRow.map((cell, idx) => (
                  <td key={idx} className="max-w-[160px] truncate px-2 py-1">
                    {cell}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-xs font-medium text-surface-500 dark:text-surface-400">
          {t('columnMapper.columnMapping')}
        </p>
        {fieldDefs.map((field) => (
          <div
            key={field.key}
            className="flex items-center gap-3 rounded-lg border border-surface-200 p-2.5 dark:border-surface-700"
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className="text-sm font-medium text-surface-800 dark:text-surface-200">
                  {t(field.labelKey)}
                </span>
                {field.required && (
                  <span className="text-xs text-danger-500">*</span>
                )}
              </div>
              <p className="text-xs text-surface-400">{t(field.descKey)}</p>
            </div>

            <div className="flex items-center gap-2">
              {mapping[field.key] && (
                <span className="inline-flex items-center gap-1 rounded-md bg-accent-50 px-2 py-0.5 text-xs font-medium text-accent-600 dark:bg-accent-900/30 dark:text-accent-400">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className="h-3 w-3"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4"
                    />
                  </svg>
                  {mapping[field.key]}
                </span>
              )}

              <select
                value={mapping[field.key] ?? ''}
                onChange={(e) => handleSelect(field.key, e.target.value)}
                className="notion-input min-w-[140px] rounded-lg px-2 py-1.5 text-xs"
                aria-label={t('columnMapper.columnMapping') + ' ' + t(field.labelKey)}
                aria-invalid={!!error || undefined}
                aria-describedby={error ? errorId : undefined}
              >
                {getAvailableColumns(field.key).map((col) => (
                  <option key={col} value={col}>
                    {col || t('columnMapper.notMapped')}
                  </option>
                ))}
              </select>
            </div>
          </div>
        ))}
      </div>

      {error && (
        <div 
          role="alert"
          id={errorId}
          className="rounded-lg border border-danger-200 bg-danger-50 p-2.5 text-xs text-danger-600 dark:border-danger-800 dark:bg-danger-900/20 dark:text-danger-400"
        >
          {error}
        </div>
      )}

      <div className="flex justify-end gap-2 border-t border-surface-200 pt-4 dark:border-surface-700">
        <button
          type="button"
          onClick={onBack}
          className="notion-button-ghost rounded-lg px-4 py-2 text-sm"
        >
          {t('columnMapper.back')}
        </button>
        <button
          type="button"
          onClick={handleConfirm}
          className="notion-button-primary rounded-lg px-4 py-2 text-sm"
        >
          {t('columnMapper.importData')}
        </button>
      </div>
    </div>
  );
}
