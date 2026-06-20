import {
  Folder,
  Item,
  ItemDecrypted,
  TotpConfig,
  Tag,
  Attachment,
  TrashEntry,
  AppSettings,
  SearchResultItem,
  HealthReport,
  ImportFormat,
  ImportDialogResult,
  ImportPayload,
  CsvColumnMapping,
  CsvHeaderResult,
  DuplicateReport,
  DuplicateResolutionMap,
  VaultRegistryEntry,
} from '../shared/types';

export type IpcResult<T> = { success: boolean; data: T; error?: string };

export interface ElectronAuthAPI {
  init(masterPassword: string, vaultId?: string): Promise<IpcResult<void> & { vaultId?: string }>;
  unlock(masterPassword: string, vaultId?: string): Promise<IpcResult<void> & { vaultId?: string }>;
  lock(): Promise<IpcResult<void>>;
  changePassword(oldPassword: string, newPassword: string, vaultId?: string): Promise<IpcResult<void>>;
  check(): Promise<{ initialized: boolean; vaultId?: string | null; vaultName?: string | null }>;
  // SECURITY: Remove all IPC listeners to prevent lingering references on lock
  cleanupListeners(): void;
}

export interface ElectronFoldersAPI {
  getTree(): Promise<IpcResult<Folder[]>>;
  create(parentId: string | null, name: string, emoji?: string): Promise<IpcResult<Folder>>;
  update(
    id: string,
    fields: { name?: string; emoji?: string; coverImage?: string },
  ): Promise<IpcResult<Folder | null>>;
  move(id: string, newParentId: string | null, sortOrder: number): Promise<IpcResult<Folder[]>>;
  delete(id: string): Promise<IpcResult<void>>;
  restore(id: string): Promise<IpcResult<Folder[]>>;
}

export interface ElectronItemsAPI {
  getAll(): Promise<IpcResult<Item[]>>;
  getByFolder(folderId: string): Promise<IpcResult<Item[]>>;
  getById(id: string): Promise<IpcResult<ItemDecrypted | null>>;
  create(
    folderId: string,
    fields: {
      title: string;
      username?: string;
      password?: string | null;
      url?: string;
      notes?: string | null;
      emoji?: string | null;
      coverImage?: string | null;
      otpConfig?: TotpConfig | null;
    },
  ): Promise<IpcResult<ItemDecrypted>>;
  update(
    id: string,
    fields: {
      title?: string;
      username?: string;
      password?: string | null;
      url?: string;
      notes?: string | null;
      emoji?: string | null;
      coverImage?: string | null;
      isFavorite?: boolean;
      sortOrder?: number;
      otpConfig?: TotpConfig | null;
    },
  ): Promise<IpcResult<ItemDecrypted | null>>;
  delete(id: string): Promise<IpcResult<void>>;
  restore(id: string): Promise<IpcResult<ItemDecrypted>>;
  toggleFavorite(id: string): Promise<IpcResult<ItemDecrypted | null>>;
  search(query: string): Promise<IpcResult<Item[]>>;
  searchByTag(tagId: string): Promise<IpcResult<Item[]>>;
}

export interface ElectronTagsAPI {
  getAll(): Promise<Tag[]>;
  create(name: string, color?: string): Promise<Tag>;
  attach(itemId: string, tagId: string): Promise<void>;
  detach(itemId: string, tagId: string): Promise<void>;
  delete(id: string): Promise<void>;
}

export interface ElectronFilesAPI {
  getByItem(itemId: string): Promise<IpcResult<Attachment[]>>;
  attach(itemId: string, filePath: string): Promise<IpcResult<Attachment>>;
  download(attachmentId: string): Promise<IpcResult<{ filePath: string; fileName: string; mimeType: string }>>;
  delete(attachmentId: string): Promise<IpcResult<Attachment | null>>;
}

export interface ElectronCoversAPI {
  upload(filePath: string): Promise<string>;
  read(coverName: string): Promise<string>;
  delete(coverName: string): Promise<void>;
}

