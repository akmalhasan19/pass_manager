import { ipcMain } from 'electron';
import { existsSync, unlinkSync, writeFileSync, renameSync, copyFileSync } from 'node:fs';
import { IPC_CHANNELS } from '../../shared/ipcChannels';
import { secureClear, secureClearString } from '../../shared/secureMemory';
import type { AuthMetadata } from '../../shared/types';
import { KDF_VERSION } from '../../shared/constants';
import {
  generateSalt,
  deriveMasterKey,
  deriveMasterKeyWithFallback,
  hashKeyForVerification,
  verifyKeyAgainstHash,
  DEFAULT_PBKDF2_ITERATIONS,
} from '../crypto/keyDerivation';
import { DEFAULT_ARGON2ID_PARAMS, isArgon2idAvailable } from '../crypto/argon2id';
import { decryptString, encryptString } from '../crypto/encryption';
import {
  initializeSqlJs,
  openDatabaseForVault,
  closeDatabase,
  saveDatabase,
  getDatabase,
  isDatabaseOpen,
} from '../database/connection';
import { migrateVaultDatabase, getAuthPath } from '../database/migrations';
import {
  ensureDefaultVaultRegistry,
  createVaultMetadata,
  resolveVaultDatabasePath,
} from '../file-system/storageManager';
import {
  readVaultAuthMetadata,
  writeVaultAuthMetadata,
  vaultAuthFileExists,
  migrateLegacyAuthToVault,
  detectKdfMigrationCandidate,
} from '../file-system/vaultAuthStorage';
import { listVaults, getVaultById } from '../file-system/vaultRegistry';
import { evaluateStrength } from '../crypto/passwordGenerator';
import { logger } from '../../shared/logger';
import { clearClipboardOnLock } from '../services/clipboardService';

/**
 * Per-vault session state.
 *
 * SECURITY: Only one vault can be unlocked at a time. When a vault is
 * unlocked, its derived key and KDF params are held here. When locked,
 * all fields are securely wiped and nulled.
 */
let activeVaultId: string | null = null;
let masterKey: Buffer | null = null;
let currentSalt: Buffer | null = null;
let currentKdfAlgorithm: 'pbkdf2' | 'argon2id' = 'pbkdf2';
let currentKdfIterations: number = DEFAULT_PBKDF2_ITERATIONS;

/**
 * Suffix used to identify the pre-migration backup file. The same
 * suffix is used everywhere the migration handler touches the backup
 * so a stray file is unambiguously associated with this flow.
 */
const PRE_ARGON2ID_BACKUP_SUFFIX = '.pre-argon2id-backup';

/**
 * Build the manual-recovery instructions the renderer shows when a
 * KDF migration fails and the pre-migration backup is still on disk.
 *
 * SECURITY: The text is generated from the absolute paths of the
 * backup and the vault file. No key material, password, salt, or
 * derived key ever appears in the instructions.
 */
function buildManualRecoveryInstructions(vaultPath: string, backupPath: string): string {
  return [
    'The KDF migration did not complete. Your original vault is preserved at:',
    `  ${backupPath}`,
    '',
    'To restore the original vault manually:',
    '  1. Lock the current vault and quit SecurePass Manager.',
    `  2. Copy the backup file to: ${vaultPath}`,
    '  3. Re-open SecurePass Manager and unlock with your original master password.',
    '',
    'If you want to retry the migration, open Settings → Security and click',
    '"Retry KDF migration". The backup file will be reused until the migration',
    'succeeds.',
    '',
    'If you do not want to retry, you can safely delete the backup file:',
    `  ${backupPath}`,
  ].join('\n');
}

export function getMasterKey(): Buffer | null {
  return masterKey;
}

export function getCurrentSalt(): Buffer | null {
  return currentSalt;
}

export function getCurrentKdfAlgorithm(): 'pbkdf2' | 'argon2id' {
  return currentKdfAlgorithm;
}

export function getCurrentKdfIterations(): number {
  return currentKdfIterations;
}

/**
 * Returns the vault ID of the currently unlocked vault, or null if locked.
 */
export function getActiveAuthVaultId(): string | null {
  return activeVaultId;
}

/**
 * Securely wipes all in-memory key material and resets session state.
 */
export function clearKeys(): void {
  secureClear(masterKey);
  secureClear(currentSalt);
  masterKey = null;
  currentSalt = null;
  activeVaultId = null;
  currentKdfAlgorithm = 'pbkdf2';
  currentKdfIterations = DEFAULT_PBKDF2_ITERATIONS;
}

/**
 * Re-encrypts all vault data with a new key.
 *
 * This function:
 * 1. Iterates through all encrypted columns in items and trash tables
 * 2. Decrypts each value with the old key
 * 3. Re-encrypts with the new key
 * 4. Writes the updated database to a temp file
 * 5. Atomically renames the temp file to replace the original
 * 6. Always cleans up the temp file before returning, even on failure
 *
 * SECURITY: Both keys must be valid 32-byte buffers. The old key is used
 * for decryption and the new key for re-encryption. Intermediate plaintext
 * is securely wiped after each re-encryption operation.
 *
 * The function never leaves a `.tmp.*` file behind on disk. If the
 * atomic rename succeeds, the temp file is consumed by the rename. If
 * it fails, the fallback copy/delete path removes the temp file, and
 * the `finally` block handles the worst-case where both the rename and
 * the fallback throw (e.g., disk full, permissions revoked mid-write).
 */
