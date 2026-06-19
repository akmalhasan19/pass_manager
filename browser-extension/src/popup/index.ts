/**
 * Popup script for SecurePass Manager Browser Extension.
 *
 * Displays matching credentials for the active tab, provides copy/autofill
 * actions, vault status indicator, and search filtering.
 *
 * @module popup/index
 */

import {
  HostRequestType,
  ExtensionResponseType,
  type GetMatchingItemsRequest,
  type CopyToClipboardRequest,
  type EncryptedCredentialItem,
  type MatchingItemsResponse,
  type VaultLockedResponse,
  type ClipboardConfirmationResponse,
  type ErrorResponse,
  type ExtensionResponse,
} from '../shared/protocol';

// ---------------------------------------------------------------------------
// DOM elements
// ---------------------------------------------------------------------------

const statusDot = document.getElementById('statusDot')!;
const statusText = document.getElementById('statusText')!;
const vaultBadge = document.getElementById('vaultBadge')!;
const vaultBadgeText = document.getElementById('vaultBadgeText')!;
const matchCount = document.getElementById('matchCount')!;
const searchWrapper = document.getElementById('searchWrapper')!;
const searchSeparator = document.getElementById('searchSeparator')!;
const searchInput = document.getElementById('searchInput') as HTMLInputElement;
const content = document.getElementById('content')!;
const loadingState = document.getElementById('loadingState')!;
const footer = document.getElementById('footer')!;
const refreshBtn = document.getElementById('refreshBtn')!;
const openAppBtn = document.getElementById('openAppBtn')!;
const settingsBtn = document.getElementById('settingsBtn')!;
const toast = document.getElementById('toast')!;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let allItems: EncryptedCredentialItem[] = [];
let currentTabUrl = '';
let expandedItemId: string | null = null;
let toastTimer: ReturnType<typeof setTimeout> | null = null;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function escapeHtml(str: string): string {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function showToast(message: string, durationMs = 2500): void {
  if (toastTimer) clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.add('visible');
  toastTimer = setTimeout(() => {
    toast.classList.remove('visible');
    toastTimer = null;
  }, durationMs);
}

function getFaviconUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return `https://www.google.com/s2/favicons?domain=${parsed.hostname}&sz=32`;
  } catch {
    return '';
  }
}

// ---------------------------------------------------------------------------
// Vault status
// ---------------------------------------------------------------------------

function setVaultStatus(locked: boolean): void {
  vaultBadge.className = locked ? 'vault-badge locked' : 'vault-badge unlocked';
  vaultBadgeText.textContent = locked ? 'Locked' : 'Unlocked';
}

function setConnectionStatus(state: 'connected' | 'disconnected' | 'connecting', label: string): void {
  statusDot.className = `status-dot ${state}`;
  statusText.textContent = label;
}

function setMatchCount(count: number): void {
  if (count > 0) {
    matchCount.style.display = '';
    matchCount.textContent = String(count);
  } else {
    matchCount.style.display = 'none';
  }
}

// ---------------------------------------------------------------------------
// Fetch matching items
// ---------------------------------------------------------------------------

async function fetchMatchingItems(): Promise<void> {
  setConnectionStatus('connecting', 'Connecting...');
  searchWrapper.style.display = 'none';
  searchSeparator.style.display = 'none';
  content.innerHTML = '';
  content.appendChild(loadingState);
  loadingState.style.display = '';

  try {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });

    if (!tab?.url) {
      setConnectionStatus('disconnected', 'No active tab');
      showEmptyState('No active tab detected.', 'Open a website to find matching credentials.');
      return;
    }

    currentTabUrl = tab.url;

    const request: GetMatchingItemsRequest = {
      type: HostRequestType.GET_MATCHING_ITEMS,
      url: tab.url,
      requestId: crypto.randomUUID(),
      timestamp: Date.now(),
      protocolVersion: 1,
    };

    const response = (await chrome.runtime.sendMessage(request)) as ExtensionResponse | undefined;

    if (!response) {
      setConnectionStatus('disconnected', 'Not connected');
      setVaultStatus(true);
      showLockedState();
      return;
    }

    handleResponse(response);
  } catch {
    setConnectionStatus('disconnected', 'Not connected');
    setVaultStatus(true);
    showLockedState();
  }
}

