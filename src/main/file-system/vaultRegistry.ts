import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, copyFileSync, statSync } from 'node:fs';
import { dirname, join, basename } from 'node:path';
import { app } from 'electron';
import type { VaultRegistryEntry, VaultRegistryFile, VaultFileStatus, VaultBackupEntry } from '../../shared/types';
import { VaultRegistryError } from '../../shared/types';
import { VAULT_REGISTRY_VERSION } from '../../shared/constants';
import { validateVaultName, normalizeForComparison } from '../../shared/validation';
import { sanitizeForField } from '../../shared/sanitize';
import { logger } from '../../shared/logger';
import {
  generateVaultId,
  isValidVaultId,
  resolveVaultDatabasePath as resolveVaultDbPath,
  VAULT_FILENAME_PREFIX,
  VAULT_FILENAME_EXTENSION,
} from '../../shared/vaultPathStrategy';

const REGISTRY_FILENAME = 'vault-registry.json';
const REGISTRY_BACKUP_SUFFIX = '.backup';

let registryCache: VaultRegistryFile | null = null;
let registryPath: string | null = null;

function getRegistryPath(): string {
  if (registryPath) return registryPath;
  const userDataPath = app?.getPath?.('userData') ?? join(process.cwd(), 'data');
  registryPath = join(userDataPath, REGISTRY_FILENAME);
  return registryPath;
}

function getVaultsDir(): string {
  const userDataPath = app?.getPath?.('userData') ?? join(process.cwd(), 'data');
  const dir = join(userDataPath, 'vaults');
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/**
 * Re-export of the canonical path resolver integrated with this module's
 * managed directory so callers don't have to repeat `getVaultsDir()`.
 */
export function resolveVaultDatabasePath(
  vaultId: string,
  customPath?: string,
): string {
  return resolveVaultDbPath(vaultId, getVaultsDir(), customPath);
}

function createEmptyRegistry(): VaultRegistryFile {
  return {
    version: VAULT_REGISTRY_VERSION,
    vaults: [],
  };
}

function validateRegistryData(data: unknown): VaultRegistryFile {
  if (!data || typeof data !== 'object') {
    throw new VaultRegistryError('Registry file is not a valid JSON object', 'REGISTRY_CORRUPTED');
  }

  const obj = data as Record<string, unknown>;

  if (typeof obj.version !== 'number' || obj.version < 1) {
    throw new VaultRegistryError('Registry file has invalid version', 'REGISTRY_CORRUPTED', {
      version: obj.version,
    });
  }

  if (!Array.isArray(obj.vaults)) {
    throw new VaultRegistryError(
      'Registry file has invalid vaults array',
      'REGISTRY_CORRUPTED',
    );
  }

  for (const vault of obj.vaults) {
    validateVaultEntry(vault);
  }

  return data as VaultRegistryFile;
}

function validateVaultEntry(entry: unknown): void {
  if (!entry || typeof entry !== 'object') {
    throw new VaultRegistryError('Vault entry is not a valid object', 'INVALID_VAULT_ENTRY');
  }

  const v = entry as Record<string, unknown>;

  if (typeof v.id !== 'string' || v.id.length === 0) {
    throw new VaultRegistryError('Vault entry has invalid id', 'INVALID_VAULT_ENTRY', { id: v.id });
  }

  if (!isValidVaultId(v.id)) {
    throw new VaultRegistryError('Vault entry id is not a valid UUID v4', 'INVALID_VAULT_ENTRY', {
      id: v.id,
    });
  }

  if (typeof v.name !== 'string' || v.name.length === 0) {
    throw new VaultRegistryError('Vault entry has invalid name', 'INVALID_VAULT_ENTRY', {
      name: v.name,
    });
  }

  // SECURITY: Reject entries with control characters or confusing names
  const validationError = validateVaultName(v.name as string);
  if (validationError) {
    throw new VaultRegistryError('Vault entry has invalid name', 'INVALID_VAULT_ENTRY', {
      name: v.name,
      errorKey: validationError,
    });
  }

  if (typeof v.databasePath !== 'string' || v.databasePath.length === 0) {
    throw new VaultRegistryError(
      'Vault entry has invalid databasePath',
      'INVALID_VAULT_ENTRY',
      { databasePath: v.databasePath },
    );
  }

  if (typeof v.createdAt !== 'number' || v.createdAt <= 0) {
    throw new VaultRegistryError(
      'Vault entry has invalid createdAt',
      'INVALID_VAULT_ENTRY',
      { createdAt: v.createdAt },
    );
  }

  if (v.isCustomLocation !== undefined && v.isCustomLocation !== null && typeof v.isCustomLocation !== 'boolean') {
    throw new VaultRegistryError(
      'Vault entry has invalid isCustomLocation',
      'INVALID_VAULT_ENTRY',
      { isCustomLocation: v.isCustomLocation },
    );
  }
}

export function loadRegistry(): VaultRegistryFile {
  if (registryCache) return registryCache;

  const path = getRegistryPath();

  if (!existsSync(path)) {
    registryCache = createEmptyRegistry();
    saveRegistryToDisk(registryCache);
    return registryCache;
  }

  let raw: string;
  try {
    raw = readFileSync(path, 'utf-8');
  } catch (cause) {
    throw new VaultRegistryError(
      'Failed to read registry file: ' + (cause instanceof Error ? cause.message : String(cause)),
      'REGISTRY_READ_ERROR',
      { path, cause: cause instanceof Error ? cause.message : String(cause) },
    );
  }

  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new VaultRegistryError(
      'Registry file contains invalid JSON',
      'REGISTRY_CORRUPTED',
      { path },
    );
  }

  registryCache = validateRegistryData(data);
  return registryCache;
}

