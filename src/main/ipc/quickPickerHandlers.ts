/**
 * IPC Handlers for Quick Picker
 *
 * Provides IPC channels for the quick picker overlay to:
 * - Search vault items with fuzzy matching
 * - Perform actions on items (copy username, password, OTP, open URL)
 * - Control overlay visibility
 *
 * @module ipc/quickPickerHandlers
 */

import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../shared/ipcChannels';
import {
  handleQuickPickerSearch,
  handleQuickPickerAction,
  showQuickPicker,
  hideQuickPicker,
  type QuickPickerAction,
  getQuickPickerAllItems,
} from '../quickPicker/quickPickerManager';
import { logger } from '../../shared/logger';

// ---------------------------------------------------------------------------
// IPC handler registration
// ---------------------------------------------------------------------------

/**
 * Register all IPC handlers for quick picker functionality.
 */
export function registerQuickPickerHandlers(): void {
  // Search vault items
  ipcMain.handle(
    IPC_CHANNELS.QUICK_PICKER_SEARCH,
    (_event, { query }: { query: string }) => {
      const results = handleQuickPickerSearch(query);
      return { success: true, data: results };
    },
  );

  // Get all items (for initial load)
  ipcMain.handle(IPC_CHANNELS.QUICK_PICKER_GET_ITEMS, () => {
    const items = getQuickPickerAllItems();
    return { success: true, data: items };
  });

  // Perform action on an item
  ipcMain.handle(
    IPC_CHANNELS.QUICK_PICKER_ACTION,
    async (_event, { itemId, action }: { itemId: string; action: QuickPickerAction }) => {
      await handleQuickPickerAction(itemId, action);
      return { success: true };
    },
  );

  // Show quick picker
  ipcMain.handle(IPC_CHANNELS.QUICK_PICKER_SHOW, () => {
    showQuickPicker();
    return { success: true };
  });

  // Hide quick picker
  ipcMain.handle(IPC_CHANNELS.QUICK_PICKER_HIDE, () => {
    hideQuickPicker();
    return { success: true };
  });

  logger.info('Quick picker IPC handlers registered');
}

/**
 * Cleanup quick picker IPC handlers.
 */
export function cleanupQuickPickerHandlers(): void {
  ipcMain.removeHandler(IPC_CHANNELS.QUICK_PICKER_SEARCH);
  ipcMain.removeHandler(IPC_CHANNELS.QUICK_PICKER_GET_ITEMS);
  ipcMain.removeHandler(IPC_CHANNELS.QUICK_PICKER_ACTION);
  ipcMain.removeHandler(IPC_CHANNELS.QUICK_PICKER_SHOW);
  ipcMain.removeHandler(IPC_CHANNELS.QUICK_PICKER_HIDE);
}
