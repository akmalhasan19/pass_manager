import { create } from 'zustand';

export type ActiveView = 'folder' | 'item' | 'health' | 'trash' | 'settings';

interface UIState {
  sidebarOpen: boolean;
  darkMode: boolean;
  quickFindOpen: boolean;
  activeView: ActiveView;
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
  toggleDarkMode: () => void;
  setDarkMode: (dark: boolean) => void;
  toggleQuickFind: () => void;
  setQuickFindOpen: (open: boolean) => void;
  setActiveView: (view: ActiveView) => void;
}

function getInitialDarkMode(): boolean {
  if (typeof window === 'undefined') return false;
  const stored = localStorage.getItem('sp-dark-mode');
  if (stored !== null) return stored === 'true';
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function applyDarkMode(dark: boolean): void {
  const root = document.documentElement;
  if (dark) {
    root.classList.add('dark');
  } else {
    root.classList.remove('dark');
  }
  localStorage.setItem('sp-dark-mode', String(dark));
}

const initialDark = getInitialDarkMode();
applyDarkMode(initialDark);

export const useUIStore = create<UIState>((set) => ({
  sidebarOpen: true,
  darkMode: initialDark,
  quickFindOpen: false,
  activeView: 'folder',

  toggleSidebar: () =>
    set((state) => ({ sidebarOpen: !state.sidebarOpen })),

  setSidebarOpen: (open: boolean) => set({ sidebarOpen: open }),

  toggleDarkMode: () =>
    set((state) => {
      const next = !state.darkMode;
      applyDarkMode(next);
      return { darkMode: next };
    }),

  setDarkMode: (dark: boolean) => {
    applyDarkMode(dark);
    set({ darkMode: dark });
  },

  toggleQuickFind: () =>
    set((state) => ({ quickFindOpen: !state.quickFindOpen })),

  setQuickFindOpen: (open: boolean) => set({ quickFindOpen: open }),

  setActiveView: (view: ActiveView) => set({ activeView: view }),
}));
