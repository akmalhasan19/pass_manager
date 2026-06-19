/**
 * Quick Picker Overlay Manager
 *
 * Manages a system-tray icon and a lightweight overlay window that provides
 * quick access to vault items via fuzzy search. The overlay is triggered by
 * global shortcut or tray icon click.
 *
 * ARCHITECTURE:
 * - Tray icon provides system-level access point
 * - Overlay is a frameless, always-on-top BrowserWindow that appears near the
 *   system tray or at screen center
 * - Fuzzy search is performed in the main process for performance
 * - Item actions (copy username, password, OTP, open URL) are handled via IPC
 *
 * SECURITY:
 * - Overlay only appears when vault is unlocked
 * - Credentials are never persisted in the overlay window
 * - Overlay window is destroyed when vault is locked
 * - Clipboard auto-clear is enforced for all copy operations via clipboardService
 *
 * @module quickPicker/quickPickerManager
 */

import { Tray, Menu, BrowserWindow, screen, nativeImage, app } from 'electron';
import { join } from 'node:path';
import { logger } from '../../shared/logger';
import { ItemRepository } from '../database/repositories/ItemRepository';
import { getMasterKey, lockCurrentVault } from '../ipc/authHandlers';
import { decryptString } from '../crypto/encryption';
import { isDatabaseOpen } from '../database/connection';
import { secureClear, secureClearString } from '../../shared/secureMemory';
import { writeToClipboard } from '../services/clipboardService';
import { setVaultLockState } from '../shortcuts/shortcutManager';
import type { ClipboardCopyResult } from '../services/clipboardService';
import type { Item } from '../../shared/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Quick picker item representation for the overlay. */
export interface QuickPickerItem {
  id: string;
  title: string;
  username: string;
  url: string;
  emoji: string | null;
  isFavorite: boolean;
}

/** Action that can be performed on a quick picker item. */
export type QuickPickerAction =
  | 'copy_username'
  | 'copy_password'
  | 'copy_otp'
  | 'open_url';

export interface QuickPickerActionResult {
  action: QuickPickerAction;
  clipboard?: ClipboardCopyResult;
}

/** Quick picker state. */
interface QuickPickerState {
  tray: Tray | null;
  overlay: BrowserWindow | null;
  isOpen: boolean;
  vaultLocked: boolean;
  items: QuickPickerItem[];
  lastUsedItemId: string | null;
}

