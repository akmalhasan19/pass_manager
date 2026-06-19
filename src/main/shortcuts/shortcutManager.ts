/**
 * Global Keyboard Shortcut Manager
 *
 * Registers system-wide keyboard shortcuts that work even when the SecurePass
 * Manager window does not have focus. Shortcuts allow users to quickly copy
 * passwords, usernames, or trigger the quick picker overlay from any app.
 *
 * ARCHITECTURE:
 * - Uses Electron's `globalShortcut` API which registers OS-level hotkeys.
 * - Shortcuts dispatch events via IPC to the renderer process.
 * - When the main window is not focused, the shortcut triggers a quick picker
 *   overlay or copies directly to clipboard (depending on context).
 * - Default shortcuts:
 *   - Ctrl+Shift+P (Cmd+Shift+P on macOS): Copy password for active item
 *   - Ctrl+Shift+U (Cmd+Shift+U on macOS): Copy username for active item
 *   - Ctrl+Shift+L (Cmd+Shift+L on macOS): Lock vault immediately
 *
 * SECURITY:
 * - Shortcuts only respond when vault is unlocked.
 * - Clipboard auto-clear is enforced regardless of how content was copied.
 * - Shortcuts cannot be triggered if app is not running or vault is locked.
 *
 * @module shortcuts/shortcutManager
 */

import { globalShortcut, BrowserWindow } from 'electron';
import { logger } from '../../shared/logger';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Default shortcut key bindings. */
export const DEFAULT_SHORTCUTS: ShortcutMap = {
  COPY_PASSWORD: process.platform === 'darwin' ? 'Cmd+Shift+P' : 'Ctrl+Shift+P',
  COPY_USERNAME: process.platform === 'darwin' ? 'Cmd+Shift+U' : 'Ctrl+Shift+U',
  LOCK_VAULT: process.platform === 'darwin' ? 'Cmd+Shift+L' : 'Ctrl+Shift+L',
  QUICK_PICKER: process.platform === 'darwin' ? 'Cmd+Shift+Space' : 'Ctrl+Shift+Space',
};

/** Valid shortcut action identifiers. */
export type ShortcutAction = 'COPY_PASSWORD' | 'COPY_USERNAME' | 'LOCK_VAULT' | 'QUICK_PICKER';

/** Map of shortcut actions to their key bindings. */
export type ShortcutMap = Record<ShortcutAction, string>;

/** Validation result for a shortcut binding. */
export interface ShortcutValidation {
  valid: boolean;
  error?: string;
}

// ---------------------------------------------------------------------------
// Callbacks
// ---------------------------------------------------------------------------

/** Callback type invoked when a shortcut action is triggered. */
export type ShortcutHandler = (action: ShortcutAction) => void | Promise<void>;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

interface ShortcutManagerState {
  currentBindings: ShortcutMap;
  registered: boolean;
  handler: ShortcutHandler | null;
  vaultLocked: boolean;
}

const state: ShortcutManagerState = {
  currentBindings: { ...DEFAULT_SHORTCUTS },
  registered: false,
  handler: null,
  vaultLocked: true,
};

// ---------------------------------------------------------------------------
// Keyboard shortcut validation
// ---------------------------------------------------------------------------

/**
 * Validate a shortcut string to ensure it's a valid Electron globalShortcut
 * format. Returns { valid: true } or { valid: false, error: string }.
 */
export function validateShortcut(shortcut: string): ShortcutValidation {
  if (!shortcut || typeof shortcut !== 'string') {
    return { valid: false, error: 'Shortcut must be a non-empty string.' };
  }

  // Must contain at least one modifier (Cmd/Ctrl/Alt/Shift) and a key
  const hasModifier = /^(Cmd|Control|Ctrl|Alt|Shift|CmdOrCtrl|Super)\b/i.test(shortcut);
  if (!hasModifier) {
    return {
      valid: false,
      error: 'Shortcut must include at least one modifier key (Ctrl, Alt, Shift, Cmd).',
    };
  }

  // Must contain a key character after the modifier(s)
  const parts = shortcut.split('+');
  const lastPart = parts[parts.length - 1];
  if (!lastPart || lastPart.length === 0) {
    return { valid: false, error: 'Shortcut must include a key after the modifier.' };
  }

  // Valid key names
  const validKeys = new Set([
    'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M',
    'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z',
    '0', '1', '2', '3', '4', '5', '6', '7', '8', '9',
    'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12',
    'Backspace', 'Delete', 'Enter', 'Escape', 'Home', 'End', 'Insert',
    'PageUp', 'PageDown', 'Space', 'Tab', 'Up', 'Down', 'Left', 'Right',
  ]);

  if (!validKeys.has(lastPart)) {
    return {
      valid: false,
      error: `"${lastPart}" is not a valid shortcut key. Use a letter, number, or function key.`,
    };
  }

  return { valid: true };
}

