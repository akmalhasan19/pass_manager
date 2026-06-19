export type DefaultItemClickAction = 'autofill' | 'copy-password' | 'copy-username';

export interface ExtensionPreferences {
  offerToSavePasswords: boolean;
  autoFillFormsAutomatically: boolean;
  clearClipboardAfterCopy: boolean;
  clipboardClearAfterSeconds: number;
  defaultItemClickAction: DefaultItemClickAction;
}

export const EXTENSION_PREFERENCES_KEY = 'extensionPreferences';

export const DEFAULT_EXTENSION_PREFERENCES: ExtensionPreferences = {
  offerToSavePasswords: true,
  autoFillFormsAutomatically: true,
  clearClipboardAfterCopy: true,
  clipboardClearAfterSeconds: 45,
  defaultItemClickAction: 'autofill',
};

const VALID_CLICK_ACTIONS: DefaultItemClickAction[] = ['autofill', 'copy-password', 'copy-username'];

function isBoolean(value: unknown): value is boolean {
  return typeof value === 'boolean';
}

function isNumberInRange(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
}

function normalizeBoolean(value: unknown, fallback: boolean): boolean {
  return isBoolean(value) ? value : fallback;
}

function normalizeClickAction(value: unknown): DefaultItemClickAction {
  return typeof value === 'string' && VALID_CLICK_ACTIONS.includes(value as DefaultItemClickAction)
    ? (value as DefaultItemClickAction)
    : DEFAULT_EXTENSION_PREFERENCES.defaultItemClickAction;
}

export function normalizeExtensionPreferences(value: unknown): ExtensionPreferences {
  if (!value || typeof value !== 'object') {
    return { ...DEFAULT_EXTENSION_PREFERENCES };
  }

  const raw = value as Partial<ExtensionPreferences>;
  const clipboardClearAfterSeconds = isNumberInRange(
    raw.clipboardClearAfterSeconds,
    5,
    300,
  )
    ? Math.floor(raw.clipboardClearAfterSeconds)
    : DEFAULT_EXTENSION_PREFERENCES.clipboardClearAfterSeconds;

  return {
    offerToSavePasswords: normalizeBoolean(
      raw.offerToSavePasswords,
      DEFAULT_EXTENSION_PREFERENCES.offerToSavePasswords,
    ),
    autoFillFormsAutomatically: normalizeBoolean(
      raw.autoFillFormsAutomatically,
      DEFAULT_EXTENSION_PREFERENCES.autoFillFormsAutomatically,
    ),
    clearClipboardAfterCopy: normalizeBoolean(
      raw.clearClipboardAfterCopy,
      DEFAULT_EXTENSION_PREFERENCES.clearClipboardAfterCopy,
    ),
    clipboardClearAfterSeconds,
    defaultItemClickAction: normalizeClickAction(raw.defaultItemClickAction),
  };
}

export async function getExtensionPreferences(): Promise<ExtensionPreferences> {
  const result = await chrome.storage.local.get(EXTENSION_PREFERENCES_KEY);
  return normalizeExtensionPreferences(result[EXTENSION_PREFERENCES_KEY]);
}

export async function updateExtensionPreferences(
  partial: Partial<ExtensionPreferences>,
): Promise<ExtensionPreferences> {
  const current = await getExtensionPreferences();
  const next = normalizeExtensionPreferences({ ...current, ...partial });

  await chrome.storage.local.set({ [EXTENSION_PREFERENCES_KEY]: next });
  return next;
}
