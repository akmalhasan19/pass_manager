/**
 * Per-Vault Auth Metadata Storage
 *
 * Each vault has its own auth metadata file stored at:
 *   {userData}/vault-auth/{vaultId}.auth.json
 *
 * This ensures complete cryptographic isolation between vaults:
 * - Each vault has its own master password, salt, and KDF params
 * - Deleting or resetting one vault does not affect any other vault
 * - No shared secrets exist between vaults
 *
 * SECURITY: Auth metadata files contain salt, KDF params, and a
 * verification hash. They must NEVER contain the derived key itself.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { app } from 'electron';
import type { AuthMetadata } from '../../shared/types';
import { logger } from '../../shared/logger';
import { isValidVaultId } from '../../shared/vaultPathStrategy';

const VAULT_AUTH_DIR_NAME = 'vault-auth';

function getUserDataPath(): string {
  const userDataPath = app?.getPath?.('userData') ?? join(process.cwd(), 'data');
  if (!existsSync(userDataPath)) {
    mkdirSync(userDataPath, { recursive: true });
  }
  return userDataPath;
}

function getVaultAuthDir(): string {
  const dir = join(getUserDataPath(), VAULT_AUTH_DIR_NAME);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/**
 * Returns the absolute path to the auth metadata file for a given vault.
 * The filename is derived from the vault ID (a UUID) to prevent conflicts
 * and avoid leaking vault names to the filesystem.
 */
export function getVaultAuthPath(vaultId: string): string {
  if (!isValidVaultId(vaultId)) {
    throw new Error(`Invalid vault ID for auth path: ${vaultId}`);
  }
  return join(getVaultAuthDir(), `${vaultId}.auth.json`);
}

/**
 * Checks whether an auth metadata file exists for the given vault.
 */
export function vaultAuthFileExists(vaultId: string): boolean {
  const authPath = getVaultAuthPath(vaultId);
  return existsSync(authPath);
}

/**
 * Reads and parses the auth metadata for a specific vault.
 *
 * @throws {Error} If the auth file does not exist or contains invalid JSON.
 */
export function readVaultAuthMetadata(vaultId: string): AuthMetadata {
  const authPath = getVaultAuthPath(vaultId);
  if (!existsSync(authPath)) {
    throw new Error(`Auth metadata not found for vault ${vaultId}.`);
  }

  const raw = readFileSync(authPath, 'utf-8');
  const parsed = JSON.parse(raw);

  return {
    ...parsed,
    salt: Buffer.from(parsed.salt, 'base64'),
  };
}

/**
 * Writes auth metadata for a specific vault.
 *
 * The salt is serialized as base64 in the JSON file.
 * This overwrites any existing auth metadata for the vault.
 */
export function writeVaultAuthMetadata(vaultId: string, metadata: AuthMetadata): void {
  const authPath = getVaultAuthPath(vaultId);
  const dir = join(authPath, '..');
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const obj = {
    ...metadata,
    salt: metadata.salt.toString('base64'),
  };

  writeFileSync(authPath, JSON.stringify(obj, null, 2), 'utf-8');
  logger.info('Vault auth metadata written', { vaultId });
}

/**
 * Deletes the auth metadata file for a specific vault.
 *
 * This is called when a vault is deleted. It does NOT affect
 * any other vault's auth metadata.
 *
 * Safe to call if the file does not exist (no-op).
 */
export function deleteVaultAuthMetadata(vaultId: string): void {
  const authPath = getVaultAuthPath(vaultId);
  if (existsSync(authPath)) {
    unlinkSync(authPath);
    logger.info('Vault auth metadata deleted', { vaultId });
  }
}

/**
 * Deletes the entire vault-auth directory and all its contents.
 *
 * This is a destructive operation intended only for full app data reset.
 * Individual vault deletions should use `deleteVaultAuthMetadata`.
 */
export function deleteAllVaultAuthMetadata(): void {
  const dir = getVaultAuthDir();
  if (existsSync(dir)) {
    rmSync(dir, { recursive: true, force: true });
    logger.info('All vault auth metadata deleted');
  }
}

/**
 * Migrates a legacy global auth.json file to per-vault auth storage.
 *
 * Called during app initialization when a legacy auth.json exists but
 * no per-vault auth file exists for the given vault yet. This ensures
 * backward compatibility for users upgrading from the single-vault era.
 *
 * After migration, the caller should delete the legacy auth.json.
 *
 * @param legacyAuthPath - Path to the legacy auth.json file
 * @param vaultId - The vault ID to associate the migrated auth metadata with
 * @returns true if migration was performed, false if no legacy file existed
 */
export function migrateLegacyAuthToVault(legacyAuthPath: string, vaultId: string): boolean {
  if (!existsSync(legacyAuthPath)) {
    return false;
  }

  if (vaultAuthFileExists(vaultId)) {
    // Vault already has its own auth — skip migration
    return false;
  }

  try {
    const raw = readFileSync(legacyAuthPath, 'utf-8');
    const parsed = JSON.parse(raw);

    const metadata: AuthMetadata = {
      salt: Buffer.from(parsed.salt, 'base64'),
      kdfAlgorithm: parsed.kdfAlgorithm ?? 'pbkdf2',
      kdfIterations: parsed.kdfIterations ?? 600000,
      kdfMemory: parsed.kdfMemory ?? null,
      kdfParallelism: parsed.kdfParallelism ?? null,
      verificationHash: parsed.verificationHash,
      createdAt: parsed.createdAt ?? Date.now(),
    };

    writeVaultAuthMetadata(vaultId, metadata);
    logger.info('Migrated legacy auth.json to per-vault auth', { vaultId });
    return true;
  } catch (cause) {
    logger.error('Failed to migrate legacy auth.json', { vaultId, cause });
    return false;
  }
}
