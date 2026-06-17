export const IPC_CHANNELS = {
  AUTH_INIT: 'auth:init',
  AUTH_UNLOCK: 'auth:unlock',
  AUTH_LOCK: 'auth:lock',
  AUTH_CHANGE_PASSWORD: 'auth:change-password',
  AUTH_CHECK: 'auth:check',
  AUTH_LOCKED: 'auth:locked',

  FOLDER_GET_TREE: 'folder:getTree',
  FOLDER_CREATE: 'folder:create',
  FOLDER_UPDATE: 'folder:update',
  FOLDER_MOVE: 'folder:move',
  FOLDER_DELETE: 'folder:delete',
  FOLDER_RESTORE: 'folder:restore',

  ITEM_GET_BY_FOLDER: 'item:getByFolder',
  ITEM_GET_BY_ID: 'item:getById',
  ITEM_CREATE: 'item:create',
  ITEM_UPDATE: 'item:update',
  ITEM_DELETE: 'item:delete',
  ITEM_RESTORE: 'item:restore',
  ITEM_TOGGLE_FAVORITE: 'item:toggleFavorite',
  ITEM_SEARCH: 'item:search',
  ITEM_SEARCH_BY_TAG: 'item:searchByTag',
  ITEM_GET_ALL: 'item:getAll',

  HEALTH_ANALYZE: 'health:analyze',

  TAG_GET_ALL: 'tag:getAll',
  TAG_CREATE: 'tag:create',
  TAG_ATTACH: 'tag:attach',
  TAG_DETACH: 'tag:detach',
  TAG_DELETE: 'tag:delete',

  FILE_GET_BY_ITEM: 'file:getByItem',
  FILE_ATTACH: 'file:attach',
  FILE_DOWNLOAD: 'file:download',
  FILE_DELETE: 'file:delete',

  COVER_UPLOAD: 'cover:upload',
  COVER_READ: 'cover:read',
  COVER_DELETE: 'cover:delete',

  POWER_MONITOR_LOCK_SCREEN: 'power-monitor:lock-screen',
  POWER_MONITOR_SUSPEND: 'power-monitor:suspend',

  SETTINGS_GET: 'settings:get',
  SETTINGS_SET: 'settings:set',
  SETTINGS_GET_ALL: 'settings:getAll',

  TRASH_GET: 'trash:get',
  TRASH_RESTORE: 'trash:restore',
  TRASH_PERMANENT_DELETE: 'trash:permanentDelete',
  TRASH_EMPTY: 'trash:empty',
  TRASH_PURGE: 'trash:purge',

  IMPORT_OPEN_FILE_DIALOG: 'import:openFileDialog',
  IMPORT_PARSE_FILE: 'import:parseFile',
  IMPORT_GET_CSV_HEADERS: 'import:getCsvHeaders',
  IMPORT_PARSE_GENERIC_CSV: 'import:parseGenericCsv',
  IMPORT_CHECK_DUPLICATES: 'import:checkDuplicates',
  IMPORT_COMMIT: 'import:commit',

  EXPORT_DATA: 'export:data',
  EXPORT_PROGRESS: 'export:progress',

  WINDOW_MINIMIZE: 'window:minimize',
  WINDOW_MAXIMIZE: 'window:maximize',
  WINDOW_CLOSE: 'window:close',
  WINDOW_IS_MAXIMIZED: 'window:isMaximized',

  // Auto-updater
  UPDATE_AVAILABLE: 'update:available',
  UPDATE_NOT_AVAILABLE: 'update:not-available',
  UPDATE_DOWNLOAD_PROGRESS: 'update:download-progress',
  UPDATE_DOWNLOADED: 'update:downloaded',
  UPDATE_ERROR: 'update:error',
  CHECK_FOR_UPDATES: 'update:check',
  DOWNLOAD_UPDATE: 'update:download',
  QUIT_AND_INSTALL: 'update:quit-and-install',
} as const;
