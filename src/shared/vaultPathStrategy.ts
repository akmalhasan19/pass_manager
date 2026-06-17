/**
 * Vault ID and File Path Strategy
 *
 * This module defines the canonical strategy for how vault IDs are generated
 * and how file paths are resolved. It is the single source of truth for all
 * naming and directory conventions related to vault database files.
 *
 * Strategy rules:
 *   1. Every vault has a stable, UUID-based `vaultId` that never depends on
 *      the vault's display name.
 *   2. The physical filename is derived deterministically from the `vaultId`
 *      using a safe, fixed prefix and suffix: `vault-{uuid}.db`.
 *   3. The display name is stored separately in the vault registry so that
 *      renaming a vault never renames or moves its underlying file.
 *   4. Unless the user explicitly provides a `customDatabasePath`, every
 *      vault file lives inside the managed application directory.
 *   5. Custom paths are allowed, but they must be absolute, not contain
 *      path-traversal sequences, and are validated at creation time.
 */

import { randomUUID } from 'node:crypto';
import { join, isAbsolute } from 'node:path';
import { containsPathTraversal, isPathWithinDirectory } from './fileSecurity';
import { VaultRegistryError } from './types';

/** Fixed prefix for all vault database filenames. */
export const VAULT_FILENAME_PREFIX = 'vault-' as const;

/** Fixed extension for all vault database files. */
export const VAULT_FILENAME_EXTENSION = '.db' as const;

/** Valid UUID v4 pattern. */
const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Generate a new stable vault ID.
 *
 * The ID is a standard UUID v4 string and is completely decoupled from the
 * vault's display name. This guarantees that renaming a vault, or two
 * vaults having the same name, never causes ID collisions or file movement.
 */
export function generateVaultId(): string {
  return randomUUID();
}

/**
 * Validate that a string is a well-formed vault ID (UUID v4).
 */
export function isValidVaultId(value: string): boolean {
  if (typeof value !== 'string') return false;
  return UUID_V4_PATTERN.test(value);
}

/**
 * Generate a safe filename from a vault ID.
 *
 * Format: `vault-{uuid}.db`
 *
 * The filename contains no user input and is safe for all major file systems.
 */
export function generateVaultFilename(vaultId: string): string {
  if (!isValidVaultId(vaultId)) {
    throw new VaultRegistryError(
      'Invalid vault ID: expected a valid UUID v4 string',
      'INVALID_VAULT_ID',
      { vaultId },
    );
  }

  return `${VAULT_FILENAME_PREFIX}${vaultId}${VAULT_FILENAME_EXTENSION}`;
}

/**
 * Resolve the full filesystem path for a vault's database file.
 *
 * If `customPath` is provided and non-empty, it is used directly (after
 * validation). Otherwise the path is constructed inside the managed
 * application directory using the deterministic filename derived from the
 * vault ID.
 *
 * @param vaultId - The stable UUID of the vault.
 * @param managedDir - The managed application directory (e.g. `userData/vaults`).
 * @param customPath - Optional custom file path chosen by the user.
 * @returns The absolute path to the vault's database file.
 * @throws VaultRegistryError if the vaultId is invalid or the custom path is unsafe.
 */
export function resolveVaultDatabasePath(
  vaultId: string,
  managedDir: string,
  customPath?: string,
): string {
  if (!isValidVaultId(vaultId)) {
    throw new VaultRegistryError(
      'Invalid vault ID: expected a valid UUID v4 string',
      'INVALID_VAULT_ID',
      { vaultId },
    );
  }

  if (!managedDir || typeof managedDir !== 'string') {
    throw new VaultRegistryError(
      'Managed directory must be a non-empty string',
      'INVALID_MANAGED_DIR',
    );
  }

  if (customPath !== undefined && customPath !== null && customPath.trim().length > 0) {
    const trimmed = customPath.trim();

    // Reject any path that contains traversal sequences
    if (containsPathTraversal(trimmed)) {
      throw new VaultRegistryError(
        'Custom database path contains invalid traversal sequences',
        'INVALID_CUSTOM_PATH',
        { customPath: trimmed },
      );
    }

    if (!isAbsolute(trimmed)) {
      throw new VaultRegistryError(
        'Custom database path must be an absolute path',
        'INVALID_CUSTOM_PATH',
        { customPath: trimmed },
      );
    }

    return trimmed;
  }

  const filename = generateVaultFilename(vaultId);
  return join(managedDir, filename);
}

/**
 * Check whether a database path was resolved inside the managed directory
 * or is a user-supplied custom location.
 *
 * @param dbPath - The absolute path stored in the registry.
 * @param managedDir - The managed directory.
 * @returns `true` if the path falls within the managed directory, `false` otherwise.
 */
export function isManagedVaultPath(dbPath: string, managedDir: string): boolean {
  if (!dbPath || !managedDir) return false;

  try {
    return isPathWithinDirectory(managedDir, dbPath);
  } catch {
    return false;
  }
}
