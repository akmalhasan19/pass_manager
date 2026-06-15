import React, { useState, useCallback, useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useErrorStore, formatErrorEntry } from '../../stores/errorStore';
import type { ErrorEntry } from '../../stores/errorStore';

export default function DebugPanel(): React.ReactElement {
  const { errors, isOpen, dismissError, clearAll, toggleOpen, setOpen } = useErrorStore();
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.ctrlKey && e.shiftKey && e.key === 'D') {
        e.preventDefault();
        toggleOpen();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [toggleOpen]);

  const handleCopy = useCallback(async (entry: ErrorEntry) => {
    try {
      await navigator.clipboard.writeText(formatErrorEntry(entry));
      setCopiedId(entry.id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      // Fallback for environments without clipboard API
      const ta = document.createElement('textarea');
      ta.value = formatErrorEntry(entry);
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      setCopiedId(entry.id);
      setTimeout(() => setCopiedId(null), 2000);
    }
  }, []);

  const hasErrors = errors.length > 0;

  return (
    <>
      {/* Toggle button */}
      <button
        type="button"
        onClick={toggleOpen}
        title="Debug Panel (Ctrl+Shift+D)"
        className={`fixed bottom-6 left-6 z-[200] flex h-10 w-10 items-center justify-center rounded-full shadow-lg transition-all ${
          hasErrors
            ? 'bg-danger-500 text-white shadow-danger-500/30 hover:bg-danger-600'
            : 'bg-surface-700 text-surface-300 hover:bg-surface-600 dark:bg-surface-600 dark:hover:bg-surface-500'
        }`}
      >
        {hasErrors && (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-danger-500 px-1 text-[10px] font-bold text-white">
            {errors.length > 9 ? '9+' : errors.length}
          </span>
        )}
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
            d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
          />
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
          />
        </svg>
      </button>

      {/* Panel overlay */}
      <AnimatePresence>
        {isOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 0.3 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[210] bg-black"
              onClick={() => setOpen(false)}
            />

            <motion.div
              initial={{ x: 420, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: 420, opacity: 0 }}
              transition={{ type: 'spring', damping: 28, stiffness: 300 }}
              className="fixed bottom-0 right-0 top-0 z-[220] flex w-[420px] max-w-[90vw] flex-col bg-surface-900 shadow-2xl dark:bg-surface-950"
            >
              {/* Header */}
              <div className="flex shrink-0 items-center justify-between border-b border-surface-700 px-4 py-3">
                <div className="flex items-center gap-2">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className="h-4 w-4 text-danger-400"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  </svg>
                  <h2 className="text-sm font-semibold text-surface-100">
                    Debug Log
                  </h2>
                  {hasErrors && (
                    <span className="rounded bg-danger-500/20 px-1.5 py-0.5 text-xs font-medium text-danger-400">
                      {errors.length}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  {hasErrors && (
                    <button
                      type="button"
                      onClick={clearAll}
                      className="rounded px-2 py-1 text-xs text-surface-400 transition-colors hover:bg-surface-700 hover:text-surface-200"
                    >
                      Clear all
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    className="rounded p-1.5 text-surface-400 transition-colors hover:bg-surface-700 hover:text-surface-200"
                    aria-label="Close debug panel"
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
                        d="M6 18L18 6M6 6l12 12"
                      />
                    </svg>
                  </button>
                </div>
              </div>

              {/* Error list */}
              <div className="flex-1 overflow-y-auto">
                {!hasErrors && (
                  <div className="flex flex-col items-center justify-center gap-2 py-16">
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      className="h-8 w-8 text-surface-600"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={1.5}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                      />
                    </svg>
                    <p className="text-sm text-surface-500">No errors captured</p>
                    <p className="text-xs text-surface-600">
                      Ctrl+Shift+D to toggle this panel
                    </p>
                  </div>
                )}

                {errors.map((entry) => (
                  <div
                    key={entry.id}
                    className="border-b border-surface-800 px-4 py-3 transition-colors hover:bg-surface-800/50"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        {/* Source + Time */}
                        <div className="mb-1 flex items-center gap-2">
                          <span className="rounded bg-surface-700 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-surface-400">
                            {entry.source}
                          </span>
                          <span className="text-[10px] text-surface-500">
                            {new Date(entry.timestamp).toLocaleTimeString()}
                          </span>
                        </div>
                        {/* Message */}
                        <p className="break-all text-sm font-medium text-surface-200">
                          {entry.message}
                        </p>
                        {/* Details */}
                        {entry.details && (
                          <p className="mt-1 text-xs text-surface-400">
                            {entry.details}
                          </p>
                        )}
                        {/* Stack trace (collapsible) */}
                        {entry.stack && (
                          <div className="mt-1">
                            <button
                              type="button"
                              onClick={() =>
                                setExpandedId(
                                  expandedId === entry.id ? null : entry.id,
                                )
                              }
                              className="text-xs text-accent-400 hover:text-accent-300"
                            >
                              {expandedId === entry.id
                                ? 'Hide stack trace'
                                : 'Show stack trace'}
                            </button>
                            {expandedId === entry.id && (
                              <pre className="mt-1 max-h-32 overflow-x-auto whitespace-pre-wrap rounded bg-surface-950 p-2 text-[10px] leading-relaxed text-surface-400">
                                {entry.stack}
                              </pre>
                            )}
                          </div>
                        )}
                      </div>
                      {/* Actions */}
                      <div className="flex shrink-0 gap-1">
                        <button
                          type="button"
                          onClick={() => handleCopy(entry)}
                          className="rounded p-1.5 text-surface-500 transition-colors hover:bg-surface-700 hover:text-surface-200"
                          aria-label="Copy error details"
                          title="Copy"
                        >
                          {copiedId === entry.id ? (
                            <svg
                              xmlns="http://www.w3.org/2000/svg"
                              className="h-3.5 w-3.5 text-success-400"
                              fill="none"
                              viewBox="0 0 24 24"
                              stroke="currentColor"
                              strokeWidth={2}
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                d="M5 13l4 4L19 7"
                              />
                            </svg>
                          ) : (
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
                                d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                              />
                            </svg>
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={() => dismissError(entry.id)}
                          className="rounded p-1.5 text-surface-500 transition-colors hover:bg-surface-700 hover:text-surface-200"
                          aria-label="Dismiss error"
                          title="Dismiss"
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
                              d="M6 18L18 6M6 6l12 12"
                            />
                          </svg>
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Footer */}
              <div className="flex shrink-0 items-center justify-between border-t border-surface-700 px-4 py-2.5">
                <span className="text-[10px] text-surface-500">
                  Ctrl+Shift+D to toggle
                </span>
                {hasErrors && (
                  <span className="text-[10px] text-surface-500">
                    {errors.length} error{errors.length !== 1 ? 's' : ''} •{' '}
                    {errors.filter((e) => e.stack).length} with stack trace
                  </span>
                )}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