function saveRegistryToDisk(registry: VaultRegistryFile): void {
  const path = getRegistryPath();
  const dir = dirname(path);

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  try {
    writeFileSync(path, JSON.stringify(registry, null, 2), 'utf-8');
  } catch (cause) {
    throw new VaultRegistryError(
      'Failed to save registry file: ' + (cause instanceof Error ? cause.message : String(cause)),
      'REGISTRY_WRITE_ERROR',
      { path, cause: cause instanceof Error ? cause.message : String(cause) },
    );
  }
}

function saveRegistry(registry: VaultRegistryFile): void {
  validateRegistryData(registry);
  registryCache = registry;
  saveRegistryToDisk(registry);
}

export function listVaults(): VaultRegistryEntry[] {
  const registry = loadRegistry();
  return [...registry.vaults].sort((a, b) => a.sortOrder - b.sortOrder);
}

export function getVaultById(vaultId: string): VaultRegistryEntry | null {
  const registry = loadRegistry();
  return registry.vaults.find((v) => v.id === vaultId) ?? null;
}

export function getDefaultVault(): VaultRegistryEntry | null {
  const registry = loadRegistry();
  return registry.vaults.find((v) => v.isDefault) ?? null;
}

export interface CreateVaultInput {
  name: string;
  description?: string | null;
  color?: string | null;
  icon?: string | null;
  isDefault?: boolean;
  /** Absolute path to an existing or new database file outside the managed directory. */
  customDatabasePath?: string;
}

export function createVault(input: CreateVaultInput): VaultRegistryEntry {
  const registry = loadRegistry();

  // SECURITY: Reject control characters and invalid names on the raw input
  // before sanitization strips them silently. This keeps the registry
  // contract explicit and matches the vault name validation requirements.
  const rawValidationError = validateVaultName(input.name);
  if (rawValidationError) {
    throw new VaultRegistryError('Vault name is invalid', 'INVALID_VAULT_NAME', {
      errorKey: rawValidationError,
    });
  }

  const sanitizedName = sanitizeForField('vaultName', input.name);
  const validationError = validateVaultName(sanitizedName);
  if (validationError) {
    throw new VaultRegistryError('Vault name is invalid', 'INVALID_VAULT_NAME', {
      errorKey: validationError,
    });
  }

  const normalizedName = sanitizedName.trim();
  const normalizedForComparison = normalizeForComparison(normalizedName);

  const duplicate = registry.vaults.find(
    (v) => normalizeForComparison(v.name) === normalizedForComparison,
  );
  if (duplicate) {
    throw new VaultRegistryError(
      'A vault with the name "' + normalizedName + '" already exists',
      'DUPLICATE_VAULT_NAME',
      { existingName: duplicate.name },
    );
  }

  const vaultId = generateVaultId();
  const databasePath = resolveVaultDatabasePath(vaultId, input.customDatabasePath);
  const isCustomLocation =
    input.customDatabasePath !== undefined &&
    input.customDatabasePath !== null &&
    input.customDatabasePath.trim().length > 0;
  const now = Date.now();

  if (input.isDefault) {
    for (const v of registry.vaults) {
      v.isDefault = false;
    }
  }

  const isFirstVault = registry.vaults.length === 0;
  const maxSortOrder = registry.vaults.reduce((max, v) => Math.max(max, v.sortOrder), 0);

  const entry: VaultRegistryEntry = {
    id: vaultId,
    name: normalizedName,
    databasePath,
    createdAt: now,
    lastOpenedAt: null,
    lastOpenedVersion: null,
    description: input.description ?? null,
    color: input.color ?? null,
    icon: input.icon ?? null,
    isDefault: input.isDefault ?? isFirstVault,
    sortOrder: maxSortOrder + 1,
    isCustomLocation,
  };

  registry.vaults.push(entry);
  saveRegistry(registry);

  logger.info('Vault created', { vaultId, name: normalizedName });
  return entry;
}

