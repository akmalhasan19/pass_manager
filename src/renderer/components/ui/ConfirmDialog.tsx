import React from 'react';
import Modal from './Modal';

export interface ConfirmDialogProps {
  isOpen: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'danger' | 'primary';
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmDialog({
  isOpen,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'primary',
  onConfirm,
  onCancel,
}: ConfirmDialogProps): React.ReactElement {
  return (
    <Modal
      isOpen={isOpen}
      onClose={onCancel}
      position="center"
      className="max-w-sm"
      ariaLabel={title}
    >
      <div className="p-5 space-y-4">
        <div className="flex items-start gap-3">
          <div
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${
              variant === 'danger'
                ? 'bg-danger-50 text-danger-500 dark:bg-danger-500/10'
                : 'bg-accent-50 text-accent-500 dark:bg-accent-900/20'
            }`}
          >
            {variant === 'danger' ? (
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            )}
          </div>
          <div>
            <h3 className="text-base font-semibold text-surface-900 dark:text-surface-50">
              {title}
            </h3>
            <p className="mt-1 text-sm text-surface-500 dark:text-surface-400">
              {message}
            </p>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            className="notion-button-ghost h-9 text-sm"
            onClick={onCancel}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            className={`h-9 text-sm notion-button ${
              variant === 'danger' ? 'notion-button-danger' : 'notion-button-primary'
            }`}
            onClick={() => {
              onConfirm();
              onCancel();
            }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </Modal>
  );
}
