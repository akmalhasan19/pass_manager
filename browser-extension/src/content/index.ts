/**
 * Content Script for SecurePass Manager Browser Extension.
 *
 * Runs on every web page to detect login forms and inject autofill UI.
 * Communicates with the background service worker via chrome.runtime messaging.
 *
 * This module is the entry point loaded by Manifest V3 content_scripts.
 * It delegates form detection to form-detector.ts and manages the
 * overlay UI lifecycle.
 *
 * @module content/index
 */

import {
  HostRequestType,
  type GetMatchingItemsRequest,
  type EncryptedCredentialItem,
  type DecryptedCredentialsResponse,
  type CreateItemResponse,
} from '../shared/protocol';
import {
  EXTENSION_PREFERENCES_KEY,
  getExtensionPreferences,
  normalizeExtensionPreferences,
  type ExtensionPreferences,
} from '../shared/preferences';
import {
  detectBestLoginForm,
  isElementVisible,
  type DetectedLoginForm,
} from './form-detector';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Overlay container ID. */
const OVERLAY_ID = 'securepass-autofill-overlay';

/** Prompt bar ID for save-credential prompt. */
const PROMPT_BAR_ID = 'securepass-prompt-bar';

/** Toast ID for transient content-script messages. */
const TOAST_ID = 'securepass-toast';

/** Debounce delay for MutationObserver scans (ms). */
const SCAN_DEBOUNCE_MS = 300;

/** Delay before initial scan after DOMContentLoaded (ms). */
const INITIAL_SCAN_DELAY_MS = 500;

/** Storage key for domains where save prompts are disabled. */
const NEVER_SAVE_DOMAINS_KEY = 'neverSaveDomains';

/** Storage keys used by the app/extension for language preference. */
const LANGUAGE_STORAGE_KEYS = ['language', 'locale', 'securepassLanguage'];

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let currentOverlay: HTMLElement | null = null;
let currentForm: DetectedLoginForm | null = null;
let matchedItems: EncryptedCredentialItem[] = [];
let scanTimer: ReturnType<typeof setTimeout> | null = null;
let lastScanUrl: string = '';

/** Track the last detected login form before submission for save prompt. */
let pendingSaveForm: DetectedLoginForm | null = null;
let pendingSaveCandidate: {
  username: string;
  password: string;
  url: string;
  position: 'top' | 'bottom';
  capturedAt: number;
} | null = null;
/** Track the current save prompt bar element. */
let currentPromptBar: HTMLElement | null = null;
/** Domains where user chose "Never for this site". */
const neverSaveDomains = new Set<string>();
/** Current prompt language, following app storage when available, then browser language. */
let promptLanguage: PromptLanguage = 'en';
let extensionPreferences: ExtensionPreferences = {
  offerToSavePasswords: true,
  autoFillFormsAutomatically: true,
  clearClipboardAfterCopy: true,
  clipboardClearAfterSeconds: 45,
  defaultItemClickAction: 'autofill',
};

type PromptLanguage = 'en' | 'id';

interface PromptCopy {
  saveTitle: string;
  saveSubtitle: (username: string, domain: string) => string;
  saveButton: string;
  neverButton: string;
  dismissButton: string;
  saved: string;
  saveFailed: string;
  noHostResponse: string;
  locked: string;
}