export interface ElectronSearchAPI {
  items(query: string): Promise<SearchResultItem[]>;
  itemsByTag(tagId: string): Promise<SearchResultItem[]>;
}

export interface ElectronSettingsAPI {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  getAll(): Promise<AppSettings>;
}

export interface ElectronTrashAPI {
  get(): Promise<IpcResult<TrashEntry[]>>;
  restore(originalId: string, originalType: 'folder' | 'item'): Promise<void>;
  permanentDelete(id: string): Promise<void>;
  empty(): Promise<void>;
  purge(): Promise<void>;
}

export interface ElectronShortcutsAPI {
  getBindings(): Promise<{
    COPY_PASSWORD: string;
    COPY_USERNAME: string;
    LOCK_VAULT: string;
    QUICK_PICKER: string;
  }>;
  updateBinding(action: string, accelerator: string): Promise<{ valid: boolean; error?: string }>;
  register(): Promise<{ success: boolean }>;
  unregister(): Promise<void>;
  enabledState(locked: boolean): Promise<{ success: boolean }>;
  onAction(callback: (action: { action: string }) => void): void;
  removeActionListener(): void;
}

export interface ElectronWindowAPI {
  minimize(): Promise<void>;
  maximize(): Promise<void>;
  close(): Promise<void>;
  isMaximized(): Promise<boolean>;
}

export interface ElectronImportAPI {
  openFileDialog(format: ImportFormat): Promise<IpcResult<ImportDialogResult>>;
  parseFile(params: ImportDialogResult): Promise<IpcResult<ImportPayload>>;
  getCsvHeaders(content: string): Promise<IpcResult<CsvHeaderResult>>;
  parseGenericCsv(params: {
    content: string;
    columnMapping: CsvColumnMapping;
  }): Promise<IpcResult<ImportPayload>>;
  checkDuplicates(payload: ImportPayload): Promise<IpcResult<DuplicateReport>>;
  commitImport(params: {
    payload: ImportPayload;
    resolutionMap: DuplicateResolutionMap;
  }): Promise<IpcResult<{ importedCount: number; replacedCount: number }>>;
}

export interface ElectronExportAPI {
  exportData(format: 'encrypted-json' | 'json-plain' | 'csv'): Promise<IpcResult<{ filePath: string }>>;
  onProgress(callback: (progress: { percent: number; phase: string }) => void): void;
  removeProgressListener(): void;
}

export interface ElectronHealthAPI {
  analyze(oldDays?: number): Promise<IpcResult<HealthReport>>;
}

export interface ElectronOtpAPI {
  /**
   * Generate a TOTP code for an item. The secret is decrypted and used
   * entirely within the main process — only the code string is returned.
   * SECURITY: The plaintext secret never reaches the renderer.
   */
  generate(itemId: string): Promise<IpcResult<{ code: string; remaining: number }>>;
  /**
   * Retrieve the OTP config (including secret) for an item.
   * Used by OtpSection in edit mode. The renderer MUST NOT persist
   * the secret in Zustand or any state management store.
   */
  getConfig(itemId: string): Promise<IpcResult<TotpConfig | null>>;
  /**
   * Check for system clock drift that could affect TOTP code validity.
   * No network request is made — the check is purely heuristic.
   * Returns an object indicating whether concerning drift was detected.
   */
  checkTimeSync(): Promise<IpcResult<{
    driftDetected: boolean;
    driftMs: number;
    period: number;
  }>>;
}

export interface ElectronQuickPickerAPI {
  search(query: string): Promise<{ success: boolean; data: unknown[] }>;
  action(itemId: string, action: string): Promise<{
    success: boolean;
    data?: {
      action: string;
      clipboard?: {
        clearAfterSeconds: number;
        message: string;
      };
    } | null;
  }>;
  show(): Promise<void>;
  hide(): Promise<void>;
  getItems(): Promise<{ success: boolean; data: unknown[] }>;
  onItems(callback: (items: unknown[]) => void): void;
  onFocusSearch(callback: () => void): void;
  removeItemsListener(): void;
  removeFocusSearchListener(): void;
}