export type UpdateVaultInput = Partial<
  Pick<VaultRegistryEntry, 'name' | 'description' | 'color' | 'icon' | 'isDefault' | 'sortOrder'>
>;

export function updateVault(vaultId: string, updates: UpdateVaultInput): VaultRegistryEntry {
  const registry = loadRegistry();
  const index = registry.vaults.findIndex((v) => v.id === vaultId);

  if (index === -1) {
    throw new VaultRegistryError('Vault not found: ' + vaultId, 'VAULT_NOT_FOUND', { vaultId });
  }

  const entry = registry.vaults[index];

  if (updates.name !== undefined) {
    // SECURITY: Reject control characters on the raw input before sanitization.
    const rawValidationError = validateVaultName(updates.name);
    if (rawValidationError) {
      throw new VaultRegistryError('Vault name is invalid', 'INVALID_VAULT_NAME', {
        errorKey: rawValidationError,
      });
    }

    const sanitizedName = sanitizeForField('vaultName', updates.name);
    const validationError = validateVaultName(sanitizedName);
    if (validationError) {
      throw new VaultRegistryError('Vault name is invalid', 'INVALID_VAULT_NAME', {
        errorKey: validationError,
      });
    }

    const normalizedName = sanitizedName.trim();
    const normalizedForComparison = normalizeForComparison(normalizedName);

    const duplicate = registry.vaults.find(
      (v) => v.id !== vaultId && normalizeForComparison(v.name) === normalizedForComparison,
    );
    if (duplicate) {
      throw new VaultRegistryError(
        'A vault with the name "' + normalizedName + '" already exists',
        'DUPLICATE_VAULT_NAME',
        { existingName: duplicate.name },
      );
    }
    entry.name = normalizedName;
  }

  if (updates.description !== undefined) entry.description = updates.description;
  if (updates.color !== undefined) entry.color = updates.color;
  if (updates.icon !== undefined) entry.icon = updates.icon;
  if (updates.sortOrder !== undefined) entry.sortOrder = updates.sortOrder;

  if (updates.isDefault === true) {
    for (const v of registry.vaults) {
      v.isDefault = v.id === vaultId;
    }
  }

  saveRegistry(registry);

  logger.info('Vault updated', { vaultId, updates: Object.keys(updates) });
  return entry;
}

export function recordVaultOpened(vaultId: string, appVersion: string): void {
  const registry = loadRegistry();
  const entry = registry.vaults.find((v) => v.id === vaultId);

  if (!entry) {
    throw new VaultRegistryError('Vault not found: ' + vaultId, 'VAULT_NOT_FOUND', { vaultId });
  }

  entry.lastOpenedAt = Date.now();
  entry.lastOpenedVersion = appVersion;

  saveRegistry(registry);
}

export function deleteVault(vaultId: string): VaultRegistryEntry {
  const registry = loadRegistry();
  const index = registry.vaults.findIndex((v) => v.id === vaultId);

  if (index === -1) {
    throw new VaultRegistryError('Vault not found: ' + vaultId, 'VAULT_NOT_FOUND', { vaultId });
  }

  const removed = registry.vaults.splice(index, 1)[0];

  if (removed.isDefault && registry.vaults.length > 0) {
    registry.vaults.sort((a, b) => a.sortOrder - b.sortOrder);
    registry.vaults[0].isDefault = true;
  }

  saveRegistry(registry);

  logger.info('Vault deleted from registry', { vaultId, name: removed.name });
  return removed;
}