const PROMPT_COPY: Record<PromptLanguage, PromptCopy> = {
  en: {
    saveTitle: 'Save password to SecurePass?',
    saveSubtitle: (username, domain) => `${username || 'New login'} on ${domain}`,
    saveButton: 'Save to SecurePass',
    neverButton: 'Never for this site',
    dismissButton: 'Dismiss',
    saved: 'Credential saved to SecurePass',
    saveFailed: 'Failed to save credential',
    noHostResponse: 'No response from SecurePass',
    locked: 'Vault is locked - cannot save',
  },
  id: {
    saveTitle: 'Simpan password ke SecurePass?',
    saveSubtitle: (username, domain) => `${username || 'Login baru'} di ${domain}`,
    saveButton: 'Simpan ke SecurePass',
    neverButton: 'Jangan untuk situs ini',
    dismissButton: 'Tutup',
    saved: 'Credential tersimpan di SecurePass',
    saveFailed: 'Gagal menyimpan credential',
    noHostResponse: 'Tidak ada respons dari SecurePass',
    locked: 'Vault terkunci - tidak bisa menyimpan',
  },
};

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const OVERLAY_STYLES = `
  #${OVERLAY_ID} {
    position: fixed;
    z-index: 2147483647;
    background: #ffffff;
    border: 1px solid #d1d5db;
    border-radius: 8px;
    box-shadow: 0 4px 16px rgba(0,0,0,0.18);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    font-size: 14px;
    min-width: 260px;
    max-width: 380px;
    overflow: hidden;
    animation: sp-slide-in 0.15s ease-out;
  }
  @keyframes sp-slide-in {
    from { opacity: 0; transform: translateY(-4px); }
    to { opacity: 1; transform: translateY(0); }
  }
  #${OVERLAY_ID} * {
    box-sizing: border-box;
  }
  #${OVERLAY_ID} .sp-header {
    padding: 10px 14px;
    font-weight: 600;
    color: #374151;
    border-bottom: 1px solid #e5e7eb;
    display: flex;
    align-items: center;
    gap: 8px;
    user-select: none;
  }
  #${OVERLAY_ID} .sp-header .sp-logo {
    width: 18px;
    height: 18px;
    background: #6366f1;
    border-radius: 4px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: white;
    font-size: 11px;
    font-weight: 700;
    flex-shrink: 0;
  }
  #${OVERLAY_ID} .sp-header .sp-close {
    margin-left: auto;
    cursor: pointer;
    color: #9ca3af;
    font-size: 16px;
    line-height: 1;
    padding: 2px 4px;
    border-radius: 4px;
    transition: background-color 0.1s;
  }
  #${OVERLAY_ID} .sp-header .sp-close:hover {
    background: #f3f4f6;
    color: #374151;
  }
  #${OVERLAY_ID} .sp-item {
    padding: 10px 14px;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 10px;
    transition: background-color 0.1s;
    border-bottom: 1px solid #f3f4f6;
  }
  #${OVERLAY_ID} .sp-item:last-child {
    border-bottom: none;
  }
  #${OVERLAY_ID} .sp-item:hover {
    background: #f0f0ff;
  }
  #${OVERLAY_ID} .sp-item-icon {
    width: 28px;
    height: 28px;
    border-radius: 6px;
    background: #e0e7ff;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 14px;
    flex-shrink: 0;
    color: #4f46e5;
  }
  #${OVERLAY_ID} .sp-item-info {
    flex: 1;
    min-width: 0;
  }
  #${OVERLAY_ID} .sp-item-title {
    font-weight: 500;
    color: #1f2937;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  #${OVERLAY_ID} .sp-item-username {
    font-size: 12px;
    color: #6b7280;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  #${OVERLAY_ID} .sp-item-actions {
    display: flex;
    gap: 4px;
    opacity: 0;
    transition: opacity 0.1s;
  }
  #${OVERLAY_ID} .sp-item:hover .sp-item-actions {
    opacity: 1;
  }
  #${OVERLAY_ID} .sp-action-btn {
    padding: 4px 8px;
    font-size: 11px;
    border: 1px solid #d1d5db;
    border-radius: 4px;
    background: white;
    color: #374151;
    cursor: pointer;
    white-space: nowrap;
  }
  #${OVERLAY_ID} .sp-action-btn:hover {
    background: #f3f4f6;
  }
  #${OVERLAY_ID} .sp-empty {
    padding: 16px 14px;
    text-align: center;
    color: #9ca3af;
    font-size: 13px;
  }
  #${OVERLAY_ID} .sp-lock-msg {
    padding: 16px 14px;
    text-align: center;
    color: #6b7280;
    font-size: 13px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
  }
  #${OVERLAY_ID} .sp-lock-msg .sp-lock-icon {
    font-size: 24px;
    opacity: 0.6;
  }
  #${OVERLAY_ID} .sp-lock-msg button {
    padding: 6px 12px;
    border: 1px solid #d1d5db;
    border-radius: 6px;
    background: white;
    color: #374151;
    cursor: pointer;
    font-size: 12px;
  }
  #${OVERLAY_ID} .sp-lock-msg button:hover {
    background: #f3f4f6;
  }
`;

const PROMPT_BAR_STYLES = `
  #${PROMPT_BAR_ID} {
    position: fixed;
    left: 16px;
    right: 16px;
    bottom: 16px;
    max-width: 720px;
    margin: 0 auto;
    z-index: 2147483647;
    background: #ffffff;
    color: #1f2937;
    border: 1px solid #d1d5db;
    border-radius: 8px;
    box-shadow: 0 8px 24px rgba(15,23,42,0.18);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    font-size: 13px;
    padding: 12px;
    display: flex;
    align-items: center;
    gap: 12px;
    animation: sp-prompt-slide-up 0.2s ease-out;
  }
  #${PROMPT_BAR_ID}[data-position="top"] {
    top: 16px;
    bottom: auto;
    animation: sp-prompt-slide-down 0.2s ease-out;
  }
  @keyframes sp-prompt-slide-up {
    from { transform: translateY(12px); opacity: 0; }
    to { transform: translateY(0); opacity: 1; }
  }
  @keyframes sp-prompt-slide-down {
    from { transform: translateY(-12px); opacity: 0; }
    to { transform: translateY(0); opacity: 1; }
  }
  #${PROMPT_BAR_ID} * {
    box-sizing: border-box;
  }
  #${PROMPT_BAR_ID} .sp-prompt-icon {
    width: 20px;
    height: 20px;
    background: #6366f1;
    border-radius: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: white;
    font-size: 10px;
    font-weight: 700;
    flex-shrink: 0;
  }
  #${PROMPT_BAR_ID} .sp-prompt-text {
    flex: 1;
    min-width: 0;
    color: #374151;
    line-height: 1.4;
  }
  #${PROMPT_BAR_ID} .sp-prompt-text strong {
    display: block;
    font-weight: 600;
    color: #111827;
  }
  #${PROMPT_BAR_ID} .sp-prompt-text span {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: #6b7280;
    font-size: 12px;
    margin-top: 2px;
  }
  #${PROMPT_BAR_ID} .sp-prompt-actions {
    display: flex;
    gap: 8px;
    flex-shrink: 0;
  }
  #${PROMPT_BAR_ID} .sp-prompt-btn {
    min-height: 32px;
    padding: 6px 12px;
    border-radius: 6px;
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    border: 1px solid transparent;
    transition: background-color 0.1s, border-color 0.1s;
    white-space: nowrap;
  }
  #${PROMPT_BAR_ID} .sp-prompt-btn-save {
    background: #2563eb;
    color: white;
    border-color: #2563eb;
  }
  #${PROMPT_BAR_ID} .sp-prompt-btn-save:hover {
    background: #1d4ed8;
  }
  #${PROMPT_BAR_ID} .sp-prompt-btn-never {
    background: transparent;
    color: #374151;
    border-color: #d1d5db;
  }
  #${PROMPT_BAR_ID} .sp-prompt-btn-never:hover {
    background: #f3f4f6;
    color: #374151;
  }
  #${PROMPT_BAR_ID} .sp-prompt-btn-dismiss {
    background: transparent;
    color: #6b7280;
    border-color: transparent;
  }
  #${PROMPT_BAR_ID} .sp-prompt-btn-dismiss:hover {
    background: #f3f4f6;
    color: #374151;
  }
  #${PROMPT_BAR_ID} .sp-prompt-success {
    display: flex;
    align-items: center;
    gap: 8px;
    color: #059669;
    font-weight: 500;
  }
  #${PROMPT_BAR_ID} .sp-prompt-success-icon {
    font-size: 16px;
  }
  @media (max-width: 560px) {
    #${PROMPT_BAR_ID} {
      left: 8px;
      right: 8px;
      bottom: 8px;
      align-items: stretch;
      flex-wrap: wrap;
    }
    #${PROMPT_BAR_ID}[data-position="top"] {
      top: 8px;
    }
    #${PROMPT_BAR_ID} .sp-prompt-actions {
      width: 100%;
      flex-wrap: wrap;
    }
    #${PROMPT_BAR_ID} .sp-prompt-btn {
      flex: 1;
    }
  }
  @media (prefers-color-scheme: dark) {
    #${PROMPT_BAR_ID} {
      background: #161b22;
      color: #f0f6fc;
      border-color: #30363d;
      box-shadow: 0 8px 24px rgba(1,4,9,0.45);
    }
    #${PROMPT_BAR_ID} .sp-prompt-icon {
      background: #3fb950;
      color: #0d1117;
    }
    #${PROMPT_BAR_ID} .sp-prompt-text {
      color: #c9d1d9;
    }
    #${PROMPT_BAR_ID} .sp-prompt-text strong {
      color: #f0f6fc;
    }
    #${PROMPT_BAR_ID} .sp-prompt-text span {
      color: #8b949e;
    }
    #${PROMPT_BAR_ID} .sp-prompt-btn-save {
      background: #238636;
      border-color: #238636;
      color: #ffffff;
    }
    #${PROMPT_BAR_ID} .sp-prompt-btn-save:hover {
      background: #2ea043;
    }
    #${PROMPT_BAR_ID} .sp-prompt-btn-never,
    #${PROMPT_BAR_ID} .sp-prompt-btn-dismiss {
      color: #c9d1d9;
      border-color: #30363d;
    }
    #${PROMPT_BAR_ID} .sp-prompt-btn-never:hover,
    #${PROMPT_BAR_ID} .sp-prompt-btn-dismiss:hover {
      background: #21262d;
      color: #f0f6fc;
    }
  }
`;

