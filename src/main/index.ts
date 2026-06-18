import { app, BrowserWindow, ipcMain, session, powerMonitor } from 'electron';
import { join } from 'node:path';
import { registerAuthHandlers, clearKeys } from './ipc/authHandlers';
import { registerFolderHandlers } from './ipc/folderHandlers';
import { registerItemHandlers } from './ipc/itemHandlers';
import { registerOtpHandlers } from './ipc/otpHandlers';
import { registerSearchHandlers } from './ipc/searchHandlers';
import { registerFileHandlers } from './ipc/fileHandlers';
import { registerCoverHandlers } from './ipc/coverHandlers';
import { registerSettingsHandlers } from './ipc/settingsHandlers';
import { registerHealthHandlers } from './ipc/healthHandlers';
import { registerImportHandlers } from './ipc/importHandlers';
import { registerExportHandlers } from './ipc/exportHandlers';
import { registerVaultHandlers } from './ipc/vaultHandlers';
import {
  registerShortcutHandlers,
  cleanupShortcutHandlers,
} from './ipc/shortcutHandlers';
import {
  registerQuickPickerHandlers,
  cleanupQuickPickerHandlers,
} from './ipc/quickPickerHandlers';
import {
  initializeQuickPicker,
  setQuickPickerVaultState,
  cleanupQuickPicker,
} from './quickPicker/quickPickerManager';
import {
  initAutoUpdater,
  checkForUpdates,
  downloadUpdate,
  quitAndInstall,
  disposeAutoUpdater,
} from './ipc/updateHandlers';
import { IPC_CHANNELS } from '../shared/ipcChannels';
import {
  isNativeMessagingMode,
  startNativeMessagingListener,
  stopNativeMessagingListener,
} from './native-host/listener';
import {
  startWebSocketFallbackServer,
  startDiscoveryServer,
  stopWebSocketFallbackServer,
} from './native-host/websocketServer';
import { handleExtensionRequest } from './services/extensionService';
import { logger } from '../shared/logger';

const isDev = !!process.env.VITE_DEV_SERVER_URL;

let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: false,
    frame: false,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      sandbox: true,
      spellcheck: false,
      // SECURITY: Disable DevTools in production to prevent inspection of
      // sensitive data, memory dumps, and runtime manipulation.
      devTools: isDev,
    },
  });

  // SECURITY: Block keyboard shortcuts that open DevTools in production.
  // Prevents F12, Ctrl+Shift+I (Cmd+Option+I on macOS), and Ctrl+Shift+J
  // from opening DevTools in packaged builds.
  if (!isDev) {
    win.webContents.on('before-input-event', (_event, input) => {
      const isF12 = input.key === 'F12';
      const isCtrlShiftI =
        input.key === 'I' && input.control && input.shift && !input.alt && !input.meta;
      const isCmdOptionI =
        input.key === 'I' && input.meta && input.alt && !input.control && !input.shift;
      const isCtrlShiftJ =
        input.key === 'J' && input.control && input.shift && !input.alt && !input.meta;
      const isCmdOptionJ =
        input.key === 'J' && input.meta && input.alt && !input.control && !input.shift;

      if (isF12 || isCtrlShiftI || isCmdOptionI || isCtrlShiftJ || isCmdOptionJ) {
        _event.preventDefault();
      }
    });
  }

  if (isDev) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL!);
    win.webContents.openDevTools({ mode: 'detach' });
  } else {
    win.loadFile(join(__dirname, '../../dist/index.html'));
  }

  win.once('ready-to-show', () => {
    win.show();
  });

  win.on('closed', () => {
    mainWindow = null;
  });

  mainWindow = win;

  // Initialize auto-updater
  initAutoUpdater(win);
}

function setCSP(): void {
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const csp = [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      "connect-src 'self' ws: http://localhost:*",
      "frame-ancestors 'none'",
      "form-action 'none'",
      "base-uri 'self'",
    ].join('; ');

    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [csp],
      },
    });
  });
}

function registerAllHandlers(): void {
  registerAuthHandlers();
  registerFolderHandlers();
  registerItemHandlers();
  registerOtpHandlers();
  registerSearchHandlers();
  registerFileHandlers();
  registerCoverHandlers();
  registerSettingsHandlers();
  registerHealthHandlers();
  registerImportHandlers();
  registerExportHandlers();
  registerVaultHandlers();
  registerShortcutHandlers();
  registerQuickPickerHandlers();

  // Auto-updater IPC handlers
  ipcMain.handle(IPC_CHANNELS.CHECK_FOR_UPDATES, async () => {
    return await checkForUpdates();
  });

  ipcMain.handle(IPC_CHANNELS.DOWNLOAD_UPDATE, async () => {
    await downloadUpdate();
  });

  ipcMain.handle(IPC_CHANNELS.QUIT_AND_INSTALL, () => {
    quitAndInstall();
  });

  // Power monitor events → forward to renderer
  powerMonitor.on('lock-screen', () => {
    mainWindow?.webContents.send(IPC_CHANNELS.POWER_MONITOR_LOCK_SCREEN);
  });

  powerMonitor.on('suspend', () => {
    mainWindow?.webContents.send(IPC_CHANNELS.POWER_MONITOR_SUSPEND);
  });

  // Window control handlers
  ipcMain.handle(IPC_CHANNELS.WINDOW_MINIMIZE, () => {
    mainWindow?.minimize();
  });

  ipcMain.handle(IPC_CHANNELS.WINDOW_MAXIMIZE, () => {
    if (mainWindow?.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow?.maximize();
    }
  });

  ipcMain.handle(IPC_CHANNELS.WINDOW_CLOSE, () => {
    mainWindow?.close();
  });

  ipcMain.handle(IPC_CHANNELS.WINDOW_IS_MAXIMIZED, () => {
    return mainWindow?.isMaximized() ?? false;
  });
}

const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    // If launched as a native messaging host (stdin is a pipe), start the
    // native messaging listener and skip the normal Electron GUI flow.
    if (isNativeMessagingMode()) {
      logger.info('App launched in native messaging mode');
      startNativeMessagingListener({
        onRequest: handleExtensionRequest,
      }).catch((err) => {
        logger.error('Native messaging listener failed', {
          cause: err instanceof Error ? err.message : String(err),
        });
        app.quit();
      });
      return;
    }

    // Start WebSocket fallback server for browser extension communication
    // This allows the extension to connect even when Native Messaging is unavailable
    startWebSocketFallbackServer({
      onRequest: handleExtensionRequest,
    })
      .then((wsPort) => {
        logger.info('WebSocket fallback server started', { wsPort });
        // Start the discovery server on the fixed port for extension discovery
        return startDiscoveryServer();
      })
      .then((discoveryPort) => {
        logger.info('WebSocket discovery server started', { discoveryPort });
      })
      .catch((err) => {
        logger.warn('Failed to start WebSocket fallback server (non-fatal)', {
          error: err instanceof Error ? err.message : String(err),
        });
      });

    setCSP();
    registerAllHandlers();
    createWindow();
    initializeQuickPicker();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      }
    });
  });

  app.on('before-quit', () => {
    // SECURITY: Wipe decryption keys from memory before process exits
    clearKeys();
    cleanupShortcutHandlers();
    cleanupQuickPickerHandlers();
    cleanupQuickPicker();
    disposeAutoUpdater();
    stopWebSocketFallbackServer();
    // Stop native messaging listener if running (sends HOST_SHUTDOWN notification)
    if (isNativeMessagingMode()) {
      stopNativeMessagingListener();
    }
    mainWindow = null;
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });
}