/**
 * Creates a backup of the current registry file before making destructive
 * changes. This enables rollback if a migration or recovery operation fails.
 *
 * Returns the backup path, or null if no registry file existed.
 */
export function backupRegistryFile(): string | null {
  const path = getRegistryPath();
  if (!existsSync(path)) return null;

  const backupPath = `${path}${REGISTRY_BACKUP_SUFFIX}.${Date.now()}`;
  try {
    copyFileSync(path, backupPath);
    logger.info('Registry backup created', { backupPath });
    return backupPath;
  } catch (cause) {
    logger.error('Failed to create registry backup', {
      backupPath,
      cause: cause instanceof Error ? cause.message : String(cause),
    });
    return null;
  }
}

/**
 * Restores the registry from a backup file. Returns true on success.
 * This is used to rollback a failed migration or recovery operation.
 */
export function restoreRegistryFromBackup(backupPath: string): boolean {
  const path = getRegistryPath();
  if (!existsSync(backupPath)) {
    logger.error('Registry backup file not found for restore', { backupPath });
    return false;
  }

  try {
    copyFileSync(backupPath, path);
    registryCache = null; // Invalidate cache so next load reads from restored file
    logger.info('Registry restored from backup', { backupPath });
    return true;
  } catch (cause) {
    logger.error('Failed to restore registry from backup', {
      backupPath,
      cause: cause instanceof Error ? cause.message : String(cause),
    });
    return false;
  }
}

/**
 * Scans the managed vaults directory and vault-auth directory to recover
 * vault entries that are not in the registry or to rebuild a corrupted registry.
 *
 * This is called when the registry file is corrupted or missing vault entries
 * need to be recovered. It finds:
 * 1. Database files matching the `vault-{uuid}.db` pattern in the vaults dir
 * 2. Auth metadata files in the vault-auth dir
 *
 * Returns the recovered vault entries without saving them, so the caller
 * can review before committing.
 */
export function recoverRegistryFromDisk(): VaultRegistryEntry[] {
  const vaultsDir = getVaultsDir();
  const userDataPath = app?.getPath?.('userData') ?? join(process.cwd(), 'data');
  const authDir = join(userDataPath, 'vault-auth');

  const recovered: VaultRegistryEntry[] = [];
  const seenIds = new Set<string>();

  const prefix = VAULT_FILENAME_PREFIX;
  const ext = VAULT_FILENAME_EXTENSION;

  // Scan vaults directory for vault-{uuid}.db files
  if (existsSync(vaultsDir)) {
    const files = readdirSync(vaultsDir);
    for (const file of files) {
      if (!file.startsWith(prefix) || !file.endsWith(ext)) continue;

      const vaultId = file.slice(prefix.length, -ext.length);
      if (!isValidVaultId(vaultId)) continue;

      if (seenIds.has(vaultId)) continue;
      seenIds.add(vaultId);

      const dbPath = join(vaultsDir, file);
      const now = Date.now();

      recovered.push({
        id: vaultId,
        name: `Recovered Vault (${vaultId.slice(0, 8)})`,
        databasePath: dbPath,
        createdAt: now,
        lastOpenedAt: null,
        lastOpenedVersion: null,
        description: 'Recovered from disk after registry corruption',
        color: null,
        icon: null,
        isDefault: false,
        sortOrder: recovered.length,
        isCustomLocation: false,
      });
    }
  }

  // Also scan vault-auth directory - any vault with auth metadata that
  // is not already found gets added as a "missing" vault (auth exists
  // but database file is not in the vaults dir).
  if (existsSync(authDir)) {
    const authFiles = readdirSync(authDir);
    for (const file of authFiles) {
      if (!file.endsWith('.auth.json')) continue;

      const vaultId = file.slice(0, -'.auth.json'.length);
      if (!isValidVaultId(vaultId)) continue;
      if (seenIds.has(vaultId)) continue;
      seenIds.add(vaultId);

      // Auth metadata exists but no DB file in vaults dir — this could be
      // a custom-location vault or the DB file was moved. Still recover it
      // as an entry so the user can decide what to do.
      const expectedDbPath = join(vaultsDir, `${prefix}${vaultId}${ext}`);
      const now = Date.now();

      recovered.push({
        id: vaultId,
        name: `Recovered Vault (${vaultId.slice(0, 8)})`,
        databasePath: existsSync(expectedDbPath) ? expectedDbPath : '(file missing — check auth location)',
        createdAt: now,
        lastOpenedAt: null,
        lastOpenedVersion: null,
        description: 'Recovered from auth metadata',
        color: null,
        icon: null,
        isDefault: false,
        sortOrder: recovered.length,
        isCustomLocation: false,
      });
    }
  }

  logger.info('Registry recovery scan complete', { found: recovered.length });
  return recovered;
}