// ---------------------------------------------------------------------------
// Overlay management
// ---------------------------------------------------------------------------

/**
 * Show the autofill overlay near a password field.
 */
function showOverlay(
  form: DetectedLoginForm,
  items: EncryptedCredentialItem[],
  vaultLocked: boolean = false,
): void {
  removeOverlay();

  const overlay = document.createElement('div');
  overlay.id = OVERLAY_ID;

  // Inject scoped styles
  const style = document.createElement('style');
  style.textContent = OVERLAY_STYLES;
  overlay.appendChild(style);

  // Header with close button
  const header = document.createElement('div');
  header.className = 'sp-header';
  header.innerHTML = `
    <span class="sp-logo">SP</span>
    <span>SecurePass Manager</span>
    <span class="sp-close" title="Dismiss">&times;</span>
  `;
  overlay.appendChild(header);

  header.querySelector('.sp-close')?.addEventListener('click', (e) => {
    e.stopPropagation();
    removeOverlay();
  });

  if (vaultLocked) {
    // Vault locked state
    const lockMsg = document.createElement('div');
    lockMsg.className = 'sp-lock-msg';
    lockMsg.innerHTML = `
      <span class="sp-lock-icon">&#128274;</span>
      <span>Vault is locked</span>
      <span style="font-size:12px;color:#9ca3af;">Unlock the desktop app to autofill</span>
    `;
    overlay.appendChild(lockMsg);
  } else if (items.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'sp-empty';
    empty.textContent = 'No matching credentials found for this site.';
    overlay.appendChild(empty);
  } else {
    for (const item of items) {
      const itemEl = document.createElement('div');
      itemEl.className = 'sp-item';

      const icon = item.emoji || (item.title ? item.title.charAt(0).toUpperCase() : '&#128274;');

      const hasOtp = !!item.otpCode || !!form.otpField;

      itemEl.innerHTML = `
        <div class="sp-item-icon">${escapeHtml(icon)}</div>
        <div class="sp-item-info">
          <div class="sp-item-title">${escapeHtml(item.title || item.url)}</div>
          <div class="sp-item-username">${escapeHtml(item.username)}</div>
        </div>
        <div class="sp-item-actions">
          <button class="sp-action-btn" data-action="fill">Fill</button>
          ${hasOtp ? '<button class="sp-action-btn" data-action="fill-otp">OTP</button>' : ''}
          <button class="sp-action-btn" data-action="copy-user">User</button>
          <button class="sp-action-btn" data-action="copy-pass">Pass</button>
        </div>
      `;

      // Click on item row → autofill
      itemEl.addEventListener('click', (e) => {
        // Don't autofill if an action button was clicked
        if ((e.target as HTMLElement).closest('.sp-action-btn')) return;
        fillForm(form, item);
        removeOverlay();
      });

      // Action buttons
      itemEl.querySelector('[data-action="fill"]')?.addEventListener('click', (e) => {
        e.stopPropagation();
        fillForm(form, item);
        removeOverlay();
      });

      itemEl.querySelector('[data-action="fill-otp"]')?.addEventListener('click', (e) => {
        e.stopPropagation();
        fillOtpOnly(form, item);
      });

      itemEl.querySelector('[data-action="copy-user"]')?.addEventListener('click', (e) => {
        e.stopPropagation();
        copyToClipboard(item.username, 'username');
      });

      itemEl.querySelector('[data-action="copy-pass"]')?.addEventListener('click', (e) => {
        e.stopPropagation();
        requestPasswordCopy(item.id);
      });

      overlay.appendChild(itemEl);
    }
  }

  // Position overlay below the password field
  const rect = form.passwordField.element.getBoundingClientRect();
  let top = rect.bottom + 6;
  let left = rect.left;

  // Keep within viewport
  const overlayWidth = 320;
  if (left + overlayWidth > window.innerWidth) {
    left = window.innerWidth - overlayWidth - 16;
  }
  if (top + 200 > window.innerHeight) {
    // Show above the field if not enough space below
    top = rect.top - 6;
    overlay.style.transform = 'translateY(-100%)';
  }

  overlay.style.top = `${top}px`;
  overlay.style.left = `${Math.max(8, left)}px`;

  document.body.appendChild(overlay);
  currentOverlay = overlay;

  // Close on outside click (with delay to avoid immediate closure)
  setTimeout(() => {
    document.addEventListener('mousedown', handleOutsideClick, { once: true });
  }, 100);
}

