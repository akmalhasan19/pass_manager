import { autoUpdater, AppUpdater } from 'electron-updater';
import { BrowserWindow } from 'electron';
import { IPC_CHANNELS } from '../../shared/ipcChannels';

let updater: AppUpdater | null = null;
let isChecking = false;

/**
 * Initialize and configure the auto-updater.
 * Should be called after the main window is created.
 */
export function initAutoUpdater(mainWindow: BrowserWindow): void {
  updater = autoUpdater;

  // Configure update source (set in electron-builder.yml publish section)
  updater.autoDownload = false;
  updater.allowDowngrade = false;
  updater.autoInstallOnAppQuit = true;

  // --- Event: Update available ---
  updater.on('update-available', (info) => {
    mainWindow.webContents.send(IPC_CHANNELS.UPDATE_AVAILABLE, {
      version: info.version,
      releaseDate: info.releaseDate,
      releaseNotes: info.releaseNotes,
    });
  });

  // --- Event: No update available ---
  updater.on('update-not-available', () => {
    mainWindow.webContents.send(IPC_CHANNELS.UPDATE_NOT_AVAILABLE);
    isChecking = false;
  });

  // --- Event: Download progress ---
  updater.on('download-progress', (progress) => {
    mainWindow.webContents.send(IPC_CHANNELS.UPDATE_DOWNLOAD_PROGRESS, {
      percent: Math.round(progress.percent),
      transferred: progress.transferred,
      total: progress.total,
      bytesPerSecond: progress.bytesPerSecond,
    });
  });

  // --- Event: Update downloaded ---
  updater.on('update-downloaded', () => {
    mainWindow.webContents.send(IPC_CHANNELS.UPDATE_DOWNLOADED);
    isChecking = false;
  });

  // --- Event: Error ---
  updater.on('error', (error) => {
    mainWindow.webContents.send(IPC_CHANNELS.UPDATE_ERROR, {
      message: error.message,
    });
    isChecking = false;
  });
}

/**
 * Check for updates. Returns false if already checking.
 */
export async function checkForUpdates(): Promise<boolean> {
  if (!updater || isChecking) return false;

  try {
    isChecking = true;
    const result = await updater.checkForUpdates();
    return result !== null;
  } catch {
    isChecking = false;
    return false;
  }
}

/**
 * Download the available update.
 */
export async function downloadUpdate(): Promise<void> {
  if (!updater) return;
  await updater.downloadUpdate();
}

/**
 * Quit the app and install the downloaded update.
 */
export function quitAndInstall(): void {
  if (!updater) return;
  updater.quitAndInstall(false, true);
}

/**
 * Clean up the updater.
 */
export function disposeAutoUpdater(): void {
  if (updater) {
    updater.removeAllListeners();
    updater = null;
  }
  isChecking = false;
}
