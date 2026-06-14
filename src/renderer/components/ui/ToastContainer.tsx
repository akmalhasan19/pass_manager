import React from 'react';
import { AnimatePresence } from 'framer-motion';
import { useToastStore } from '../../stores/toastStore';
import Toast from './Toast';

export default function ToastContainer(): React.ReactElement {
  const toasts = useToastStore((state) => state.toasts);
  const removeToast = useToastStore((state) => state.removeToast);

  return (
    <div className="fixed bottom-6 right-6 z-[100] flex flex-col gap-2 pointer-events-none">
      <AnimatePresence mode="popLayout">
        {toasts.map((toast) => (
          <Toast
            key={toast.id}
            id={toast.id}
            message={toast.message}
            type={toast.type}
            durationMs={toast.durationMs}
            onDismiss={removeToast}
          />
        ))}
      </AnimatePresence>
    </div>
  );
}