function handleOutsideClick(event: MouseEvent): void {
  if (currentOverlay && !currentOverlay.contains(event.target as Node)) {
    removeOverlay();
  }
}

function removeOverlay(): void {
  if (currentOverlay) {
    currentOverlay.remove();
    currentOverlay = null;
  }
}

// ---------------------------------------------------------------------------
// Save credential prompt bar
// ---------------------------------------------------------------------------

function removePromptBar(): void {
  if (currentPromptBar) {
    currentPromptBar.remove();
    currentPromptBar = null;
  }
}

/**
 * Show the save-credential prompt bar at the bottom of the viewport.
 *
 * @param username - The username that was submitted.
 * @param password - The password that was submitted (will be cleared after save).
 * @param formUrl  - The page URL where the form was submitted.
 */
function showSavePrompt(
  username: string,
  password: string,
  formUrl: string,
  position: 'top' | 'bottom' = 'bottom',
): void {
  removePromptBar();

  const domain = extractDomain(formUrl);
  if (neverSaveDomains.has(domain) || !extensionPreferences.offerToSavePasswords) return;
  const copy = PROMPT_COPY[promptLanguage];

  const bar = document.createElement('div');
  bar.id = PROMPT_BAR_ID;
  bar.dataset.position = position;
  bar.lang = promptLanguage;

  const style = document.createElement('style');
  style.textContent = PROMPT_BAR_STYLES;
  bar.appendChild(style);

  const icon = document.createElement('div');
  icon.className = 'sp-prompt-icon';
  icon.textContent = 'SP';
  bar.appendChild(icon);

  const text = document.createElement('div');
  text.className = 'sp-prompt-text';
  text.innerHTML = `
    <strong>${escapeHtml(copy.saveTitle)}</strong>
    <span>${escapeHtml(copy.saveSubtitle(username, domain))}</span>
  `;
  bar.appendChild(text);

  const actions = document.createElement('div');
  actions.className = 'sp-prompt-actions';

  const saveBtn = document.createElement('button');
  saveBtn.className = 'sp-prompt-btn sp-prompt-btn-save';
  saveBtn.type = 'button';
  saveBtn.textContent = copy.saveButton;
  saveBtn.addEventListener('click', () => {
    sendCreateItem(username, password, formUrl, domain);
    removePromptBar();
  });
  actions.appendChild(saveBtn);

  const neverBtn = document.createElement('button');
  neverBtn.className = 'sp-prompt-btn sp-prompt-btn-never';
  neverBtn.type = 'button';
  neverBtn.textContent = copy.neverButton;
  neverBtn.addEventListener('click', () => {
    neverSaveDomains.add(domain);
    chrome.storage.local.get(NEVER_SAVE_DOMAINS_KEY, (data) => {
      const stored: string[] = data[NEVER_SAVE_DOMAINS_KEY] || [];
      if (!stored.includes(domain)) {
        stored.push(domain);
        chrome.storage.local.set({ [NEVER_SAVE_DOMAINS_KEY]: stored });
      }
    });
    removePromptBar();
  });
  actions.appendChild(neverBtn);

  const dismissBtn = document.createElement('button');
  dismissBtn.className = 'sp-prompt-btn sp-prompt-btn-dismiss';
  dismissBtn.type = 'button';
  dismissBtn.textContent = copy.dismissButton;
  dismissBtn.title = copy.dismissButton;
  dismissBtn.addEventListener('click', () => {
    removePromptBar();
  });
  actions.appendChild(dismissBtn);

  bar.appendChild(actions);

  document.body.appendChild(bar);
  currentPromptBar = bar;

  // Auto-dismiss after 15 seconds of inactivity
  setTimeout(() => {
    if (currentPromptBar === bar) {
      removePromptBar();
    }
  }, 15_000);
}

/**
 * Show a brief success message in the prompt bar after saving.
 */
function showSaveSuccess(): void {
  removePromptBar();
  const copy = PROMPT_COPY[promptLanguage];

  const bar = document.createElement('div');
  bar.id = PROMPT_BAR_ID;

  const style = document.createElement('style');
  style.textContent = PROMPT_BAR_STYLES;
  bar.appendChild(style);

  const success = document.createElement('div');
  success.className = 'sp-prompt-success';
  success.innerHTML = `<span class="sp-prompt-success-icon">&#10003;</span> ${escapeHtml(copy.saved)}`;
  bar.appendChild(success);

  document.body.appendChild(bar);
  currentPromptBar = bar;

  setTimeout(() => {
    if (currentPromptBar === bar) {
      removePromptBar();
    }
  }, 3000);
}

