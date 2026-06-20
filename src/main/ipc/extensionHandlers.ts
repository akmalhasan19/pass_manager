/**
 * IPC Handlers for Browser Extension Integration
 *
 * Provides the main-process side of the extension wizard/setup flow:
 * - Query native-messaging host installation status per browser
 * - Install / uninstall host manifests
 * - Open store download pages for Chrome / Firefox / Edge
 *
 * @module ipc/extensionHandlers
 */

import { ipcMain, shell } from 'electron';
import { IPC_CHANNELS } from '../../shared/ipcChannels';
import {
  getNativeHostStatus,
  installNativeHost,
  uninstallNativeHost,
} from '../native-host/installer';
import { logger } from '../../shared/logger';

/** Placeholder extension IDs for each browser store.
 *  Replace with real store IDs once published. */
const EXTENSION_ID_CHROME = 'your-chrome-extension-id';
const EXTENSION_ID_FIREFOX = 'securepass-manager@securepass-manager.org';

const CHROME_STORE_URL = `https://chrome.google.com/webstore/detail/${EXTENSION_ID_CHROME}`;
const FIREFOX_STORE_URL = `https://addons.mozilla.org/en-US/firefox/addon/securepass-manager/`;
const EDGE_STORE_URL = `https://microsoftedge.microsoft.com/addons/detail/securepass-manager`;

export function registerExtensionHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.EXTENSION_GET_STATUS, async () => {
    try {
      const status = getNativeHostStatus({ browsers: ['chrome', 'firefox', 'edge'] });
      return { success: true, data: status };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('Extension get status failed', { error: message });
      return { success: false, error: message };
    }
  });

  ipcMain.handle(IPC_CHANNELS.EXTENSION_INSTALL_HOST, async (_event, { allowedExtensionIds }: { allowedExtensionIds?: string[] } = {}) => {
    try {
      const result = installNativeHost({
        allowedExtensionIds: allowedExtensionIds ?? [EXTENSION_ID_CHROME, EXTENSION_ID_FIREFOX],
      });
      return { success: result.allSucceeded, data: result };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('Extension install host failed', { error: message });
      return { success: false, error: message };
    }
  });

  ipcMain.handle(IPC_CHANNELS.EXTENSION_UNINSTALL_HOST, async () => {
    try {
      const result = uninstallNativeHost();
      return { success: result.allSucceeded, data: result };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('Extension uninstall host failed', { error: message });
      return { success: false, error: message };
    }
  });

  ipcMain.handle(IPC_CHANNELS.EXTENSION_OPEN_STORE, async (_event, { browser }: { browser: 'chrome' | 'firefox' | 'edge' }) => {
    try {
      const url = browser === 'chrome' ? CHROME_STORE_URL : browser === 'firefox' ? FIREFOX_STORE_URL : EDGE_STORE_URL;
      await shell.openExternal(url);
      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('Extension open store failed', { error: message });
      return { success: false, error: message };
    }
  });
}