function handleResponse(response: ExtensionResponse): void {
  switch (response.type) {
    case ExtensionResponseType.MATCHING_ITEMS_RESPONSE: {
      const matching = response as MatchingItemsResponse;
      setConnectionStatus('connected', 'Connected');
      setVaultStatus(false);
      allItems = matching.items || [];
      setMatchCount(allItems.length);
      renderItems(allItems);
      break;
    }
    case ExtensionResponseType.VAULT_LOCKED: {
      const locked = response as VaultLockedResponse;
      setConnectionStatus('connected', 'Vault locked');
      setVaultStatus(true);
      setMatchCount(0);
      showLockedState(locked.message);
      break;
    }
    case ExtensionResponseType.NO_MATCH_FOUND: {
      setConnectionStatus('connected', 'Connected');
      setVaultStatus(false);
      setMatchCount(0);
      showEmptyState('No credentials found for this site.', 'Add new credentials from the desktop app.');
      break;
    }
    case ExtensionResponseType.ERROR: {
      const err = response as ErrorResponse;
      setConnectionStatus('disconnected', 'Error');
      setVaultStatus(true);
      setMatchCount(0);
      showErrorState(err.message);
      break;
    }
    default: {
      setConnectionStatus('disconnected', 'Unexpected response');
      setVaultStatus(true);
      showEmptyState('Unexpected response from desktop app.', 'Try refreshing.');
      break;
    }
  }
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function showEmptyState(title: string, desc: string): void {
  searchWrapper.style.display = 'none';
  searchSeparator.style.display = 'none';
  content.innerHTML = `
    <div class="state-message">
      <span class="state-icon">🔍</span>
      <div class="state-title">${escapeHtml(title)}</div>
      <div class="state-desc">${escapeHtml(desc)}</div>
    </div>
  `;
}

function showLockedState(message?: string): void {
  searchWrapper.style.display = 'none';
  searchSeparator.style.display = 'none';
  const desc = message || 'Please unlock your vault in the SecurePass desktop app.';
  content.innerHTML = `
    <div class="state-message">
      <span class="state-icon">🔒</span>
      <div class="state-title">Vault Locked</div>
      <div class="state-desc">${escapeHtml(desc)}</div>
      <button class="btn btn-primary" id="unlockOpenAppBtn" style="margin-top:4px;">Open SecurePass</button>
    </div>
  `;
  const unlockBtn = document.getElementById('unlockOpenAppBtn');
  if (unlockBtn) {
    unlockBtn.addEventListener('click', () => {
      chrome.runtime.sendMessage({ action: 'openApp' });
    });
  }
}

function showErrorState(message: string): void {
  searchWrapper.style.display = 'none';
  searchSeparator.style.display = 'none';
  content.innerHTML = `
    <div class="state-message">
      <span class="state-icon">⚠️</span>
      <div class="state-title">Connection Error</div>
      <div class="state-desc">${escapeHtml(message)}</div>
    </div>
  `;
}

function renderItems(items: EncryptedCredentialItem[]): void {
  if (items.length === 0) {
    showEmptyState('No credentials found for this site.', 'Add new credentials from the desktop app.');
    return;
  }

  searchWrapper.style.display = '';
  searchSeparator.style.display = '';
  searchInput.value = '';
  expandedItemId = null;

  const fragment = document.createDocumentFragment();

  for (const item of items) {
    const itemEl = document.createElement('div');
    itemEl.className = 'credential-item';
    itemEl.dataset.id = item.id;

    const faviconSrc = getFaviconUrl(item.url);
    const faviconHtml = faviconSrc
      ? `<img src="${escapeHtml(faviconSrc)}" alt="" onerror="this.parentElement.textContent='🔑'" />`
      : '🔑';

    const otpBadge = item.otpCode
      ? `<span class="otp-badge">OTP</span>`
      : '';

    itemEl.innerHTML = `
      <div class="credential-favicon">${faviconHtml}</div>
      <div class="credential-info">
        <div class="credential-title">${escapeHtml(item.title || 'Untitled')}${otpBadge}</div>
        <div class="credential-username">${escapeHtml(item.username)}</div>
      </div>
      <div class="credential-chevron">▼</div>
    `;

    itemEl.addEventListener('click', () => {
      toggleExpand(item.id);
    });

    fragment.appendChild(itemEl);

    const actionsRow = document.createElement('div');
    actionsRow.className = 'credential-actions-row';
    actionsRow.style.display = 'none';
    actionsRow.dataset.forId = item.id;

    const actions = document.createElement('div');
    actions.className = 'credential-actions';
    actions.innerHTML = `
      <button class="action-btn" data-action="copy-username" data-item-id="${escapeHtml(item.id)}">
        <span class="action-icon">👤</span> Copy Username
      </button>
      <button class="action-btn" data-action="copy-password" data-item-id="${escapeHtml(item.id)}">
        <span class="action-icon">🔑</span> Copy Password
      </button>
      ${item.otpCode ? `
      <button class="action-btn" data-action="copy-otp" data-item-id="${escapeHtml(item.id)}">
        <span class="action-icon">🔢</span> Copy OTP
      </button>` : ''}
      <button class="action-btn primary" data-action="autofill" data-item-id="${escapeHtml(item.id)}">
        <span class="action-icon">⚡</span> Autofill
      </button>
    `;

    actions.addEventListener('click', (e) => {
      e.stopPropagation();
    });

    for (const btn of actions.querySelectorAll<HTMLButtonElement>('[data-action]')) {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        handleAction(btn.dataset.action!, item);
      });
    }

    actionsRow.appendChild(actions);
    fragment.appendChild(actionsRow);
  }

  content.innerHTML = '';
  content.appendChild(fragment);
}