function sendCreateItem(
  username: string,
  password: string,
  url: string,
  title: string,
): void {
  const copy = PROMPT_COPY[promptLanguage];
  chrome.runtime.sendMessage(
    {
      type: HostRequestType.CREATE_ITEM,
      title,
      username,
      password,
      url,
      requestId: crypto.randomUUID(),
      timestamp: Date.now(),
      protocolVersion: 1,
    },
    (response: CreateItemResponse | { type: string; message?: string } | undefined) => {
      if (chrome.runtime.lastError) {
        console.error('[SecurePass] CREATE_ITEM error:', chrome.runtime.lastError.message);
        showTemporaryToast(copy.saveFailed);
        return;
      }

      if (!response) {
        showTemporaryToast(copy.noHostResponse);
        return;
      }

      if (response.type === 'CREATE_ITEM_RESPONSE' && (response as CreateItemResponse).success) {
        showSaveSuccess();
      } else if (response.type === 'VAULT_LOCKED') {
        showTemporaryToast(copy.locked);
      } else {
        showTemporaryToast(response.message || copy.saveFailed);
      }
    },
  );
}

/**
 * Extract the registrable domain from a URL for "never save" tracking.
 * Falls back to hostname if public suffix list is unavailable.
 */
function extractDomain(urlString: string): string {
  try {
    const url = new URL(urlString);
    return url.hostname;
  } catch {
    return urlString;
  }
}

function getPromptPosition(anchor?: HTMLElement | null): 'top' | 'bottom' {
  if (!anchor) return 'bottom';
  const rect = anchor.getBoundingClientRect();
  return rect.top > window.innerHeight / 2 ? 'top' : 'bottom';
}

function normalizePromptLanguage(value: unknown): PromptLanguage | null {
  if (typeof value !== 'string') return null;
  const normalized = value.toLowerCase();
  if (normalized.startsWith('id')) return 'id';
  if (normalized.startsWith('en')) return 'en';
  return null;
}

function loadPromptLanguage(): void {
  chrome.storage.local.get(LANGUAGE_STORAGE_KEYS, (data) => {
    for (const key of LANGUAGE_STORAGE_KEYS) {
      const stored = normalizePromptLanguage(data[key]);
      if (stored) {
        promptLanguage = stored;
        return;
      }
    }

    promptLanguage = normalizePromptLanguage(navigator.language) ?? 'en';
  });
}

async function loadExtensionPreferences(): Promise<void> {
  extensionPreferences = await getExtensionPreferences();
}

function setupPreferenceListener(): void {
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') return;

    const preferenceChange = changes[EXTENSION_PREFERENCES_KEY];
    if (preferenceChange?.newValue) {
      extensionPreferences = normalizeExtensionPreferences(preferenceChange.newValue);
    }

    for (const key of LANGUAGE_STORAGE_KEYS) {
      const changed = changes[key];
      const nextLanguage = normalizePromptLanguage(changed?.newValue);
      if (nextLanguage) {
        promptLanguage = nextLanguage;
        return;
      }
    }
  });
}

// ---------------------------------------------------------------------------
// Credential filling
// ---------------------------------------------------------------------------

/**
 * Fill a form with credentials from a matched item.
 *
 * Flow:
 * 1. Fill username directly (already available from the item).
 * 2. Request decrypted password from background via GET_CREDENTIALS.
 * 3. If OTP field is detected and item has OTP config, request OTP code.
 * 4. Fill all available fields.
 */
function fillForm(form: DetectedLoginForm, item: EncryptedCredentialItem): void {
  // Fill username field
  if (form.usernameField && item.username) {
    setFieldValue(form.usernameField.element, item.username);
  }

  // Request decrypted credentials from background script
  const includeOtp = !!form.otpField;

  chrome.runtime.sendMessage(
    {
      type: HostRequestType.GET_CREDENTIALS,
      itemId: item.id,
      includeOtp,
      requestId: crypto.randomUUID(),
      timestamp: Date.now(),
      protocolVersion: 1,
    },
    (response: DecryptedCredentialsResponse) => {
      if (chrome.runtime.lastError) {
        console.error('[SecurePass] GET_CREDENTIALS error:', chrome.runtime.lastError.message);
        return;
      }

      if (!response || response.type !== 'CREDENTIALS_RESPONSE') return;

      const decryptedItem = response.item;
      if (!decryptedItem) return;

      // Fill password field
      if (form.passwordField && decryptedItem.password) {
        setFieldValue(form.passwordField.element, decryptedItem.password);
      }

      // Fill OTP field if available
      if (form.otpField && decryptedItem.otpCode) {
        setFieldValue(form.otpField.element, decryptedItem.otpCode);
        if (decryptedItem.otpRemainingSeconds) {
          showTemporaryToast(`OTP filled — rotates in ${decryptedItem.otpRemainingSeconds}s`);
        }
      }

      // Notify background for autofill-success animation
      chrome.runtime.sendMessage({ action: 'autofillSuccess' }).catch(() => {
        // Best-effort — ignore if background is unavailable
      });
    },
  );
}

/**
 * Fill only the OTP field without touching username/password.
 * Used when user clicks the OTP button specifically.
 */
