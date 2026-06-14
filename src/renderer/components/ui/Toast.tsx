import React, { useEffect } from 'react';
import { motion } from 'framer-motion';
import type { ToastType } from '../../stores/toastStore';

export interface ToastProps {
  id: string;
  message: string;
  type: ToastType;
  durationMs: number;
  onDismiss: (id: string) => void;
}

const typeStyles: Record<ToastType, string> = {
  success: 'bg-success-500 text-white shadow-success-500/20',
  error: 'bg-danger-500 text-white shadow-danger-500/20',
  info: 'bg-surface-800 dark:bg-surface-700 text-white shadow-surface-800/20',
};

const iconByType: Record<ToastType, React.ReactNode> = {
  success: (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      className="h-4 w-4"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
    </svg>
  ),
  error: (
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
        d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
      />
    </svg>
  ),
  info: (
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
        d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
      />
    </svg>
  ),
};

export default function Toast({
  id,
  message,
  type,
  durationMs,
  onDismiss,
}: ToastProps): React.ReactElement {
  useEffect(() => {
    const timer = setTimeout(() => {
      onDismiss(id);
    }, durationMs);
    return () => clearTimeout(timer);
  }, [id, durationMs, onDismiss]);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 16, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, x: 24, scale: 0.96 }}
      transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
      className={`pointer-events-auto flex items-center gap-2.5 rounded-lg px-4 py-2.5 text-sm font-medium shadow-lg ${typeStyles[type]}`}
      role="status"
      aria-live="polite"
    >
      {iconByType[type]}
      <span>{message}</span>
      <button
        type="button"
        onClick={() => onDismiss(id)}
        className="ml-1 rounded p-0.5 transition-colors hover:bg-white/20"
        aria-label="Dismiss notification"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className="h-3.5 w-3.5"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </motion.div>
  );
}
