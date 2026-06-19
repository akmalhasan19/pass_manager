/**
 * Settings page for SecurePass Manager Browser Extension.
 *
 * Manages extension preferences including autofill, clipboard, and default actions.
 * Settings can be synced with the desktop application.
 *
 * @module popup/settings
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ExtensionSettings {
  offerSavePasswords: boolean;
  autoFillForms: boolean;
  clearClipboardAfterCopy: boolean;
  clipboardClearDelaySeconds: number;
  defaultClickAction: 'autofill' | 'copy-password' | 'copy-username' | 'expand';
  syncWithDesktopApp: boolean;
}

const DEFAULT_SETTINGS: ExtensionSettings = {
  offerSavePasswords: true,
  autoFillForms: true,
  clearClipboardAfterCopy: true,
  clipboardClearDelaySeconds: 30,
  defaultClickAction: 'autofill',
  syncWithDesktopApp: true,
};

const STORAGE_KEY = 'extension_settings';

// ---------------------------------------------------------------------------
// DOM Elements
// ---------------------------------------------------------------------------

const backBtn = document.getElementById('backBtn')!;
const saveBtn = document.getElementById('saveBtn')!;
const resetBtn = document.getElementById('resetBtn')!;

const offerSaveToggle = document.getElementById('offerSaveToggle')!;
const autoFillToggle = document.getElementById('autoFillToggle')!;
const clearClipboardToggle = document.getElementById('clearClipboardToggle')!;
const clipboardDelayInput = document.getElementById('clipboardDelayInput') as HTMLInputElement;
const defaultActionSelect = document.getElementById('defaultActionSelect') as HTMLSelectElement;
const syncToggle = document.getElementById('syncToggle')!;

const syncStatus = document.getElementById('syncStatus')!;
const syncDot = document.getElementById('syncDot')!;
const syncText = document.getElementById('syncText')!;

// ---------------------------------------------------------------------------
// Storage Helpers
// ---------------------------------------------------------------------------

async function loadSettings(): Promise<ExtensionSettings> {
  try {
    const result = await chrome.storage.local.get(STORAGE_KEY);
    const stored = result[STORAGE_KEY] as Partial<ExtensionSettings> | undefined;
    if (stored) {
      return { ...DEFAULT_SETTINGS, ...stored };
    }
  } catch (error) {
    console.error('Failed to load settings:', error);
  }
  return { ...DEFAULT_SETTINGS };
}

async function saveSettings(settings: ExtensionSettings): Promise<void> {
  try {
    await chrome.storage.local.set({ [STORAGE_KEY]: settings });
  } catch (error) {
    console.error('Failed to save settings:', error);
    throw error;
  }
}

// ---------------------------------------------------------------------------
// UI Helpers
// ---------------------------------------------------------------------------

function setToggleState(toggle: HTMLElement, on: boolean): void {
  if (on) {
    toggle.classList.add('on');
    toggle.setAttribute('aria-checked', 'true');
  } else {
    toggle.classList.remove('on');
    toggle.setAttribute('aria-checked', 'false');
  }
}

function getToggleState(toggle: HTMLElement): boolean {
  return toggle.classList.contains('on');
}

function setSyncStatus(state: 'synced' | 'syncing' | 'error', message: string): void {
  syncDot.className = 'sync-dot';
  if (state === 'syncing') {
    syncDot.classList.add('syncing');
  } else if (state === 'error') {
    syncDot.classList.add('error');
  }
  syncText.textContent = message;
}

// ---------------------------------------------------------------------------
// Settings UI Binding
// ---------------------------------------------------------------------------

function bindSettingsToUI(settings: ExtensionSettings): void {
  setToggleState(offerSaveToggle, settings.offerSavePasswords);
  setToggleState(autoFillToggle, settings.autoFillForms);
  setToggleState(clearClipboardToggle, settings.clearClipboardAfterCopy);
  setToggleState(syncToggle, settings.syncWithDesktopApp);

  clipboardDelayInput.value = String(settings.clipboardClearDelaySeconds);
  defaultActionSelect.value = settings.defaultClickAction;

  // Disable clipboard delay input if clear clipboard is off
  clipboardDelayInput.disabled = !settings.clearClipboardAfterCopy;
}

function readSettingsFromUI(): ExtensionSettings {
  const delayValue = parseInt(clipboardDelayInput.value, 10);
  const clampedDelay = Math.max(10, Math.min(300, isNaN(delayValue) ? 30 : delayValue));

  return {
    offerSavePasswords: getToggleState(offerSaveToggle),
    autoFillForms: getToggleState(autoFillToggle),
    clearClipboardAfterCopy: getToggleState(clearClipboardToggle),
    clipboardClearDelaySeconds: clampedDelay,
    defaultClickAction: defaultActionSelect.value as ExtensionSettings['defaultClickAction'],
    syncWithDesktopApp: getToggleState(syncToggle),
  };
}

// ---------------------------------------------------------------------------
// Toggle Interaction
// ---------------------------------------------------------------------------

function setupToggle(toggle: HTMLElement): void {
  function toggleState(): void {
    const currentState = getToggleState(toggle);
    setToggleState(toggle, !currentState);

    // Special handling for clear clipboard toggle
    if (toggle === clearClipboardToggle) {
      const enabled = !currentState;
      clipboardDelayInput.disabled = !enabled;
    }
  }

  toggle.addEventListener('click', toggleState);
  toggle.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      toggleState();
    }
  });
}

// ---------------------------------------------------------------------------
// Sync with Desktop App
// ---------------------------------------------------------------------------

async function syncSettingsWithDesktop(settings: ExtensionSettings): Promise<void> {
  if (!settings.syncWithDesktopApp) {
    setSyncStatus('synced', 'Sync disabled - local settings only');
    return;
  }

  setSyncStatus('syncing', 'Syncing with desktop app...');

  try {
    // Send settings to background script which will forward to desktop app
    const response = await chrome.runtime.sendMessage({
      type: 'SYNC_SETTINGS',
      settings,
      requestId: crypto.randomUUID(),
      timestamp: Date.now(),
    });

    if (response?.success) {
      setSyncStatus('synced', 'Settings synced with desktop app');
    } else {
      setSyncStatus('error', response?.message || 'Sync failed');
    }
  } catch (error) {
    setSyncStatus('error', 'Desktop app not connected');
    console.error('Sync error:', error);
  }
}

// ---------------------------------------------------------------------------
// Event Handlers
// ---------------------------------------------------------------------------

async function handleSave(): Promise<void> {
  const settings = readSettingsFromUI();

  setSyncStatus('syncing', 'Saving...');

  try {
    await saveSettings(settings);
    await syncSettingsWithDesktop(settings);
    
    // Show success feedback
    saveBtn.textContent = 'Saved!';
    setTimeout(() => {
      saveBtn.textContent = 'Save Changes';
    }, 1500);
  } catch (error) {
    setSyncStatus('error', 'Failed to save settings');
    console.error('Save error:', error);
  }
}

function handleReset(): void {
  if (confirm('Reset all settings to defaults?')) {
    bindSettingsToUI(DEFAULT_SETTINGS);
    setSyncStatus('synced', 'Reset to defaults - click Save to apply');
  }
}

function handleBack(): void {
  // Close settings popup and reopen main popup
  chrome.runtime.sendMessage({ action: 'openPopup' });
  window.close();
}

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------

async function init(): Promise<void> {
  // Setup toggle interactions
  setupToggle(offerSaveToggle);
  setupToggle(autoFillToggle);
  setupToggle(clearClipboardToggle);
  setupToggle(syncToggle);

  // Load and bind settings
  const settings = await loadSettings();
  bindSettingsToUI(settings);

  // Setup button listeners
  saveBtn.addEventListener('click', handleSave);
  resetBtn.addEventListener('click', handleReset);
  backBtn.addEventListener('click', handleBack);

  // Initial sync status
  if (settings.syncWithDesktopApp) {
    setSyncStatus('synced', 'Settings synced with desktop app');
  } else {
    setSyncStatus('synced', 'Sync disabled - local settings only');
  }
}

// Start the app
init();
