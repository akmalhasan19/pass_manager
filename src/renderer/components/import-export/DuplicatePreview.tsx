import React, { useState, useCallback } from 'react';
import { useTranslation } from '../../i18n/useTranslation';
import type {
  DuplicateReport,
  DuplicateResolution,
  DuplicateResolutionMap,
  ImportPayload,
} from '../../../shared/types';

interface DuplicatePreviewProps {
  payload: ImportPayload;
  report: DuplicateReport;
  onConfirm: (resolutionMap: DuplicateResolutionMap) => void;
  onBack: () => void;
}

export default function DuplicatePreview({
  payload: _payload,
  report,
  onConfirm,
  onBack,
}: DuplicatePreviewProps): React.ReactElement {
  const { t } = useTranslation();
  const [globalResolution, setGlobalResolution] = useState<DuplicateResolution>('skip');
  const [perItemResolutions, setPerItemResolutions] = useState<Record<number, DuplicateResolution>>({});

  const handleGlobalChange = useCallback((value: DuplicateResolution) => {
    setGlobalResolution(value);
    setPerItemResolutions({});
  }, []);

  const handleItemChange = useCallback(
    (index: number, value: DuplicateResolution) => {
      setPerItemResolutions((prev) => ({
        ...prev,
        [index]: value,
      }));
    },
    [],
  );

  const getItemResolution = useCallback(
    (index: number): DuplicateResolution => {
      return perItemResolutions[index] ?? globalResolution;
    },
    [perItemResolutions, globalResolution],
  );

  const uniqueImportCount = report.totalImportItems - report.duplicates.length;
  const skippedCount = report.duplicates.filter(
    (d) => getItemResolution(d.importItemIndex) === 'skip',
  ).length;
  const replacedCount = report.duplicates.filter(
    (d) => getItemResolution(d.importItemIndex) === 'replace',
  ).length;
  const renamedCount = report.duplicates.filter(
    (d) => getItemResolution(d.importItemIndex) === 'rename',
  ).length;
  const finalItemCount =
    report.totalImportItems - skippedCount;

  const handleConfirm = useCallback(() => {
    onConfirm({
      items: report.duplicates,
      globalResolution,
      perItemResolutions,
    });
  }, [report.duplicates, globalResolution, perItemResolutions, onConfirm]);

  const resolutionOptions: { value: DuplicateResolution; labelKey: string; descKey: string }[] = [
    {
      value: 'skip',
      labelKey: 'duplicatePreview.resolution.skip',
      descKey: 'duplicatePreview.resolution.skip.desc',
    },
    {
      value: 'replace',
      labelKey: 'duplicatePreview.resolution.replace',
      descKey: 'duplicatePreview.resolution.replace.desc',
    },
    {
      value: 'rename',
      labelKey: 'duplicatePreview.resolution.rename',
      descKey: 'duplicatePreview.resolution.rename.desc',
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onBack}
          className="text-xs text-accent-500 hover:text-accent-600 dark:text-accent-400"
        >
          {t('duplicatePreview.back')}
        </button>
      </div>

      <div className="rounded-lg border border-surface-200 bg-surface-50 p-4 dark:border-surface-700 dark:bg-surface-800">
        <h3 className="mb-2 text-sm font-medium text-surface-800 dark:text-surface-200">
          {t('duplicatePreview.importSummary')}
        </h3>
        <div className="grid grid-cols-3 gap-3 text-center text-xs">
          <div className="rounded-md bg-white p-2 dark:bg-surface-900">
            <div className="text-lg font-semibold text-surface-800 dark:text-surface-200">
              {report.totalImportItems}
            </div>
            <div className="text-surface-400">{t('duplicatePreview.totalItems')}</div>
          </div>
          <div className="rounded-md bg-white p-2 dark:bg-surface-900">
            <div className="text-lg font-semibold text-danger-500">
              {report.duplicates.length}
            </div>
            <div className="text-surface-400">{t('duplicatePreview.duplicatesFound')}</div>
          </div>
          <div className="rounded-md bg-white p-2 dark:bg-surface-900">
            <div className="text-lg font-semibold text-success-500">
              {uniqueImportCount}
            </div>
            <div className="text-surface-400">{t('duplicatePreview.newItems')}</div>
          </div>
        </div>
      </div>

      <div className="space-y-2">
        <label className="text-xs font-medium text-surface-500 dark:text-surface-400">
          {t('duplicatePreview.actionForAll')}
        </label>
        <div className="grid grid-cols-3 gap-2">
          {resolutionOptions.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => handleGlobalChange(opt.value)}
              className={`rounded-lg border p-2.5 text-left transition-all ${
                globalResolution === opt.value
                  ? 'border-accent-400 bg-accent-50 dark:border-accent-600 dark:bg-accent-900/20'
                  : 'border-surface-200 hover:border-surface-300 dark:border-surface-700 dark:hover:border-surface-600'
              }`}
            >
              <div className="text-sm font-medium text-surface-800 dark:text-surface-200">
                {t(opt.labelKey)}
              </div>
              <div className="mt-0.5 text-xs text-surface-400">{t(opt.descKey)}</div>
            </button>
          ))}
        </div>
      </div>

      {report.duplicates.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-surface-500 dark:text-surface-400">
            {t('duplicatePreview.perItemOverride')}
          </p>
          <div className="max-h-60 space-y-1.5 overflow-y-auto rounded-lg border border-surface-200 p-2 dark:border-surface-700">
            {report.duplicates.map((dup) => (
              <div
                key={`${dup.existingItemId}-${dup.importItemIndex}`}
                className="flex items-center gap-2 rounded-md p-2 text-xs hover:bg-surface-50 dark:hover:bg-surface-800"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="font-medium text-surface-700 dark:text-surface-300">
                      {dup.importItemTitle}
                    </span>
                    <span className="text-surface-300 dark:text-surface-600">&rarr;</span>
                    <span className="text-surface-500 line-through">
                      {dup.existingItemTitle}
                    </span>
                  </div>
                  {dup.importItemUrl && (
                    <p className="truncate text-surface-400">{dup.importItemUrl}</p>
                  )}
                </div>
                <select
                  value={getItemResolution(dup.importItemIndex)}
                  onChange={(e) =>
                    handleItemChange(
                      dup.importItemIndex,
                      e.target.value as DuplicateResolution,
                    )
                  }
                  className="notion-input min-w-[90px] rounded px-2 py-1 text-xs"
                  aria-label={t('duplicatePreview.ariaLabelResolution', { title: dup.importItemTitle })}
                >
                  {resolutionOptions.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {t(opt.labelKey)}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="rounded-lg border border-surface-200 p-3 dark:border-surface-700">
        <div className="flex items-center justify-between text-xs">
          <span className="text-surface-500">{t('duplicatePreview.totalToImport')}</span>
          <span className="font-medium text-surface-800 dark:text-surface-200">
            {finalItemCount}
          </span>
        </div>
        {skippedCount > 0 && (
          <div className="flex items-center justify-between text-xs">
            <span className="text-surface-400">{t('duplicatePreview.skipped')}</span>
            <span className="text-surface-500">{skippedCount}</span>
          </div>
        )}
        {replacedCount > 0 && (
          <div className="flex items-center justify-between text-xs">
            <span className="text-surface-400">{t('duplicatePreview.replaced')}</span>
            <span className="text-warning-500">{replacedCount}</span>
          </div>
        )}
        {renamedCount > 0 && (
          <div className="flex items-center justify-between text-xs">
            <span className="text-surface-400">{t('duplicatePreview.renamed')}</span>
            <span className="text-surface-500">{renamedCount}</span>
          </div>
        )}
      </div>

      <div className="flex justify-end gap-2 border-t border-surface-200 pt-4 dark:border-surface-700">
        <button
          type="button"
          onClick={onBack}
          className="notion-button-ghost rounded-lg px-4 py-2 text-sm"
        >
          {t('duplicatePreview.buttonBack')}
        </button>
        <button
          type="button"
          onClick={handleConfirm}
          className="notion-button-primary rounded-lg px-4 py-2 text-sm"
        >
          {finalItemCount === 1
            ? t('duplicatePreview.buttonImport', { count: finalItemCount })
            : t('duplicatePreview.buttonImport.plural', { count: finalItemCount })}
        </button>
      </div>
    </div>
  );
}
