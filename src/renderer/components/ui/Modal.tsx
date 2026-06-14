import React, { useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

export interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  children: React.ReactNode;
  /** Vertical alignment of the modal card. */
  position?: 'center' | 'top';
  /** Additional classes for the modal card. */
  className?: string;
  /** Accessible label for the dialog. */
  ariaLabel?: string;
  /** Click on the overlay closes the modal when true. */
  closeOnOverlayClick?: boolean;
}

const overlayVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1 },
  exit: { opacity: 0 },
};

const cardVariants = {
  hidden: { opacity: 0, y: -12, scale: 0.96 },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { duration: 0.15, ease: [0.16, 1, 0.3, 1] },
  },
  exit: {
    opacity: 0,
    y: -8,
    scale: 0.98,
    transition: { duration: 0.1, ease: 'easeIn' },
  },
};

/**
 * Reusable modal dialog with Framer Motion enter/exit animations.
 *
 * Handles Escape key dismissal and focus management basics.
 */
export default function Modal({
  isOpen,
  onClose,
  children,
  position = 'center',
  className = '',
  ariaLabel = 'Modal dialog',
  closeOnOverlayClick = true,
}: ModalProps): React.ReactElement {
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const positionClasses =
    position === 'center' ? 'items-center justify-center' : 'items-start justify-center pt-[10vh]';

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className={`fixed inset-0 z-50 flex ${positionClasses}`}
          role="dialog"
          aria-modal="true"
          aria-label={ariaLabel}
          initial="hidden"
          animate="visible"
          exit="exit"
        >
          <motion.div
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            variants={overlayVariants}
            onClick={closeOnOverlayClick ? onClose : undefined}
          />
          <motion.div
            className={`relative z-10 w-full overflow-hidden rounded-xl border border-surface-200 bg-white shadow-2xl dark:border-surface-700 dark:bg-surface-850 ${className}`}
            variants={cardVariants}
            onClick={(e) => e.stopPropagation()}
          >
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