// ---------------------------------------------------------------------------
// Shortcut registration
// ---------------------------------------------------------------------------

/**
 * Register all global shortcuts based on the current bindings.
 * Automatically unregisters any previously registered shortcuts first.
 *
 * @param handler - Callback invoked when a shortcut action is triggered.
 * @returns true if all shortcuts were registered successfully.
 */
export function registerShortcuts(handler: ShortcutHandler): boolean {
  // Unregister existing shortcuts first
  unregisterShortcuts();

  state.handler = handler;
  let allRegistered = true;

  for (const [action, accelerator] of Object.entries(state.currentBindings)) {
    const valid = validateShortcut(accelerator);
    if (!valid.valid) {
      logger.warn('Invalid shortcut binding, skipping', {
        action,
        accelerator,
        error: valid.error,
      });
      allRegistered = false;
      continue;
    }

    try {
      const registered = globalShortcut.register(accelerator, () => {
        if (state.vaultLocked) {
          logger.debug('Shortcut ignored: vault is locked', { action });
          return;
        }
        shortcutActionHandler(action as ShortcutAction);
      });

      if (!registered) {
        logger.warn('Failed to register global shortcut', { action, accelerator });
        allRegistered = false;
      } else {
        logger.info('Global shortcut registered', { action, accelerator });
      }
    } catch (err) {
      logger.error('Error registering global shortcut', {
        action,
        accelerator,
        error: err instanceof Error ? err.message : String(err),
      });
      allRegistered = false;
    }
  }

  state.registered = allRegistered;
  return allRegistered;
}

/**
 * Unregister all previously registered global shortcuts.
 */
export function unregisterShortcuts(): void {
  globalShortcut.unregisterAll();
  state.registered = false;
  logger.info('All global shortcuts unregistered');
}

/**
 * Update the shortcut binding for a specific action.
 * Re-registers all shortcuts if any were previously registered.
 *
 * @param action - The shortcut action to update.
 * @param accelerator - The new key binding.
 * @returns Validation result.
 */
export function updateShortcutBinding(
  action: ShortcutAction,
  accelerator: string,
): ShortcutValidation {
  const validation = validateShortcut(accelerator);
  if (!validation.valid) {
    return validation;
  }

  state.currentBindings[action] = accelerator;

  // If shortcuts are already registered, re-register with new bindings
  if (state.registered) {
    registerShortcuts(state.handler!);
  }

  return { valid: true };
}

/**
 * Get the current shortcut bindings.
 */
export function getShortcutBindings(): ShortcutMap {
  return { ...state.currentBindings };
}

/**
 * Update vault lock state. Shortcuts only respond when vault is unlocked.
 *
 * @param locked - Whether the vault is currently locked.
 */
export function setVaultLockState(locked: boolean): void {
  state.vaultLocked = locked;
  logger.debug('Vault lock state updated for shortcuts', { locked });
}

/**
 * Get whether the vault lock state.
 */
export function isVaultLocked(): boolean {
  return state.vaultLocked;
}

/**
 * Check if any shortcuts are currently registered.
 */
export function hasRegisteredShortcuts(): boolean {
  return state.registered;
}

// ---------------------------------------------------------------------------
// Internal shortcut action handler
// ---------------------------------------------------------------------------

/**
 * Handle a triggered shortcut action.
 * Dispatches to the registered handler and manages clipboard lifecycle.
 */
function shortcutActionHandler(action: ShortcutAction): void {
  logger.info('Global shortcut triggered', { action });

  // Get the main window to send events if focused
  const mainWindow = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed());

  if (mainWindow && mainWindow.isFocused()) {
    // If the main window is focused, send the action as an IPC event
    mainWindow.webContents.send('shortcut:action', { action });
  }

  // Also invoke the handler callback
  if (state.handler) {
    try {
      const result = state.handler(action);
      if (result instanceof Promise) {
        result.catch((err) => {
          logger.error('Shortcut handler async error', {
            action,
            error: err instanceof Error ? err.message : String(err),
          });
        });
      }
    } catch (err) {
      logger.error('Shortcut handler error', {
        action,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

/**
 * Clean up all shortcut resources.
 * Call this on app quit or when the vault is locked.
 */
export function cleanupShortcutManager(): void {
  unregisterShortcuts();
  state.handler = null;
  state.vaultLocked = true;
  logger.info('Shortcut manager cleaned up');
}
