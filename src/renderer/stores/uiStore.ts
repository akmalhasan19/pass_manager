import { create } from 'zustand';

export type ActiveView = 'home' | 'folder' | 'item' | 'health' | 'trash' | 'settings';

interface UIState {
  sidebarOpen: boolean;
  /** Reflects the effective dark mode currently applied to the UI. */
  darkMode: boolean;
  quickFindOpen: boolean;
  activeView: ActiveView;
  centerPanelVisible: boolean;
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
  /** @deprecated Use the Theme setting in settingsStore instead. */
  toggleDarkMode: () => void;
  setDarkMode: (dark: boolean) => void;
  toggleQuickFind: () => void;
  setQuickFindOpen: (open: boolean) => void;
  setActiveView: (view: ActiveView) => void;
  toggleCenterPanel: () => void;
  setCenterPanelVisible: (visible: boolean) => void;
  reset: () => void;
}

function getInitialDarkMode(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export const useUIStore = create<UIState>((set) => ({
  sidebarOpen: true,
  darkMode: getInitialDarkMode(),
  quickFindOpen: false,
  activeView: 'home',
  centerPanelVisible: true,

  toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),

  setSidebarOpen: (open: boolean) => set({ sidebarOpen: open }),

  toggleDarkMode: () => set((state) => ({ darkMode: !state.darkMode })),

  setDarkMode: (dark: boolean) => set({ darkMode: dark }),

  toggleQuickFind: () => set((state) => ({ quickFindOpen: !state.quickFindOpen })),

  setQuickFindOpen: (open: boolean) => set({ quickFindOpen: open }),

  setActiveView: (view: ActiveView) => set({ activeView: view }),

  toggleCenterPanel: () => set((state) => ({ centerPanelVisible: !state.centerPanelVisible })),

  setCenterPanelVisible: (visible: boolean) => set({ centerPanelVisible: visible }),

  reset: () =>
    set({
      activeView: 'home',
      centerPanelVisible: true,
      quickFindOpen: false,
    }),
}));
