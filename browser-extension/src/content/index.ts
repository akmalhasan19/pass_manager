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
 * All injected UI (overlay, prompt bar, toast) is rendered inside Shadow DOM
 * containers to ensure CSS and DOM isolation from the host page, preventing:
 * - CSS style leakage from the host page
 * - Style override by malicious page stylesheets
 * - Accidental DOM manipulation by page scripts
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
import {
  getOrCreateIsolatedContainer,
  removeIsolatedContainer,
  injectShadowStyles,
} from '../shared/dom-isolation';
import {
  sanitizeUrl,
  sanitizeDomain,
  sanitizeDisplayTitle,
  sanitizeUsername,
  escapeHtml,
  sanitizeFormField,
} from '../shared/sanitize';
import {
  checkDomainMatch,
  isCommonlyPhishedDomain,
  type DomainMatchResult,
} from '../shared/anti-phishing';
import { secureClearString } from '../shared/secureMemory';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Overlay container ID. */
const OVERLAY_ID = 'securepass-autofill-overlay';

/** Prompt bar ID for save-credential prompt. */
const PROMPT_BAR_ID = 'securepass-prompt-bar';

/** Toast ID for transient content-script messages. */
const TOAST_ID = 'securepass-toast';

/** Shadow DOM container IDs. */
const OVERLAY_CONTAINER = 'overlay';
const PROMPT_CONTAINER = 'prompt';
const TOAST_CONTAINER = 'toast';

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

/** Domain match results per item ID (for anti-phishing). */
let domainMatchResults: Map<string, DomainMatchResult> = new Map();

/** Current page domain (extracted for anti-phishing checks). */
let currentPageDomain: string = '';
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
// Styles — Rendered inside Shadow DOM to isolate from host page CSS
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
  /* Phishing warning banner */
  #${OVERLAY_ID} .sp-phishing-warning {
    padding: 8px 14px;
    background: #fef2f2;
    border-bottom: 1px solid #fecaca;
    display: flex;
    align-items: flex-start;
    gap: 8px;
    font-size: 12px;
    line-height: 1.4;
    color: #991b1b;
  }
  #${OVERLAY_ID} .sp-phishing-warning .sp-warning-icon {
    flex-shrink: 0;
    font-size: 14px;
    line-height: 1.4;
  }
  #${OVERLAY_ID} .sp-phishing-warning .sp-warning-text {
    flex: 1;
    min-width: 0;
  }
  #${OVERLAY_ID} .sp-phishing-warning .sp-warning-title {
    font-weight: 600;
    color: #7f1d1d;
  }
  @media (prefers-color-scheme: dark) {
    #${OVERLAY_ID} .sp-phishing-warning {
      background: #450a0a;
      border-color: #7f1d1d;
      color: #fca5a5;
    }
    #${OVERLAY_ID} .sp-phishing-warning .sp-warning-title {
      color: #fecaca;
    }
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
 * Renders inside a Shadow DOM container to ensure CSS/DOM isolation.
 */
