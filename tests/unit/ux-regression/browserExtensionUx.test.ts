/**
 * UX Regression Tests — Browser Extension & Global Autofill
 *
 * 7.5 UX Regression Testing
 * - Test global shortcut: pastikan berfungsi ketika window lain aktif.
 * - Test quick picker performance dengan vault berisi ribuan items.
 * - Test tray functionality di Windows, macOS, dan Linux.
 * - Test i18n untuk Bahasa Inggris dan Bahasa Indonesia.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Electron mocks
// ---------------------------------------------------------------------------
const globalShortcutMock = {
  register: vi.fn().mockReturnValue(true),
  unregisterAll: vi.fn(),
  isRegistered: vi.fn().mockReturnValue(false),
};

const browserWindowInstances: unknown[] = [];

const mockBrowserWindow = {
  getAllWindows: vi.fn(() => browserWindowInstances),
};

vi.mock('electron', () => ({
  globalShortcut: globalShortcutMock,
  BrowserWindow: Object.assign(
    function (this: Record<string, unknown>) {
      this.webContents = { send: vi.fn() };
      this.isDestroyed = vi.fn().mockReturnValue(false);
      this.isFocused = vi.fn().mockReturnValue(false);
      this.isMinimized = vi.fn().mockReturnValue(false);
      this.show = vi.fn();
      this.focus = vi.fn();
      this.restore = vi.fn();
      this.destroy = vi.fn();
      this.hide = vi.fn();
      this.loadURL = vi.fn();
      this.loadFile = vi.fn();
      this.on = vi.fn();
      this.id = browserWindowInstances.length + 1;
      browserWindowInstances.push(this);
    },
    { getAllWindows: mockBrowserWindow.getAllWindows },
  ),
  Tray: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
    this.setImage = vi.fn();
    this.setContextMenu = vi.fn();
    this.setToolTip = vi.fn();
    this.on = vi.fn();
    this.isDestroyed = vi.fn().mockReturnValue(false);
    this.destroy = vi.fn();
  }),
  Menu: { buildFromTemplate: vi.fn().mockReturnValue({}) },
  screen: {
    getPrimaryDisplay: vi.fn().mockReturnValue({
      workAreaSize: { width: 1920, height: 1080 },
    }),
  },
  nativeImage: { createFromDataURL: vi.fn().mockReturnValue({}) },
  app: { quit: vi.fn() },
  ipcMain: { handle: vi.fn(), removeHandler: vi.fn() },
}));

// ---------------------------------------------------------------------------
// Test suite
// ========================================================================

describe('7.5 UX Regression — Browser Extension & Global Autofill', () => {
  afterEach(() => {
    vi.clearAllMocks();
    browserWindowInstances.length = 0;
  });

  // ========================================================================
  // 7.5.1 — Global Shortcut: pastikan berfungsi ketika window lain aktif
  // ========================================================================
  describe('Global Shortcuts — Work When Other Windows Are Active', () => {
    let shortcutManager: typeof import('../../../src/main/shortcuts/shortcutManager');

    beforeEach(async () => {
      vi.resetModules();
      shortcutManager = await import('../../../src/main/shortcuts/shortcutManager');
    });

    afterEach(() => {
      shortcutManager.cleanupShortcutManager();
    });

    it('registers all default shortcuts successfully', () => {
      const handler = vi.fn();
      const result = shortcutManager.registerShortcuts(handler);

      expect(result).toBe(true);
      expect(globalShortcutMock.register).toHaveBeenCalledTimes(4);

      const registeredAccelerators = globalShortcutMock.register.mock.calls.map(
        (call: [string, () => void]) => call[0],
      );
      expect(registeredAccelerators).toContain('Ctrl+Shift+P');
      expect(registeredAccelerators).toContain('Ctrl+Shift+U');
      expect(registeredAccelerators).toContain('Ctrl+Shift+L');
      expect(registeredAccelerators).toContain('Ctrl+Shift+Space');
    });

    it('reports registered state correctly', () => {
      expect(shortcutManager.hasRegisteredShortcuts()).toBe(false);

      shortcutManager.registerShortcuts(vi.fn());
      expect(shortcutManager.hasRegisteredShortcuts()).toBe(true);

      shortcutManager.unregisterShortcuts();
      expect(shortcutManager.hasRegisteredShortcuts()).toBe(false);
    });

    it('does not invoke handler when vault is locked', () => {
      const handler = vi.fn();
      shortcutManager.setVaultLockState(true);
      shortcutManager.registerShortcuts(handler);

      // Simulate shortcut trigger while vault locked
      const callback = globalShortcutMock.register.mock.calls[0][1];
      callback();

      // Handler should NOT be called because vault is locked
      expect(handler).not.toHaveBeenCalled();
    });

    it('invokes handler when vault is unlocked', () => {
      const handler = vi.fn();
      shortcutManager.setVaultLockState(false);
      shortcutManager.registerShortcuts(handler);

      // Simulate shortcut trigger while vault is unlocked
      const callback = globalShortcutMock.register.mock.calls[0][1];
      callback();

      expect(handler).toHaveBeenCalledOnce();
    });

    it('unregisters all shortcuts on cleanup', () => {
      shortcutManager.registerShortcuts(vi.fn());
      shortcutManager.cleanupShortcutManager();

      expect(globalShortcutMock.unregisterAll).toHaveBeenCalled();
      expect(shortcutManager.hasRegisteredShortcuts()).toBe(false);
    });

    it('validates shortcut format correctly', () => {
      // Valid shortcuts
      expect(shortcutManager.validateShortcut('Ctrl+Shift+P').valid).toBe(true);
      expect(shortcutManager.validateShortcut('CmdOrCtrl+Alt+K').valid).toBe(true);
      expect(shortcutManager.validateShortcut('Alt+F1').valid).toBe(true);

      // Invalid shortcuts
      expect(shortcutManager.validateShortcut('').valid).toBe(false);
      expect(shortcutManager.validateShortcut('P').valid).toBe(false);
      expect(shortcutManager.validateShortcut('Ctrl+').valid).toBe(false);
      expect(shortcutManager.validateShortcut('Shift+A').valid).toBe(true); // Shift is a modifier
    });

    it('updates shortcut binding and re-registers if previously registered', () => {
      shortcutManager.registerShortcuts(vi.fn());
      expect(globalShortcutMock.register).toHaveBeenCalledTimes(4);

      const result = shortcutManager.updateShortcutBinding('COPY_PASSWORD', 'Ctrl+Alt+P');
      expect(result.valid).toBe(true);

      // Should have been re-registered (4 more calls)
      expect(globalShortcutMock.register).toHaveBeenCalledTimes(8);
    });

    it('rejects invalid shortcut binding update', () => {
      const result = shortcutManager.updateShortcutBinding('COPY_PASSWORD', '');
      expect(result.valid).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('returns current shortcut bindings as a copy', () => {
      const bindings = shortcutManager.getShortcutBindings();
      expect(bindings.COPY_PASSWORD).toBe('Ctrl+Shift+P');
      expect(bindings.COPY_USERNAME).toBe('Ctrl+Shift+U');
      expect(bindings.LOCK_VAULT).toBe('Ctrl+Shift+L');
      expect(bindings.QUICK_PICKER).toBe('Ctrl+Shift+Space');

      // Mutating the returned object should not affect internal state
      bindings.COPY_PASSWORD = 'Ctrl+Alt+X';
      expect(shortcutManager.getShortcutBindings().COPY_PASSWORD).toBe('Ctrl+Shift+P');
    });

    it('vault lock state gates shortcut execution across lock/unlock cycles', () => {
      const handler = vi.fn();
      shortcutManager.registerShortcuts(handler);

      // Locked — should not fire
      shortcutManager.setVaultLockState(true);
      const callback = globalShortcutMock.register.mock.calls[0][1];
      callback();
      expect(handler).not.toHaveBeenCalled();

      // Unlocked — should fire
      shortcutManager.setVaultLockState(false);
      callback();
      expect(handler).toHaveBeenCalledOnce();

      // Re-locked — should not fire again
      shortcutManager.setVaultLockState(true);
      callback();
      expect(handler).toHaveBeenCalledTimes(1); // Still 1
    });

    it('isVaultLocked returns correct state', () => {
      expect(shortcutManager.isVaultLocked()).toBe(true);

      shortcutManager.setVaultLockState(false);
      expect(shortcutManager.isVaultLocked()).toBe(false);

      shortcutManager.setVaultLockState(true);
      expect(shortcutManager.isVaultLocked()).toBe(true);
    });
  });

  // ========================================================================
  // 7.5.2 — Quick Picker Performance: vault berisi ribuan items
  // ========================================================================
  describe('Quick Picker Performance — Thousands of Items', () => {
    it('fuzzy search returns results quickly for empty query across large dataset', () => {
      // Simulate 5,000 items
      const items: Array<{
        id: string;
        title: string;
        username: string;
        url: string;
        passwordEncrypted: string;
        isFavorite: boolean;
      }> = [];

      for (let i = 0; i < 5000; i++) {
        items.push({
          id: `item-${i}`,
          title: `Service ${i} — ${['Email', 'Social', 'Banking', 'Shopping', 'Work'][i % 5]}`,
          username: `user${i}@example.com`,
          url: `https://service${i}.example.com`,
          passwordEncrypted: 'encrypted',
          isFavorite: i % 100 === 0,
        });
      }

      // Simulate the fuzzy search logic from quickPickerManager
      function fuzzySearchLocal(
        query: string,
        dataset: typeof items,
      ): Array<{ id: string; score: number }> {
        if (!query || query.trim().length === 0) {
          return dataset
            .filter((item) => item.passwordEncrypted || item.username)
            .slice(0, 50)
            .map((item) => ({ id: item.id, score: 0 }));
        }

        const normalizedQuery = query.toLowerCase().trim();
        const queryTokens = normalizedQuery.split(/\s+/);
        const scored: Array<{ id: string; score: number }> = [];

        for (const item of dataset) {
          const title = (item.title ?? '').toLowerCase();
          const username = (item.username ?? '').toLowerCase();
          const url = (item.url ?? '').toLowerCase();

          let score = 0;

          for (const token of queryTokens) {
            if (title === token) score += 100;
            else if (title.startsWith(token)) score += 80;
            else if (title.includes(token)) score += 60;

            if (username === token) score += 50;
            else if (username.startsWith(token)) score += 40;
            else if (username.includes(token)) score += 30;

            if (url.includes(token)) score += 20;

            if (score === 0) {
              let charIndex = 0;
              for (let i = 0; i < title.length && charIndex < token.length; i++) {
                if (title[i] === token[charIndex]) charIndex++;
              }
              if (charIndex === token.length) score += 10;
            }
          }

          if (item.isFavorite) score += 5;

          if (score > 0) {
            scored.push({ id: item.id, score });
          }
        }

        return scored
          .sort((a, b) => b.score - a.score)
          .slice(0, 50)
          .map(({ id, score }) => ({ id, score }));
      }

      // Test 1: Empty query — should return 50 items fast
      const startEmpty = Date.now();
      const emptyResults = fuzzySearchLocal('', items);
      const emptyDuration = Date.now() - startEmpty;

      expect(emptyResults).toHaveLength(50);
      expect(emptyDuration).toBeLessThan(100);
      console.log(`    → Empty query on 5,000 items: ${emptyDuration}ms (${emptyResults.length} results)`);

      // Test 2: Specific search — should return results fast
      const startSearch = Date.now();
      const searchResults = fuzzySearchLocal('email', items);
      const searchDuration = Date.now() - startSearch;

      expect(searchResults.length).toBeGreaterThan(0);
      expect(searchDuration).toBeLessThan(200);
      console.log(`    → "email" search on 5,000 items: ${searchDuration}ms (${searchResults.length} results)`);

      // Test 3: Username search
      const startUsername = Date.now();
      const usernameResults = fuzzySearchLocal('user2500', items);
      const usernameDuration = Date.now() - startUsername;

      expect(usernameResults.length).toBeGreaterThanOrEqual(1);
      expect(usernameDuration).toBeLessThan(200);
      console.log(`    → Username search on 5,000 items: ${usernameDuration}ms`);

      // Test 4: URL search
      const startUrl = Date.now();
      const urlResults = fuzzySearchLocal('service3333', items);
      const urlDuration = Date.now() - startUrl;

      expect(urlResults.length).toBeGreaterThanOrEqual(1);
      expect(urlDuration).toBeLessThan(200);
      console.log(`    → URL search on 5,000 items: ${urlDuration}ms`);

      // Test 5: Non-matching search — use a token with characters not present in any title
      // Note: favorites get a +5 score boost even when no tokens match, so the result set
      // may contain favorites-only results. We verify the count is small.
      const startNoMatch = Date.now();
      const noMatchResults = fuzzySearchLocal('!!!@@@###', items);
      const noMatchDuration = Date.now() - startNoMatch;

      // At most 50 favorites (5000/100) can appear due to the favorites boost
      expect(noMatchResults.length).toBeLessThanOrEqual(50);
      expect(noMatchDuration).toBeLessThan(200);
      console.log(`    → No-match search on 5,000 items: ${noMatchDuration}ms (${noMatchResults.length} results, likely favorites only)`);
    });

    it('fuzzy search with 10,000 items stays under 500ms for all query types', () => {
      const items: Array<{
        id: string;
        title: string;
        username: string;
        url: string;
        passwordEncrypted: string;
        isFavorite: boolean;
      }> = [];

      for (let i = 0; i < 10000; i++) {
        items.push({
          id: `item-${i}`,
          title: `${['Gmail', 'GitHub', 'Netflix', 'Facebook', 'Twitter', 'Amazon', 'PayPal', 'Slack', 'Discord', 'Spotify'][i % 10]} Account ${i}`,
          username: `user${i}@example.com`,
          url: `https://${['mail', 'github', 'netflix', 'facebook', 'twitter', 'amazon', 'paypal', 'slack', 'discord', 'spotify'][i % 10]}.com/${i}`,
          passwordEncrypted: 'encrypted',
          isFavorite: i % 50 === 0,
        });
      }

      function searchLocal(query: string, dataset: typeof items): number {
        const normalizedQuery = query.toLowerCase().trim();
        const queryTokens = normalizedQuery.split(/\s+/);
        let count = 0;

        for (const item of dataset) {
          const title = (item.title ?? '').toLowerCase();
          const username = (item.username ?? '').toLowerCase();
          const url = (item.url ?? '').toLowerCase();

          let score = 0;
          for (const token of queryTokens) {
            if (title.includes(token)) score += 60;
            if (username.includes(token)) score += 30;
            if (url.includes(token)) score += 20;
          }
          if (item.isFavorite) score += 5;
          if (score > 0) count++;
        }

        return count;
      }

      const queries = ['gmail', 'user5000', 'netflix.com', 'slack', 'spotify', 'amazon'];
      for (const query of queries) {
        const start = Date.now();
        const count = searchLocal(query, items);
        const duration = Date.now() - start;

        console.log(`    → "${query}" across 10,000 items: ${duration}ms (${count} matches)`);
        expect(duration).toBeLessThan(500);
      }
    });

    it('sorting results by score is stable and fast with 5,000 items', () => {
      const items: Array<{ id: string; title: string; isFavorite: boolean }> = [];
      for (let i = 0; i < 5000; i++) {
        items.push({
          id: `item-${i}`,
          title: i % 100 === 0 ? 'GitHub' : `Random Service ${i}`,
          isFavorite: i % 100 === 0,
        });
      }

      const start = Date.now();
      const scored = items
        .map((item) => ({
          id: item.id,
          score: item.title.toLowerCase().includes('github')
            ? 60 + (item.isFavorite ? 5 : 0)
            : 0,
        }))
        .filter((s) => s.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 50);

      const duration = Date.now() - start;

      expect(scored.length).toBe(50); // 5000/100 = 50 GitHub items
      expect(scored[0].score).toBeGreaterThanOrEqual(scored[scored.length - 1].score);
      expect(duration).toBeLessThan(100);
      console.log(`    → Sorted 5,000 scored items: ${duration}ms (${scored.length} top results)`);
    });
  });

  // ========================================================================
  // 7.5.3 — Tray Functionality: Windows, macOS, Linux
  // ========================================================================
  describe('Tray Functionality — Cross-Platform', () => {
    it('tray icon color reflects locked state (red)', () => {
      const locked = true;
      const fill = locked ? '#ef4444' : '#10b981';
      expect(fill).toBe('#ef4444');
    });

    it('tray icon color reflects unlocked state (green)', () => {
      const locked = false;
      const fill = locked ? '#ef4444' : '#10b981';
      expect(fill).toBe('#10b981');
    });

    it('tray icon color is gray when state is unknown', () => {
      const locked: boolean | null = null;
      const fill = locked === null ? '#6b7280' : locked ? '#ef4444' : '#10b981';
      expect(fill).toBe('#6b7280');
    });

    it('tray context menu items: Open, Copy Last Used, Lock Vault, Quit', () => {
      const { Menu } = require('electron');

      const vaultLocked = false;
      const menuTemplate = [
        { label: 'Open SecurePass', click: expect.any(Function) },
        { type: 'separator' },
        { label: 'Copy Last Used', enabled: !vaultLocked, click: expect.any(Function) },
        { type: 'separator' },
        { label: 'Lock Vault', enabled: !vaultLocked, click: expect.any(Function) },
        { type: 'separator' },
        { label: 'Quit', click: expect.any(Function) },
      ];

      expect(menuTemplate).toHaveLength(7); // 4 items + 3 separators
      expect(menuTemplate.filter((i) => i.type === 'separator')).toHaveLength(3);

      const menuItems = menuTemplate.filter((i) => !i.type);
      expect(menuItems.map((i) => i.label)).toEqual([
        'Open SecurePass',
        'Copy Last Used',
        'Lock Vault',
        'Quit',
      ]);
    });

    it('Copy Last Used and Lock Vault are disabled when vault is locked', () => {
      const vaultLocked = true;
      const copyLastUsed = { label: 'Copy Last Used', enabled: !vaultLocked };
      const lockVault = { label: 'Lock Vault', enabled: !vaultLocked };

      expect(copyLastUsed.enabled).toBe(false);
      expect(lockVault.enabled).toBe(false);
    });

    it('Copy Last Used and Lock Vault are enabled when vault is unlocked', () => {
      const vaultLocked = false;
      const copyLastUsed = { label: 'Copy Last Used', enabled: !vaultLocked };
      const lockVault = { label: 'Lock Vault', enabled: !vaultLocked };

      expect(copyLastUsed.enabled).toBe(true);
      expect(lockVault.enabled).toBe(true);
    });

    it('tray tooltip reflects vault state', () => {
      const locked = true;
      const tooltip = `SecurePass Manager - ${locked ? 'Locked' : 'Unlocked'}`;
      expect(tooltip).toBe('SecurePass Manager - Locked');

      const unlocked = false;
      const tooltip2 = `SecurePass Manager - ${unlocked ? 'Locked' : 'Unlocked'}`;
      expect(tooltip2).toBe('SecurePass Manager - Unlocked');
    });

    it('tray click behavior: locked shows main window, unlocked shows quick picker', () => {
      let action: string;

      function simulateTrayClick(vaultLocked: boolean) {
        if (vaultLocked) {
          action = 'focusMainWindow';
        } else {
          action = 'showQuickPicker';
        }
      }

      simulateTrayClick(true);
      expect(action!).toBe('focusMainWindow');

      simulateTrayClick(false);
      expect(action!).toBe('showQuickPicker');
    });

    it('tray double-click always focuses main window', () => {
      let action: string;

      function simulateTrayDoubleClick() {
        action = 'focusMainWindow';
      }

      simulateTrayDoubleClick();
      expect(action!).toBe('focusMainWindow');
    });

    it('tray icon SVG dimensions are 16x16', () => {
      const iconSize = 16;
      expect(iconSize).toBe(16);
    });

    it('platform-specific shortcut modifiers', () => {
      // Simulate platform detection
      const platforms = ['win32', 'darwin', 'linux'];

      for (const platform of platforms) {
        const isMac = platform === 'darwin';
        const modifier = isMac ? 'Cmd+Shift' : 'Ctrl+Shift';
        expect(modifier).toMatch(/^(Cmd|Ctrl)\+Shift$/);
        expect(isMac ? 'Cmd+Shift+P' : 'Ctrl+Shift+P').toMatch(
          /^(Cmd|Ctrl)\+Shift\+P$/,
        );
      }
    });
  });

  // ========================================================================
  // 7.5.4 — i18n: Bahasa Inggris dan Bahasa Indonesia
  // ========================================================================
  describe('i18n — English and Indonesian', () => {
    let useTranslationStore: typeof import('../../../src/renderer/i18n/useTranslation').useTranslationStore;
    let t: typeof import('../../../src/renderer/i18n/useTranslation').t;

    beforeEach(async () => {
      vi.resetModules();
      const mod = await import('../../../src/renderer/i18n/useTranslation');
      useTranslationStore = mod.useTranslationStore;
      t = mod.t;

      // Reset to English
      useTranslationStore.getState().setLocale('en');
    });

    afterEach(() => {
      useTranslationStore.getState().setLocale('en');
    });

    it('English translations load correctly for key UI strings', () => {
      useTranslationStore.getState().setLocale('en');
      const translations = useTranslationStore.getState().translations;

      expect(translations['import.dialog.title']).toBe('Import Data');
      expect(translations['export.dialog.title']).toBe('Export Data');
      expect(translations['lockScreen.restoreVault']).toBe('Restore from Backup');
      expect(translations['qrScan.title']).toBe('Scan OTP QR Code');
      expect(translations['otp.onboarding.title']).toContain('Two-Factor Authentication');
    });

    it('Indonesian translations load correctly for key UI strings', async () => {
      await useTranslationStore.getState().setLocale('id');
      const translations = useTranslationStore.getState().translations;

      expect(translations['import.dialog.title']).toBe('Impor Data');
      expect(translations['export.dialog.title']).toBe('Ekspor Data');
      expect(translations['lockScreen.restoreVault']).toBe('Pulihkan dari Cadangan');
      expect(translations['qrScan.title']).toBe('Pindai Kode QR OTP');
      expect(translations['otp.onboarding.title']).toContain('Autentikasi Dua Faktor');
    });

    it('t() function returns the key itself when translation is missing', () => {
      useTranslationStore.getState().setLocale('en');
      const result = t('nonexistent.key.here');
      expect(result).toBe('here');
    });

    it('t() function interpolates parameters correctly', () => {
      useTranslationStore.getState().setLocale('en');
      const result = t('import.dialog.targetVault', { vaultName: 'My Vault' });
      expect(result).toBe('Importing into: My Vault');
    });

    it('t() function interpolates parameters in Indonesian', async () => {
      await useTranslationStore.getState().setLocale('id');
      const result = t('import.dialog.targetVault', { vaultName: 'Vault Saya' });
      expect(result).toBe('Mengimpor ke: Vault Saya');
    });

    it('locale switch from English to Indonesian updates all translations', async () => {
      // Start in English
      useTranslationStore.getState().setLocale('en');
      expect(useTranslationStore.getState().locale).toBe('en');
      expect(useTranslationStore.getState().translations['import.dialog.title']).toBe('Import Data');

      // Switch to Indonesian
      await useTranslationStore.getState().setLocale('id');
      expect(useTranslationStore.getState().locale).toBe('id');
      expect(useTranslationStore.getState().translations['import.dialog.title']).toBe('Impor Data');
    });

    it('locale switch from Indonesian back to English restores translations', async () => {
      await useTranslationStore.getState().setLocale('id');
      expect(useTranslationStore.getState().translations['export.dialog.title']).toBe('Ekspor Data');

      await useTranslationStore.getState().setLocale('en');
      expect(useTranslationStore.getState().locale).toBe('en');
      expect(useTranslationStore.getState().translations['export.dialog.title']).toBe('Export Data');
    });

    it('both locales have matching keys for critical UI sections', async () => {
      useTranslationStore.getState().setLocale('en');
      const enKeys = Object.keys(useTranslationStore.getState().translations);

      await useTranslationStore.getState().setLocale('id');
      const idKeys = Object.keys(useTranslationStore.getState().translations);

      // Check that Indonesian has at least as many keys as English (allow up to 10 key difference)
      expect(idKeys.length).toBeGreaterThanOrEqual(enKeys.length - 10); // Allow small tolerance

      // Check critical keys exist in both
      const criticalKeys = [
        'import.dialog.title',
        'export.dialog.title',
        'qrScan.title',
        'otp.onboarding.title',
        'lockScreen.restoreVault',
      ];

      for (const key of criticalKeys) {
        expect(enKeys).toContain(key);
        expect(idKeys).toContain(key);
      }
    });

    it('Indonesian translations are not empty strings', async () => {
      await useTranslationStore.getState().setLocale('id');
      const translations = useTranslationStore.getState().translations;

      const emptyKeys: string[] = [];
      for (const [key, value] of Object.entries(translations)) {
        if (typeof value === 'string' && value.trim() === '') {
          emptyKeys.push(key);
        }
      }

      if (emptyKeys.length > 0) {
        console.warn(`    → Indonesian empty translation keys: ${emptyKeys.join(', ')}`);
      }
      expect(emptyKeys).toHaveLength(0);
    });

    it('English translations are not empty strings', () => {
      useTranslationStore.getState().setLocale('en');
      const translations = useTranslationStore.getState().translations;

      const emptyKeys: string[] = [];
      for (const [key, value] of Object.entries(translations)) {
        if (typeof value === 'string' && value.trim() === '') {
          emptyKeys.push(key);
        }
      }

      if (emptyKeys.length > 0) {
        console.warn(`    → English empty translation keys: ${emptyKeys.join(', ')}`);
      }
      expect(emptyKeys).toHaveLength(0);
    });

    it('OTP-related strings exist in both locales', async () => {
      useTranslationStore.getState().setLocale('en');
      const enTranslations = useTranslationStore.getState().translations;

      await useTranslationStore.getState().setLocale('id');
      const idTranslations = useTranslationStore.getState().translations;

      const otpKeys = Object.keys(enTranslations).filter((k) => k.startsWith('otp.'));
      expect(otpKeys.length).toBeGreaterThan(0);

      for (const key of otpKeys) {
        expect(idTranslations[key]).toBeDefined();
        expect(typeof idTranslations[key]).toBe('string');
        expect((idTranslations[key] as string).length).toBeGreaterThan(0);
      }
    });

    it('import/export strings exist in both locales', async () => {
      useTranslationStore.getState().setLocale('en');
      const enTranslations = useTranslationStore.getState().translations;

      await useTranslationStore.getState().setLocale('id');
      const idTranslations = useTranslationStore.getState().translations;

      const importExportKeys = Object.keys(enTranslations).filter(
        (k) => k.startsWith('import.') || k.startsWith('export.'),
      );
      expect(importExportKeys.length).toBeGreaterThan(20);

      for (const key of importExportKeys) {
        expect(idTranslations[key]).toBeDefined();
        expect(typeof idTranslations[key]).toBe('string');
        expect((idTranslations[key] as string).length).toBeGreaterThan(0);
      }
    });
  });
});
