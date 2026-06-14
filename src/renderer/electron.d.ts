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
} from '../shared/types';

export interface ElectronAuthAPI {
  init(masterPassword: string): Promise<void>;
  unlock(masterPassword: string): Promise<boolean>;
  lock(): Promise<void>;
  changePassword(oldPassword: string, newPassword: string): Promise<void>;
  check(): Promise<boolean>;
}

export interface ElectronFoldersAPI {
  getTree(): Promise<Folder[]>;
  create(parentId: string | null, name: string, emoji?: string): Promise<Folder>;
  update(
    id: string,
    fields: { name?: string; emoji?: string; coverImage?: string },
  ): Promise<Folder | null>;
  move(id: string, newParentId: string | null, sortOrder: number): Promise<Folder | null>;
  delete(id: string): Promise<void>;
  restore(id: string): Promise<void>;
}

export interface ElectronItemsAPI {
  getAll(): Promise<Item[]>;
  getByFolder(folderId: string): Promise<Item[]>;
  getById(id: string): Promise<ItemDecrypted | null>;
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
  ): Promise<ItemDecrypted>;
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
  ): Promise<ItemDecrypted | null>;
  delete(id: string): Promise<void>;
  restore(id: string): Promise<void>;
  toggleFavorite(id: string): Promise<ItemDecrypted | null>;
  search(query: string): Promise<Item[]>;
  searchByTag(tagId: string): Promise<Item[]>;
}

export interface ElectronTagsAPI {
  getAll(): Promise<Tag[]>;
  create(name: string, color?: string): Promise<Tag>;
  attach(itemId: string, tagId: string): Promise<void>;
  detach(itemId: string, tagId: string): Promise<void>;
  delete(id: string): Promise<void>;
}

export interface ElectronFilesAPI {
  getByItem(itemId: string): Promise<Attachment[]>;
  attach(itemId: string, filePath: string): Promise<Attachment>;
  download(attachmentId: string): Promise<string>;
  delete(attachmentId: string): Promise<Attachment | null>;
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
  get(): Promise<TrashEntry[]>;
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

export interface ElectronHealthAPI {
  analyze(oldDays?: number): Promise<HealthReport>;
}

export interface ElectronAPI {
  auth: ElectronAuthAPI;
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
}

declare global {
  interface Window {
    electron: ElectronAPI;
  }
}
