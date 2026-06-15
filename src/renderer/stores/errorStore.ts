import { create } from 'zustand';

export interface ErrorEntry {
  id: string;
  message: string;
  source: string;
  stack?: string;
  timestamp: number;
  details?: string;
}

interface ErrorState {
  errors: ErrorEntry[];
  isOpen: boolean;
  addError: (entry: Omit<ErrorEntry, 'id' | 'timestamp'>) => string;
  dismissError: (id: string) => void;
  clearAll: () => void;
  toggleOpen: () => void;
  setOpen: (open: boolean) => void;
}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export const useErrorStore = create<ErrorState>((set) => ({
  errors: [],
  isOpen: false,

  addError: (entry) => {
    const id = generateId();
    const errorEntry: ErrorEntry = { ...entry, id, timestamp: Date.now() };
    set((state) => ({
      errors: [...state.errors, errorEntry],
      isOpen: true,
    }));
    console.error(`[${entry.source}] ${entry.message}`, entry.stack || '');
    return id;
  },

  dismissError: (id) => {
    set((state) => ({
      errors: state.errors.filter((e) => e.id !== id),
    }));
  },

  clearAll: () => set({ errors: [] }),

  toggleOpen: () => set((state) => ({ isOpen: !state.isOpen })),

  setOpen: (open) => set({ isOpen: open }),
}));

export function captureError(
  error: unknown,
  source: string,
  details?: string,
): string {
  const message = error instanceof Error ? error.message : String(error ?? 'Unknown error');
  const stack = error instanceof Error ? error.stack : undefined;
  return useErrorStore.getState().addError({ message, source, stack, details });
}

export function formatErrorEntry(entry: ErrorEntry): string {
  const lines: string[] = [
    `[${entry.source}] ${entry.message}`,
    `Time: ${new Date(entry.timestamp).toLocaleString()}`,
  ];
  if (entry.details) lines.push(`Details: ${entry.details}`);
  if (entry.stack) lines.push(`Stack:\n${entry.stack}`);
  return lines.join('\n');
}