export interface ElectronUpdatesAPI {
  check(): Promise<boolean>;
  download(): Promise<void>;
  quitAndInstall(): void;
  onAvailable(callback: (info: { version: string }) => void): void;
  onNotAvailable(callback: () => void): void;
  onDownloadProgress(callback: (progress: { percent: number }) => void): void;
  onDownloaded(callback: () => void): void;
  onError(callback: (error: { message: string }) => void): void;
  // SECURITY: Remove all update-related IPC listeners to prevent lingering references
  removeAllListeners(): void;
}

export interface ElectronVaultsAPI {
  list(): Promise<IpcResult<VaultRegistryEntry[]>>;
  create(params: {
    name: string;
    masterPassword: string;
    description?: string | null;
    color?: string | null;
    icon?: string | null;
    isDefault?: boolean;
    customDatabasePath?: string;
  }): Promise<IpcResult<VaultRegistryEntry>>;
  select(vaultId: string, masterPassword: string): Promise<IpcResult<{ vaultId: string }>>;
  rename(vaultId: string, name: string): Promise<IpcResult<VaultRegistryEntry>>;
  delete(vaultId: string, deleteDatabaseFile?: boolean, deleteAttachments?: boolean): Promise<IpcResult<VaultRegistryEntry>>;
  setDefault(vaultId: string): Promise<IpcResult<VaultRegistryEntry>>;
  revealLocation(vaultId: string): Promise<IpcResult<void>>;
  getActive(): Promise<IpcResult<{ vaultId: string | null; vault: VaultRegistryEntry | null }>>;
  openFileDialog(): Promise<IpcResult<{ filePath: string; fileName: string }>>;
  importExisting(params: { filePath: string; name: string }): Promise<IpcResult<VaultRegistryEntry>>;
  backupFileDialog(vaultId: string): Promise<IpcResult<{ filePath: string }>>;
  backup(params: { vaultId: string; filePath: string }): Promise<IpcResult<void>>;
  restoreFileDialog(): Promise<IpcResult<{ filePath: string; vaultName: string }>>;
  restore(params: { filePath: string; name: string }): Promise<IpcResult<{ vaultId: string; vaultName: string }>>;
}

export interface ElectronClipboardAPI {
  copy(text: string, options: unknown): Promise<{ success: boolean; clearAfterSeconds?: number; message?: string; error?: string }>;
  status(): Promise<{ success: boolean; data: { hasAutoClear: boolean; clearInSeconds: number | null; message: string | null; type: string | null } }>;
  onStatusChange(callback: (status: { hasAutoClear: boolean; clearInSeconds: number | null; message: string | null; type: string | null }) => void): void;
  clearStatusListener(): void;
}

export interface ElectronExtensionAPI {
  getStatus(): Promise<{ success: boolean; data: unknown; error?: string }>;
  installHost(allowedExtensionIds?: string[]): Promise<{ success: boolean; data: unknown; error?: string }>;
  uninstallHost(): Promise<{ success: boolean; data: unknown; error?: string }>;
  openStore(browser: 'chrome' | 'firefox' | 'edge'): Promise<{ success: boolean; error?: string }>;
}

export interface ElectronAPI {
  auth: ElectronAuthAPI;
  import: ElectronImportAPI;
  export: ElectronExportAPI;
  vaults: ElectronVaultsAPI;
  folders: ElectronFoldersAPI;
  items: ElectronItemsAPI;
  tags: ElectronTagsAPI;
  files: ElectronFilesAPI;
  covers: ElectronCoversAPI;
  search: ElectronSearchAPI;
  settings: ElectronSettingsAPI;
  trash: ElectronTrashAPI;
  health: ElectronHealthAPI;
  otp: ElectronOtpAPI;
  window: ElectronWindowAPI;
  shortcuts: ElectronShortcutsAPI;
  updates: ElectronUpdatesAPI;
  quickPicker: ElectronQuickPickerAPI;
  clipboard: ElectronClipboardAPI;
  extension: ElectronExtensionAPI;
}

declare global {
  interface Window {
    electron: ElectronAPI;
  }
}
