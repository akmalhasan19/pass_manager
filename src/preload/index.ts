import { contextBridge, ipcRenderer } from 'electron';
import { IPC_CHANNELS } from '../shared/ipcChannels';
import type { ImportFormat } from '../shared/types';

const api = {
  import: {
    openFileDialog: (format: ImportFormat) =>
      ipcRenderer.invoke(IPC_CHANNELS.IMPORT_OPEN_FILE_DIALOG, { format }),
    parseFile: (params: { format: ImportFormat; filePath: string; content: string }) =>
      ipcRenderer.invoke(IPC_CHANNELS.IMPORT_PARSE_FILE, params),
    getCsvHeaders: (content: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.IMPORT_GET_CSV_HEADERS, { content }),
    parseGenericCsv: (params: {
      content: string;
      columnMapping: import('../shared/types').CsvColumnMapping;
    }) => ipcRenderer.invoke(IPC_CHANNELS.IMPORT_PARSE_GENERIC_CSV, params),
    checkDuplicates: (payload: import('../shared/types').ImportPayload) =>
      ipcRenderer.invoke(IPC_CHANNELS.IMPORT_CHECK_DUPLICATES, { payload }),
    commitImport: (params: {
      payload: import('../shared/types').ImportPayload;
      resolutionMap: import('../shared/types').DuplicateResolutionMap;
    }) => ipcRenderer.invoke(IPC_CHANNELS.IMPORT_COMMIT, params),
  },

  export: {
    exportData: (format: 'encrypted-json' | 'json-plain' | 'csv') =>
      ipcRenderer.invoke(IPC_CHANNELS.EXPORT_DATA, { format }),
    onProgress: (callback: (progress: { percent: number; phase: string }) => void) =>
      ipcRenderer.on(IPC_CHANNELS.EXPORT_PROGRESS, (_event, progress) => callback(progress)),
    removeProgressListener: () =>
      ipcRenderer.removeAllListeners(IPC_CHANNELS.EXPORT_PROGRESS),
  },

  auth: {
    init: (masterPassword: string, vaultId?: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.AUTH_INIT, { masterPassword, vaultId }),
    unlock: (masterPassword: string, vaultId?: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.AUTH_UNLOCK, { masterPassword, vaultId }),
    lock: () => ipcRenderer.invoke(IPC_CHANNELS.AUTH_LOCK),
    changePassword: (oldPassword: string, newPassword: string, vaultId?: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.AUTH_CHANGE_PASSWORD, { oldPassword, newPassword, vaultId }),
    check: () => ipcRenderer.invoke(IPC_CHANNELS.AUTH_CHECK),
    // SECURITY: Clean up all IPC listeners to prevent lingering references
    // after lock or when the renderer no longer needs them.
    cleanupListeners: () => removeAllSensitiveListeners(),
  },

  vaults: {
    list: () => ipcRenderer.invoke(IPC_CHANNELS.VAULT_LIST),
    create: (params: {
      name: string;
      masterPassword: string;
      description?: string | null;
      color?: string | null;
      icon?: string | null;
      isDefault?: boolean;
      customDatabasePath?: string;
    }) => ipcRenderer.invoke(IPC_CHANNELS.VAULT_CREATE, params),
    select: (vaultId: string, masterPassword: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.VAULT_SELECT, { vaultId, masterPassword }),
    rename: (vaultId: string, name: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.VAULT_RENAME, { vaultId, name }),
    delete: (vaultId: string, deleteDatabaseFile?: boolean, deleteAttachments?: boolean) =>
      ipcRenderer.invoke(IPC_CHANNELS.VAULT_DELETE, {
        vaultId,
        deleteDatabaseFile,
        deleteAttachments,
      }),
    getActive: () => ipcRenderer.invoke(IPC_CHANNELS.VAULT_GET_ACTIVE),
  },

  folders: {
    getTree: () => ipcRenderer.invoke(IPC_CHANNELS.FOLDER_GET_TREE),
    create: (parentId: string | null, name: string, emoji?: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.FOLDER_CREATE, { parentId, name, emoji }),
    update: (id: string, fields: { name?: string; emoji?: string; coverImage?: string }) =>
      ipcRenderer.invoke(IPC_CHANNELS.FOLDER_UPDATE, { id, ...fields }),
    move: (id: string, newParentId: string | null, sortOrder: number) =>
      ipcRenderer.invoke(IPC_CHANNELS.FOLDER_MOVE, { id, newParentId, sortOrder }),
    delete: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.FOLDER_DELETE, { id }),
    restore: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.FOLDER_RESTORE, { id }),
  },

  items: {
    getAll: () => ipcRenderer.invoke(IPC_CHANNELS.ITEM_GET_ALL),
    getByFolder: (folderId: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.ITEM_GET_BY_FOLDER, { folderId }),
    getById: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.ITEM_GET_BY_ID, { id }),
    create: (
      folderId: string,
      fields: {
        title: string;
        username?: string;
        passwordEncrypted?: ArrayBuffer | null;
        url?: string;
        notesEncrypted?: ArrayBuffer | null;
        emoji?: string | null;
        coverImage?: string | null;
      },
    ) => ipcRenderer.invoke(IPC_CHANNELS.ITEM_CREATE, { folderId, ...fields }),
    update: (
      id: string,
      fields: {
        title?: string;
        username?: string;
        passwordEncrypted?: ArrayBuffer | null;
        url?: string;
        notesEncrypted?: ArrayBuffer | null;
        emoji?: string | null;
        coverImage?: string | null;
        isFavorite?: boolean;
        sortOrder?: number;
      },
    ) => ipcRenderer.invoke(IPC_CHANNELS.ITEM_UPDATE, { id, ...fields }),
    delete: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.ITEM_DELETE, { id }),
    restore: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.ITEM_RESTORE, { id }),
    toggleFavorite: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.ITEM_TOGGLE_FAVORITE, { id }),
    search: (query: string) => ipcRenderer.invoke(IPC_CHANNELS.ITEM_SEARCH, { query }),
    searchByTag: (tagId: string) => ipcRenderer.invoke(IPC_CHANNELS.ITEM_SEARCH_BY_TAG, { tagId }),
  },

  tags: {
    getAll: () => ipcRenderer.invoke(IPC_CHANNELS.TAG_GET_ALL),
    create: (name: string, color?: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.TAG_CREATE, { name, color }),
    attach: (itemId: string, tagId: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.TAG_ATTACH, { itemId, tagId }),
    detach: (itemId: string, tagId: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.TAG_DETACH, { itemId, tagId }),
    delete: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.TAG_DELETE, { id }),
  },

  files: {
    getByItem: (itemId: string) => ipcRenderer.invoke(IPC_CHANNELS.FILE_GET_BY_ITEM, { itemId }),
    attach: (itemId: string, filePath: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.FILE_ATTACH, { itemId, filePath }),
    download: (attachmentId: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.FILE_DOWNLOAD, { attachmentId }),
    delete: (attachmentId: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.FILE_DELETE, { attachmentId }),
  },

  covers: {
    upload: (filePath: string) => ipcRenderer.invoke(IPC_CHANNELS.COVER_UPLOAD, { filePath }),
    read: (coverName: string) => ipcRenderer.invoke(IPC_CHANNELS.COVER_READ, { coverName }),
    delete: (coverName: string) => ipcRenderer.invoke(IPC_CHANNELS.COVER_DELETE, { coverName }),
  },

  search: {
    items: (query: string) => ipcRenderer.invoke(IPC_CHANNELS.ITEM_SEARCH, { query }),
    itemsByTag: (tagId: string) => ipcRenderer.invoke(IPC_CHANNELS.ITEM_SEARCH_BY_TAG, { tagId }),
  },

  settings: {
    get: (key: string) => ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_GET, { key }),
    set: (key: string, value: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_SET, { key, value }),
    getAll: () => ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_GET_ALL),
  },

  trash: {
    get: () => ipcRenderer.invoke(IPC_CHANNELS.TRASH_GET),
    restore: (originalId: string, originalType: 'folder' | 'item') =>
      ipcRenderer.invoke(IPC_CHANNELS.TRASH_RESTORE, { originalId, originalType }),
    permanentDelete: (id: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.TRASH_PERMANENT_DELETE, { id }),
    empty: () => ipcRenderer.invoke(IPC_CHANNELS.TRASH_EMPTY),
    purge: () => ipcRenderer.invoke(IPC_CHANNELS.TRASH_PURGE),
  },

  health: {
    analyze: (oldDays?: number) => ipcRenderer.invoke(IPC_CHANNELS.HEALTH_ANALYZE, { oldDays }),
  },

  window: {
    minimize: () => ipcRenderer.invoke(IPC_CHANNELS.WINDOW_MINIMIZE),
    maximize: () => ipcRenderer.invoke(IPC_CHANNELS.WINDOW_MAXIMIZE),
    close: () => ipcRenderer.invoke(IPC_CHANNELS.WINDOW_CLOSE),
    isMaximized: () => ipcRenderer.invoke(IPC_CHANNELS.WINDOW_IS_MAXIMIZED),
  },

  updates: {
    check: () => ipcRenderer.invoke(IPC_CHANNELS.CHECK_FOR_UPDATES),
    download: () => ipcRenderer.invoke(IPC_CHANNELS.DOWNLOAD_UPDATE),
    quitAndInstall: () => ipcRenderer.invoke(IPC_CHANNELS.QUIT_AND_INSTALL),
    onAvailable: (callback: (info: { version: string }) => void) =>
      ipcRenderer.on(IPC_CHANNELS.UPDATE_AVAILABLE, (_event, info) => callback(info)),
    onNotAvailable: (callback: () => void) =>
      ipcRenderer.on(IPC_CHANNELS.UPDATE_NOT_AVAILABLE, () => callback()),
    onDownloadProgress: (callback: (progress: { percent: number }) => void) =>
      ipcRenderer.on(IPC_CHANNELS.UPDATE_DOWNLOAD_PROGRESS, (_event, progress) =>
        callback(progress),
      ),
    onDownloaded: (callback: () => void) =>
      ipcRenderer.on(IPC_CHANNELS.UPDATE_DOWNLOADED, () => callback()),
    onError: (callback: (error: { message: string }) => void) =>
      ipcRenderer.on(IPC_CHANNELS.UPDATE_ERROR, (_event, error) => callback(error)),
    // SECURITY: Remove all update-related IPC listeners to prevent
    // lingering references after operations complete or on lock.
    removeAllListeners: () => {
      ipcRenderer.removeAllListeners(IPC_CHANNELS.UPDATE_AVAILABLE);
      ipcRenderer.removeAllListeners(IPC_CHANNELS.UPDATE_NOT_AVAILABLE);
      ipcRenderer.removeAllListeners(IPC_CHANNELS.UPDATE_DOWNLOAD_PROGRESS);
      ipcRenderer.removeAllListeners(IPC_CHANNELS.UPDATE_DOWNLOADED);
      ipcRenderer.removeAllListeners(IPC_CHANNELS.UPDATE_ERROR);
    },
  },
};