/**
 * Commits the recovered vault entries to the registry, replacing the current
 * registry contents entirely. This is the final step after the user has
 * reviewed the recovery results.
 *
 * Creates a backup of the old registry before overwriting.
 */
export function commitRecovery(recovered: VaultRegistryEntry[]): VaultRegistryFile {
  backupRegistryFile();

  const registry: VaultRegistryFile = {
    version: VAULT_REGISTRY_VERSION,
    vaults: recovered,
  };

  // Ensure at least one is marked as default
  const hasDefault = recovered.some((v) => v.isDefault);
  if (!hasDefault && recovered.length > 0) {
    recovered[0].isDefault = true;
  }

  saveRegistry(registry);
  logger.info('Recovery committed to registry', { count: recovered.length });
  return registry;
}

/**
 * Checks the file status of a single vault's database file.
 * Returns 'ok' if the file exists, 'missing' if it doesn't,
 * 'corrupted' if the file exists but is empty or too small,
 * or 'auth_missing' if auth metadata is missing.
 */
export function checkVaultFileStatus(vaultId: string): VaultFileStatus {
  const registry = loadRegistry();
  const entry = registry.vaults.find((v) => v.id === vaultId);
  if (!entry) return 'missing';

  const userDataPath = app?.getPath?.('userData') ?? join(process.cwd(), 'data');
  const authDir = join(userDataPath, 'vault-auth');
  const authFile = join(authDir, `${vaultId}.auth.json`);

  if (!existsSync(authFile)) return 'auth_missing';

  if (!existsSync(entry.databasePath)) return 'missing';

  try {
    const stat = statSync(entry.databasePath);
    if (stat.size === 0) return 'corrupted';
  } catch {
    return 'missing';
  }

  return 'ok';
}

/**
 * Checks file status for all vaults in the registry.
 * Returns each vault entry annotated with its current file status.
 */
export function checkAllVaultFiles(): Array<{ entry: VaultRegistryEntry; status: VaultFileStatus }> {
  const registry = loadRegistry();
  return registry.vaults.map((entry) => ({
    entry,
    status: checkVaultFileStatus(entry.id),
  }));
}

/**
 * Removes vaults with missing database files from the registry in bulk.
 * Returns the list of removed vault entries.
 *
 * This is safer than individual deletes when multiple vault files have
 * been lost (e.g., after a disk failure or manual file cleanup).
 */
export function removeMissingVaults(): VaultRegistryEntry[] {
  const registry = loadRegistry();
  const remaining: VaultRegistryEntry[] = [];
  const removed: VaultRegistryEntry[] = [];

  for (const entry of registry.vaults) {
    const status = checkVaultFileStatus(entry.id);
    if (status === 'missing' || status === 'auth_missing') {
      removed.push(entry);
      logger.info('Removed missing vault from registry', {
        vaultId: entry.id,
        name: entry.name,
        status,
      });
    } else {
      remaining.push(entry);
    }
  }

  if (removed.length === 0) return [];

  // If we removed the default, assign a new one
  const hadDefault = registry.vaults.some((v) => v.isDefault);
  const stillHasDefault = remaining.some((v) => v.isDefault);
  if (hadDefault && !stillHasDefault && remaining.length > 0) {
    remaining[0].isDefault = true;
  }

  backupRegistryFile();

  registry.vaults = remaining;
  saveRegistry(registry);

  logger.info('Missing vaults removed from registry', { removed: removed.length, remaining: remaining.length });
  return removed;
}

export function invalidateRegistryCache(): void {
  registryCache = null;
}