function fillOtpOnly(form: DetectedLoginForm, item: EncryptedCredentialItem): void {
  if (!form.otpField) return;

  chrome.runtime.sendMessage(
    {
      type: HostRequestType.GET_CREDENTIALS,
      itemId: item.id,
      includeOtp: true,
      requestId: crypto.randomUUID(),
      timestamp: Date.now(),
      protocolVersion: 1,
    },
    (response: DecryptedCredentialsResponse) => {
      if (chrome.runtime.lastError) return;
      if (response?.type !== 'CREDENTIALS_RESPONSE') return;

      const decryptedItem = response.item;
      if (decryptedItem?.otpCode) {
        setFieldValue(form.otpField!.element, decryptedItem.otpCode);
        showTemporaryToast(
          decryptedItem.otpRemainingSeconds
            ? `OTP filled — rotates in ${decryptedItem.otpRemainingSeconds}s`
            : 'OTP code filled',
        );
      } else {
        showTemporaryToast('No OTP code available');
      }
    },
  );
}

/**
 * Set a value on an input field, dispatching events to trigger frameworks.
 * Uses the native setter to bypass framework value interception.
 */
function setFieldValue(field: HTMLInputElement, value: string): void {
  const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    'value',
  )?.set;

  if (nativeInputValueSetter) {
    nativeInputValueSetter.call(field, value);
  } else {
    field.value = value;
  }

  // Dispatch events in the order a real user interaction would trigger
  field.dispatchEvent(new Event('focus', { bubbles: true }));
  field.dispatchEvent(new Event('focusin', { bubbles: true }));
  field.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
  field.dispatchEvent(new Event('change', { bubbles: true }));

  // Some frameworks listen for keyboard events
  field.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Unidentified' }));
  field.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'Unidentified' }));
}

// ---------------------------------------------------------------------------
// Clipboard operations
// ---------------------------------------------------------------------------

function copyToClipboard(text: string, field: string): void {
  navigator.clipboard.writeText(text).then(() => {
    showTemporaryToast(`${field} copied to clipboard`);
  }).catch(() => {
    // Fallback for older browsers
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    textarea.remove();
    showTemporaryToast(`${field} copied to clipboard`);
  });
}

function requestPasswordCopy(itemId: string): void {
  chrome.runtime.sendMessage(
    {
      type: HostRequestType.GET_CREDENTIALS,
      itemId,
      includeOtp: false,
      requestId: crypto.randomUUID(),
      timestamp: Date.now(),
      protocolVersion: 1,
    },
    (response: DecryptedCredentialsResponse) => {
      if (chrome.runtime.lastError) return;
      if (response?.type === 'CREDENTIALS_RESPONSE' && response.item?.password) {
        copyToClipboard(response.item.password, 'Password');
      }
    },
  );
}

// ---------------------------------------------------------------------------
// Toast notifications
// ---------------------------------------------------------------------------

function showTemporaryToast(message: string): void {
  const existing = document.getElementById('securepass-toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.id = 'securepass-toast';
  toast.textContent = message;
  Object.assign(toast.style, {
    position: 'fixed',
    bottom: '20px',
    left: '50%',
    transform: 'translateX(-50%)',
    background: '#1f2937',
    color: 'white',
    padding: '8px 16px',
    borderRadius: '6px',
    fontSize: '13px',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    zIndex: '2147483647',
    boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
    transition: 'opacity 0.3s',
    opacity: '1',
  });

  document.body.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 300);
  }, 2000);
}

// ---------------------------------------------------------------------------
// Communication with background
// ---------------------------------------------------------------------------

/**
 * Request matching credentials for the current page URL.
 */
async function requestMatchingItems(
  url: string,
): Promise<{ items: EncryptedCredentialItem[]; vaultLocked: boolean }> {
  return new Promise((resolve) => {
    const request: GetMatchingItemsRequest = {
      type: HostRequestType.GET_MATCHING_ITEMS,
      url,
      requestId: crypto.randomUUID(),
      timestamp: Date.now(),
      protocolVersion: 1,
    };

    chrome.runtime.sendMessage(request, (response) => {
      if (chrome.runtime.lastError) {
        resolve({ items: [], vaultLocked: false });
        return;
      }

      if (response?.type === 'MATCHING_ITEMS_RESPONSE') {
        resolve({ items: response.items || [], vaultLocked: false });
      } else if (response?.type === 'VAULT_LOCKED') {
        resolve({ items: [], vaultLocked: true });
      } else {
        resolve({ items: [], vaultLocked: false });
      }
    });
  });
}

// ---------------------------------------------------------------------------
// Core: detect → query → show overlay
// ---------------------------------------------------------------------------

async function handleDetectedForm(form: DetectedLoginForm): Promise<void> {
  // Don't show overlay if one is already visible for this form
  if (currentOverlay && currentForm === form) return;

  const url = window.location.href;

  // Deduplicate: don't re-query if URL hasn't changed
  if (url === lastScanUrl && currentOverlay) return;

  lastScanUrl = url;
  const { items, vaultLocked } = await requestMatchingItems(url);

  matchedItems = items;
  currentForm = form;
  showOverlay(form, items, vaultLocked);
}

/**
 * Scan the page for login forms and show overlay if found.
 * Handles both top-level pages and iframe contexts.
 */
function scanForForms(): void {
  if (!extensionPreferences.autoFillFormsAutomatically) return;

  const form = detectBestLoginForm(document);

  if (!form) return;

  // Only show overlay if the password field is visible or focused
  const isActive = document.activeElement === form.passwordField.element;
  const isVisible = isElementVisible(form.passwordField.element);

  if (isActive || isVisible) {
    handleDetectedForm(form);
  }
}

/**
 * Debounced scan — prevents excessive scanning during rapid DOM mutations.
 */
function debouncedScan(): void {
  if (scanTimer) clearTimeout(scanTimer);
  scanTimer = setTimeout(scanForForms, SCAN_DEBOUNCE_MS);
}

// ---------------------------------------------------------------------------
// DOM observation for dynamic content
// ---------------------------------------------------------------------------