// Forward power monitor events to renderer as DOM events.
// SECURITY: Store handler references so they can be removed on lock/cleanup.
const powerMonitorLockHandler = () => {
  window.dispatchEvent(new CustomEvent('power-monitor-lock-screen'));
};
const powerMonitorSuspendHandler = () => {
  window.dispatchEvent(new CustomEvent('power-monitor-suspend'));
};
ipcRenderer.on(IPC_CHANNELS.POWER_MONITOR_LOCK_SCREEN, powerMonitorLockHandler);
ipcRenderer.on(IPC_CHANNELS.POWER_MONITOR_SUSPEND, powerMonitorSuspendHandler);

// SECURITY: Expose cleanup for all IPC listeners to prevent lingering references.
function removeAllSensitiveListeners(): void {
  // Remove power monitor IPC listeners
  ipcRenderer.removeListener(IPC_CHANNELS.POWER_MONITOR_LOCK_SCREEN, powerMonitorLockHandler);
  ipcRenderer.removeListener(IPC_CHANNELS.POWER_MONITOR_SUSPEND, powerMonitorSuspendHandler);
  // Remove all update-related listeners
  ipcRenderer.removeAllListeners(IPC_CHANNELS.UPDATE_AVAILABLE);
  ipcRenderer.removeAllListeners(IPC_CHANNELS.UPDATE_NOT_AVAILABLE);
  ipcRenderer.removeAllListeners(IPC_CHANNELS.UPDATE_DOWNLOAD_PROGRESS);
  ipcRenderer.removeAllListeners(IPC_CHANNELS.UPDATE_DOWNLOADED);
  ipcRenderer.removeAllListeners(IPC_CHANNELS.UPDATE_ERROR);
  // Remove export progress listener
  ipcRenderer.removeAllListeners(IPC_CHANNELS.EXPORT_PROGRESS);
}

contextBridge.exposeInMainWorld('electron', api);
