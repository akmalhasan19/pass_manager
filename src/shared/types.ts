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

export interface TotpConfig {
  secret: string;
  period: number;
  digits: number;
  algorithm: string;
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
  otp: TotpConfig | null;
  otpSecretEncrypted: ArrayBuffer | null;
  otpPeriod: number;
  otpDigits: number;
  otpAlgorithm: string;
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
  otp: TotpConfig | null;
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
  otpPrivacyMode: boolean;
  otpOnboardingShown: boolean;
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

export class DatabaseNoActiveVaultError extends DatabaseError {
  constructor(context: Record<string, unknown> = {}) {
    super(
      'No active vault is open. Open a vault before running database operations.',
      'DB_NO_ACTIVE_VAULT',
      context,
    );
    this.name = 'DatabaseNoActiveVaultError';
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

export const EXPORT_FORMAT_VERSION = 1;
export const EXPORT_MAGIC = 'SPM';
export const EXPORT_FILE_EXTENSION = '.spm';

export interface ExportMetadata {
  appName: string;
  appVersion: string;
  exportedAt: number;
  formatVersion: number;
  schemaVersion: number;
  itemCount: number;
  folderCount: number;
  tagCount: number;
  attachmentCount: number;
  sourceVaultId?: string;
  sourceVaultName?: string;
}

export interface ExportFolder {
  id: string;
  parentId: string | null;
  name: string;
  emoji: string | null;
  coverImage: string | null;
  createdAt: number;
  updatedAt: number;
  sortOrder: number;
}

export interface ExportItem {
  id: string;
  folderId: string;
  title: string;
  username: string;
  passwordEncrypted: string | null;
  url: string;
  notesEncrypted: string | null;
  emoji: string | null;
  coverImage: string | null;
  createdAt: number;
  updatedAt: number;
  isFavorite: boolean;
  sortOrder: number;
  tagIds: string[];
  otpSecretEncrypted: string | null;
  otpPeriod: number;
  otpDigits: number;
  otpAlgorithm: string;
}

export interface ExportTag {
  id: string;
  name: string;
  color: string;
}

export interface ExportAttachment {
  id: string;
  itemId: string | null;
  folderId: string | null;
  fileName: string;
  mimeType: string;
  fileSize: number;
  dataEncrypted: string;
  createdAt: number;
}

export interface ExportPayload {
  formatVersion: number;
  metadata: ExportMetadata;
  folders: ExportFolder[];
  items: ExportItem[];
  tags: ExportTag[];
  attachments: ExportAttachment[];
}

export interface EncryptedExportFile {
  magic: string;
  formatVersion: number;
  encryptionAlgorithm: 'aes-256-gcm';
  iv: string;
  authTag: string;
  ciphertext: string;
}

export interface PlainTextExportItem {
  title: string;
  username: string;
  password: string;
  url: string;
  notes: string;
  tags: string[];
}

export interface PlainTextExportItemRich {
  title: string;
  username: string;
  password: string;
  url: string;
  notes: {
    html: string;
    text: string;
  } | null;
  tags: string[];
  folder?: string;
  isFavorite?: boolean;
  createdAt?: number;
  updatedAt?: number;
}

export const CSV_COLUMNS = ['title', 'username', 'password', 'url', 'notes', 'tags'] as const;
export type CsvColumn = (typeof CSV_COLUMNS)[number];

export type ImportFormat =
  | 'keepass-xml'
  | 'bitwarden-json'
  | '1password-csv'
  | 'generic-csv'
  | 'encrypted-json';

export const IMPORT_FORMATS: ImportFormat[] = [
  'keepass-xml',
  'bitwarden-json',
  '1password-csv',
  'generic-csv',
  'encrypted-json',
];

export const IMPORT_FORMAT_LABELS: Record<ImportFormat, string> = {
  'keepass-xml': 'KeePass XML',
  'bitwarden-json': 'Bitwarden JSON',
  '1password-csv': '1Password CSV',
  'generic-csv': 'Generic CSV',
  'encrypted-json': 'Encrypted JSON (.spm)',
};

export const IMPORT_FORMAT_EXTENSIONS: Record<ImportFormat, string[]> = {
  'keepass-xml': ['.xml'],
  'bitwarden-json': ['.json'],
  '1password-csv': ['.csv'],
  'generic-csv': ['.csv'],
  'encrypted-json': ['.spm', '.json.encr'],
};

export const IMPORT_FORMAT_MIME_TYPES: Record<ImportFormat, string[]> = {
  'keepass-xml': ['text/xml', 'application/xml'],
  'bitwarden-json': ['application/json'],
  '1password-csv': ['text/csv', 'text/comma-separated-values'],
  'generic-csv': ['text/csv', 'text/comma-separated-values'],
  'encrypted-json': ['application/octet-stream', 'application/json'],
};

export interface FilePickResult {
  filePath: string;
  fileName: string;
  content: string;
  detectedFormat: ImportFormat | null;
}

export interface ImportDialogResult {
  format: ImportFormat;
  filePath: string;
  content: string;
}

export type CsvColumnMapping = Partial<Record<CsvColumn, string>>;

export interface GenericCsvParseRequest {
  format: 'generic-csv';
  filePath: string;
  content: string;
  columnMapping: CsvColumnMapping;
}

export interface CsvHeaderResult {
  headers: string[];
  sampleRow: string[];
}

export type DuplicateResolution = 'skip' | 'replace' | 'rename';

export interface DuplicateInfo {
  importItemIndex: number;
  importItemTitle: string;
  importItemUrl: string;
  existingItemId: string;
  existingItemTitle: string;
  existingItemUrl: string;
}

export interface DuplicateReport {
  duplicates: DuplicateInfo[];
  totalImportItems: number;
  uniqueItems: number;
}

export interface DuplicateResolutionMap {
  items: DuplicateInfo[];
  globalResolution: DuplicateResolution;
  perItemResolutions: Record<number, DuplicateResolution>;
}

export interface ImportCommitRequest {
  payload: ImportPayload;
  resolutionMap: DuplicateResolutionMap;
}

export interface ImportFolder {
  id: string;
  parentId: string | null;
  name: string;
  emoji: string | null;
  coverImage: string | null;
  createdAt: number;
  updatedAt: number;
  sortOrder: number;
}

export interface ImportItem {
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
  tagIds: string[];
}

export interface ImportTag {
  id: string;
  name: string;
  color: string;
}

export interface ImportAttachment {
  id: string;
  itemId: string | null;
  folderId: string | null;
  fileName: string;
  mimeType: string;
  fileSize: number;
  rawData: Buffer;
  createdAt: number;
}

export interface ImportPayload {
  folders: ImportFolder[];
  items: ImportItem[];
  tags: ImportTag[];
  attachments: ImportAttachment[];
}

/**
 * Vault registry entry stored in the app config directory.
 *
 * SECURITY: This type must NEVER contain master passwords, encryption keys,
 * derived keys, salts, or any other sensitive cryptographic material.
 * Only non-sensitive metadata belongs here.
 */
export interface VaultRegistryEntry {
  id: string;
  name: string;
  databasePath: string;
  createdAt: number;
  lastOpenedAt: number | null;
  lastOpenedVersion: string | null;
  description: string | null;
  color: string | null;
  icon: string | null;
  isDefault: boolean;
  sortOrder: number;
  /** Whether the database file is stored outside the managed app directory. */
  isCustomLocation: boolean;
}

export interface VaultRegistryFile {
  version: number;
  vaults: VaultRegistryEntry[];
}

/**
 * Vault backup file format.
 *
 * A vault backup bundles the encrypted database file and the per-vault
 * auth metadata into a single portable file. The database is NOT decrypted
 * during backup — the raw encrypted bytes are preserved as-is.
 *
 * File extension: .spmv (SecurePass Manager Vault backup)
 */
export const VAULT_BACKUP_MAGIC = 'SPMV';
export const VAULT_BACKUP_FORMAT_VERSION = 1;
export const VAULT_BACKUP_FILE_EXTENSION = '.spmv';

export interface VaultBackupFile {
  magic: string;
  formatVersion: number;
  vaultName: string;
  databaseBase64: string;
  authMetadata: {
    salt: string;
    kdfAlgorithm: string;
    kdfIterations: number;
    kdfMemory: number | null;
    kdfParallelism: number | null;
    verificationHash: string;
    createdAt: number;
  };
  backupCreatedAt: number;
}

export interface VaultRestoreResult {
  vaultId: string;
  vaultName: string;
}

export type VaultFileStatus = 'ok' | 'missing' | 'corrupted' | 'auth_missing';

export interface VaultWithStatus extends VaultRegistryEntry {
  fileStatus: VaultFileStatus;
}

export interface VaultRecoveryResult {
  recovered: number;
  vaults: VaultRegistryEntry[];
}

export interface VaultBackupEntry {
  vaultId: string;
  name: string;
  databasePath: string;
  backedUpAt: number;
}

export class VaultRegistryError extends Error {
  public code: string;
  public context: Record<string, unknown>;

  constructor(message: string, code: string, context: Record<string, unknown> = {}) {
    super(message);
    this.name = 'VaultRegistryError';
    this.code = code;
    this.context = context;
  }
}
