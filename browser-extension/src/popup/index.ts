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
  type NoMatchFoundResponse,
  type VaultLockedResponse,
  type ClipboardConfirmationResponse,
  type ErrorResponse,
  type ExtensionResponse,
  type ExtensionSettingsResponse,
  ErrorCode,
} from '../shared/protocol';
import {
  EXTENSION_PREFERENCES_KEY,
  getExtensionPreferences,
  updateExtensionPreferences,
  normalizeExtensionPreferences,
  type ExtensionPreferences,
  type DefaultItemClickAction,
} from '../shared/preferences';
import {
  sanitizeUrl,
  sanitizeDisplayTitle,
  sanitizeUsername,
  escapeHtml,
  isValidTabUrl,
} from '../shared/sanitize';

const statusDot = document.getElementById('statusDot')!;
const statusText = document.getElementById('statusText')!;
const vaultName = document.getElementById('vaultName')!;
const vaultBadge = document.getElementById('vaultBadge')!;
const vaultBadgeText = document.getElementById('vaultBadgeText')!;
const matchCount = document.getElementById('matchCount')!;
const searchWrapper = document.getElementById('searchWrapper')!;
const searchSeparator = document.getElementById('searchSeparator')!;
const searchInput = document.getElementById('searchInput') as HTMLInputElement;
const content = document.getElementById('content')!;
const settingsView = document.getElementById('settingsView')!;
const loadingState = document.getElementById('loadingState')!;
const refreshBtn = document.getElementById('refreshBtn')!;
const openAppBtn = document.getElementById('openAppBtn')!;
const settingsBtn = document.getElementById('settingsBtn')!;
const toast = document.getElementById('toast')!;

let allItems: EncryptedCredentialItem[] = [];
let expandedItemId: string | null = null;
let toastTimer: ReturnType<typeof setTimeout> | null = null;
let currentPreferences: ExtensionPreferences | null = null;

