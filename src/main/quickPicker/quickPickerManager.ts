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

import { Tray, Menu, BrowserWindow, screen, nativeImage } from 'electron';
import { join } from 'node:path';
import { logger } from '../../shared/logger';
import { ItemRepository } from '../database/repositories/ItemRepository';
import { getActiveAuthVaultId, getMasterKey } from '../ipc/authHandlers';
import { decryptString } from '../crypto/encryption';
import { isDatabaseOpen } from '../database/connection';
import { secureClearString } from '../../shared/secureMemory';
import { writeToClipboard } from '../services/clipboardService';
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

/** Quick picker state. */
interface QuickPickerState {
  tray: Tray | null;
  overlay: BrowserWindow | null;
  isOpen: boolean;
  vaultLocked: boolean;
  items: QuickPickerItem[];
}

const state: QuickPickerState = {
  tray: null,
  overlay: null,
  isOpen: false,
  vaultLocked: true,
  items: [],
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
 * Handle an action on a quick picker item.
 */
export async function handleQuickPickerAction(
  itemId: string,
  action: QuickPickerAction,
): Promise<void> {
  if (state.vaultLocked || !isDatabaseOpen()) {
    logger.warn('Quick picker: vault is locked, ignoring action');
    return;
  }

  const masterKey = getMasterKey();
  if (!masterKey) {
    logger.warn('Quick picker: no master key available');
    return;
  }

  try {
    const item = itemRepo.getById(itemId);
    if (!item) {
      logger.warn('Quick picker: item not found', { itemId });
      return;
    }

    switch (action) {
      case 'copy_username': {
        const username = item.username ?? '';
        writeToClipboard(username, { type: 'username', clearAfterSeconds: 45, showToast: true });
        logger.info('Quick picker: username copied', { itemId, title: item.title });
        break;
      }

      case 'copy_password': {
        if (!item.passwordEncrypted) {
          logger.warn('Quick picker: item has no password', { itemId });
          return;
        }
        const passwordBuf = Buffer.from(item.passwordEncrypted);
        try {
          const plaintext = decryptString(passwordBuf, masterKey);
          writeToClipboard(plaintext, { type: 'password', clearAfterSeconds: 45, showToast: true });
          secureClearString(plaintext);
          logger.info('Quick picker: password copied', { itemId, title: item.title });
        } finally {
          secureClearString(passwordBuf as unknown as string);
        }
        break;
      }

      case 'copy_otp': {
        if (!item.otpSecretEncrypted) {
          logger.warn('Quick picker: item has no OTP configured', { itemId });
          return;
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
          writeToClipboard(code, { type: 'otp', clearAfterSeconds: 45, showToast: true });
          secureClearString(otpSecret);
          logger.info('Quick picker: OTP copied', { itemId, title: item.title });
        } finally {
          secureClearString(otpBuf as unknown as string);
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
  } catch (err) {
    logger.error('Quick picker: action failed', {
      itemId,
      action,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // Hide overlay after action
  hideQuickPicker();
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
 * Create the system tray icon (16x16 SVG).
 */
function createTrayIcon(): Tray {
  // Create a simple 16x16 icon using nativeImage from data URL
  const size = 16;
  const svgDataUrl = `data:image/svg+xml;base64,${Buffer.from(
    `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
      <rect width="${size}" height="${size}" rx="3" fill="#888888"/>
      <text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" fill="white" font-size="10" font-weight="bold">S</text>
    </svg>`
  ).toString('base64')}`;
  const icon = nativeImage.createFromDataURL(svgDataUrl);

  const tray = new Tray(icon);
  tray.setToolTip('SecurePass Manager');

  updateTrayMenu();

  tray.on('click', () => {
    if (state.vaultLocked) {
      // Focus the main window when vault is locked
      const mainWindow = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed());
      if (mainWindow) {
        mainWindow.show();
        mainWindow.focus();
      }
    } else {
      // Show quick picker when vault is unlocked
      showQuickPicker();
    }
  });

  tray.on('double-click', () => {
    const mainWindow = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed());
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
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
      click: () => {
        const mainWindow = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed());
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        }
      },
    },
    { type: 'separator' },
    {
      label: 'Quick Search',
      enabled: !state.vaultLocked,
      click: () => showQuickPicker(),
    },
    { type: 'separator' },
    {
      label: 'Lock Vault',
      enabled: !state.vaultLocked,
      click: () => {
        const { lockCurrentVault } = require('../ipc/authHandlers');
        lockCurrentVault();
      },
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        const { app } = require('electron');
        app.quit();
      },
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
    // Create colored icon based on state using data URL (SVG doesn't work with createFromBuffer)
    const iconSize = 16;
    const svgDataUrl = `data:image/svg+xml;base64,${Buffer.from(
      `<svg width="${iconSize}" height="${iconSize}" xmlns="http://www.w3.org/2000/svg">
        <rect width="${iconSize}" height="${iconSize}" rx="3" fill="${locked ? '#ef4444' : '#10b981'}"/>
        <text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" fill="white" font-size="10" font-weight="bold">S</text>
      </svg>`
    ).toString('base64')}`;
    const icon = nativeImage.createFromDataURL(svgDataUrl);
    state.tray.setImage(icon);
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

  logger.info('Quick picker: cleaned up');
}
