import React, { useCallback, useEffect, useState } from 'react';
import { useSettingsStore } from '../../stores/settingsStore';
import { useExtensionStatus } from '../../hooks/useExtensionStatus';

export default function ExtensionSetupBanner(): React.ReactElement | null {
  const { settings, updateSetting } = useSettingsStore();
  const { status, isLoading, refresh, install, openStore } = useExtensionStatus();
  const [installing, setInstalling] = useState(false);

  // Refresh status when the component mounts and extension is enabled
  useEffect(() => {
    if (settings.extensionIntegrationEnabled) {
      refresh();
    }
  }, [settings.extensionIntegrationEnabled, refresh]);

  const dismiss = useCallback(() => {
    updateSetting('extensionSetupDismissed', true);
  }, [updateSetting]);

  const handleInstall = useCallback(async () => {
    setInstalling(true);
    try {
      await install();
    } finally {
      setInstalling(false);
    }
  }, [install]);

  const handleOpenChromeStore = useCallback(async () => {
    await openStore('chrome');
  }, [openStore]);

  // Show conditions:
  // 1. Extension integration is enabled
  // 2. Not already dismissed
  // 3. Status loaded and no host is installed
  if (!settings.extensionIntegrationEnabled || settings.extensionSetupDismissed) {
    return null;
  }

  if (!status) {
    return null;
  }

  if (status.anyInstalled) {
    return null;
  }

  return (
    <div className="relative z-40 border-b border-accent-100 bg-accent-50 px-4 py-3 dark:border-accent-800 dark:bg-accent-900/20">
      <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent-100 text-accent-600 dark:bg-accent-800/50 dark:text-accent-300">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-5 w-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"
              />
            </svg>
          </div>
          <div>
            <h3 className="text-sm font-semibold text-accent-900 dark:text-accent-100">
              Browser Extension Not Connected
            </h3>
            <p className="mt-0.5 text-xs text-accent-700 dark:text-accent-300">
              Install the SecurePass browser extension to enable autofill and quick access from Chrome, Firefox, or Edge.
            </p>
          </div>
        </div>

        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
          <button
            onClick={handleInstall}
            disabled={installing || isLoading}
            className="inline-flex items-center gap-1.5 rounded-md bg-accent-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-accent-700 disabled:opacity-50"
          >
            {installing ? 'Installing...' : 'Install Native Host'}
          </button>

          <button
            onClick={handleOpenChromeStore}
            className="inline-flex items-center gap-1.5 rounded-md border border-accent-200 bg-white px-3 py-1.5 text-xs font-medium text-accent-700 transition-colors hover:bg-accent-50 dark:border-accent-700 dark:bg-accent-900/20 dark:text-accent-300 dark:hover:bg-accent-900/40"
          >
            Get Extension
          </button>

          <button
            onClick={dismiss}
            className="rounded-md px-2 py-1.5 text-xs font-medium text-accent-600 hover:bg-accent-100 dark:text-accent-300 dark:hover:bg-accent-900/30"
          >
            Dismiss
          </button>
        </div>
      </div>
    </div>
  );
}