function setupMutationObserver(): void {
  const observer = new MutationObserver((mutations) => {
    let shouldScan = false;

    for (const mutation of mutations) {
      if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
        // Check if any added node contains inputs
        for (const node of Array.from(mutation.addedNodes)) {
          if (node instanceof Element) {
            if (
              node.tagName === 'INPUT' ||
              node.querySelector?.('input')
            ) {
              shouldScan = true;
              break;
            }
          }
        }
      }

      if (shouldScan) break;
    }

    if (shouldScan) {
      debouncedScan();
    }
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
}

// ---------------------------------------------------------------------------
// Iframe handling
// ---------------------------------------------------------------------------

/**
 * Detect if the current content script is running inside an iframe.
 */
function isInsideIframe(): boolean {
  try {
    return window.self !== window.top;
  } catch {
    // Cross-origin iframe — cannot access window.top
    return true;
  }
}

/**
 * Check if the current frame is likely a login-related iframe
 * (e.g., Google Sign-In, Facebook Login, Apple ID, OAuth providers).
 */
function isLoginIframe(): boolean {
  const hostname = window.location.hostname.toLowerCase();

  const loginIframeHosts = [
    'accounts.google.com',
    'login.microsoftonline.com',
    'facebook.com',
    'appleid.apple.com',
    'github.com',
    'login.yahoo.com',
    'oauth',
    'sso.',
    'id.',
    'signin.',
    'auth.',
  ];

  return loginIframeHosts.some((pattern) => hostname.includes(pattern));
}

/**
 * For cross-origin iframes, the parent page cannot inject into child frames.
 * However, Manifest V3 content scripts run independently in each frame, so
 * form detection and autofill work naturally within the iframe's context.
 *
 * The overlay is positioned relative to the iframe's viewport. If the iframe
 * is small (e.g., a popup login), the overlay will be clipped. In that case,
 * we use the iframe element from the top frame as reference.
 */
function getIframeBoundingClientRect(): DOMRect | null {
  if (!isInsideIframe()) return null;

  try {
    // Try to get the iframe element from the parent frame
    const iframe = window.frameElement as HTMLIFrameElement | null;
    if (iframe) {
      return iframe.getBoundingClientRect();
    }
  } catch {
    // Cross-origin — cannot access frameElement
  }

  return null;
}

// ---------------------------------------------------------------------------
// Event listeners
// ---------------------------------------------------------------------------

function setupEventListeners(): void {
  // Scan when a password field receives focus
  document.addEventListener('focusin', (event) => {
    const target = event.target;
    if (
      target instanceof HTMLInputElement &&
      target.type === 'password'
    ) {
      // Short delay to let the form render
      setTimeout(scanForForms, 50);
    }
  });

  // Remove overlay when user starts typing in the password field
  document.addEventListener('keydown', (event) => {
    if (
      event.target instanceof HTMLInputElement &&
      event.target.type === 'password' &&
      currentOverlay
    ) {
      removeOverlay();
    }
  });

  // Detect form submissions for save-credential prompt
  document.addEventListener('submit', handleFormSubmit, { capture: true });

  // Also handle AJAX-based logins by watching for navigation after
  // password field interaction (common in SPAs)
  let passwordInteracted = false;
  document.addEventListener('focusin', (event) => {
    if (
      event.target instanceof HTMLInputElement &&
      event.target.type === 'password'
    ) {
      passwordInteracted = true;
    }
  });
  document.addEventListener('input', (event) => {
    if (
      event.target instanceof HTMLInputElement &&
      event.target.type === 'password'
    ) {
      passwordInteracted = true;
      capturePendingSaveCandidate(event.target);
    }
  });

  // Re-scan on URL changes (pushState / popstate for SPAs)
  let lastUrl = window.location.href;
  const urlObserver = new MutationObserver(() => {
    const currentUrl = window.location.href;
    if (currentUrl !== lastUrl) {
      lastUrl = currentUrl;
      lastScanUrl = '';
      removeOverlay();

      // If password was recently interacted with and URL changed,
      // this may be a successful SPA login — show save prompt
      if (passwordInteracted) {
        passwordInteracted = false;
        detectAndShowSavePrompt(currentUrl);
      }

      debouncedScan();
    }
  });

  urlObserver.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });

  window.addEventListener('popstate', () => {
    lastScanUrl = '';
    removeOverlay();
    debouncedScan();
  });
}

// ---------------------------------------------------------------------------
// Form submission detection for save prompt
// ---------------------------------------------------------------------------

function capturePendingSaveCandidate(passwordInput: HTMLInputElement): void {
  if (!passwordInput.value) return;

  const form = passwordInput.closest('form');
  const usernameInput = form
    ? findUsernameInForm(form, passwordInput)
    : findUsernameNearPassword(passwordInput);

  pendingSaveCandidate = {
    username: usernameInput?.value?.trim() || '',
    password: passwordInput.value,
    url: window.location.href,
    position: getPromptPosition(passwordInput),
    capturedAt: Date.now(),
  };
}

/**
 * Intercept form submission to capture credentials before the page navigates.
 */
