import { create } from 'zustand';
import type { AppSettings } from '../../shared/types';

const DEFAULT_SETTINGS: AppSettings = {
  autoLockTime: 300000,
  theme: 'system',
  defaultPasswordLength: 20,
  defaultPasswordUppercase: true,
  defaultPasswordLowercase: true,
  defaultPasswordNumbers: true,
  defaultPasswordSymbols: true,
  defaultPasswordExcludeAmbiguous: true,
  trashAutoPurgeDays: 30,
};

type SettingKey = keyof AppSettings;

interface SettingsState {
  settings: AppSettings;
  isLoaded: boolean;
  isLoading: boolean;
  error: string | null;
  loadSettings: () => Promise<void>;
  updateSetting: <K extends SettingKey>(key: K, value: AppSettings[K]) => Promise<void>;
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  settings: { ...DEFAULT_SETTINGS },
  isLoaded: false,
  isLoading: false,
  error: null,

  loadSettings: async () => {
    if (get().isLoaded) return;
    set({ isLoading: true, error: null });
    try {
      const loaded = await window.electron.settings.getAll();
      set({
        settings: { ...DEFAULT_SETTINGS, ...loaded },
        isLoaded: true,
        isLoading: false,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load settings';
      set({ isLoading: false, error: message });
    }
  },

  updateSetting: async (key, value) => {
    set({ error: null });
    try {
      await window.electron.settings.set(key, String(value));
      set((state) => ({
        settings: { ...state.settings, [key]: value },
      }));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update setting';
      set({ error: message });
    }
  },
}));
