export const IPC_CHANNELS = {
  AUTH_INIT: 'auth:init',
  AUTH_UNLOCK: 'auth:unlock',
  AUTH_LOCK: 'auth:lock',
  AUTH_CHANGE_PASSWORD: 'auth:change-password',
  AUTH_CHECK: 'auth:check',

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

  TAG_GET_ALL: 'tag:getAll',
  TAG_CREATE: 'tag:create',
  TAG_ATTACH: 'tag:attach',
  TAG_DETACH: 'tag:detach',
  TAG_DELETE: 'tag:delete',

  FILE_ATTACH: 'file:attach',
  FILE_DOWNLOAD: 'file:download',
  FILE_DELETE: 'file:delete',

  SETTINGS_GET: 'settings:get',
  SETTINGS_SET: 'settings:set',
  SETTINGS_GET_ALL: 'settings:getAll',

  TRASH_GET: 'trash:get',
  TRASH_RESTORE: 'trash:restore',
  TRASH_PERMANENT_DELETE: 'trash:permanentDelete',
  TRASH_EMPTY: 'trash:empty',
  TRASH_PURGE: 'trash:purge',
} as const;
