"use strict";
const electron = require("electron");
const IPC_CHANNELS = {
  AUTH_INIT: "auth:init",
  AUTH_UNLOCK: "auth:unlock",
  AUTH_LOCK: "auth:lock",
  AUTH_CHANGE_PASSWORD: "auth:change-password",
  AUTH_CHECK: "auth:check",
  AUTH_MIGRATE_KDF: "auth:migrateKdf",
  AUTH_GET_KDF_STATUS: "auth:getKdfStatus",
  VAULT_LIST: "vault:list",
  VAULT_CREATE: "vault:create",
  VAULT_SELECT: "vault:select",
  VAULT_RENAME: "vault:rename",
  VAULT_DELETE: "vault:delete",
  VAULT_SET_DEFAULT: "vault:setDefault",
  VAULT_REVEAL_LOCATION: "vault:revealLocation",
  VAULT_GET_ACTIVE: "vault:getActive",
  VAULT_IMPORT_FILE_DIALOG: "vault:importFileDialog",
  VAULT_IMPORT: "vault:import",
  VAULT_BACKUP_FILE_DIALOG: "vault:backupFileDialog",
  VAULT_BACKUP: "vault:backup",
  VAULT_RESTORE_FILE_DIALOG: "vault:restoreFileDialog",
  VAULT_RESTORE: "vault:restore",
  FOLDER_GET_TREE: "folder:getTree",
  FOLDER_CREATE: "folder:create",
  FOLDER_UPDATE: "folder:update",
  FOLDER_MOVE: "folder:move",
  FOLDER_DELETE: "folder:delete",
  FOLDER_RESTORE: "folder:restore",
  ITEM_GET_BY_FOLDER: "item:getByFolder",
  ITEM_GET_BY_ID: "item:getById",
  ITEM_CREATE: "item:create",
  ITEM_UPDATE: "item:update",
  ITEM_DELETE: "item:delete",
  ITEM_RESTORE: "item:restore",
  ITEM_TOGGLE_FAVORITE: "item:toggleFavorite",
  ITEM_SEARCH: "item:search",
  ITEM_SEARCH_BY_TAG: "item:searchByTag",
  ITEM_GET_ALL: "item:getAll",
  OTP_GENERATE: "otp:generate",
  OTP_GET_CONFIG: "otp:getConfig",
  OTP_CHECK_TIME_SYNC: "otp:checkTimeSync",
  HEALTH_ANALYZE: "health:analyze",
  TAG_GET_ALL: "tag:getAll",
  TAG_CREATE: "tag:create",
  TAG_ATTACH: "tag:attach",
  TAG_DETACH: "tag:detach",
  TAG_DELETE: "tag:delete",
  FILE_GET_BY_ITEM: "file:getByItem",
  FILE_ATTACH: "file:attach",
  FILE_DOWNLOAD: "file:download",
  FILE_DELETE: "file:delete",
  COVER_UPLOAD: "cover:upload",
  COVER_READ: "cover:read",
  COVER_DELETE: "cover:delete",
  POWER_MONITOR_LOCK_SCREEN: "power-monitor:lock-screen",
  POWER_MONITOR_SUSPEND: "power-monitor:suspend",
  SETTINGS_GET: "settings:get",
  SETTINGS_SET: "settings:set",
  SETTINGS_GET_ALL: "settings:getAll",
  TRASH_GET: "trash:get",
  TRASH_RESTORE: "trash:restore",
  TRASH_PERMANENT_DELETE: "trash:permanentDelete",
  TRASH_EMPTY: "trash:empty",
  TRASH_PURGE: "trash:purge",
  IMPORT_OPEN_FILE_DIALOG: "import:openFileDialog",
  IMPORT_PARSE_FILE: "import:parseFile",
  IMPORT_GET_CSV_HEADERS: "import:getCsvHeaders",
  IMPORT_PARSE_GENERIC_CSV: "import:parseGenericCsv",
  IMPORT_CHECK_DUPLICATES: "import:checkDuplicates",
  IMPORT_COMMIT: "import:commit",
  EXPORT_DATA: "export:data",
  EXPORT_PROGRESS: "export:progress",
  WINDOW_MINIMIZE: "window:minimize",
  WINDOW_MAXIMIZE: "window:maximize",
  WINDOW_CLOSE: "window:close",
  WINDOW_IS_MAXIMIZED: "window:isMaximized",
  // Global shortcuts
  SHORTCUT_GET_BINDINGS: "shortcut:getBindings",
  SHORTCUT_UPDATE_BINDING: "shortcut:updateBinding",
  SHORTCUT_REGISTER: "shortcut:register",
  SHORTCUT_UNREGISTER: "shortcut:unregister",
  SHORTCUT_ACTION: "shortcut:action",
  SHORTCUT_ENABLED_STATE: "shortcut:enabledState",
  // Auto-updater
  UPDATE_AVAILABLE: "update:available",
  UPDATE_NOT_AVAILABLE: "update:not-available",
  UPDATE_DOWNLOAD_PROGRESS: "update:download-progress",
  UPDATE_DOWNLOADED: "update:downloaded",
  UPDATE_ERROR: "update:error",
  CHECK_FOR_UPDATES: "update:check",
  DOWNLOAD_UPDATE: "update:download",
  QUIT_AND_INSTALL: "update:quit-and-install",
  // Quick Picker
  QUICK_PICKER_SEARCH: "quickPicker:search",
  QUICK_PICKER_ACTION: "quickPicker:action",
  QUICK_PICKER_SHOW: "quickPicker:show",
  QUICK_PICKER_HIDE: "quickPicker:hide",
  QUICK_PICKER_GET_ITEMS: "quickPicker:getItems",
  QUICK_PICKER_ITEMS: "quickPicker:items",
  QUICK_PICKER_FOCUS_SEARCH: "quickPicker:focusSearch",
  // Clipboard management
  CLIPBOARD_COPY: "clipboard:copy",
  CLIPBOARD_STATUS: "clipboard:status",
  CLIPBOARD_ON_STATUS_CHANGE: "clipboard:onStatusChange",
  CLIPBOARD_CLEAR_STATUS_LISTENER: "clipboard:clearStatusListener",
  // Browser Extension integration
  EXTENSION_GET_STATUS: "extension:getStatus",
  EXTENSION_INSTALL_HOST: "extension:installHost",
  EXTENSION_UNINSTALL_HOST: "extension:uninstallHost",
  EXTENSION_OPEN_STORE: "extension:openStore"
};
const api = {
  import: {
    openFileDialog: (format) => electron.ipcRenderer.invoke(IPC_CHANNELS.IMPORT_OPEN_FILE_DIALOG, { format }),
    parseFile: (params) => electron.ipcRenderer.invoke(IPC_CHANNELS.IMPORT_PARSE_FILE, params),
    getCsvHeaders: (content) => electron.ipcRenderer.invoke(IPC_CHANNELS.IMPORT_GET_CSV_HEADERS, { content }),
    parseGenericCsv: (params) => electron.ipcRenderer.invoke(IPC_CHANNELS.IMPORT_PARSE_GENERIC_CSV, params),
    checkDuplicates: (payload) => electron.ipcRenderer.invoke(IPC_CHANNELS.IMPORT_CHECK_DUPLICATES, { payload }),
    commitImport: (params) => electron.ipcRenderer.invoke(IPC_CHANNELS.IMPORT_COMMIT, params)
  },
  export: {
    exportData: (format) => electron.ipcRenderer.invoke(IPC_CHANNELS.EXPORT_DATA, { format }),
    onProgress: (callback) => electron.ipcRenderer.on(IPC_CHANNELS.EXPORT_PROGRESS, (_event, progress) => callback(progress)),
    removeProgressListener: () => electron.ipcRenderer.removeAllListeners(IPC_CHANNELS.EXPORT_PROGRESS)
  },
  auth: {
    init: (masterPassword, vaultId) => electron.ipcRenderer.invoke(IPC_CHANNELS.AUTH_INIT, { masterPassword, vaultId }),
    unlock: (masterPassword, vaultId) => electron.ipcRenderer.invoke(IPC_CHANNELS.AUTH_UNLOCK, { masterPassword, vaultId }),
    lock: () => electron.ipcRenderer.invoke(IPC_CHANNELS.AUTH_LOCK),
    changePassword: (oldPassword, newPassword, vaultId) => electron.ipcRenderer.invoke(IPC_CHANNELS.AUTH_CHANGE_PASSWORD, { oldPassword, newPassword, vaultId }),
    check: () => electron.ipcRenderer.invoke(IPC_CHANNELS.AUTH_CHECK),
    migrateKdf: () => electron.ipcRenderer.invoke(IPC_CHANNELS.AUTH_MIGRATE_KDF),
    getKdfStatus: () => electron.ipcRenderer.invoke(IPC_CHANNELS.AUTH_GET_KDF_STATUS),
    // SECURITY: Clean up all IPC listeners to prevent lingering references
    // after lock or when the renderer no longer needs them.
    cleanupListeners: () => removeAllSensitiveListeners()
  },
  vaults: {
    list: () => electron.ipcRenderer.invoke(IPC_CHANNELS.VAULT_LIST),
    create: (params) => electron.ipcRenderer.invoke(IPC_CHANNELS.VAULT_CREATE, params),
    select: (vaultId, masterPassword) => electron.ipcRenderer.invoke(IPC_CHANNELS.VAULT_SELECT, { vaultId, masterPassword }),
    rename: (vaultId, name) => electron.ipcRenderer.invoke(IPC_CHANNELS.VAULT_RENAME, { vaultId, name }),
    delete: (vaultId, deleteDatabaseFile, deleteAttachments) => electron.ipcRenderer.invoke(IPC_CHANNELS.VAULT_DELETE, {
      vaultId,
      deleteDatabaseFile,
      deleteAttachments
    }),
    setDefault: (vaultId) => electron.ipcRenderer.invoke(IPC_CHANNELS.VAULT_SET_DEFAULT, { vaultId }),
    revealLocation: (vaultId) => electron.ipcRenderer.invoke(IPC_CHANNELS.VAULT_REVEAL_LOCATION, { vaultId }),
    getActive: () => electron.ipcRenderer.invoke(IPC_CHANNELS.VAULT_GET_ACTIVE),
    openFileDialog: () => electron.ipcRenderer.invoke(IPC_CHANNELS.VAULT_IMPORT_FILE_DIALOG),
    importExisting: (params) => electron.ipcRenderer.invoke(IPC_CHANNELS.VAULT_IMPORT, params),
    backupFileDialog: (vaultId) => electron.ipcRenderer.invoke(IPC_CHANNELS.VAULT_BACKUP_FILE_DIALOG, { vaultId }),
    backup: (params) => electron.ipcRenderer.invoke(IPC_CHANNELS.VAULT_BACKUP, params),
    restoreFileDialog: () => electron.ipcRenderer.invoke(IPC_CHANNELS.VAULT_RESTORE_FILE_DIALOG),
    restore: (params) => electron.ipcRenderer.invoke(IPC_CHANNELS.VAULT_RESTORE, params)
  },
  folders: {
    getTree: () => electron.ipcRenderer.invoke(IPC_CHANNELS.FOLDER_GET_TREE),
    create: (parentId, name, emoji) => electron.ipcRenderer.invoke(IPC_CHANNELS.FOLDER_CREATE, { parentId, name, emoji }),
    update: (id, fields) => electron.ipcRenderer.invoke(IPC_CHANNELS.FOLDER_UPDATE, { id, ...fields }),
    move: (id, newParentId, sortOrder) => electron.ipcRenderer.invoke(IPC_CHANNELS.FOLDER_MOVE, { id, newParentId, sortOrder }),
    delete: (id) => electron.ipcRenderer.invoke(IPC_CHANNELS.FOLDER_DELETE, { id }),
    restore: (id) => electron.ipcRenderer.invoke(IPC_CHANNELS.FOLDER_RESTORE, { id })
  },
  items: {
    getAll: () => electron.ipcRenderer.invoke(IPC_CHANNELS.ITEM_GET_ALL),
    getByFolder: (folderId) => electron.ipcRenderer.invoke(IPC_CHANNELS.ITEM_GET_BY_FOLDER, { folderId }),
    getById: (id) => electron.ipcRenderer.invoke(IPC_CHANNELS.ITEM_GET_BY_ID, { id }),
    create: (folderId, fields) => electron.ipcRenderer.invoke(IPC_CHANNELS.ITEM_CREATE, { folderId, ...fields }),
    update: (id, fields) => electron.ipcRenderer.invoke(IPC_CHANNELS.ITEM_UPDATE, { id, ...fields }),
    delete: (id) => electron.ipcRenderer.invoke(IPC_CHANNELS.ITEM_DELETE, { id }),
    restore: (id) => electron.ipcRenderer.invoke(IPC_CHANNELS.ITEM_RESTORE, { id }),
    toggleFavorite: (id) => electron.ipcRenderer.invoke(IPC_CHANNELS.ITEM_TOGGLE_FAVORITE, { id }),
    search: (query) => electron.ipcRenderer.invoke(IPC_CHANNELS.ITEM_SEARCH, { query }),
    searchByTag: (tagId) => electron.ipcRenderer.invoke(IPC_CHANNELS.ITEM_SEARCH_BY_TAG, { tagId })
  },
  tags: {
    getAll: () => electron.ipcRenderer.invoke(IPC_CHANNELS.TAG_GET_ALL),
    create: (name, color) => electron.ipcRenderer.invoke(IPC_CHANNELS.TAG_CREATE, { name, color }),
    attach: (itemId, tagId) => electron.ipcRenderer.invoke(IPC_CHANNELS.TAG_ATTACH, { itemId, tagId }),
    detach: (itemId, tagId) => electron.ipcRenderer.invoke(IPC_CHANNELS.TAG_DETACH, { itemId, tagId }),
    delete: (id) => electron.ipcRenderer.invoke(IPC_CHANNELS.TAG_DELETE, { id })
  },
  files: {
    getByItem: (itemId) => electron.ipcRenderer.invoke(IPC_CHANNELS.FILE_GET_BY_ITEM, { itemId }),
    attach: (itemId, filePath) => electron.ipcRenderer.invoke(IPC_CHANNELS.FILE_ATTACH, { itemId, filePath }),
    download: (attachmentId) => electron.ipcRenderer.invoke(IPC_CHANNELS.FILE_DOWNLOAD, { attachmentId }),
    delete: (attachmentId) => electron.ipcRenderer.invoke(IPC_CHANNELS.FILE_DELETE, { attachmentId })
  },
  covers: {
    upload: (filePath) => electron.ipcRenderer.invoke(IPC_CHANNELS.COVER_UPLOAD, { filePath }),
    read: (coverName) => electron.ipcRenderer.invoke(IPC_CHANNELS.COVER_READ, { coverName }),
    delete: (coverName) => electron.ipcRenderer.invoke(IPC_CHANNELS.COVER_DELETE, { coverName })
  },
  search: {
    items: (query) => electron.ipcRenderer.invoke(IPC_CHANNELS.ITEM_SEARCH, { query }),
    itemsByTag: (tagId) => electron.ipcRenderer.invoke(IPC_CHANNELS.ITEM_SEARCH_BY_TAG, { tagId })
  },
  settings: {
    get: (key) => electron.ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_GET, { key }),
    set: (key, value) => electron.ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_SET, { key, value }),
    getAll: () => electron.ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_GET_ALL)
  },
  trash: {
    get: () => electron.ipcRenderer.invoke(IPC_CHANNELS.TRASH_GET),
    restore: (originalId, originalType) => electron.ipcRenderer.invoke(IPC_CHANNELS.TRASH_RESTORE, { originalId, originalType }),
    permanentDelete: (id) => electron.ipcRenderer.invoke(IPC_CHANNELS.TRASH_PERMANENT_DELETE, { id }),
    empty: () => electron.ipcRenderer.invoke(IPC_CHANNELS.TRASH_EMPTY),
    purge: () => electron.ipcRenderer.invoke(IPC_CHANNELS.TRASH_PURGE)
  },
  health: {
    analyze: (oldDays) => electron.ipcRenderer.invoke(IPC_CHANNELS.HEALTH_ANALYZE, { oldDays })
  },
  otp: {
    /**
     * Generate a TOTP code for an item. The secret is decrypted and used
     * entirely within the main process — only the code string is returned.
     */
    generate: (itemId) => electron.ipcRenderer.invoke(IPC_CHANNELS.OTP_GENERATE, { itemId }),
    /**
     * Retrieve the OTP config (including secret) for an item.
     * Used by OtpSection in edit mode. The renderer MUST NOT persist
     * the secret in Zustand or any state management store.
     */
    getConfig: (itemId) => electron.ipcRenderer.invoke(IPC_CHANNELS.OTP_GET_CONFIG, { itemId }),
    /**
     * Check for system clock drift that could affect TOTP code validity.
     * No network request is made — the check is purely heuristic.
     * Returns { driftDetected, driftMs, period } if drift is found.
     */
    checkTimeSync: () => electron.ipcRenderer.invoke(IPC_CHANNELS.OTP_CHECK_TIME_SYNC)
  },
  window: {
    minimize: () => electron.ipcRenderer.invoke(IPC_CHANNELS.WINDOW_MINIMIZE),
    maximize: () => electron.ipcRenderer.invoke(IPC_CHANNELS.WINDOW_MAXIMIZE),
    close: () => electron.ipcRenderer.invoke(IPC_CHANNELS.WINDOW_CLOSE),
    isMaximized: () => electron.ipcRenderer.invoke(IPC_CHANNELS.WINDOW_IS_MAXIMIZED)
  },
  shortcuts: {
    getBindings: () => electron.ipcRenderer.invoke(IPC_CHANNELS.SHORTCUT_GET_BINDINGS),
    updateBinding: (action, accelerator) => electron.ipcRenderer.invoke(IPC_CHANNELS.SHORTCUT_UPDATE_BINDING, { action, accelerator }),
    register: () => electron.ipcRenderer.invoke(IPC_CHANNELS.SHORTCUT_REGISTER),
    unregister: () => electron.ipcRenderer.invoke(IPC_CHANNELS.SHORTCUT_UNREGISTER),
    enabledState: (locked) => electron.ipcRenderer.invoke(IPC_CHANNELS.SHORTCUT_ENABLED_STATE, { locked }),
    onAction: (callback) => electron.ipcRenderer.on(IPC_CHANNELS.SHORTCUT_ACTION, (_event, data) => callback(data)),
    removeActionListener: () => electron.ipcRenderer.removeAllListeners(IPC_CHANNELS.SHORTCUT_ACTION)
  },
  quickPicker: {
    search: (query) => electron.ipcRenderer.invoke(IPC_CHANNELS.QUICK_PICKER_SEARCH, { query }),
    action: (itemId, action) => electron.ipcRenderer.invoke(IPC_CHANNELS.QUICK_PICKER_ACTION, { itemId, action }),
    show: () => electron.ipcRenderer.invoke(IPC_CHANNELS.QUICK_PICKER_SHOW),
    hide: () => electron.ipcRenderer.invoke(IPC_CHANNELS.QUICK_PICKER_HIDE),
    getItems: () => electron.ipcRenderer.invoke(IPC_CHANNELS.QUICK_PICKER_GET_ITEMS),
    onItems: (callback) => electron.ipcRenderer.on(IPC_CHANNELS.QUICK_PICKER_ITEMS, (_event, items) => callback(items)),
    onFocusSearch: (callback) => electron.ipcRenderer.on(IPC_CHANNELS.QUICK_PICKER_FOCUS_SEARCH, () => callback()),
    removeItemsListener: () => electron.ipcRenderer.removeAllListeners(IPC_CHANNELS.QUICK_PICKER_ITEMS),
    removeFocusSearchListener: () => electron.ipcRenderer.removeAllListeners(IPC_CHANNELS.QUICK_PICKER_FOCUS_SEARCH)
  },
  clipboard: {
    copy: (text, options) => electron.ipcRenderer.invoke(IPC_CHANNELS.CLIPBOARD_COPY, { text, options }),
    status: () => electron.ipcRenderer.invoke(IPC_CHANNELS.CLIPBOARD_STATUS),
    onStatusChange: (callback) => {
      electron.ipcRenderer.invoke(IPC_CHANNELS.CLIPBOARD_ON_STATUS_CHANGE);
      electron.ipcRenderer.on(IPC_CHANNELS.CLIPBOARD_STATUS, (_event, status) => callback(status));
    },
    clearStatusListener: () => {
      electron.ipcRenderer.invoke(IPC_CHANNELS.CLIPBOARD_CLEAR_STATUS_LISTENER);
      electron.ipcRenderer.removeAllListeners(IPC_CHANNELS.CLIPBOARD_STATUS);
    }
  },
  updates: {
    check: () => electron.ipcRenderer.invoke(IPC_CHANNELS.CHECK_FOR_UPDATES),
    download: () => electron.ipcRenderer.invoke(IPC_CHANNELS.DOWNLOAD_UPDATE),
    quitAndInstall: () => electron.ipcRenderer.invoke(IPC_CHANNELS.QUIT_AND_INSTALL),
    onAvailable: (callback) => electron.ipcRenderer.on(IPC_CHANNELS.UPDATE_AVAILABLE, (_event, info) => callback(info)),
    onNotAvailable: (callback) => electron.ipcRenderer.on(IPC_CHANNELS.UPDATE_NOT_AVAILABLE, () => callback()),
    onDownloadProgress: (callback) => electron.ipcRenderer.on(
      IPC_CHANNELS.UPDATE_DOWNLOAD_PROGRESS,
      (_event, progress) => callback(progress)
    ),
    onDownloaded: (callback) => electron.ipcRenderer.on(IPC_CHANNELS.UPDATE_DOWNLOADED, () => callback()),
    onError: (callback) => electron.ipcRenderer.on(IPC_CHANNELS.UPDATE_ERROR, (_event, error) => callback(error)),
    // SECURITY: Remove all update-related IPC listeners to prevent
    // lingering references after operations complete or on lock.
    removeAllListeners: () => {
      electron.ipcRenderer.removeAllListeners(IPC_CHANNELS.UPDATE_AVAILABLE);
      electron.ipcRenderer.removeAllListeners(IPC_CHANNELS.UPDATE_NOT_AVAILABLE);
      electron.ipcRenderer.removeAllListeners(IPC_CHANNELS.UPDATE_DOWNLOAD_PROGRESS);
      electron.ipcRenderer.removeAllListeners(IPC_CHANNELS.UPDATE_DOWNLOADED);
      electron.ipcRenderer.removeAllListeners(IPC_CHANNELS.UPDATE_ERROR);
    }
  },
  extension: {
    getStatus: () => electron.ipcRenderer.invoke(IPC_CHANNELS.EXTENSION_GET_STATUS),
    installHost: (allowedExtensionIds) => electron.ipcRenderer.invoke(IPC_CHANNELS.EXTENSION_INSTALL_HOST, { allowedExtensionIds }),
    uninstallHost: () => electron.ipcRenderer.invoke(IPC_CHANNELS.EXTENSION_UNINSTALL_HOST),
    openStore: (browser) => electron.ipcRenderer.invoke(IPC_CHANNELS.EXTENSION_OPEN_STORE, { browser })
  }
};
const powerMonitorLockHandler = () => {
  window.dispatchEvent(new CustomEvent("power-monitor-lock-screen"));
};
const powerMonitorSuspendHandler = () => {
  window.dispatchEvent(new CustomEvent("power-monitor-suspend"));
};
electron.ipcRenderer.on(IPC_CHANNELS.POWER_MONITOR_LOCK_SCREEN, powerMonitorLockHandler);
electron.ipcRenderer.on(IPC_CHANNELS.POWER_MONITOR_SUSPEND, powerMonitorSuspendHandler);
function removeAllSensitiveListeners() {
  electron.ipcRenderer.removeListener(IPC_CHANNELS.POWER_MONITOR_LOCK_SCREEN, powerMonitorLockHandler);
  electron.ipcRenderer.removeListener(IPC_CHANNELS.POWER_MONITOR_SUSPEND, powerMonitorSuspendHandler);
  electron.ipcRenderer.removeAllListeners(IPC_CHANNELS.UPDATE_AVAILABLE);
  electron.ipcRenderer.removeAllListeners(IPC_CHANNELS.UPDATE_NOT_AVAILABLE);
  electron.ipcRenderer.removeAllListeners(IPC_CHANNELS.UPDATE_DOWNLOAD_PROGRESS);
  electron.ipcRenderer.removeAllListeners(IPC_CHANNELS.UPDATE_DOWNLOADED);
  electron.ipcRenderer.removeAllListeners(IPC_CHANNELS.UPDATE_ERROR);
  electron.ipcRenderer.removeAllListeners(IPC_CHANNELS.EXPORT_PROGRESS);
  electron.ipcRenderer.removeAllListeners(IPC_CHANNELS.SHORTCUT_ACTION);
}
electron.contextBridge.exposeInMainWorld("electron", api);
//# sourceMappingURL=index.js.map
