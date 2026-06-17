import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { app } from 'electron';
import type { VaultRegistryEntry, VaultRegistryFile } from '../../shared/types';
import { VaultRegistryError } from '../../shared/types';
import { VAULT_REGISTRY_VERSION } from '../../shared/constants';
import { validateVaultName, normalizeForComparison } from '../../shared/validation';
import { sanitizeForField } from '../../shared/sanitize';
import { logger } from '../../shared/logger';
import {
  generateVaultId,
  isValidVaultId,
  resolveVaultDatabasePath as resolveVaultDbPath,
} from '../../shared/vaultPathStrategy';

const REGISTRY_FILENAME = 'vault-registry.json';

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

export function invalidateRegistryCache(): void {
  registryCache = null;
}