function handleFormSubmit(event: Event): void {
  const form = event.target;
  if (!(form instanceof HTMLFormElement)) return;

  // Check if this form contains a password field
  const passwordInput = form.querySelector('input[type="password"]');
  if (!passwordInput || !(passwordInput instanceof HTMLInputElement)) return;

  // Find the username field using our detector's heuristics
  const usernameInput = findUsernameInForm(form, passwordInput);

  const username = usernameInput?.value?.trim() || '';
  const password = passwordInput.value;

  // Don't prompt for empty passwords
  if (!password) return;

  // Don't prompt if this domain is in the "never save" list
  const domain = extractDomain(window.location.href);
  if (neverSaveDomains.has(domain) || !extensionPreferences.offerToSavePasswords) return;
  const promptPosition = getPromptPosition(passwordInput);

  // Store for prompt after navigation
  pendingSaveForm = {
    passwordField: { element: passwordInput, confidence: 1, reasons: ['submit'] },
    usernameField: usernameInput
      ? { element: usernameInput, confidence: 1, reasons: ['submit'] }
      : null,
    otpField: null,
    formElement: form,
    overallConfidence: 1,
  };
  pendingSaveCandidate = {
    username,
    password,
    url: window.location.href,
    position: promptPosition,
    capturedAt: Date.now(),
  };

  // Show prompt only for a new login (no matching vault item for this site).
  // Keep it asynchronous and delayed so native form submission is not blocked.
  setTimeout(() => {
    requestMatchingItems(window.location.href)
      .then(({ items, vaultLocked }) => {
        if (vaultLocked || items.length > 0 || neverSaveDomains.has(domain)) return;
        showSavePrompt(username, password, window.location.href, promptPosition);
      })
      .catch(() => {
        if (!neverSaveDomains.has(domain)) {
          showSavePrompt(username, password, window.location.href, promptPosition);
        }
      });
  }, 100);
}

/**
 * Find the username field within a form using simple heuristics.
 */
function findUsernameInForm(
  form: HTMLFormElement,
  passwordInput: HTMLInputElement,
): HTMLInputElement | null {
  // Strategy 1: look for autocomplete="username" or type="email"
  const candidates = form.querySelectorAll('input');
  for (const input of Array.from(candidates)) {
    if (input === passwordInput) continue;
    if (input.type === 'hidden' || input.type === 'submit' || input.type === 'checkbox') continue;

    const autocomplete = (input.autocomplete || input.getAttribute('autocomplete') || '').toLowerCase();
    if (autocomplete === 'username' || autocomplete === 'email') {
      return input;
    }
    if (input.type === 'email') {
      return input;
    }
  }

  // Strategy 2: look for text/tel inputs near the password field
  const allInputs = Array.from(candidates).filter(
    (input) =>
      input !== passwordInput &&
      (input.type === 'text' || input.type === 'tel' || input.type === '') &&
      !input.hidden,
  );

  if (allInputs.length === 1) return allInputs[0];

  // Pick the one closest to the password field in DOM order
  let best: HTMLInputElement | null = null;
  let bestDistance = Infinity;

  for (const input of allInputs) {
    const pos = passwordInput.compareDocumentPosition(input);
    if (pos & Node.DOCUMENT_POSITION_PRECEDING) {
      // input is before password — good candidate
      const distance = Math.abs(
        passwordInput.getBoundingClientRect().top - input.getBoundingClientRect().top,
      );
      if (distance < bestDistance) {
        bestDistance = distance;
        best = input;
      }
    }
  }

  return best || allInputs[0] || null;
}

function findUsernameNearPassword(passwordInput: HTMLInputElement): HTMLInputElement | null {
  const parent = passwordInput.parentElement;
  const root = parent?.closest('main, section, article, div') || document;
  const candidates = Array.from(root.querySelectorAll('input')).filter(
    (input): input is HTMLInputElement =>
      input instanceof HTMLInputElement &&
      input !== passwordInput &&
      !input.disabled &&
      !input.hidden &&
      ['email', 'text', 'tel', ''].includes(input.type),
  );

  if (candidates.length === 0) return null;

  let best: HTMLInputElement | null = null;
  let bestDistance = Infinity;
  const passwordRect = passwordInput.getBoundingClientRect();

  for (const input of candidates) {
    const rect = input.getBoundingClientRect();
    const distance = Math.abs(passwordRect.top - rect.top) + Math.abs(passwordRect.left - rect.left);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = input;
    }
  }

  return best;
}

/**
 * Attempt to show save prompt after SPA navigation.
 * Checks if the URL changed and there was recent password interaction.
 */
function detectAndShowSavePrompt(newUrl: string): void {
  if (!pendingSaveCandidate) return;

  const candidate = pendingSaveCandidate;
  pendingSaveCandidate = null;
  pendingSaveForm = null;

  // Ignore stale captured credentials from old interactions.
  if (Date.now() - candidate.capturedAt > 60_000) return;

  const domain = extractDomain(candidate.url);
  if (neverSaveDomains.has(domain) || !extensionPreferences.offerToSavePasswords) return;

  requestMatchingItems(newUrl)
    .then(({ items, vaultLocked }) => {
      if (vaultLocked || items.length > 0 || neverSaveDomains.has(domain)) return;
      showSavePrompt(candidate.username, candidate.password, candidate.url, candidate.position);
    })
    .catch(() => {
      if (!neverSaveDomains.has(domain)) {
        showSavePrompt(candidate.username, candidate.password, candidate.url, candidate.position);
      }
    });
}

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------

async function initialize(): Promise<void> {
  await loadExtensionPreferences();
  loadPromptLanguage();
  setupPreferenceListener();

  // Load "never save" domains from persistent storage
  chrome.storage.local.get(NEVER_SAVE_DOMAINS_KEY, (data) => {
    const stored: string[] = data[NEVER_SAVE_DOMAINS_KEY] || [];
    for (const domain of stored) {
      neverSaveDomains.add(domain);
    }
  });

  setupMutationObserver();
  setupEventListeners();

  // If inside a known login iframe, scan more aggressively
  const initialDelay = isLoginIframe() ? 200 : INITIAL_SCAN_DELAY_MS;
  setTimeout(scanForForms, initialDelay);
}

// Start the content script
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initialize);
} else {
  initialize();
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function escapeHtml(str: string): string {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
