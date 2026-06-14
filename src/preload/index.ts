import { contextBridge, ipcRenderer } from 'electron';
import { IPC_CHANNELS } from '../shared/ipcChannels';

const api = {
  auth: {
    init: (masterPassword: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.AUTH_INIT, { masterPassword }),
    unlock: (masterPassword: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.AUTH_UNLOCK, { masterPassword }),
    lock: () =>
      ipcRenderer.invoke(IPC_CHANNELS.AUTH_LOCK),
    changePassword: (oldPassword: string, newPassword: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.AUTH_CHANGE_PASSWORD, { oldPassword, newPassword }),
    check: () =>
      ipcRenderer.invoke(IPC_CHANNELS.AUTH_CHECK),
  },

  folders: {
    getTree: () =>
      ipcRenderer.invoke(IPC_CHANNELS.FOLDER_GET_TREE),
    create: (parentId: string | null, name: string, emoji?: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.FOLDER_CREATE, { parentId, name, emoji }),
    update: (id: string, fields: { name?: string; emoji?: string; coverImage?: string }) =>
      ipcRenderer.invoke(IPC_CHANNELS.FOLDER_UPDATE, { id, ...fields }),
    move: (id: string, newParentId: string | null, sortOrder: number) =>
      ipcRenderer.invoke(IPC_CHANNELS.FOLDER_MOVE, { id, newParentId, sortOrder }),
    delete: (id: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.FOLDER_DELETE, { id }),
    restore: (id: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.FOLDER_RESTORE, { id }),
  },

  items: {
    getAll: () =>
      ipcRenderer.invoke(IPC_CHANNELS.ITEM_GET_ALL),
    getByFolder: (folderId: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.ITEM_GET_BY_FOLDER, { folderId }),
    getById: (id: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.ITEM_GET_BY_ID, { id }),
    create: (folderId: string, fields: {
      title: string;
      username?: string;
      passwordEncrypted?: ArrayBuffer | null;
      url?: string;
      notesEncrypted?: ArrayBuffer | null;
      emoji?: string | null;
      coverImage?: string | null;
    }) => ipcRenderer.invoke(IPC_CHANNELS.ITEM_CREATE, { folderId, ...fields }),
    update: (id: string, fields: {
      title?: string;
      username?: string;
      passwordEncrypted?: ArrayBuffer | null;
      url?: string;
      notesEncrypted?: ArrayBuffer | null;
      emoji?: string | null;
      coverImage?: string | null;
      isFavorite?: boolean;
      sortOrder?: number;
    }) => ipcRenderer.invoke(IPC_CHANNELS.ITEM_UPDATE, { id, ...fields }),
    delete: (id: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.ITEM_DELETE, { id }),
    restore: (id: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.ITEM_RESTORE, { id }),
    toggleFavorite: (id: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.ITEM_TOGGLE_FAVORITE, { id }),
    search: (query: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.ITEM_SEARCH, { query }),
    searchByTag: (tagId: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.ITEM_SEARCH_BY_TAG, { tagId }),
  },

  tags: {
    getAll: () =>
      ipcRenderer.invoke(IPC_CHANNELS.TAG_GET_ALL),
    create: (name: string, color?: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.TAG_CREATE, { name, color }),
    attach: (itemId: string, tagId: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.TAG_ATTACH, { itemId, tagId }),
    detach: (itemId: string, tagId: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.TAG_DETACH, { itemId, tagId }),
    delete: (id: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.TAG_DELETE, { id }),
  },

  files: {
    getByItem: (itemId: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.FILE_GET_BY_ITEM, { itemId }),
    attach: (itemId: string, filePath: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.FILE_ATTACH, { itemId, filePath }),
    download: (attachmentId: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.FILE_DOWNLOAD, { attachmentId }),
    delete: (attachmentId: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.FILE_DELETE, { attachmentId }),
  },

  covers: {
    upload: (filePath: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.COVER_UPLOAD, { filePath }),
    read: (coverName: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.COVER_READ, { coverName }),
    delete: (coverName: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.COVER_DELETE, { coverName }),
  },

  search: {
    items: (query: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.ITEM_SEARCH, { query }),
    itemsByTag: (tagId: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.ITEM_SEARCH_BY_TAG, { tagId }),
  },

  settings: {
    get: (key: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_GET, { key }),
    set: (key: string, value: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_SET, { key, value }),
    getAll: () =>
      ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_GET_ALL),
  },

  trash: {
    get: () =>
      ipcRenderer.invoke(IPC_CHANNELS.TRASH_GET),
    restore: (originalId: string, originalType: 'folder' | 'item') =>
      ipcRenderer.invoke(IPC_CHANNELS.TRASH_RESTORE, { originalId, originalType }),
    permanentDelete: (id: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.TRASH_PERMANENT_DELETE, { id }),
    empty: () =>
      ipcRenderer.invoke(IPC_CHANNELS.TRASH_EMPTY),
    purge: () =>
      ipcRenderer.invoke(IPC_CHANNELS.TRASH_PURGE),
  },

  health: {
    analyze: (oldDays?: number) =>
      ipcRenderer.invoke(IPC_CHANNELS.HEALTH_ANALYZE, { oldDays }),
  },

  window: {
    minimize: () =>
      ipcRenderer.invoke(IPC_CHANNELS.WINDOW_MINIMIZE),
    maximize: () =>
      ipcRenderer.invoke(IPC_CHANNELS.WINDOW_MAXIMIZE),
    close: () =>
      ipcRenderer.invoke(IPC_CHANNELS.WINDOW_CLOSE),
    isMaximized: () =>
      ipcRenderer.invoke(IPC_CHANNELS.WINDOW_IS_MAXIMIZED),
  },
};

// Forward power monitor events to renderer as DOM events
ipcRenderer.on(IPC_CHANNELS.POWER_MONITOR_LOCK_SCREEN, () => {
  window.dispatchEvent(new CustomEvent('power-monitor-lock-screen'));
});

ipcRenderer.on(IPC_CHANNELS.POWER_MONITOR_SUSPEND, () => {
  window.dispatchEvent(new CustomEvent('power-monitor-suspend'));
});

contextBridge.exposeInMainWorld('electron', api);
