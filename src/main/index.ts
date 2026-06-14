import { app, BrowserWindow, ipcMain, session, powerMonitor } from 'electron';
import { join } from 'node:path';
import { registerAuthHandlers } from './ipc/authHandlers';
import { registerFolderHandlers } from './ipc/folderHandlers';
import { registerItemHandlers } from './ipc/itemHandlers';
import { registerSearchHandlers } from './ipc/searchHandlers';
import { registerFileHandlers } from './ipc/fileHandlers';
import { registerCoverHandlers } from './ipc/coverHandlers';
import { registerSettingsHandlers } from './ipc/settingsHandlers';
import { registerHealthHandlers } from './ipc/healthHandlers';
import { IPC_CHANNELS } from '../shared/ipcChannels';

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
      sandbox: false,
      spellcheck: false,
    },
  });

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
}

function setCSP(): void {
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const csp = [
      "default-src 'self'",
      "script-src 'self'",
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
  registerSearchHandlers();
  registerFileHandlers();
  registerCoverHandlers();
  registerSettingsHandlers();
  registerHealthHandlers();

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
    setCSP();
    registerAllHandlers();
    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      }
    });
  });

  app.on('before-quit', () => {
    mainWindow = null;
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });
}
