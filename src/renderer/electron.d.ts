import {
  Folder,
  Item,
  Tag,
  Attachment,
  TrashEntry,
  AppSettings,
  SearchResultItem,
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
  getByFolder(folderId: string): Promise<Item[]>;
  getById(id: string): Promise<Item | null>;
  create(
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
  ): Promise<Item>;
  update(
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
  ): Promise<Item | null>;
  delete(id: string): Promise<void>;
  restore(id: string): Promise<void>;
  toggleFavorite(id: string): Promise<Item | null>;
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
  attach(itemId: string, filePath: string): Promise<Attachment>;
  download(attachmentId: string): Promise<string>;
  delete(attachmentId: string): Promise<Attachment | null>;
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

export interface ElectronAPI {
  auth: ElectronAuthAPI;
  folders: ElectronFoldersAPI;
  items: ElectronItemsAPI;
  tags: ElectronTagsAPI;
  files: ElectronFilesAPI;
  search: ElectronSearchAPI;
  settings: ElectronSettingsAPI;
  trash: ElectronTrashAPI;
  window: ElectronWindowAPI;
}

declare global {
  interface Window {
    electron: ElectronAPI;
  }
}
