/**
 * IPC Handlers for Secure Clipboard Management
 *
 * Menyediakan IPC channels untuk clipboard dengan auto-clear timeout,
 * toast notification, dan status monitoring.
 *
 * @module ipc/clipboardHandlers
 */

import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../shared/ipcChannels';
import {
  writeToClipboard,
  getClipboardStatus,
  onClipboardStatusChange,
  cleanupClipboardService,
  ClipboardWriteOptions,
} from '../services/clipboardService';
import { logger } from '../../shared/logger';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let statusListenerRegistered = false;
const statusListeners = new Set<Electron.WebContents>();

// ---------------------------------------------------------------------------
// IPC handler registration
// ---------------------------------------------------------------------------

/**
 * Kirim status clipboard ke semua renderer yang mendengarkan.
 */
function broadcastStatus(status: { hasAutoClear: boolean; clearInSeconds: number | null }): void {
  for (const wc of statusListeners) {
    if (!wc.isDestroyed()) {
      try {
        wc.send(IPC_CHANNELS.CLIPBOARD_STATUS, status);
      } catch {
        statusListeners.delete(wc);
      }
    }
  }
}

export function registerClipboardHandlers(): void {
  // Copy ke clipboard dengan auto-clear
  ipcMain.handle(
    IPC_CHANNELS.CLIPBOARD_COPY,
    (_event, { text, options }: { text: string; options: ClipboardWriteOptions }) => {
      try {
        const result = writeToClipboard(text, options);
        return {
          success: true,
          clearAfterSeconds: result.clearAfterSeconds,
          message: result.message,
        };
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        logger.error('Clipboard copy failed', { error });
        return { success: false, error };
      }
    },
  );

  // Clear clipboard manual
  ipcMain.handle(IPC_CHANNELS.CLIPBOARD_STATUS, () => {
    return { success: true, data: getClipboardStatus() };
  });

  // Setup listener untuk status change (dari main menu/tray)
  ipcMain.handle(IPC_CHANNELS.CLIPBOARD_ON_STATUS_CHANGE, (event) => {
    const wc = event.sender;
    statusListeners.add(wc);

    if (!statusListenerRegistered) {
      onClipboardStatusChange((status) => {
        broadcastStatus(status);
      });
      statusListenerRegistered = true;
    }

    return { success: true };
  });

  // Cleanup listener
  ipcMain.handle(IPC_CHANNELS.CLIPBOARD_CLEAR_STATUS_LISTENER, (event) => {
    statusListeners.delete(event.sender);
    return { success: true };
  });

  logger.info('Clipboard IPC handlers registered');
}

/**
 * Cleanup clipboard IPC handlers dan resources.
 */
export function cleanupClipboardHandlers(): void {
  ipcMain.removeHandler(IPC_CHANNELS.CLIPBOARD_COPY);
  ipcMain.removeHandler(IPC_CHANNELS.CLIPBOARD_STATUS);
  ipcMain.removeHandler(IPC_CHANNELS.CLIPBOARD_ON_STATUS_CHANGE);
  ipcMain.removeHandler(IPC_CHANNELS.CLIPBOARD_CLEAR_STATUS_LISTENER);
  statusListeners.clear();
  cleanupClipboardService();
  statusListenerRegistered = false;
  logger.info('Clipboard IPC handlers cleaned up');
}
