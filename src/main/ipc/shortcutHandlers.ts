/**
 * IPC Handlers for Global Shortcut Configuration
 *
 * Provides IPC channels for the renderer to:
 * - Get current shortcut bindings
 * - Update individual shortcut bindings
 * - Register/unregister all shortcuts
 * - React to shortcut actions (when main window is focused)
 *
 * @module ipc/shortcutHandlers
 */

import { ipcMain, BrowserWindow } from 'electron';
import { IPC_CHANNELS } from '../../shared/ipcChannels';
import {
  registerShortcuts,
  unregisterShortcuts,
  updateShortcutBinding,
  getShortcutBindings,
  setVaultLockState,
  cleanupShortcutManager,
  type ShortcutAction,
  type ShortcutMap,
} from '../shortcuts/shortcutManager';
import { getActiveAuthVaultId } from './authHandlers';
import { ItemRepository } from '../database/repositories/ItemRepository';
import { getMasterKey } from './authHandlers';
import { decryptString } from '../crypto/encryption';
import { isDatabaseOpen } from '../database/connection';
import { writeToClipboard } from '../services/clipboardService';
import { logger } from '../../shared/logger';
import { secureClearString } from '../../shared/secureMemory';

// ---------------------------------------------------------------------------
// Singleton repository
// ---------------------------------------------------------------------------

const itemRepo = new ItemRepository();

// ---------------------------------------------------------------------------
// Shortcut action handlers (triggered when window is NOT focused)
// ---------------------------------------------------------------------------

/**
 * Handle a COPY_PASSWORD shortcut action.
 * Copies the password of the most recently active item to clipboard.
 */
function handleCopyPasswordShortcut(): void {
  if (getActiveAuthVaultId() && isDatabaseOpen()) {
    const masterKey = getMasterKey();
    if (!masterKey) return;

    try {
      // Get the most recently modified item with a password
      const allItems = itemRepo.getAll();
      // Sort by updatedAt descending, pick first with a password
      const sorted = [...allItems]
        .filter((item) => item.passwordEncrypted)
        .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));

      if (sorted.length > 0) {
        const item = sorted[0]!;
        const passwordBuf = Buffer.from(item.passwordEncrypted!);
        try {
          const plaintext = decryptString(passwordBuf, masterKey);
          writeToClipboard(plaintext, { type: 'password', clearAfterSeconds: 45, showToast: true });
          secureClearString(plaintext);
          logger.info('Global shortcut: password copied to clipboard', {
            itemId: item.id,
            title: item.title,
          });
        } finally {
          secureClearString(passwordBuf as unknown as string);
        }
      }
    } catch (err) {
      logger.error('Global shortcut: failed to copy password', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

/**
 * Handle a COPY_USERNAME shortcut action.
 * Copies the username of the most recently active item to clipboard.
 */
function handleCopyUsernameShortcut(): void {
  if (getActiveAuthVaultId() && isDatabaseOpen()) {
    const masterKey = getMasterKey();
    if (!masterKey) return;

    try {
      const allItems = itemRepo.getAll();
      const sorted = [...allItems]
        .filter((item) => item.username)
        .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));

      if (sorted.length > 0) {
        const item = sorted[0]!;
        writeToClipboard(item.username ?? '', { type: 'username', clearAfterSeconds: 45, showToast: true });
        logger.info('Global shortcut: username copied to clipboard', {
          itemId: item.id,
          title: item.title,
        });
      }
    } catch (err) {
      logger.error('Global shortcut: failed to copy username', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

/**
 * Handle a LOCK_VAULT shortcut action.
 * Locks the vault immediately from anywhere.
 */
function handleLockVaultShortcut(): void {
  if (getActiveAuthVaultId()) {
    // Import and call lock logic
    const { lockCurrentVault } = require('./authHandlers');
    lockCurrentVault();
    setVaultLockState(true);

    // Notify all windows
    BrowserWindow.getAllWindows().forEach((win) => {
      if (!win.isDestroyed()) {
        win.webContents.send(IPC_CHANNELS.SHORTCUT_ACTION, {
          action: 'LOCK_VAULT',
        });
      }
    });

    logger.info('Global shortcut: vault locked');
  }
}

// ---------------------------------------------------------------------------
// Shortcut handler router
// ---------------------------------------------------------------------------

/**
 * Route a global shortcut action to the appropriate handler.
 * This is called when the main window is NOT focused.
 */
export function handleGlobalShortcutAction(action: ShortcutAction): void {
  switch (action) {
    case 'COPY_PASSWORD':
      handleCopyPasswordShortcut();
      break;
    case 'COPY_USERNAME':
      handleCopyUsernameShortcut();
      break;
    case 'LOCK_VAULT':
      handleLockVaultShortcut();
      break;
    case 'QUICK_PICKER':
      // Quick picker is handled by the quick picker manager
      const { showQuickPicker } = require('../quickPicker/quickPickerManager');
      showQuickPicker();
      break;
    default:
      logger.warn('Unknown global shortcut action', { action });
  }
}

// ---------------------------------------------------------------------------
// IPC handler registration
// ---------------------------------------------------------------------------

/**
 * Register all IPC handlers for global shortcut configuration.
 */
export function registerShortcutHandlers(): void {
  // Get current shortcut bindings
  ipcMain.handle(IPC_CHANNELS.SHORTCUT_GET_BINDINGS, () => {
    return {
      success: true,
      data: getShortcutBindings(),
    };
  });

  // Update a single shortcut binding
  ipcMain.handle(
    IPC_CHANNELS.SHORTCUT_UPDATE_BINDING,
    (
      _event,
      { action, accelerator }: { action: ShortcutAction; accelerator: string },
    ) => {
      const result = updateShortcutBinding(action, accelerator);
      return result;
    },
  );

  // Register all shortcuts with the given handler
  ipcMain.handle(IPC_CHANNELS.SHORTCUT_REGISTER, () => {
    const registered = registerShortcuts(handleGlobalShortcutAction);
    return { success: registered };
  });

  // Unregister all shortcuts
  ipcMain.handle(IPC_CHANNELS.SHORTCUT_UNREGISTER, () => {
    unregisterShortcuts();
    return { success: true };
  });

  // Update vault lock state (called from auth handlers)
  ipcMain.handle(
    IPC_CHANNELS.SHORTCUT_ENABLED_STATE,
    (_event, { locked }: { locked: boolean }) => {
      setVaultLockState(locked);
      if (locked) {
        unregisterShortcuts();
      } else {
        registerShortcuts(handleGlobalShortcutAction);
      }
      return { success: true };
    },
  );

  logger.info('Shortcut IPC handlers registered');
}

/**
 * Cleanup shortcut handlers and resources.
 */
export function cleanupShortcutHandlers(): void {
  ipcMain.removeHandler(IPC_CHANNELS.SHORTCUT_GET_BINDINGS);
  ipcMain.removeHandler(IPC_CHANNELS.SHORTCUT_UPDATE_BINDING);
  ipcMain.removeHandler(IPC_CHANNELS.SHORTCUT_REGISTER);
  ipcMain.removeHandler(IPC_CHANNELS.SHORTCUT_UNREGISTER);
  ipcMain.removeHandler(IPC_CHANNELS.SHORTCUT_ENABLED_STATE);
  cleanupShortcutManager();
}