function toggleExpand(itemId: string): void {
  const wasExpanded = expandedItemId === itemId;

  // Collapse all
  for (const el of content.querySelectorAll('.credential-item')) {
    el.classList.remove('expanded');
  }
  for (const row of content.querySelectorAll<HTMLElement>('.credential-actions-row')) {
    row.style.display = 'none';
  }

  if (wasExpanded) {
    expandedItemId = null;
    return;
  }

  expandedItemId = itemId;

  const itemEl = content.querySelector(`.credential-item[data-id="${CSS.escape(itemId)}"]`);
  if (itemEl) itemEl.classList.add('expanded');

  const actionsRow = content.querySelector(`.credential-actions-row[data-for-id="${CSS.escape(itemId)}"]`) as HTMLElement | null;
  if (actionsRow) actionsRow.style.display = '';
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

async function handleAction(action: string, item: EncryptedCredentialItem): Promise<void> {
  switch (action) {
    case 'copy-username':
      await copyToClipboard(item.id, 'username');
      break;
    case 'copy-password':
      await copyToClipboard(item.id, 'password');
      break;
    case 'copy-otp':
      await copyToClipboard(item.id, 'otp');
      break;
    case 'autofill':
      await triggerAutofill(item);
      break;
  }
}

async function copyToClipboard(
  itemId: string,
  field: 'username' | 'password' | 'otp',
): Promise<void> {
  const request: CopyToClipboardRequest = {
    type: HostRequestType.COPY_TO_CLIPBOARD,
    itemId,
    field,
    clearAfterSeconds: 30,
    requestId: crypto.randomUUID(),
    timestamp: Date.now(),
    protocolVersion: 1,
  };

  try {
    const response = (await chrome.runtime.sendMessage(request)) as ExtensionResponse | undefined;

    if (response?.type === ExtensionResponseType.CLIPBOARD_CONFIRMATION) {
      const conf = response as ClipboardConfirmationResponse;
      const label = field === 'otp' ? 'OTP code' : field === 'username' ? 'Username' : 'Password';
      showToast(`${label} copied — will clear in ${conf.clearAfterSeconds}s`);
    } else if (response?.type === ExtensionResponseType.VAULT_LOCKED) {
      showToast('Vault is locked. Unlock in the desktop app.');
    } else {
      showToast('Failed to copy. Try again.');
    }
  } catch {
    showToast('Desktop app not connected.');
  }
}

async function triggerAutofill(item: EncryptedCredentialItem): Promise<void> {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) {
      showToast('No active tab.');
      return;
    }

    // Request the background script to get decrypted credentials and send
    // them to the content script for injection.
    const credRequest = {
      type: HostRequestType.GET_CREDENTIALS,
      itemId: item.id,
      includeOtp: true,
      requestId: crypto.randomUUID(),
      timestamp: Date.now(),
      protocolVersion: 1,
    };

    const response = (await chrome.runtime.sendMessage(credRequest)) as ExtensionResponse | undefined;

    if (response?.type === ExtensionResponseType.CREDENTIALS_RESPONSE && 'item' in response) {
      const respItem = (response as { item: { password?: string; otpCode?: string; username: string } }).item;

      await chrome.tabs.sendMessage(tab.id, {
        action: 'autofill',
        username: item.username,
        password: respItem.password || '',
        otp: respItem.otpCode || '',
      });

      showToast('Autofill sent!');
    } else if (response?.type === ExtensionResponseType.VAULT_LOCKED) {
      showToast('Vault is locked. Unlock in the desktop app.');
    } else {
      showToast('Could not retrieve credentials.');
    }
  } catch {
    showToast('Autofill failed. Is the page loaded?');
  }
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

