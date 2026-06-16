import React, { useState, useCallback } from 'react';
import type { CsvColumn, CsvColumnMapping } from '../../../shared/types';

const SECUREPASS_FIELDS: { key: CsvColumn; label: string; required: boolean; description: string }[] = [
  { key: 'title', label: 'Title', required: true, description: 'Entry name / title' },
  { key: 'username', label: 'Username', required: true, description: 'Login username' },
  { key: 'password', label: 'Password', required: true, description: 'Login password' },
  { key: 'url', label: 'URL', required: false, description: 'Website URL' },
  { key: 'notes', label: 'Notes', required: false, description: 'Additional notes' },
  { key: 'tags', label: 'Tags', required: false, description: 'Comma-separated tags' },
];

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
  const [mapping, setMapping] = useState<CsvColumnMapping>(() => {
    const auto: CsvColumnMapping = {};
    const lowerHeaders = csvHeaders.map((h) => h.toLowerCase().trim());

    for (const field of SECUREPASS_FIELDS) {
      const idx = lowerHeaders.indexOf(field.key);
      if (idx !== -1) {
        auto[field.key] = csvHeaders[idx];
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
    const missing = SECUREPASS_FIELDS.filter(
      (f) => f.required && !mapping[f.key],
    );

    if (missing.length > 0) {
      setError(
        `Please map the required fields: ${missing.map((f) => f.label).join(', ')}`,
      );
      return;
    }

    if (hasDuplicates()) {
      setError('Each CSV column can only be mapped to one SecurePass field.');
      return;
    }

    onConfirm(mapping);
  }, [mapping, onConfirm, hasDuplicates]);

  const getAvailableColumns = (fieldKey: CsvColumn): string[] => {
    const current = mapping[fieldKey];
    return ['', ...csvHeaders].filter(
      (col) => col === '' || col === current || !usedColumns.has(col),
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onBack}
          className="text-xs text-accent-500 hover:text-accent-600 dark:text-accent-400"
        >
          &larr; Change file
        </button>
      </div>

      <div>
        <p className="text-sm text-surface-500 dark:text-surface-400">
          Map your CSV columns to SecurePass fields. Drag or select from the dropdowns below.
        </p>
      </div>

      {/* CSV Preview */}
      <div className="overflow-hidden rounded-lg border border-surface-200 dark:border-surface-700">
        <div className="bg-surface-50 px-3 py-1.5 text-xs font-medium text-surface-500 dark:bg-surface-800 dark:text-surface-400">
          CSV Preview
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

      {/* Column Mapping */}
      <div className="space-y-2">
        <p className="text-xs font-medium text-surface-500 dark:text-surface-400">
          Column Mapping
        </p>
        {SECUREPASS_FIELDS.map((field) => (
          <div
            key={field.key}
            className="flex items-center gap-3 rounded-lg border border-surface-200 p-2.5 dark:border-surface-700"
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className="text-sm font-medium text-surface-800 dark:text-surface-200">
                  {field.label}
                </span>
                {field.required && (
                  <span className="text-xs text-danger-500">*</span>
                )}
              </div>
              <p className="text-xs text-surface-400">{field.description}</p>
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
                aria-label={`Map ${field.label} to CSV column`}
              >
                {getAvailableColumns(field.key).map((col) => (
                  <option key={col} value={col}>
                    {col || '— Not mapped —'}
                  </option>
                ))}
              </select>
            </div>
          </div>
        ))}
      </div>

      {error && (
        <div className="rounded-lg border border-danger-200 bg-danger-50 p-2.5 text-xs text-danger-600 dark:border-danger-800 dark:bg-danger-900/20 dark:text-danger-400">
          {error}
        </div>
      )}

      {/* Actions */}
      <div className="flex justify-end gap-2 border-t border-surface-200 pt-4 dark:border-surface-700">
        <button
          type="button"
          onClick={onBack}
          className="notion-button-ghost rounded-lg px-4 py-2 text-sm"
        >
          Back
        </button>
        <button
          type="button"
          onClick={handleConfirm}
          className="notion-button-primary rounded-lg px-4 py-2 text-sm"
        >
          Import Data
        </button>
      </div>
    </div>
  );
}