function showOverlay(
  form: DetectedLoginForm,
  items: EncryptedCredentialItem[],
  vaultLocked: boolean = false,
  hasRiskyItem: boolean = false,
): void {
  removeOverlay();

  const shadowRoot = getOrCreateIsolatedContainer(OVERLAY_CONTAINER);
  injectShadowStyles(shadowRoot, OVERLAY_STYLES);

  const overlay = document.createElement('div');
  overlay.id = OVERLAY_ID;

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

  // Phishing warning banner: shown when any item's domain doesn't match
  if (hasRiskyItem) {
    const phishingBanner = document.createElement('div');
    phishingBanner.className = 'sp-phishing-warning';
    phishingBanner.innerHTML = `
      <span class="sp-warning-icon">&#9888;</span>
      <div class="sp-warning-text">
        <div class="sp-warning-title">${escapeHtml('Phishing Warning')}</div>
        <div>${escapeHtml('Some credentials do not match this domain. Verify before filling.')}</div>
      </div>
    `;
    overlay.appendChild(phishingBanner);
  }

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

      const matchResult = domainMatchResults.get(item.id);
      const isRisky = matchResult && !matchResult.isSafe;

      itemEl.innerHTML = `
        <div class="sp-item-icon" style="${isRisky ? 'border:2px solid #dc2626;' : ''}">${escapeHtml(icon)}</div>
        <div class="sp-item-info">
          <div class="sp-item-title">${escapeHtml(item.title || item.url)}</div>
          <div class="sp-item-username">${escapeHtml(item.username)}</div>
        </div>
        ${isRisky ? '<span style="margin-left:auto;color:#dc2626;font-size:16px;flex-shrink:0;" title="' + escapeHtml(matchResult!.description) + '">&#9888;</span>' : ''}
        <div class="sp-item-actions">
          <button class="sp-action-btn" data-action="fill">Fill</button>
          ${hasOtp ? '<button class="sp-action-btn" data-action="fill-otp">OTP</button>' : ''}
          <button class="sp-action-btn" data-action="copy-user">User</button>
          <button class="sp-action-btn" data-action="copy-pass">Pass</button>
        </div>
      `;

      if (isRisky) {
        itemEl.style.borderLeft = '3px solid #dc2626';
      }

      // Click on item row → autofill
      itemEl.addEventListener('click', (e) => {
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
    top = rect.top - 6;
    overlay.style.transform = 'translateY(-100%)';
  }

  overlay.style.top = `${top}px`;
  overlay.style.left = `${Math.max(8, left)}px`;

  shadowRoot.appendChild(overlay);
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
  removeIsolatedContainer(OVERLAY_CONTAINER);

  // Securely clear cached credential references from memory
  matchedItems = [];
  domainMatchResults = new Map();
}

// ---------------------------------------------------------------------------
// Save credential prompt bar
// ---------------------------------------------------------------------------

function removePromptBar(): void {
  if (currentPromptBar) {
    currentPromptBar.remove();
    currentPromptBar = null;
  }
  removeIsolatedContainer(PROMPT_CONTAINER);
}

/**
 * Show the save-credential prompt bar at the bottom of the viewport.
 * Renders inside a Shadow DOM container to ensure CSS/DOM isolation.
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

  const shadowRoot = getOrCreateIsolatedContainer(PROMPT_CONTAINER);
  injectShadowStyles(shadowRoot, PROMPT_BAR_STYLES);

  const bar = document.createElement('div');
  bar.id = PROMPT_BAR_ID;
  bar.dataset.position = position;
  bar.lang = promptLanguage;

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

  shadowRoot.appendChild(bar);
  currentPromptBar = bar;

  // Auto-dismiss after 15 seconds
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

  const shadowRoot = getOrCreateIsolatedContainer(PROMPT_CONTAINER);
  injectShadowStyles(shadowRoot, PROMPT_BAR_STYLES);

  const bar = document.createElement('div');
  bar.id = PROMPT_BAR_ID;

  const success = document.createElement('div');
  success.className = 'sp-prompt-success';
  success.innerHTML = `<span class="sp-prompt-success-icon">&#10003;</span> ${escapeHtml(copy.saved)}`;
  bar.appendChild(success);

  shadowRoot.appendChild(bar);
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

function fillForm(form: DetectedLoginForm, item: EncryptedCredentialItem): void {
  // Anti-phishing: warn if domain doesn't match before filling
  const matchResult = domainMatchResults.get(item.id);
  if (matchResult && !matchResult.isSafe) {
    showTemporaryToast(`⚠ Warning: ${matchResult.description}. Fill at your own risk.`);
  }

  if (form.usernameField && item.username) {
    setFieldValue(form.usernameField.element, item.username);
  }

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

      if (form.passwordField && decryptedItem.password) {
        setFieldValue(form.passwordField.element, decryptedItem.password);
        // Clear password from memory after use
        decryptedItem.password = secureClearString(decryptedItem.password);
      }

      if (form.otpField && decryptedItem.otpCode) {
        setFieldValue(form.otpField.element, decryptedItem.otpCode);
        // Clear OTP code from memory after use
        decryptedItem.otpCode = secureClearString(decryptedItem.otpCode);
        if (decryptedItem.otpRemainingSeconds) {
          showTemporaryToast(`OTP filled — rotates in ${decryptedItem.otpRemainingSeconds}s`);
        }
      }

      chrome.runtime.sendMessage({ action: 'autofillSuccess' }).catch(() => {});
    },
  );
}

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
        // Clear OTP code from memory after use
        decryptedItem.otpCode = secureClearString(decryptedItem.otpCode);
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

  field.dispatchEvent(new Event('focus', { bubbles: true }));
  field.dispatchEvent(new Event('focusin', { bubbles: true }));
  field.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
  field.dispatchEvent(new Event('change', { bubbles: true }));
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
        // Clear password from memory after copying to clipboard
        response.item.password = secureClearString(response.item.password);
      }
    },
  );
}

// ---------------------------------------------------------------------------
// Toast notifications
// ---------------------------------------------------------------------------

function showTemporaryToast(message: string): void {
  const existing = document.getElementById(TOAST_ID);
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.id = TOAST_ID;
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
// Core: detect -> query -> show overlay (all via isolated Shadow DOM)
// ---------------------------------------------------------------------------

async function handleDetectedForm(form: DetectedLoginForm): Promise<void> {
  if (currentOverlay && currentForm === form) return;

  const url = window.location.href;

  if (url === lastScanUrl && currentOverlay) return;

  lastScanUrl = url;
  const { items, vaultLocked } = await requestMatchingItems(url);

  // Compute anti-phishing domain match results
  try {
    currentPageDomain = new URL(url).hostname;
  } catch {
    currentPageDomain = '';
  }
  domainMatchResults = new Map();
  let hasRiskyItem = false;
  for (const item of items) {
    let itemDomain = '';
    try {
      itemDomain = new URL(item.url).hostname;
    } catch {
      // Try treating item.url as a bare domain
      itemDomain = item.url;
    }
    const result = checkDomainMatch(itemDomain, currentPageDomain);
    domainMatchResults.set(item.id, result);
    if (!result.isSafe) hasRiskyItem = true;
  }

  matchedItems = items;
  currentForm = form;
  showOverlay(form, items, vaultLocked, hasRiskyItem);
}

function scanForForms(): void {
  if (!extensionPreferences.autoFillFormsAutomatically) return;

  const form = detectBestLoginForm(document);

  if (!form) return;

  const isActive = document.activeElement === form.passwordField.element;
  const isVisible = isElementVisible(form.passwordField.element);

  if (isActive || isVisible) {
    handleDetectedForm(form);
  }
}

function debouncedScan(): void {
  if (scanTimer) clearTimeout(scanTimer);
  scanTimer = setTimeout(scanForForms, SCAN_DEBOUNCE_MS);
}

// ---------------------------------------------------------------------------
// DOM observation
// ---------------------------------------------------------------------------

function setupMutationObserver(): void {
  const observer = new MutationObserver((mutations) => {
    let shouldScan = false;

    for (const mutation of mutations) {
      if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
        for (const node of Array.from(mutation.addedNodes)) {
          if (node instanceof Element) {
            if (node.tagName === 'INPUT' || node.querySelector?.('input')) {
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

function isInsideIframe(): boolean {
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
}

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

function getIframeBoundingClientRect(): DOMRect | null {
  if (!isInsideIframe()) return null;

  try {
    const iframe = window.frameElement as HTMLIFrameElement | null;
    if (iframe) {
      return iframe.getBoundingClientRect();
    }
  } catch {
    // Cross-origin
  }

  return null;
}

// ---------------------------------------------------------------------------
// Event listeners
// ---------------------------------------------------------------------------

function setupEventListeners(): void {
  document.addEventListener('focusin', (event) => {
    const target = event.target;
    if (target instanceof HTMLInputElement && target.type === 'password') {
      setTimeout(scanForForms, 50);
    }
  });

  document.addEventListener('keydown', (event) => {
    if (
      event.target instanceof HTMLInputElement &&
      event.target.type === 'password' &&
      currentOverlay
    ) {
      removeOverlay();
    }
  });

  document.addEventListener('submit', handleFormSubmit, { capture: true });

  let passwordInteracted = false;
  document.addEventListener('focusin', (event) => {
    if (event.target instanceof HTMLInputElement && event.target.type === 'password') {
      passwordInteracted = true;
    }
  });
  document.addEventListener('input', (event) => {
    if (event.target instanceof HTMLInputElement && event.target.type === 'password') {
      passwordInteracted = true;
      capturePendingSaveCandidate(event.target);
    }
  });

  let lastUrl = window.location.href;
  const urlObserver = new MutationObserver(() => {
    const currentUrl = window.location.href;
    if (currentUrl !== lastUrl) {
      lastUrl = currentUrl;
      lastScanUrl = '';
      removeOverlay();

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
// Form submission detection
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

function handleFormSubmit(event: Event): void {
  const form = event.target;
  if (!(form instanceof HTMLFormElement)) return;

  const passwordInput = form.querySelector('input[type="password"]');
  if (!passwordInput || !(passwordInput instanceof HTMLInputElement)) return;

  const usernameInput = findUsernameInForm(form, passwordInput);

  const username = usernameInput?.value?.trim() || '';
  const password = passwordInput.value;

  if (!password) return;

  const domain = extractDomain(window.location.href);
  if (neverSaveDomains.has(domain) || !extensionPreferences.offerToSavePasswords) return;
  const promptPosition = getPromptPosition(passwordInput);

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

function findUsernameInForm(
  form: HTMLFormElement,
  passwordInput: HTMLInputElement,
): HTMLInputElement | null {
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

  const allInputs = Array.from(candidates).filter(
    (input) =>
      input !== passwordInput &&
      (input.type === 'text' || input.type === 'tel' || input.type === '') &&
      !input.hidden,
  );

  if (allInputs.length === 1) return allInputs[0];

  let best: HTMLInputElement | null = null;
  let bestDistance = Infinity;

  for (const input of allInputs) {
    const pos = passwordInput.compareDocumentPosition(input);
    if (pos & Node.DOCUMENT_POSITION_PRECEDING) {
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

function detectAndShowSavePrompt(newUrl: string): void {
  if (!pendingSaveCandidate) return;

  const candidate = pendingSaveCandidate;
  pendingSaveCandidate = null;
  pendingSaveForm = null;

  if (Date.now() - candidate.capturedAt > 60_000) {
    // Expired — securely clear the captured password
    secureClearString(candidate.password);
    return;
  }

  const domain = extractDomain(candidate.url);
  if (neverSaveDomains.has(domain) || !extensionPreferences.offerToSavePasswords) {
    secureClearString(candidate.password);
    return;
  }

  requestMatchingItems(newUrl)
    .then(({ items, vaultLocked }) => {
      if (vaultLocked || items.length > 0 || neverSaveDomains.has(domain)) {
        secureClearString(candidate.password);
        return;
      }
      showSavePrompt(candidate.username, candidate.password, candidate.url, candidate.position);
    })
    .catch(() => {
      if (!neverSaveDomains.has(domain)) {
        showSavePrompt(candidate.username, candidate.password, candidate.url, candidate.position);
      }
      secureClearString(candidate.password);
    });
}

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------

async function initialize(): Promise<void> {
  await loadExtensionPreferences();
  loadPromptLanguage();
  setupPreferenceListener();

  chrome.storage.local.get(NEVER_SAVE_DOMAINS_KEY, (data) => {
    const stored: string[] = data[NEVER_SAVE_DOMAINS_KEY] || [];
    for (const domain of stored) {
      neverSaveDomains.add(domain);
    }
  });

  setupMutationObserver();
  setupEventListeners();

  const initialDelay = isLoginIframe() ? 200 : INITIAL_SCAN_DELAY_MS;
  setTimeout(scanForForms, initialDelay);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initialize);
} else {
  initialize();
}