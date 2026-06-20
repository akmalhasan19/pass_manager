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
 * Validates that auth metadata has all required fields with correct types.
 * Returns an error message if validation fails, null if valid.
 */
export function validateAuthMetadata(metadata: Record<string, unknown>): string | null {
  // Validate salt exists and is valid base64
  if (!metadata.salt || typeof metadata.salt !== 'string') {
    return 'Auth metadata is corrupt: missing or invalid salt.';
  }

  // Validate salt is valid base64 and not empty
  const saltString = metadata.salt as string;
  const saltBuffer = Buffer.from(saltString, 'base64');

  // Check if the decoded buffer is empty
  if (saltBuffer.length === 0) {
    return 'Auth metadata is corrupt: salt is empty.';
  }

  // Check if the base64 string is valid by re-encoding and comparing
  const reEncoded = saltBuffer.toString('base64');
  if (reEncoded !== saltString) {
    return 'Auth metadata is corrupt: salt is not valid base64.';
  }

  // Validate verificationHash exists and is valid hex string
  if (!metadata.verificationHash || typeof metadata.verificationHash !== 'string') {
    return 'Auth metadata is corrupt: missing or invalid verification hash.';
  }

  if (!/^[a-f0-9]{64}$/i.test(metadata.verificationHash)) {
    return 'Auth metadata is corrupt: verification hash is not valid hex.';
  }

  // Validate kdfAlgorithm if present
  if (metadata.kdfAlgorithm !== undefined) {
    if (metadata.kdfAlgorithm !== 'pbkdf2' && metadata.kdfAlgorithm !== 'argon2id') {
      return `Auth metadata is corrupt: unsupported KDF algorithm "${metadata.kdfAlgorithm}".`;
    }
  }

  // Validate kdfIterations for PBKDF2
  const algorithm = metadata.kdfAlgorithm ?? 'pbkdf2';
  if (algorithm === 'pbkdf2') {
    if (metadata.kdfIterations !== undefined) {
      if (typeof metadata.kdfIterations !== 'number' || metadata.kdfIterations < 1) {
        return 'Auth metadata is corrupt: invalid PBKDF2 iterations count.';
      }
    }
  }

  // Validate Argon2id parameters if algorithm is argon2id
  if (algorithm === 'argon2id') {
    if (metadata.kdfMemory !== undefined && metadata.kdfMemory !== null) {
      if (typeof metadata.kdfMemory !== 'number' || metadata.kdfMemory < 1) {
        return 'Auth metadata is corrupt: invalid Argon2id memory cost.';
      }
    }
    if (metadata.kdfParallelism !== undefined && metadata.kdfParallelism !== null) {
      if (typeof metadata.kdfParallelism !== 'number' || metadata.kdfParallelism < 1) {
        return 'Auth metadata is corrupt: invalid Argon2id parallelism.';
      }
    }
  }

  return null;
}

/**
 * Reads and parses the auth metadata for a specific vault.
 *
 * @throws {Error} If the auth file does not exist, contains invalid JSON,
 *                 or fails validation.
 */
export function readVaultAuthMetadata(vaultId: string): AuthMetadata {
  const authPath = getVaultAuthPath(vaultId);
  if (!existsSync(authPath)) {
    throw new Error(`Auth metadata not found for vault ${vaultId}.`);
  }

  const raw = readFileSync(authPath, 'utf-8');
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(
      `Auth metadata for vault ${vaultId} is corrupt: invalid JSON format.`,
    );
  }

  // Validate the parsed metadata
  const validationError = validateAuthMetadata(parsed);
  if (validationError) {
    throw new Error(`Auth metadata for vault ${vaultId} is corrupt: ${validationError}`);
  }

  return {
    ...parsed,
    salt: Buffer.from(parsed.salt as string, 'base64'),
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

// ───────────────────────────────────────────────────────────────────────────
// Legacy Single-Vault KDF Migration Detection
// ───────────────────────────────────────────────────────────────────────────

/**
 * Result of scanning a vault's auth metadata to determine if it is a
 * candidate for KDF migration (PBKDF2 → Argon2id).
 *
 * Detecting legacy single-file vaults that lack the `kdfAlgorithm` field
 * is critical for Sub-Task 6.1: Single-Vault Legacy Migration.
 */
export interface KdfMigrationCandidate {
  /** True if this vault uses PBKDF2 or has no explicit kdfAlgorithm. */
  isCandidate: boolean;
  /** The detected algorithm, or 'unknown' if unreadable. */
  currentAlgorithm: 'pbkdf2' | 'argon2id' | 'unknown';
  /** True if the auth metadata contains the `kdfAlgorithm` field. */
  hasKdfAlgorithmField: boolean;
  /** True if the auth metadata uses the pre-v1 flat format (no kdfParams / no kdfVersion). */
  hasFlatLegacyFormat: boolean;
  /** Human-readable reason for the candidate status. */
  reason: string;
}

/**
 * Detects whether a vault is a legacy single-file vault that needs
 * migration from PBKDF2 to Argon2id.
 *
 * Legacy single-file vaults are identified by the absence of the
 * `kdfAlgorithm` field in their per-vault auth metadata. Newer vaults
 * explicitly declare `pbkdf2` or `argon2id`.
 *
 * This function is the cornerstone of Sub-Task 6.1: it reads the
 * per-vault auth metadata, detects the legacy condition, and returns
 * a structured result that callers can use to display UI indicators,
 * trigger background migration, or log diagnostics.
 *
 * SECURITY: This function only reads metadata — it does not change
 * any files, derive keys, or access the vault database. It is safe to
 * call on a locked vault.
 *
 * @param vaultId - The vault ID to check.
 * @returns KdfMigrationCandidate with full detection results.
 */
export function detectKdfMigrationCandidate(vaultId: string): KdfMigrationCandidate {
  try {
    const authMetadata = readVaultAuthMetadata(vaultId);
    const hasKdfAlgorithmField = authMetadata.kdfAlgorithm !== undefined;
    const currentAlgorithm = authMetadata.kdfAlgorithm ?? 'pbkdf2';
    const isCandidate = currentAlgorithm === 'pbkdf2';
    const hasFlatLegacyFormat = !authMetadata.kdfParams && !authMetadata.kdfVersion;

    let reason: string;
    if (isCandidate) {
      if (!hasKdfAlgorithmField) {
        reason = 'Legacy single-file vault without kdfAlgorithm field detected. PBKDF2 is assumed.';
      } else {
        reason = 'Vault is using PBKDF2 and should be migrated to Argon2id for stronger security.';
      }
    } else {
      reason = 'Vault is already using Argon2id. No KDF migration needed.';
    }

    return {
      isCandidate,
      currentAlgorithm,
      hasKdfAlgorithmField,
      hasFlatLegacyFormat,
      reason,
    };
  } catch {
    return {
      isCandidate: false,
      currentAlgorithm: 'unknown',
      hasKdfAlgorithmField: false,
      hasFlatLegacyFormat: false,
      reason: 'Unable to read auth metadata for vault.',
    };
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
      kdfParams: parsed.kdfParams ?? undefined,
      kdfVersion: parsed.kdfVersion ?? undefined,
    };

    writeVaultAuthMetadata(vaultId, metadata);
    logger.info('Migrated legacy auth.json to per-vault auth', { vaultId });
    return true;
  } catch (cause) {
    logger.error('Failed to migrate legacy auth.json', { vaultId, cause });
    return false;
  }
}