const DEFAULT_VAULT_LOCKED_MESSAGE = 'Please unlock your vault in the SecurePass app.';
const HOST_DISCONNECTED_MESSAGE = 'SecurePass Manager is not connected to the browser extension.';
const HOST_DISCONNECTED_STEPS = [
  'Open SecurePass Manager and unlock your vault.',
  'Reload this popup or restart the browser extension.',
  'If the desktop app was updated, reinstall the native messaging host from Settings.',
];

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
    return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(parsed.hostname)}&sz=32`;
  } catch {
    return '';
  }
}

function getDisplayDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function setVaultStatus(locked: boolean): void {
  vaultBadge.className = locked ? 'vault-badge locked' : 'vault-badge unlocked';
  vaultBadgeText.textContent = locked ? 'Locked' : 'Unlocked';
  vaultBadge.setAttribute('aria-label', locked ? 'Vault locked' : 'Vault unlocked');
}

function setVaultName(name?: string): void {
  const nextName = name?.trim() || 'Active vault';
  vaultName.textContent = nextName;
  vaultName.title = nextName;
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

async function fetchMatchingItems(): Promise<void> {
  setConnectionStatus('connecting', 'Connecting...');
  setVaultName('Checking vault...');
  searchWrapper.style.display = 'none';
  searchSeparator.style.display = 'none';
  content.innerHTML = '';
  content.appendChild(loadingState);
  loadingState.style.display = '';

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab?.url) {
      setConnectionStatus('disconnected', 'No active tab');
      setVaultStatus(true);
      setVaultName('Unavailable');
      showEmptyState('No active tab detected.', 'Open a website to find matching credentials.');
      return;
    }

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
      setVaultName('Unavailable');
      showHostDisconnectedState('No response from SecurePass Manager.');
      return;
    }

    handleResponse(response);
  } catch (error) {
    setConnectionStatus('disconnected', 'Not connected');
    setVaultStatus(true);
    setVaultName('Unavailable');
    showHostDisconnectedState(error instanceof Error ? error.message : 'Could not reach SecurePass Manager.');
  }
}

function handleResponse(response: ExtensionResponse): void {
  switch (response.type) {
    case ExtensionResponseType.MATCHING_ITEMS_RESPONSE: {
      const matching = response as MatchingItemsResponse & { vaultName?: string };
      setConnectionStatus('connected', 'Connected');
      setVaultStatus(false);
      setVaultName(matching.vaultName);
      allItems = matching.items || [];
      setMatchCount(allItems.length);
      renderItems(allItems);
      break;
    }
    case ExtensionResponseType.VAULT_LOCKED: {
      const locked = response as VaultLockedResponse;
      setConnectionStatus('connected', 'Vault locked');
      setVaultStatus(true);
      setVaultName('No vault unlocked');
      setMatchCount(0);
      showVaultLockedState(locked.message);
      break;
    }
    case ExtensionResponseType.NO_MATCH_FOUND: {
      const noMatch = response as NoMatchFoundResponse;
      setConnectionStatus('connected', 'Connected');
      setVaultStatus(false);
      setVaultName('Active vault');
      setMatchCount(0);
      showNoMatchState(noMatch.searchedDomain, noMatch.searchedUrl);
      break;
    }
    case ExtensionResponseType.HOST_SHUTDOWN: {
      const shutdown = response as { message: string };
      setConnectionStatus('disconnected', 'Host closed');
      setVaultStatus(true);
      setVaultName('Unavailable');
      setMatchCount(0);
      showHostDisconnectedState(shutdown.message);
      break;
    }
    case ExtensionResponseType.ERROR: {
      const err = response as ErrorResponse;
      if (
        err.code === ErrorCode.HANDSHAKE_REQUIRED
        || err.code === ErrorCode.INVALID_SESSION
        || err.code === ErrorCode.UNAUTHORIZED
      ) {
        setConnectionStatus('disconnected', 'Not connected');
        setVaultStatus(true);
        setVaultName('Unavailable');
        setMatchCount(0);
        showHostDisconnectedState(err.message);
      } else {
        setConnectionStatus('disconnected', 'Error');
        setVaultStatus(true);
        setVaultName('Unavailable');
        setMatchCount(0);
        showErrorState(err.message);
      }
      break;
    }
    default: {
      setConnectionStatus('disconnected', 'Unexpected response');
      setVaultStatus(true);
      setVaultName('Unavailable');
      showEmptyState('Unexpected response from desktop app.', 'Try refreshing.');
      break;
    }
  }
}

function showEmptyState(title: string, desc: string): void {
  searchWrapper.style.display = 'none';
  searchSeparator.style.display = 'none';
  content.innerHTML = `
    <div class="state-message">
      <span class="state-icon" aria-hidden="true">?</span>
      <div class="state-title">${escapeHtml(title)}</div>
      <div class="state-desc">${escapeHtml(desc)}</div>
    </div>
  `;
}

function showVaultLockedState(message?: string): void {
  searchWrapper.style.display = 'none';
  searchSeparator.style.display = 'none';
  const desc = message || DEFAULT_VAULT_LOCKED_MESSAGE;
  content.innerHTML = `
    <div class="state-message">
      <span class="state-icon state-icon-lock" aria-hidden="true">LOCK</span>
      <div class="state-title">Vault Locked</div>
      <div class="state-desc">${escapeHtml(desc)}</div>
      <button class="btn btn-primary state-action" id="statePrimaryAction" type="button">Open App</button>
    </div>
  `;
  document.getElementById('statePrimaryAction')?.addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'openApp' });
  });
}

function showNoMatchState(domain?: string, url?: string): void {
  searchWrapper.style.display = 'none';
  searchSeparator.style.display = 'none';
  const searched = domain ? ` for ${escapeHtml(domain)}` : '';
  const targetUrl = url || '';
  const safeTargetUrl = targetUrl ? escapeHtml(targetUrl) : '';

  content.innerHTML = `
    <div class="state-message">
      <span class="state-icon" aria-hidden="true">0</span>
      <div class="state-title">No credentials found for this site${searched}</div>
      <div class="state-desc">Add this login from SecurePass Manager or save it after your next successful sign-in.</div>
      ${safeTargetUrl ? `<div class="state-domain" title="${safeTargetUrl}">${safeTargetUrl}</div>` : ''}
      <button class="btn btn-primary state-action" id="statePrimaryAction" type="button">Add New</button>
    </div>
  `;
  document.getElementById('statePrimaryAction')?.addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'openApp', route: 'newItem' });
  });
}

function showHostDisconnectedState(message?: string): void {
  searchWrapper.style.display = 'none';
  searchSeparator.style.display = 'none';
  const detail = message || HOST_DISCONNECTED_MESSAGE;
  const steps = HOST_DISCONNECTED_STEPS.map((step) => `<li>${escapeHtml(step)}</li>`).join('');

  content.innerHTML = `
    <div class="state-message">
      <span class="state-icon" aria-hidden="true">!</span>
      <div class="state-title">Desktop App Not Connected</div>
      <div class="state-desc">${escapeHtml(detail)}</div>
      <ol class="state-troubleshooting">${steps}</ol>
      <div class="state-actions">
        <button class="btn btn-primary" id="statePrimaryAction" type="button">Open App</button>
        <button class="btn btn-secondary" id="stateSecondaryAction" type="button">Retry</button>
      </div>
    </div>
  `;
  document.getElementById('statePrimaryAction')?.addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'openApp' });
  });
  document.getElementById('stateSecondaryAction')?.addEventListener('click', () => {
    fetchMatchingItems();
  });
}

function showErrorState(message: string): void {
  searchWrapper.style.display = 'none';
  searchSeparator.style.display = 'none';
  content.innerHTML = `
    <div class="state-message">
      <span class="state-icon" aria-hidden="true">!</span>
      <div class="state-title">Connection Error</div>
      <div class="state-desc">${escapeHtml(message)}</div>
      <div class="state-actions">
        <button class="btn btn-primary" id="statePrimaryAction" type="button">Retry</button>
      </div>
    </div>
  `;
  document.getElementById('statePrimaryAction')?.addEventListener('click', () => {
    fetchMatchingItems();
  });
}

function renderItems(items: EncryptedCredentialItem[]): void {
  if (items.length === 0) {
    showNoMatchState();
    return;
  }

  searchWrapper.style.display = '';
  searchSeparator.style.display = '';
  searchInput.value = '';
  expandedItemId = null;

  const fragment = document.createDocumentFragment();

  for (const item of items) {
    fragment.appendChild(createItemRow(item));
    fragment.appendChild(createActionsRow(item));
  }

  content.innerHTML = '';
  content.appendChild(fragment);
}

function createItemRow(item: EncryptedCredentialItem): HTMLElement {
  const itemEl = document.createElement('div');
  itemEl.className = 'credential-item';
  itemEl.dataset.id = item.id;

  const faviconSrc = getFaviconUrl(item.url);
  const faviconHtml = faviconSrc
    ? `<img src="${escapeHtml(faviconSrc)}" alt="" />`
    : '<span class="favicon-fallback" aria-hidden="true">SP</span>';
  const otpBadge = item.otpCode ? '<span class="otp-badge">OTP</span>' : '';

  itemEl.innerHTML = `
    <div class="credential-favicon">${faviconHtml}</div>
    <div class="credential-info">
      <div class="credential-title">${escapeHtml(item.title || 'Untitled')}${otpBadge}</div>
      <div class="credential-username">${escapeHtml(item.username)}</div>
    </div>
    <div class="credential-row-actions" aria-label="Quick copy actions">
      <button class="icon-btn" data-action="copy-username" title="Copy username" aria-label="Copy username">U</button>
      <button class="icon-btn" data-action="copy-password" title="Copy password" aria-label="Copy password">P</button>
    </div>
    <div class="credential-chevron" aria-hidden="true">v</div>
  `;

  itemEl.addEventListener('click', () => toggleExpand(item.id));

  for (const btn of itemEl.querySelectorAll<HTMLButtonElement>('[data-action]')) {
    btn.addEventListener('click', (event) => {
      event.stopPropagation();
      handleAction(btn.dataset.action!, item);
    });
  }

  return itemEl;
}

function createActionsRow(item: EncryptedCredentialItem): HTMLElement {
  const actionsRow = document.createElement('div');
  actionsRow.className = 'credential-actions-row';
  actionsRow.style.display = 'none';
  actionsRow.dataset.forId = item.id;

  const actions = document.createElement('div');
  actions.className = 'credential-actions';
  actions.innerHTML = `
    <div class="credential-detail">${escapeHtml(getDisplayDomain(item.url))}</div>
    <button class="action-btn primary" data-action="autofill">
      <span class="action-icon" aria-hidden="true">>></span> Autofill
    </button>
    <button class="action-btn" data-action="copy-username">
      <span class="action-icon" aria-hidden="true">U</span> Copy Username
    </button>
    <button class="action-btn" data-action="copy-password">
      <span class="action-icon" aria-hidden="true">P</span> Copy Password
    </button>
    ${item.otpCode ? `
    <button class="action-btn" data-action="copy-otp">
      <span class="action-icon" aria-hidden="true">#</span> Copy OTP
    </button>` : ''}
  `;

  actions.addEventListener('click', (event) => event.stopPropagation());

  for (const btn of actions.querySelectorAll<HTMLButtonElement>('[data-action]')) {
    btn.addEventListener('click', (event) => {
      event.stopPropagation();
      handleAction(btn.dataset.action!, item);
    });
  }

  actionsRow.appendChild(actions);
  return actionsRow;
}

function toggleExpand(itemId: string): void {
  const wasExpanded = expandedItemId === itemId;

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
  content.querySelector(`.credential-item[data-id="${CSS.escape(itemId)}"]`)?.classList.add('expanded');

  const actionsRow = content.querySelector(
    `.credential-actions-row[data-for-id="${CSS.escape(itemId)}"]`,
  ) as HTMLElement | null;
  if (actionsRow) actionsRow.style.display = '';
}

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
  const preferences = currentPreferences ?? await getExtensionPreferences();
  currentPreferences = preferences;
  const request: CopyToClipboardRequest = {
    type: HostRequestType.COPY_TO_CLIPBOARD,
    itemId,
    field,
    clearAfterSeconds: preferences.clearClipboardAfterCopy
      ? preferences.clipboardClearAfterSeconds
      : undefined,
    requestId: crypto.randomUUID(),
    timestamp: Date.now(),
    protocolVersion: 1,
  };

  try {
    const response = (await chrome.runtime.sendMessage(request)) as ExtensionResponse | undefined;

    if (response?.type === ExtensionResponseType.CLIPBOARD_CONFIRMATION) {
      const conf = response as ClipboardConfirmationResponse;
      const label = field === 'otp' ? 'OTP code' : field === 'username' ? 'Username' : 'Password';
      showToast(`${label} copied - will clear in ${conf.clearAfterSeconds}s`);
    } else if (response?.type === ExtensionResponseType.VAULT_LOCKED) {
      showToast('Vault is locked. Unlock in the desktop app.');
    } else {
      showToast('Failed to copy. Try again.');
    }
  } catch {
    showToast('Desktop app not connected. Open SecurePass Manager and retry.');
  }
}

async function triggerAutofill(item: EncryptedCredentialItem): Promise<void> {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) {
      showToast('No active tab.');
      return;
    }

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

      showToast('Autofill sent.');
    } else if (response?.type === ExtensionResponseType.VAULT_LOCKED) {
      showToast('Vault is locked. Unlock in the desktop app.');
    } else {
      showToast('Could not retrieve credentials.');
    }
  } catch {
    showToast('Autofill failed. Is the page loaded?');
  }
}

function filterItems(query: string): void {
  const q = query.toLowerCase().trim();
  let visibleCount = 0;

  for (const item of allItems) {
    const matches = !q
      || item.title.toLowerCase().includes(q)
      || item.username.toLowerCase().includes(q)
      || item.url.toLowerCase().includes(q);

    const row = content.querySelector(`.credential-item[data-id="${CSS.escape(item.id)}"]`) as HTMLElement | null;
    const actionRow = content.querySelector(`.credential-actions-row[data-for-id="${CSS.escape(item.id)}"]`) as HTMLElement | null;

    if (row) row.style.display = matches ? '' : 'none';
    if (actionRow) actionRow.style.display = matches && expandedItemId === item.id ? '' : 'none';
    if (matches) visibleCount++;
  }

  content.querySelector('.search-empty')?.remove();

  if (visibleCount === 0 && q) {
    const emptyEl = document.createElement('div');
    emptyEl.className = 'state-message search-empty';
    emptyEl.innerHTML = `
      <span class="state-icon" aria-hidden="true">?</span>
      <div class="state-title">No matches</div>
      <div class="state-desc">No credentials match "${escapeHtml(query)}".</div>
    `;
    content.appendChild(emptyEl);
  }

  setMatchCount(visibleCount);
}

openAppBtn.addEventListener('click', () => {
  chrome.runtime.sendMessage({ action: 'openApp' });
});

refreshBtn.addEventListener('click', () => {
  fetchMatchingItems();
});

settingsBtn.addEventListener('click', () => {
  // Open settings page in a new tab
  chrome.tabs.create({
    url: chrome.runtime.getURL('src/popup/settings.html'),
    active: false,
  });
  window.close();
});

searchInput.addEventListener('input', () => {
  filterItems(searchInput.value);
});

fetchMatchingItems();
