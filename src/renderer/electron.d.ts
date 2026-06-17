import {
  Folder,
  Item,
  ItemDecrypted,
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
} from '../shared/types';

export type IpcResult<T> = { success: boolean; data: T; error?: string };

export interface ElectronAuthAPI {
  init(masterPassword: string): Promise<IpcResult<void>>;
  unlock(masterPassword: string): Promise<IpcResult<void>>;
  lock(): Promise<IpcResult<void>>;
  changePassword(oldPassword: string, newPassword: string): Promise<IpcResult<void>>;
  check(): Promise<{ initialized: boolean }>;
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

export interface ElectronAPI {
  auth: ElectronAuthAPI;
  import: ElectronImportAPI;
  export: ElectronExportAPI;
  folders: ElectronFoldersAPI;
  items: ElectronItemsAPI;
  tags: ElectronTagsAPI;
  files: ElectronFilesAPI;
  covers: ElectronCoversAPI;
  search: ElectronSearchAPI;
  settings: ElectronSettingsAPI;
  trash: ElectronTrashAPI;
  health: ElectronHealthAPI;
  window: ElectronWindowAPI;
  updates: ElectronUpdatesAPI;
}

declare global {
  interface Window {
    electron: ElectronAPI;
  }
}