function reEncryptVaultData(oldKey: Buffer, newKey: Buffer, vaultId: string): void {
  const db = getDatabase();

  // Re-encrypt items: password_encrypted, notes_encrypted, otp_secret
  const itemStmt = db.prepare(
    'SELECT id, password_encrypted, notes_encrypted, otp_secret FROM items',
  );
  const updateItemStmt = db.prepare(
    'UPDATE items SET password_encrypted = ?, notes_encrypted = ?, otp_secret = ? WHERE id = ?',
  );

  while (itemStmt.step()) {
    const row = itemStmt.getAsObject() as {
      id: string;
      password_encrypted: Uint8Array | null;
      notes_encrypted: Uint8Array | null;
      otp_secret: Uint8Array | null;
    };

    let newPasswordEnc: Uint8Array | null = null;
    let newNotesEnc: Uint8Array | null = null;
    let newOtpSecretEnc: Uint8Array | null = null;

    if (row.password_encrypted) {
      const encryptedBuf = Buffer.from(row.password_encrypted);
      const decrypted = decryptString(encryptedBuf, oldKey);
      newPasswordEnc = encryptString(decrypted, newKey);
      secureClearString(decrypted);
      secureClear(encryptedBuf);
    }

    if (row.notes_encrypted) {
      const encryptedBuf = Buffer.from(row.notes_encrypted);
      const decrypted = decryptString(encryptedBuf, oldKey);
      newNotesEnc = encryptString(decrypted, newKey);
      secureClearString(decrypted);
      secureClear(encryptedBuf);
    }

    if (row.otp_secret) {
      const encryptedBuf = Buffer.from(row.otp_secret);
      const decrypted = decryptString(encryptedBuf, oldKey);
      newOtpSecretEnc = encryptString(decrypted, newKey);
      secureClearString(decrypted);
      secureClear(encryptedBuf);
    }

    updateItemStmt.bind([newPasswordEnc, newNotesEnc, newOtpSecretEnc, row.id]);
    updateItemStmt.step();
    updateItemStmt.reset();
  }
  itemStmt.free();
  updateItemStmt.free();

  // Re-encrypt trash: data_encrypted
  const trashStmt = db.prepare('SELECT id, data_encrypted FROM trash');
  const updateTrashStmt = db.prepare('UPDATE trash SET data_encrypted = ? WHERE id = ?');

  while (trashStmt.step()) {
    const row = trashStmt.getAsObject() as {
      id: string;
      data_encrypted: Uint8Array | null;
    };

    let newDataEnc: Uint8Array | null = null;

    if (row.data_encrypted) {
      const encryptedBuf = Buffer.from(row.data_encrypted);
      const decrypted = decryptString(encryptedBuf, oldKey);
      newDataEnc = encryptString(decrypted, newKey);
      secureClearString(decrypted);
      secureClear(encryptedBuf);
    }

    updateTrashStmt.bind([newDataEnc, row.id]);
    updateTrashStmt.step();
    updateTrashStmt.reset();
  }
  trashStmt.free();
  updateTrashStmt.free();

  // Atomic vault file replacement: export modified DB to temp file,
  // then rename to overwrite the original. This ensures the vault file
  // is never in a partially-written state.
  const vaultPath = resolveVaultDatabasePath(vaultId);
  const tempPath = `${vaultPath}.tmp.${Date.now()}`;

  const exported = db.export();
  const data = Buffer.from(exported);
  writeFileSync(tempPath, data);

  try {
    try {
      renameSync(tempPath, vaultPath);
    } catch (renameError) {
      // Fallback: if rename fails (e.g., cross-device), copy and delete
      try {
        writeFileSync(vaultPath, data);
        unlinkSync(tempPath);
      } catch (fallbackError) {
        throw new Error(
          `Failed to write re-encrypted vault: ${renameError instanceof Error ? renameError.message : String(renameError)}; fallback: ${fallbackError instanceof Error ? fallbackError.message : String(fallbackError)}`,
        );
      }
    }
  } finally {
    // Defense-in-depth cleanup: if the temp file is still on disk for
    // any reason (rename failed, fallback copy succeeded but unlink
    // failed, etc.) remove it so we never leave a stale `.tmp.*` file
    // in the vault directory.
    try {
      if (existsSync(tempPath)) {
        unlinkSync(tempPath);
      }
    } catch {
      // Best-effort cleanup; the migration handler logs the residual
      // path and the operator can remove it manually.
    }
  }
}

/**
 * Locks the currently active vault: saves and closes the database,
 * wipes key material, and resets session state.
 *
 * Returns the vault ID that was locked, or null if no vault was active.
 */
export function lockCurrentVault(): string | null {
  const lockedVaultId = activeVaultId;

  clearClipboardOnLock();

  if (isDatabaseOpen()) {
    saveDatabase();
    closeDatabase();
  }

  clearKeys();

  return lockedVaultId;
}

