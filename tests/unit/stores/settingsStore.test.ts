import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useSettingsStore } from '../../../src/renderer/stores/settingsStore';

const mockElectron = {
  settings: {
    getAll: vi.fn(),
    set: vi.fn(),
  },
};

vi.stubGlobal('window', {
  electron: mockElectron,
  dispatchEvent: vi.fn(),
  addEventListener: vi.fn(),
});

describe('settingsStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSettingsStore.setState({
      settings: {
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
      },
      isLoaded: false,
      isLoading: false,
      error: null,
    });
  });

  describe('initial state', () => {
    it('should have default settings', () => {
      const { settings } = useSettingsStore.getState();
      expect(settings.autoLockTime).toBe(300000);
      expect(settings.theme).toBe('system');
      expect(settings.defaultPasswordLength).toBe(20);
      expect(settings.trashAutoPurgeDays).toBe(30);
      expect(settings.passwordHealthOldDays).toBe(90);
    });

    it('should have isLoaded false initially', () => {
      expect(useSettingsStore.getState().isLoaded).toBe(false);
    });

    it('should have isLoading false initially', () => {
      expect(useSettingsStore.getState().isLoading).toBe(false);
    });

    it('should have no error initially', () => {
      expect(useSettingsStore.getState().error).toBeNull();
    });
  });

  describe('loadSettings', () => {
    it('should load settings and merge with defaults', async () => {
      mockElectron.settings.getAll.mockResolvedValue({
        autoLockTime: 600000,
        theme: 'dark',
      });

      await useSettingsStore.getState().loadSettings();

      const { settings, isLoaded, isLoading, error } = useSettingsStore.getState();
      expect(settings.autoLockTime).toBe(600000);
      expect(settings.theme).toBe('dark');
      // Defaults should be preserved for keys not returned
      expect(settings.defaultPasswordLength).toBe(20);
      expect(settings.trashAutoPurgeDays).toBe(30);
      expect(isLoaded).toBe(true);
      expect(isLoading).toBe(false);
      expect(error).toBeNull();
    });

    it('should be idempotent (skip if already loaded)', async () => {
      useSettingsStore.setState({ isLoaded: true });
      await useSettingsStore.getState().loadSettings();
      // getAll should NOT have been called
      expect(mockElectron.settings.getAll).not.toHaveBeenCalled();
    });

    it('should set error on failure', async () => {
      mockElectron.settings.getAll.mockRejectedValue(new Error('DB error'));

      await useSettingsStore.getState().loadSettings();

      const { isLoading, error, isLoaded } = useSettingsStore.getState();
      expect(isLoading).toBe(false);
      expect(isLoaded).toBe(false);
      expect(error).toBe('DB error');
    });

    it('should set generic error on non-Error failure', async () => {
      mockElectron.settings.getAll.mockRejectedValue('raw string error');

      await useSettingsStore.getState().loadSettings();

      expect(useSettingsStore.getState().error).toBe('Failed to load settings');
    });
  });

  describe('updateSetting', () => {
    it('should update a setting and merge into state', async () => {
      mockElectron.settings.set.mockResolvedValue(undefined);

      await useSettingsStore.getState().updateSetting('theme', 'light');

      const { settings, error } = useSettingsStore.getState();
      expect(settings.theme).toBe('light');
      // Other settings unchanged
      expect(settings.autoLockTime).toBe(300000);
      expect(error).toBeNull();
    });

    it('should update autoLockTime', async () => {
      mockElectron.settings.set.mockResolvedValue(undefined);

      await useSettingsStore.getState().updateSetting('autoLockTime', 120000);

      expect(useSettingsStore.getState().settings.autoLockTime).toBe(120000);
    });

    it('should update defaultPasswordLength', async () => {
      mockElectron.settings.set.mockResolvedValue(undefined);

      await useSettingsStore.getState().updateSetting('defaultPasswordLength', 32);

      expect(useSettingsStore.getState().settings.defaultPasswordLength).toBe(32);
    });

    it('should update boolean settings', async () => {
      mockElectron.settings.set.mockResolvedValue(undefined);

      await useSettingsStore.getState().updateSetting('defaultPasswordSymbols', false);

      expect(useSettingsStore.getState().settings.defaultPasswordSymbols).toBe(false);
    });

    it('should set error on failure', async () => {
      mockElectron.settings.set.mockRejectedValue(new Error('Save failed'));

      await useSettingsStore.getState().updateSetting('theme', 'dark');

      expect(useSettingsStore.getState().error).toBe('Save failed');
    });

    it('should set generic error on non-Error failure', async () => {
      mockElectron.settings.set.mockRejectedValue('fail');

      await useSettingsStore.getState().updateSetting('theme', 'dark');

      expect(useSettingsStore.getState().error).toBe('Failed to update setting');
    });
  });
});