const state: QuickPickerState = {
  tray: null,
  overlay: null,
  isOpen: false,
  vaultLocked: true,
  items: [],
  lastUsedItemId: null,
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default clipboard auto-clear timeout in seconds. */
const CLIPBOARD_CLEAR_SECONDS = 45;

/** Overlay window dimensions. */
const OVERLAY_WIDTH = 480;
const OVERLAY_MAX_HEIGHT = 500;

// ---------------------------------------------------------------------------
// Repository
// ---------------------------------------------------------------------------

const itemRepo = new ItemRepository();

// ---------------------------------------------------------------------------
// Window Helpers
// ---------------------------------------------------------------------------

/**
 * Return the main application window rather than the quick picker overlay.
 */
function getMainWindow(): BrowserWindow | null {
  return (
    BrowserWindow.getAllWindows().find((window) => {
      if (window.isDestroyed()) return false;
      return state.overlay ? window.id !== state.overlay.id : true;
    }) ?? null
  );
}

/**
 * Bring the main app forward. When locked, this shows the lock screen because
 * the renderer derives that view from auth state.
 */
function focusMainWindow(): void {
  const mainWindow = getMainWindow();
  if (!mainWindow) {
    return;
  }

  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  mainWindow.show();
  mainWindow.focus();
}

// ---------------------------------------------------------------------------
// Fuzzy Search
// ---------------------------------------------------------------------------

/**
 * Perform fuzzy matching of a query against vault items.
 * Returns items scored by relevance (title match > username match > url match).
 *
 * @param query - The search query string.
 * @param items - All vault items to search.
 * @returns Filtered and sorted items matching the query.
 */
function fuzzySearch(query: string, items: Item[]): QuickPickerItem[] {
  if (!query || query.trim().length === 0) {
    return items
      .filter((item) => item.passwordEncrypted || item.username)
      .slice(0, 50)
      .map(toQuickPickerItem);
  }

  const normalizedQuery = query.toLowerCase().trim();
  const queryTokens = normalizedQuery.split(/\s+/);

  const scored: Array<{ item: Item; score: number }> = [];

  for (const item of items) {
    const title = (item.title ?? '').toLowerCase();
    const username = (item.username ?? '').toLowerCase();
    const url = (item.url ?? '').toLowerCase();

    let score = 0;

    for (const token of queryTokens) {
      // Exact title match (highest priority)
      if (title === token) {
        score += 100;
      }
      // Title starts with query
      else if (title.startsWith(token)) {
        score += 80;
      }
      // Title contains query
      else if (title.includes(token)) {
        score += 60;
      }

      // Username matches
      if (username === token) {
        score += 50;
      } else if (username.startsWith(token)) {
        score += 40;
      } else if (username.includes(token)) {
        score += 30;
      }

      // URL matches
      if (url.includes(token)) {
        score += 20;
      }

      // Fuzzy character match (characters in order but not contiguous)
      if (score === 0) {
        let charIndex = 0;
        for (let i = 0; i < title.length && charIndex < token.length; i++) {
          if (title[i] === token[charIndex]) {
            charIndex++;
          }
        }
        if (charIndex === token.length) {
          score += 10;
        }
      }
    }

    // Boost favorites
    if (item.isFavorite) {
      score += 5;
    }

    if (score > 0) {
      scored.push({ item, score });
    }
  }

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, 50)
    .map(({ item }) => toQuickPickerItem(item));
}

/**
 * Convert a vault Item to a QuickPickerItem (without sensitive data).
 */
function toQuickPickerItem(item: Item): QuickPickerItem {
  return {
    id: item.id,
    title: item.title,
    username: item.username ?? '',
    url: item.url ?? '',
    emoji: item.emoji ?? null,
    isFavorite: item.isFavorite,
  };
}

// ---------------------------------------------------------------------------
// Overlay Window
// ---------------------------------------------------------------------------

/**
 * Create the quick picker overlay window.
 * The window is frameless, always-on-top, and does not steal focus.
 */