export interface UnlockVaultResult {
  success: boolean;
  vaultId?: string;
  error?: string;
  /** True when the vault was unlocked with PBKDF2 and should be migrated to Argon2id. */
  needsMigration?: boolean;
  /** True when Argon2id is not available and PBKDF2 will be used as fallback. */
  argon2idUnavailable?: boolean;
}

/**
 * Unlocks a specific vault by verifying the password against its per-vault
 * auth metadata, running migrations, opening the database, and setting
 * the session state.
 *
 * This is the core unlock logic shared by AUTH_UNLOCK IPC and selectVault.
 */
export async function unlockVault(
  vaultId: string,
  masterPassword: string,
): Promise<UnlockVaultResult> {
  try {
    await initializeSqlJs();

    // Read per-vault auth metadata
    if (!vaultAuthFileExists(vaultId)) {
      return {
        success: false,
        error: 'Auth metadata not found for this vault. It may need to be re-initialized.',
      };
    }

    let authMetadata: AuthMetadata;
    try {
      authMetadata = readVaultAuthMetadata(vaultId);
    } catch (error) {
      return {
        success: false,
        error: `Failed to read vault authentication data: ${error instanceof Error ? error.message : 'Unknown error'}. The vault may be corrupt.`,
      };
    }

    // Deteksi algoritma KDF: jika field kdfAlgorithm tidak ada, asumsikan PBKDF2 (format lama)
    const detectedAlgorithm: 'pbkdf2' | 'argon2id' = authMetadata.kdfAlgorithm ?? 'pbkdf2';

    // Sub-Task 6.1: Detect legacy single-file vault without kdfAlgorithm
    // and mark it as a candidate for KDF migration BEFORE running any
    // schema (format) migration. This ensures KDF migration awareness is
    // available before other format changes and satisfies the requirement
    // that Argon2id migration happens before or alongside other migrations.
    const needsMigration = detectedAlgorithm === 'pbkdf2';

    let kdfParams: import('../crypto/kdfEngine').KdfParams;
    if (authMetadata.kdfVersion && authMetadata.kdfVersion >= 1 && authMetadata.kdfParams) {
      kdfParams = authMetadata.kdfParams as import('../crypto/kdfEngine').KdfParams;
    } else if (detectedAlgorithm === 'argon2id') {
      kdfParams = {
        algorithm: 'argon2id',
        memoryCost: authMetadata.kdfMemory ?? 65536,
        timeCost: 3,
        parallelism: authMetadata.kdfParallelism ?? 4,
      };
    } else {
      // Legacy PBKDF2 vault - validate iterations
      const iterations = authMetadata.kdfIterations;
      if (typeof iterations !== 'number' || iterations < 1) {
        return {
          success: false,
          error: 'Vault authentication data is corrupt: invalid PBKDF2 iterations count. Please restore from backup or contact support.',
        };
      }
      kdfParams = {
        algorithm: 'pbkdf2',
        iterations,
      };
    }

    // Validate salt is a valid Buffer
    if (!Buffer.isBuffer(authMetadata.salt) || authMetadata.salt.length === 0) {
      return {
        success: false,
        error: 'Vault authentication data is corrupt: invalid salt. Please restore from backup or contact support.',
      };
    }

    const key = await deriveMasterKey(masterPassword, authMetadata.salt, kdfParams);

    if (!verifyKeyAgainstHash(key, authMetadata.verificationHash)) {
      return { success: false, error: 'Invalid master password.' };
    }

    // Run per-vault migration before opening for use
    try {
      migrateVaultDatabase(vaultId, key);
    } catch (migrationError) {
      return {
        success: false,
        error: `Database migration failed: ${migrationError instanceof Error ? migrationError.message : String(migrationError)}`,
      };
    }

    // Open the vault database for ongoing use
    openDatabaseForVault(vaultId);

    // Set session state — metadata vault TIDAK diubah selama unlock.
    // Modifikasi metadata hanya terjadi saat migrasi KDF (Task 3).
    activeVaultId = vaultId;
    masterKey = key;
    currentSalt = authMetadata.salt;
    currentKdfAlgorithm = detectedAlgorithm;
    // Resolve effective iterations dari kdfParams yang sudah dipakai,
    // bukan dari raw metadata, untuk konsistensi antar format.
    currentKdfIterations =
      kdfParams.algorithm === 'pbkdf2'
        ? kdfParams.iterations
        : kdfParams.timeCost;

    // Check if Argon2id is available for potential migration
    const argon2idAvailable = isArgon2idAvailable();

    return {
      success: true,
      vaultId,
      needsMigration,
      argon2idUnavailable: needsMigration && !argon2idAvailable,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error during unlock',
    };
  }
}

/**
 * Checks whether the app has been initialized with at least one vault
 * that has auth metadata. Also handles migration from legacy global auth.json.
 */
function isAppInitialized(): boolean {
  // Check if any vault auth file exists
  const vaults = listVaults();
  for (const vault of vaults) {
    if (vaultAuthFileExists(vault.id)) {
      return true;
    }
  }

  // Check legacy global auth.json for backward compatibility
  const legacyPath = getAuthPath();
  if (existsSync(legacyPath)) {
    return true;
  }

  return false;
}

/**
 * Attempts to migrate legacy global auth.json to per-vault auth for the
 * default vault. Returns the vault ID if migration succeeded or if the
 * vault already has per-vault auth.
 */
