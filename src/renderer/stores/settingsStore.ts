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
  passwordHealthOldDays: 90,
  otpPrivacyMode: false,
};

type SettingKey = keyof AppSettings;

interface SettingsState {
  settings: AppSettings;
  isLoaded: boolean;
  isLoading: boolean;
  error: string | null;
  loadSettings: () => Promise<void>;
  updateSetting: <K extends SettingKey>(key: K, value: AppSettings[K]) => Promise<void>;
  reset: () => void;
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
      const parsed: AppSettings = { ...DEFAULT_SETTINGS };
      const defaults = DEFAULT_SETTINGS as unknown as Record<string, unknown>;
      const target = parsed as unknown as Record<string, unknown>;
      for (const [key, value] of Object.entries(loaded)) {
        if (key in defaults) {
          const defaultVal = defaults[key];
          if (typeof defaultVal === 'boolean') {
            target[key] = value === 'true' || value === true;
          } else if (typeof defaultVal === 'number') {
            target[key] = Number(value);
          } else {
            target[key] = value;
          }
        }
      }
      set({
        settings: parsed,
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

  /**
   * Reset settings store to unloaded state.
   * Called during vault switch/lock so the next vault loads its own settings.
   */
  reset: () =>
    set({
      settings: { ...DEFAULT_SETTINGS },
      isLoaded: false,
      isLoading: false,
      error: null,
    }),
}));
