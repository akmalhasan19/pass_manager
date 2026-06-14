export interface Folder {
  id: string;
  parentId: string | null;
  name: string;
  emoji: string | null;
  coverImage: string | null;
  createdAt: number;
  updatedAt: number;
  sortOrder: number;
  children?: Folder[];
}

export interface Item {
  id: string;
  folderId: string;
  title: string;
  username: string;
  passwordEncrypted: ArrayBuffer | null;
  url: string;
  notesEncrypted: ArrayBuffer | null;
  emoji: string | null;
  coverImage: string | null;
  createdAt: number;
  updatedAt: number;
  isFavorite: boolean;
  sortOrder: number;
  tags?: Tag[];
}

export interface ItemDecrypted {
  id: string;
  folderId: string;
  title: string;
  username: string;
  password: string;
  url: string;
  notes: string | null;
  emoji: string | null;
  coverImage: string | null;
  createdAt: number;
  updatedAt: number;
  isFavorite: boolean;
  sortOrder: number;
  tags?: Tag[];
}

export interface Tag {
  id: string;
  name: string;
  color: string;
}

export interface Attachment {
  id: string;
  itemId: string | null;
  folderId: string | null;
  fileName: string;
  mimeType: string;
  fileSize: number;
  storagePath: string;
  createdAt: number;
}

export interface TrashEntry {
  id: string;
  originalType: 'folder' | 'item';
  originalId: string;
  originalParentId: string | null;
  dataEncrypted: ArrayBuffer;
  deletedAt: number;
}

export interface AuthMetadata {
  salt: Buffer;
  kdfAlgorithm: 'pbkdf2' | 'argon2id';
  kdfIterations: number;
  kdfMemory: number | null;
  kdfParallelism: number | null;
  verificationHash: string;
  createdAt: number;
}

export interface KdfParams {
  algorithm: 'pbkdf2' | 'argon2id';
  iterations: number;
}

export interface AppSettings {
  autoLockTime: number;
  theme: 'light' | 'dark' | 'system';
  defaultPasswordLength: number;
  defaultPasswordUppercase: boolean;
  defaultPasswordLowercase: boolean;
  defaultPasswordNumbers: boolean;
  defaultPasswordSymbols: boolean;
  defaultPasswordExcludeAmbiguous: boolean;
  trashAutoPurgeDays: number;
  passwordHealthOldDays: number;
}

export interface SearchResultItem {
  type: 'folder' | 'item' | 'tag';
  id: string;
  title: string;
  subtitle: string;
  emoji: string | null;
  breadcrumb: string;
}

export class DatabaseError extends Error {
  public code: string;
  public context: Record<string, unknown>;

  constructor(message: string, code: string, context: Record<string, unknown> = {}) {
    super(message);
    this.name = 'DatabaseError';
    this.code = code;
    this.context = context;
  }
}

export class DatabaseNotOpenError extends DatabaseError {
  constructor(context: Record<string, unknown> = {}) {
    super('Database is not open. Call openDatabase() first.', 'DB_NOT_OPEN', context);
    this.name = 'DatabaseNotOpenError';
  }
}

export class DatabaseCorruptedError extends DatabaseError {
  constructor(path: string, cause?: unknown) {
    super(`Database file is corrupted or invalid: ${path}`, 'DB_CORRUPTED', {
      path,
      cause: cause instanceof Error ? cause.message : String(cause),
    });
    this.name = 'DatabaseCorruptedError';
  }
}

export class DatabaseIOError extends DatabaseError {
  constructor(operation: string, path: string, cause: unknown) {
    super(
      `File I/O error during ${operation}: ${path} — ${cause instanceof Error ? cause.message : String(cause)}`,
      'DB_IO_ERROR',
      { operation, path, cause: cause instanceof Error ? cause.message : String(cause) },
    );
    this.name = 'DatabaseIOError';
  }
}

export class DatabaseNotInitializedError extends DatabaseError {
  constructor() {
    super('SQL.js not initialized. Call initializeSqlJs() first.', 'DB_NOT_INITIALIZED');
    this.name = 'DatabaseNotInitializedError';
  }
}

export interface HealthReport {
  total: number;
  weak: number;
  reused: number;
  old: number;
  strong: number;
  score: 'A' | 'B' | 'C' | 'D' | 'F';
  weakPasswords: Array<{ itemId: string; title: string; reason: string }>;
  reusedPasswords: Array<{
    hash: string;
    count: number;
    items: Array<{ itemId: string; title: string }>;
  }>;
  oldPasswords: Array<{ itemId: string; title: string; daysSinceChange: number }>;
}