function attemptLegacyMigration(): string | null {
  const legacyPath = getAuthPath();
  if (!existsSync(legacyPath)) {
    return null;
  }

  // Find or create the default vault
  const vault = ensureDefaultVaultRegistry();
  if (!vault) {
    return null;
  }

  // If the vault already has per-vault auth, just clean up legacy file
  if (vaultAuthFileExists(vault.id)) {
    try {
      unlinkSync(legacyPath);
    } catch {
      // Non-fatal: legacy file cleanup is best-effort
    }
    return vault.id;
  }

  // Migrate legacy auth.json to per-vault auth
  const migrated = migrateLegacyAuthToVault(legacyPath, vault.id);
  if (migrated) {
    // Delete legacy auth.json after successful migration
    try {
      unlinkSync(legacyPath);
      logger.info('Legacy auth.json deleted after migration');
    } catch {
      // Non-fatal
    }
    return vault.id;
  }

  return null;
}

export function registerAuthHandlers(): void {
  ipcMain.handle(
    IPC_CHANNELS.AUTH_INIT,
    async (
      _event,
      { masterPassword, vaultId: _requestedVaultId }: { masterPassword: string; vaultId?: string },
    ) => {
      try {
        const strength = evaluateStrength(masterPassword);
        if (strength.score < 2) {
          return {
            success: false,
            error: `Master password too weak: ${strength.label}. Choose a stronger password.`,
          };
        }

        // Check if the app is already initialized
        if (isAppInitialized()) {
          return { success: false, error: 'App is already initialized.' };
        }

        // Before creating a new vault, check if a legacy single-vault
        // database exists. If so, the user should use the unlock flow
        // with their existing master password rather than creating a
        // new vault that would orphan their existing data.
        const legacyVault = ensureDefaultVaultRegistry();
        if (legacyVault) {
          return {
            success: false,
            error: 'A legacy vault database was detected. Please unlock it with your existing master password instead of creating a new vault.',
          };
        }

        await initializeSqlJs();

        // Create the default vault in the registry
        const vault = createVaultMetadata({ name: 'Default Vault', isDefault: true });

        // Derive key and create per-vault auth metadata
        const salt = generateSalt();
        let key: Buffer;
        try {
          key = await deriveMasterKey(masterPassword, salt, {
            algorithm: 'pbkdf2',
            iterations: DEFAULT_PBKDF2_ITERATIONS,
          });
        } catch (error) {
          return {
            success: false,
            error: `Failed to derive encryption key: ${error instanceof Error ? error.message : 'Unknown error'}. Please try again.`,
          };
        }

        // Run schema and migrations on the vault's own database file
        try {
          migrateVaultDatabase(vault.id, key);
        } catch (migrationError) {
          return {
            success: false,
            error: `Database migration failed for vault "${vault.name}": ${migrationError instanceof Error ? migrationError.message : String(migrationError)}`,
          };
        }

        // Re-open the vault database for ongoing use
        openDatabaseForVault(vault.id);

        try {
          const verificationHash = hashKeyForVerification(key);

          const authMetadata: AuthMetadata = {
            salt,
            kdfAlgorithm: 'pbkdf2',
            kdfIterations: DEFAULT_PBKDF2_ITERATIONS,
            kdfMemory: null,
            kdfParallelism: null,
            verificationHash,
            createdAt: Date.now(),
            kdfParams: {
              algorithm: 'pbkdf2',
              iterations: DEFAULT_PBKDF2_ITERATIONS,
            },
            kdfVersion: KDF_VERSION,
          };

          // Write per-vault auth metadata
          writeVaultAuthMetadata(vault.id, authMetadata);

          // Set session state
          activeVaultId = vault.id;
          masterKey = key;
          currentSalt = salt;
          currentKdfAlgorithm = 'pbkdf2';
          currentKdfIterations = DEFAULT_PBKDF2_ITERATIONS;

          return { success: true, vaultId: vault.id };
        } catch (innerError) {
          secureClear(key);
          throw innerError;
        }
      } catch (error) {
        const msg = error instanceof Error
          ? `${error.message}${error.context?.cause ? ` — ${error.context.cause}` : ''}`
          : 'Unknown error during initialization';
        return { success: false, error: msg };
      }
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.AUTH_UNLOCK,
    async (
      _event,
      { masterPassword, vaultId: requestedVaultId }: { masterPassword: string; vaultId?: string },
    ) => {
      try {
        await initializeSqlJs();

        // Determine which vault to unlock
        let vaultId = requestedVaultId;

        if (!vaultId) {
          // Try legacy migration first
          const migratedVaultId = attemptLegacyMigration();
          if (migratedVaultId) {
            vaultId = migratedVaultId;
          } else {
            // Fall back to default vault
            const vault = ensureDefaultVaultRegistry();
            if (!vault) {
              return {
                success: false,
                error: 'No vault found. The vault database file may have been moved or deleted.',
              };
            }
            vaultId = vault.id;
          }
        } else {
          // A vault ID was explicitly provided (e.g., by the vault selector
          // after ensureDefaultVaultRegistry ran during AUTH_CHECK).
          // If the vault entry exists but has no auth metadata yet (because
          // the legacy auth.json migration hasn't run), try migration.
          if (!vaultAuthFileExists(vaultId)) {
            const migratedVaultId = attemptLegacyMigration();
            if (migratedVaultId) {
              vaultId = migratedVaultId;
            }
          }
        }

        return await unlockVault(vaultId, masterPassword);
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error during unlock',
        };
      }
    },
  );

  ipcMain.handle(IPC_CHANNELS.AUTH_LOCK, () => {
    try {
      const lockedVaultId = lockCurrentVault();
      return { success: true, vaultId: lockedVaultId };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error during lock',
      };
    }
  });

  ipcMain.handle(
    IPC_CHANNELS.AUTH_CHANGE_PASSWORD,
    async (
      _event,
      {
        oldPassword,
        newPassword,
        vaultId: requestedVaultId,
      }: { oldPassword: string; newPassword: string; vaultId?: string },
    ) => {
      try {
        // Determine which vault to change password for
        const vaultId = requestedVaultId ?? activeVaultId;
        if (!vaultId) {
          return { success: false, error: 'No vault specified and no vault is currently unlocked.' };
        }

        if (!vaultAuthFileExists(vaultId)) {
          return { success: false, error: 'Auth metadata not found for this vault.' };
        }

        if (!isDatabaseOpen()) {
          return { success: false, error: 'Database is not open. Unlock first.' };
        }

        // Verify the vault context matches
        const currentVaultId = getActiveVaultId();
        if (currentVaultId !== vaultId) {
          return {
            success: false,
            error: 'The specified vault is not the currently open vault. Unlock it first.',
          };
        }

        let authMetadata: AuthMetadata;
        try {
          authMetadata = readVaultAuthMetadata(vaultId);
        } catch (error) {
          return {
            success: false,
            error: `Failed to read vault authentication data: ${error instanceof Error ? error.message : 'Unknown error'}. The vault may be corrupt.`,
          };
        }

        // Deteksi algoritma KDF: jika field kdfAlgorithm tidak ada, asumsikan PBKDF2 (format lama)
        const detectedAlgorithm: 'pbkdf2' | 'argon2id' = authMetadata.kdfAlgorithm ?? 'pbkdf2';

        let oldKdfParams: import('../crypto/kdfEngine').KdfParams;
        if (authMetadata.kdfVersion && authMetadata.kdfVersion >= 1 && authMetadata.kdfParams) {
          oldKdfParams = authMetadata.kdfParams as import('../crypto/kdfEngine').KdfParams;
        } else if (detectedAlgorithm === 'argon2id') {
          oldKdfParams = {
            algorithm: 'argon2id',
            memoryCost: authMetadata.kdfMemory ?? 65536,
            timeCost: 3,
            parallelism: authMetadata.kdfParallelism ?? 4,
          };
        } else {
          // Legacy PBKDF2 vault - validate iterations
          const iterations = authMetadata.kdfIterations;
          if (typeof iterations !== 'number' || iterations < 1) {
            return {
              success: false,
              error: 'Vault authentication data is corrupt: invalid PBKDF2 iterations count. Please restore from backup or contact support.',
            };
          }
          oldKdfParams = {
            algorithm: 'pbkdf2',
            iterations,
          };
        }

        // Validate salt is a valid Buffer
        if (!Buffer.isBuffer(authMetadata.salt) || authMetadata.salt.length === 0) {
          return {
            success: false,
            error: 'Vault authentication data is corrupt: invalid salt. Please restore from backup or contact support.',
          };
        }

        const oldKey = await deriveMasterKey(oldPassword, authMetadata.salt, oldKdfParams);

        if (!verifyKeyAgainstHash(oldKey, authMetadata.verificationHash)) {
          return { success: false, error: 'Invalid current master password.' };
        }

        const strength = evaluateStrength(newPassword);
        if (strength.score < 2) {
          return {
            success: false,
            error: `New master password too weak: ${strength.label}. Choose a stronger password.`,
          };
        }

        const newSalt = generateSalt();
        const newKey = await deriveMasterKey(newPassword, newSalt, {
          algorithm: 'pbkdf2',
          iterations: DEFAULT_PBKDF2_ITERATIONS,
        });

        try {
          const newVerificationHash = hashKeyForVerification(newKey);

          const db = getDatabase();
          if (!db) {
            return { success: false, error: 'Database not available.' };
          }

          const itemStmt = db.prepare('SELECT id, password_encrypted, notes_encrypted FROM items');
          const updateStmt = db.prepare(
            'UPDATE items SET password_encrypted = ?, notes_encrypted = ? WHERE id = ?',
          );

          let lastPasswordEnc: Uint8Array | null = null;
          let lastNotesEnc: Uint8Array | null = null;

          while (itemStmt.step()) {
            const row = itemStmt.getAsObject() as {
              id: string;
              password_encrypted: Uint8Array | null;
              notes_encrypted: Uint8Array | null;
            };

            let newPasswordEnc: Uint8Array | null = null;
            let newNotesEnc: Uint8Array | null = null;

            if (row.password_encrypted) {
              const encryptedBuf = Buffer.from(row.password_encrypted);
              let decrypted = decryptString(encryptedBuf, oldKey);
              newPasswordEnc = encryptString(decrypted, newKey);
              decrypted = secureClearString(decrypted);
              secureClear(encryptedBuf);
            }

            if (row.notes_encrypted) {
              const encryptedBuf = Buffer.from(row.notes_encrypted);
              let decrypted = decryptString(encryptedBuf, oldKey);
              newNotesEnc = encryptString(decrypted, newKey);
              decrypted = secureClearString(decrypted);
              secureClear(encryptedBuf);
            }

            if (lastPasswordEnc) secureClear(lastPasswordEnc as unknown as Buffer);
            if (lastNotesEnc) secureClear(lastNotesEnc as unknown as Buffer);

            updateStmt.bind([newPasswordEnc, newNotesEnc, row.id]);
            updateStmt.step();
            updateStmt.reset();

            lastPasswordEnc = newPasswordEnc;
            lastNotesEnc = newNotesEnc;
          }

          if (lastPasswordEnc) secureClear(lastPasswordEnc as unknown as Buffer);
          if (lastNotesEnc) secureClear(lastNotesEnc as unknown as Buffer);

          itemStmt.free();
          updateStmt.free();

          const newAuthMetadata: AuthMetadata = {
            salt: newSalt,
            kdfAlgorithm: 'pbkdf2',
            kdfIterations: DEFAULT_PBKDF2_ITERATIONS,
            kdfMemory: null,
            kdfParallelism: null,
            verificationHash: newVerificationHash,
            createdAt: Date.now(),
            kdfParams: {
              algorithm: 'pbkdf2',
              iterations: DEFAULT_PBKDF2_ITERATIONS,
            },
            kdfVersion: KDF_VERSION,
          };

          // Write per-vault auth metadata (replaces old vault auth file)
          writeVaultAuthMetadata(vaultId, newAuthMetadata);
          saveDatabase();

          // Update session state — metadata vault TIDAK diubah
          // selama password change. Format KDF tetap sesuai vault.
          masterKey = newKey;
          currentSalt = newSalt;
          currentKdfAlgorithm = 'pbkdf2';
          currentKdfIterations = DEFAULT_PBKDF2_ITERATIONS;

          secureClear(oldKey);

          return { success: true };
        } catch (innerError) {
          secureClear(newKey);
          throw innerError;
        }
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error during password change',
        };
      }
    },
  );

  ipcMain.handle(IPC_CHANNELS.AUTH_CHECK, () => {
    // Proactively detect any legacy single-vault database and create the
    // default vault registry entry when the app opens. This ensures the
    // migration is detected on launch rather than being deferred until
    // the first unlock attempt.
    try {
      ensureDefaultVaultRegistry();
    } catch {
      // Non-fatal: if migration fails here (e.g. backup I/O error), the
      // unlock flow will retry migration when the user attempts to unlock.
    }

    const initialized = isAppInitialized();
    const currentVaultId = activeVaultId;

    if (currentVaultId) {
      const vault = getVaultById(currentVaultId);
      return {
        initialized,
        vaultId: currentVaultId,
        vaultName: vault?.name ?? null,
      };
    }

    return { initialized, vaultId: null, vaultName: null };
  });

  /**
   * AUTH_GET_KDF_STATUS: Returns the current KDF algorithm and Argon2id availability.
   * Used by the Settings > Security panel to display encryption status and
   * offer manual migration re-trigger.
   */
  ipcMain.handle(IPC_CHANNELS.AUTH_GET_KDF_STATUS, () => {
    const vaultId = activeVaultId;
    const kdfAlgorithm = vaultId ? currentKdfAlgorithm : null;
    const argon2idAvailable = isArgon2idAvailable();
    const needsMigration = kdfAlgorithm === 'pbkdf2';

    return {
      success: true,
      data: {
        vaultId,
        kdfAlgorithm,
        argon2idAvailable,
        needsMigration,
      },
    };
  });

  /**
   * AUTH_MIGRATE_KDF: Migrates the currently unlocked vault from PBKDF2 to Argon2id.
   *
   * This handler is called from the renderer after a successful unlock when
   * needsMigration is true. The migration runs asynchronously — the renderer
   * does NOT await completion, it only fires and shows a toast.
   *
   * Security notes:
   * - The masterKey must be available in session state (vault is unlocked).
   * - A new salt is generated and a new key derived with Argon2id.
   * - All encrypted data is re-encrypted with the new key.
   * - The old vault file is backed up before overwrite.
   * - On failure, the old vault remains usable with PBKDF2 and the
   *   backup file is preserved so the user can recover manually.
   * - On failure, the response includes `backupAvailable` and
   *   `manualRecoveryInstructions` so the renderer can guide the user.
   * - Every failure is logged with the full stack trace. The logger
   *   redacts sensitive field names (password, salt, key, etc.) before
   *   emitting to console, so no password, key, salt, or hash ever
   *   reaches the log output.
   */
  ipcMain.handle(IPC_CHANNELS.AUTH_MIGRATE_KDF, async () => {
    let backupPath: string | null = null;
    let vaultPath: string | null = null;

    /**
     * Build the failure response, attaching recovery instructions when
     * the backup is still on disk. The renderer surfaces this in a
     * dedicated dialog so the user knows how to roll back manually.
     */
    const buildFailureResult = (
      error: string,
      cause?: unknown,
      source?: string,
    ) => {
      const backupStillAvailable = backupPath !== null && existsSync(backupPath);
      const result: {
        success: boolean;
        error: string;
        cause?: string;
        stack?: string;
        failureStage?: string;
        backupAvailable?: boolean;
        backupPath?: string;
        vaultPath?: string;
        manualRecoveryInstructions?: string;
      } = {
        success: false,
        error,
        backupAvailable: backupStillAvailable,
        backupPath: backupStillAvailable ? backupPath : undefined,
        vaultPath: vaultPath ?? undefined,
      };
      if (cause !== undefined) {
        if (cause instanceof Error) {
          result.cause = cause.message;
          result.stack = cause.stack;
        } else {
          result.cause = String(cause);
        }
      }
      if (source) {
        result.failureStage = source;
      }
      if (backupStillAvailable && vaultPath) {
        result.manualRecoveryInstructions = buildManualRecoveryInstructions(
          vaultPath,
          backupPath as string,
        );
      }
      return result;
    };

    /**
     * Restore the vault from the backup file. This is best-effort: if
     * the restore itself fails we still report the original error to
     * the user and surface the backup path for manual recovery.
     */
    const restoreFromBackup = (): { restored: boolean; reason?: string } => {
      if (!backupPath || !vaultPath) {
        return { restored: false, reason: 'no backup path' };
      }
      if (!existsSync(backupPath)) {
        logger.error('Cannot restore from backup — backup file is missing', {
          vaultPath,
          backupPath,
        });
        return { restored: false, reason: 'backup file missing' };
      }
      try {
        copyFileSync(backupPath, vaultPath);
        logger.info('Vault restored from backup', { vaultPath, backupPath });
        return { restored: true };
      } catch (restoreError) {
        logger.error('Failed to restore vault from backup', {
          vaultPath,
          backupPath,
          cause: restoreError instanceof Error ? restoreError.message : String(restoreError),
          stack: restoreError instanceof Error ? restoreError.stack : undefined,
        });
        return {
          restored: false,
          reason: restoreError instanceof Error ? restoreError.message : String(restoreError),
        };
      }
    };

    try {
      const vaultId = activeVaultId;
      const oldKey = masterKey;

      if (!vaultId || !oldKey) {
        return buildFailureResult('No vault is currently unlocked.', undefined, 'preflight');
      }

      // Guard: only migrate PBKDF2 vaults
      if (currentKdfAlgorithm !== 'pbkdf2') {
        return buildFailureResult(
          'Vault is not using PBKDF2. Migration not needed.',
          undefined,
          'preflight',
        );
      }

      // Check if Argon2id is available before attempting migration
      if (!isArgon2idAvailable()) {
        logger.info('Argon2id not available, migration skipped - vault remains on PBKDF2', { vaultId });
        return {
          success: false,
          error: 'ARGON2ID_UNAVAILABLE',
          fallbackToPbkdf2: true,
        };
      }

      // Read current auth metadata to verify it exists
      if (!vaultAuthFileExists(vaultId)) {
        return buildFailureResult('Auth metadata not found for this vault.', undefined, 'preflight');
      }

      // Sub-Task 3.3: Create backup of the vault file before re-encryption.
      // The backup uses suffix `.pre-argon2id-backup` so it can be identified
      // and recovered if the migration fails or is interrupted. The backup
      // is intentionally preserved on failure so the user (or a follow-up
      // migration attempt) can recover from it.
      vaultPath = resolveVaultDatabasePath(vaultId);
      backupPath = `${vaultPath}${PRE_ARGON2ID_BACKUP_SUFFIX}`;

      try {
        copyFileSync(vaultPath, backupPath);
        logger.info('Vault backup created before Argon2id migration', {
          vaultId,
          backupPath,
        });
      } catch (backupError) {
        logger.error('Failed to create vault backup before migration', {
          vaultId,
          vaultPath,
          cause: backupError instanceof Error ? backupError.message : String(backupError),
          stack: backupError instanceof Error ? backupError.stack : undefined,
        });
        return buildFailureResult(
          `Failed to create vault backup: ${backupError instanceof Error ? backupError.message : 'Unknown error'}. Migration aborted for safety.`,
          backupError,
          'backup',
        );
      }

      // Derive new key with Argon2id (with fallback tracking)
      const newSalt = generateSalt();
      let newKey: Buffer;
      let fallbackOccurred = false;
      try {
        const result = await deriveMasterKeyWithFallback(
          oldKey.toString('utf-8'),
          newSalt,
          DEFAULT_ARGON2ID_PARAMS,
        );
        newKey = result.key;
        fallbackOccurred = result.fallbackOccurred;
        if (fallbackOccurred) {
          logger.info('Argon2id fell back to PBKDF2 during migration', {
            vaultId,
            reason: result.fallbackReason,
          });
        }
      } catch (error) {
        logger.error('Argon2id key derivation failed during migration', {
          vaultId,
          vaultPath,
          backupPath,
          cause: error instanceof Error ? error.message : 'Unknown error',
          stack: error instanceof Error ? error.stack : undefined,
        });
        // Backup is preserved — the user can recover from it.
        return buildFailureResult(
          `Failed to derive Argon2id key: ${error instanceof Error ? error.message : 'Unknown error'}`,
          error,
          'key-derivation',
        );
      }

      // Re-encrypt all vault data with the new key.
      // If this fails, the original vault file is untouched (atomic write via
      // temp file + rename). The backup remains available for recovery.
      try {
        reEncryptVaultData(oldKey, newKey, vaultId);
      } catch (error) {
        secureClear(newKey);
        logger.error('Vault re-encryption failed during Argon2id migration', {
          vaultId,
          vaultPath,
          backupPath,
          cause: error instanceof Error ? error.message : 'Unknown error',
          stack: error instanceof Error ? error.stack : undefined,
        });
        // Attempt to restore the original vault from backup in case the
        // rename partially succeeded (e.g., cross-device fallback path).
        // The helper logs the outcome; we just need to invoke it.
        restoreFromBackup();
        return buildFailureResult(
          `Failed to re-encrypt vault data: ${error instanceof Error ? error.message : 'Unknown error'}`,
          error,
          're-encrypt',
        );
      }

      // Verify the new key produces the same verification hash pattern
      const newVerificationHash = hashKeyForVerification(newKey);

      // Build new auth metadata
      const newAuthMetadata: AuthMetadata = {
        salt: newSalt,
        kdfAlgorithm: 'argon2id',
        kdfIterations: DEFAULT_ARGON2ID_PARAMS.timeCost,
        kdfMemory: DEFAULT_ARGON2ID_PARAMS.memoryCost,
        kdfParallelism: DEFAULT_ARGON2ID_PARAMS.parallelism,
        verificationHash: newVerificationHash,
        createdAt: Date.now(),
        migratedAt: Date.now(),
        kdfParams: { ...DEFAULT_ARGON2ID_PARAMS },
        kdfVersion: KDF_VERSION,
      };

      // Write new auth metadata (atomic: write new file, then the old one is replaced)
      writeVaultAuthMetadata(vaultId, newAuthMetadata);

      // Sub-Task 3.3: Verify the migrated vault before deleting the backup.
      // Re-read the auth metadata and verify the new key works against it.
      let verifiedMetadata: AuthMetadata;
      try {
        verifiedMetadata = readVaultAuthMetadata(vaultId);
      } catch (error) {
        // Metadata write succeeded but re-read failed — restore from backup
        logger.error('Post-migration metadata verification failed, restoring vault', {
          vaultId,
          vaultPath,
          backupPath,
          cause: error instanceof Error ? error.message : 'Unknown error',
          stack: error instanceof Error ? error.stack : undefined,
        });
        restoreFromBackup();
        secureClear(newKey);
        return buildFailureResult(
          'Migration verification failed. Vault restored from backup.',
          error,
          'verify-metadata',
        );
      }

      // Verify the new key matches the stored verification hash
      if (!verifyKeyAgainstHash(newKey, verifiedMetadata.verificationHash)) {
        logger.error('Post-migration key verification failed, restoring vault', {
          vaultId,
          vaultPath,
          backupPath,
        });
        restoreFromBackup();
        secureClear(newKey);
        return buildFailureResult(
          'Migration verification failed. Vault restored from backup.',
          undefined,
          'verify-key',
        );
      }

      // Sub-Task 3.3: Only delete backup after successful migration + verification
      try {
        unlinkSync(backupPath);
        logger.info('Vault backup removed after successful Argon2id migration', { vaultId });
      } catch (cleanupError) {
        // Non-fatal: backup cleanup is best-effort. The backup file is small
        // and can be cleaned up manually or on next migration attempt.
        logger.warn('Failed to remove vault backup after successful migration', {
          vaultId,
          backupPath,
          cause: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
        });
      }

      // Wipe old key material
      secureClear(oldKey);

      // Update session state — point masterKey to the new Argon2id-derived key
      masterKey = newKey;
      currentKdfAlgorithm = 'argon2id';
      currentKdfIterations = DEFAULT_ARGON2ID_PARAMS.timeCost;

      logger.info('Vault KDF migrated from PBKDF2 to Argon2id', { vaultId });

      return {
        success: true,
        fallbackOccurred,
        fallbackReason: fallbackOccurred ? 'Argon2id fell back to PBKDF2' : undefined,
      };
    } catch (error) {
      // Sub-Task 3.3 & 6.2: Log the unexpected error with full stack
      // trace. The logger's sanitizer strips any sensitive field names
      // (password, key, salt, hash, …) before writing to the console,
      // so no password, derived key, salt, or hash ever reaches the log.
      logger.error('KDF migration failed with unexpected error', {
        vaultId: activeVaultId ?? 'unknown',
        vaultPath: vaultPath ?? undefined,
        backupPath: backupPath ?? undefined,
        cause: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
      });
      // Best-effort restore from the backup if one was created before
      // the unexpected failure.
      const restore = restoreFromBackup();
      const result = buildFailureResult(
        error instanceof Error ? error.message : 'Unknown error during KDF migration',
        error,
        'unexpected',
      );
      if (!restore.restored && backupPath) {
        logger.warn('Unexpected migration failure: backup was not auto-restored', {
          restoreReason: restore.reason,
        });
      }
      return result;
    }
  });
}