function createOverlay(): BrowserWindow {
  if (state.overlay && !state.overlay.isDestroyed()) {
    return state.overlay;
  }

  const primaryDisplay = screen.getPrimaryDisplay();
  const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize;

  // Position overlay at top-center of screen
  const x = Math.round((screenWidth - OVERLAY_WIDTH) / 2);
  const y = Math.round(screenHeight * 0.15);

  const overlay = new BrowserWindow({
    width: OVERLAY_WIDTH,
    height: OVERLAY_MAX_HEIGHT,
    x,
    y,
    show: false,
    frame: false,
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    focusable: true,
    hasShadow: true,
    transparent: false,
    backgroundColor: '#1a1a2e',
    webPreferences: {
      preload: join(__dirname, '../../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      sandbox: true,
      spellcheck: false,
    },
  });

  // Load the quick picker HTML
  if (process.env.VITE_DEV_SERVER_URL) {
    overlay.loadURL(`${process.env.VITE_DEV_SERVER_URL}/quick-picker.html`);
  } else {
    overlay.loadFile(join(__dirname, '../../dist/quick-picker.html'));
  }

  // Hide instead of close to allow reuse
  overlay.on('close', (event) => {
    event.preventDefault();
    overlay.hide();
    state.isOpen = false;
  });

  // Handle blur to hide overlay (like Spotlight/Alfred)
  overlay.on('blur', () => {
    // Small delay to allow click events to process
    setTimeout(() => {
      if (state.overlay && !state.overlay.isDestroyed()) {
        state.overlay.hide();
        state.isOpen = false;
      }
    }, 150);
  });

  state.overlay = overlay;
  return overlay;
}

/**
 * Show the quick picker overlay.
 */
export function showQuickPicker(): void {
  if (state.vaultLocked) {
    logger.debug('Quick picker: vault is locked, not showing');
    return;
  }

  if (!isDatabaseOpen()) {
    logger.debug('Quick picker: database is not open');
    return;
  }

  const overlay = createOverlay();

  // Load fresh items
  try {
    const allItems = itemRepo.getAll();
    state.items = allItems
      .filter((item) => item.passwordEncrypted || item.username)
      .map(toQuickPickerItem);
  } catch (err) {
    logger.error('Quick picker: failed to load items', {
      error: err instanceof Error ? err.message : String(err),
    });
    state.items = [];
  }

  // Send items to overlay
  overlay.webContents.once('did-finish-load', () => {
    overlay.webContents.send('quick-picker:items', state.items);
  });

  if (overlay.webContents.isLoading()) {
    // Will send items after load completes
  } else {
    overlay.webContents.send('quick-picker:items', state.items);
  }

  // Show overlay without stealing focus from current app
  overlay.showInactive();
  state.isOpen = true;

  // Focus the search input after a short delay
  setTimeout(() => {
    if (overlay && !overlay.isDestroyed()) {
      overlay.webContents.send('quick-picker:focus-search');
    }
  }, 100);

  logger.info('Quick picker: overlay shown');
}

/**
 * Hide the quick picker overlay.
 */
export function hideQuickPicker(): void {
  if (state.overlay && !state.overlay.isDestroyed()) {
    state.overlay.hide();
    state.isOpen = false;
  }
}

// ---------------------------------------------------------------------------
// Item Actions
// ---------------------------------------------------------------------------

/**
 * Find the item used by the tray "Copy Last Used" command. Prefer the item
 * acted on most recently in this process; fall back to the most recently
 * updated item with a password so the command remains useful after startup.
 */
function getLastUsedPasswordItem(): Item | null {
  if (!isDatabaseOpen()) {
    return null;
  }

  if (state.lastUsedItemId) {
    const lastUsed = itemRepo.getById(state.lastUsedItemId);
    if (lastUsed?.passwordEncrypted) {
      return lastUsed;
    }
  }

  return itemRepo.getAll().find((item) => item.passwordEncrypted) ?? null;
}

/**
 * Copy the last used credential password from the tray menu.
 */
function copyLastUsedPasswordFromTray(): void {
  if (state.vaultLocked || !isDatabaseOpen()) {
    logger.warn('Tray: copy last used ignored because vault is locked');
    return;
  }

  const masterKey = getMasterKey();
  if (!masterKey) {
    logger.warn('Tray: copy last used ignored because no master key is available');
    return;
  }

  try {
    const item = getLastUsedPasswordItem();
    if (!item?.passwordEncrypted) {
      logger.warn('Tray: no password item available for Copy Last Used');
      return;
    }

    const passwordBuf = Buffer.from(item.passwordEncrypted);
    let plaintext: string | null = null;
    try {
      plaintext = decryptString(passwordBuf, masterKey);
      writeToClipboard(plaintext, {
        type: 'password',
        clearAfterSeconds: CLIPBOARD_CLEAR_SECONDS,
        showToast: true,
      });
      state.lastUsedItemId = item.id;
      logger.info('Tray: last used password copied', { itemId: item.id, title: item.title });
    } finally {
      if (plaintext) secureClearString(plaintext);
      secureClear(passwordBuf);
    }
  } catch (err) {
    logger.error('Tray: failed to copy last used password', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Handle an action on a quick picker item.
 */
export async function handleQuickPickerAction(
  itemId: string,
  action: QuickPickerAction,
): Promise<QuickPickerActionResult | null> {
  if (state.vaultLocked || !isDatabaseOpen()) {
    logger.warn('Quick picker: vault is locked, ignoring action');
    return null;
  }

  const masterKey = getMasterKey();
  if (!masterKey) {
    logger.warn('Quick picker: no master key available');
    return null;
  }

  try {
    const item = itemRepo.getById(itemId);
    if (!item) {
      logger.warn('Quick picker: item not found', { itemId });
      return null;
    }
    state.lastUsedItemId = item.id;

    let actionResult: QuickPickerActionResult | null = { action };

    switch (action) {
      case 'copy_username': {
        const username = item.username ?? '';
        if (!username) {
          logger.warn('Quick picker: item has no username', { itemId });
          return null;
        }
        actionResult = {
          action,
          clipboard: writeToClipboard(username, {
            type: 'username',
            clearAfterSeconds: CLIPBOARD_CLEAR_SECONDS,
            showToast: true,
          }),
        };
        logger.info('Quick picker: username copied', { itemId, title: item.title });
        break;
      }

      case 'copy_password': {
        if (!item.passwordEncrypted) {
          logger.warn('Quick picker: item has no password', { itemId });
          return null;
        }
        const passwordBuf = Buffer.from(item.passwordEncrypted);
        let plaintext: string | null = null;
        try {
          plaintext = decryptString(passwordBuf, masterKey);
          actionResult = {
            action,
            clipboard: writeToClipboard(plaintext, {
              type: 'password',
              clearAfterSeconds: CLIPBOARD_CLEAR_SECONDS,
              showToast: true,
            }),
          };
          logger.info('Quick picker: password copied', { itemId, title: item.title });
        } finally {
          if (plaintext) secureClearString(plaintext);
          secureClear(passwordBuf);
        }
        break;
      }

      case 'copy_otp': {
        if (!item.otpSecretEncrypted) {
          logger.warn('Quick picker: item has no OTP configured', { itemId });
          return null;
        }
        // OTP generation is handled by the totp service
        // We need to decrypt the OTP secret and generate the code
        const otpBuf = Buffer.from(item.otpSecretEncrypted);
        try {
          const otpSecret = decryptString(otpBuf, masterKey);
          const totpConfig = {
            secret: otpSecret,
            period: item.otpPeriod || 30,
            digits: item.otpDigits || 6,
            algorithm: item.otpAlgorithm || 'SHA1',
          };

          // Import and use totpService
          const { generateTOTP } = await import('../services/totpService');
          const code = generateTOTP(otpSecret, totpConfig);
          actionResult = {
            action,
            clipboard: writeToClipboard(code, {
              type: 'otp',
              clearAfterSeconds: CLIPBOARD_CLEAR_SECONDS,
              showToast: true,
            }),
          };
          secureClearString(otpSecret);
          logger.info('Quick picker: OTP copied', { itemId, title: item.title });
        } finally {
          secureClear(otpBuf);
        }
        break;
      }

      case 'open_url': {
        if (item.url) {
          const { shell } = await import('electron');
          await shell.openExternal(item.url);
          logger.info('Quick picker: URL opened', { itemId, title: item.title, url: item.url });
        }
        break;
      }
    }

    // Hide overlay after action
    hideQuickPicker();
    return actionResult;
  } catch (err) {
    logger.error('Quick picker: action failed', {
      itemId,
      action,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  hideQuickPicker();
  return null;
}

// ---------------------------------------------------------------------------
// Search Handler
// ---------------------------------------------------------------------------

/**
 * Handle search query from overlay.
 */
export function handleQuickPickerSearch(query: string): QuickPickerItem[] {
  if (!isDatabaseOpen()) {
    return [];
  }

  try {
    const allItems = itemRepo.getAll();
    return fuzzySearch(query, allItems);
  } catch (err) {
    logger.error('Quick picker: search failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}

/**
 * Get all items formatted for quick picker (without sensitive data).
 * Used for initial load of the overlay.
 */
export function getQuickPickerAllItems(): QuickPickerItem[] {
  if (!isDatabaseOpen()) {
    return [];
  }

  try {
    const allItems = itemRepo.getAll();
    return allItems
      .filter((item) => item.passwordEncrypted || item.username)
      .map(toQuickPickerItem);
  } catch (err) {
    logger.error('Quick picker: failed to get all items', {
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}

// ---------------------------------------------------------------------------
// Tray Icon
// ---------------------------------------------------------------------------

/**
 * Create the system tray icon image. Red indicates locked, green indicates
 * an unlocked vault, and gray is used before auth state is known.
 */
function createTrayIconImage(locked: boolean | null): Electron.NativeImage {
  const iconSize = 16;
  const fill = locked === null ? '#6b7280' : locked ? '#ef4444' : '#10b981';
  const statusDot = locked === false
    ? '<circle cx="12.5" cy="3.5" r="2" fill="#dcfce7"/>'
    : locked === true
      ? '<circle cx="12.5" cy="3.5" r="2" fill="#fee2e2"/>'
      : '';
  const svgDataUrl = `data:image/svg+xml;base64,${Buffer.from(
    `<svg width="${iconSize}" height="${iconSize}" xmlns="http://www.w3.org/2000/svg">
      <rect width="${iconSize}" height="${iconSize}" rx="3" fill="${fill}"/>
      <text x="50%" y="58%" dominant-baseline="middle" text-anchor="middle" fill="white" font-family="Arial, sans-serif" font-size="10" font-weight="bold">S</text>
      ${statusDot}
    </svg>`,
  ).toString('base64')}`;

  return nativeImage.createFromDataURL(svgDataUrl);
}

/**
 * Lock the vault from the tray and immediately refresh tray/shortcut state.
 */
function lockVaultFromTray(): void {
  const lockedVaultId = lockCurrentVault();
  setVaultLockState(true);
  setQuickPickerVaultState(true);
  focusMainWindow();
  logger.info('Tray: vault locked', { vaultId: lockedVaultId });
}

/**
 * Create the system tray icon.
 */
function createTrayIcon(): Tray {
  const tray = new Tray(createTrayIconImage(null));
  tray.setToolTip('SecurePass Manager - Locked');

  updateTrayMenu();

  tray.on('click', () => {
    if (state.vaultLocked) {
      focusMainWindow();
    } else {
      showQuickPicker();
    }
  });

  tray.on('double-click', () => {
    focusMainWindow();
  });

  state.tray = tray;
  return tray;
}

/**
 * Update the tray context menu based on current state.
 */
function updateTrayMenu(): void {
  if (!state.tray || state.tray.isDestroyed()) {
    return;
  }

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Open SecurePass',
      click: () => focusMainWindow(),
    },
    { type: 'separator' },
    {
      label: 'Copy Last Used',
      enabled: !state.vaultLocked,
      click: () => copyLastUsedPasswordFromTray(),
    },
    { type: 'separator' },
    {
      label: 'Lock Vault',
      enabled: !state.vaultLocked,
      click: () => lockVaultFromTray(),
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => app.quit(),
    },
  ]);

  state.tray.setContextMenu(contextMenu);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Initialize the quick picker system.
 * Creates the tray icon and sets up IPC handlers.
 */
export function initializeQuickPicker(): void {
  createTrayIcon();
  logger.info('Quick picker: initialized');
}

/**
 * Update vault lock state. Shows/hides tray based on state.
 */
export function setQuickPickerVaultState(locked: boolean): void {
  state.vaultLocked = locked;
  updateTrayMenu();

  if (locked) {
    hideQuickPicker();
  }

  // Update tray icon color based on vault state
  if (state.tray && !state.tray.isDestroyed()) {
    state.tray.setImage(createTrayIconImage(locked));
    state.tray.setToolTip(`SecurePass Manager - ${locked ? 'Locked' : 'Unlocked'}`);
  }
}

/**
 * Get whether the quick picker is currently open.
 */
export function isQuickPickerOpen(): boolean {
  return state.isOpen;
}

/**
 * Clean up quick picker resources.
 */
export function cleanupQuickPicker(): void {
  hideQuickPicker();

  // clipboard clear timer now managed by clipboardService

  if (state.overlay && !state.overlay.isDestroyed()) {
    state.overlay.destroy();
    state.overlay = null;
  }

  if (state.tray && !state.tray.isDestroyed()) {
    state.tray.destroy();
    state.tray = null;
  }

  state.isOpen = false;
  state.items = [];
  state.lastUsedItemId = null;

  logger.info('Quick picker: cleaned up');
}
