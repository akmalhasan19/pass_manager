import { useState, useEffect, useCallback } from 'react';
import { useSettingsStore } from '../stores/settingsStore';

export interface BrowserStatus {
  registered: boolean;
  manifestPath: string;
}

export interface ExtensionStatus {
  browsers: Record<string, BrowserStatus>;
  anyInstalled: boolean;
}

interface ExtensionStatusState {
  status: ExtensionStatus | null;
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  install: () => Promise<{ success: boolean; error?: string }>;
  uninstall: () => Promise<{ success: boolean; error?: string }>;
  openStore: (browser: 'chrome' | 'firefox' | 'edge') => Promise<{ success: boolean; error?: string }>;
}

export function useExtensionStatus(): ExtensionStatusState {
  const [status, setStatus] = useState<ExtensionStatus | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { settings } = useSettingsStore();

  const refresh = useCallback(async () => {
    if (!settings.extensionIntegrationEnabled) {
      setStatus(null);
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const result = (await window.electron.extension.getStatus()) as {
        success: boolean;
        data?: ExtensionStatus;
        error?: string;
      };
      if (result.success && result.data) {
        setStatus(result.data);
      } else {
        setError(result.error ?? 'Failed to get extension status');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setIsLoading(false);
    }
  }, [settings.extensionIntegrationEnabled]);

  const install = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const result = (await window.electron.extension.installHost()) as {
        success: boolean;
        error?: string;
      };
      await refresh();
      return { success: result.success, error: result.error };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Install failed';
      setError(msg);
      return { success: false, error: msg };
    } finally {
      setIsLoading(false);
    }
  }, [refresh]);

  const uninstall = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const result = (await window.electron.extension.uninstallHost()) as {
        success: boolean;
        error?: string;
      };
      await refresh();
      return { success: result.success, error: result.error };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Uninstall failed';
      setError(msg);
      return { success: false, error: msg };
    } finally {
      setIsLoading(false);
    }
  }, [refresh]);

  const openStore = useCallback(async (browser: 'chrome' | 'firefox' | 'edge') => {
    try {
      const result = (await window.electron.extension.openStore(browser)) as {
        success: boolean;
        error?: string;
      };
      return { success: result.success, error: result.error };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to open store';
      return { success: false, error: msg };
    }
  }, []);

  useEffect(() => {
    if (settings.extensionIntegrationEnabled) {
      refresh();
    }
  }, [settings.extensionIntegrationEnabled, refresh]);

  return { status, isLoading, error, refresh, install, uninstall, openStore };
}