function filterItems(query: string): void {
  const q = query.toLowerCase().trim();
  const rows = content.querySelectorAll<HTMLElement>('.credential-item');
  const actionRows = content.querySelectorAll<HTMLElement>('.credential-actions-row');

  let visibleCount = 0;

  for (const item of allItems) {
    const matches = !q
      || item.title.toLowerCase().includes(q)
      || item.username.toLowerCase().includes(q)
      || item.url.toLowerCase().includes(q);

    const row = content.querySelector(`.credential-item[data-id="${CSS.escape(item.id)}"]`) as HTMLElement | null;
    const actionRow = content.querySelector(`.credential-actions-row[data-for-id="${CSS.escape(item.id)}"]`) as HTMLElement | null;

    if (row) row.style.display = matches ? '' : 'none';
    if (actionRow) {
      actionRow.style.display = matches && expandedItemId === item.id ? '' : 'none';
    }

    if (matches) visibleCount++;
  }

  // Handle empty search results
  const existingEmpty = content.querySelector('.search-empty');
  if (existingEmpty) existingEmpty.remove();

  if (visibleCount === 0 && q) {
    const emptyEl = document.createElement('div');
    emptyEl.className = 'state-message search-empty';
    emptyEl.innerHTML = `
      <span class="state-icon">🔍</span>
      <div class="state-title">No matches</div>
      <div class="state-desc">No credentials match "${escapeHtml(query)}".</div>
    `;
    content.appendChild(emptyEl);
  }

  setMatchCount(visibleCount);
}

// ---------------------------------------------------------------------------
// Event listeners
// ---------------------------------------------------------------------------

openAppBtn.addEventListener('click', () => {
  chrome.runtime.sendMessage({ action: 'openApp' });
});

refreshBtn.addEventListener('click', () => {
  fetchMatchingItems();
});

settingsBtn.addEventListener('click', () => {
  // Open settings page in a new popup
  chrome.tabs.create({
    url: chrome.runtime.getURL('src/popup/settings.html'),
    active: false,
  });
  window.close();
});

searchInput.addEventListener('input', () => {
  filterItems(searchInput.value);
});

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

fetchMatchingItems();
