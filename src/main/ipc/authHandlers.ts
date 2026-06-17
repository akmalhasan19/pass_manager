import { ipcMain } from 'electron';
import { existsSync, unlinkSync } from 'node:fs';
import { IPC_CHANNELS } from '../../shared/ipcChannels';
import { secureClear, secureClearString } from '../../shared/secureMemory';
import type { AuthMetadata } from '../../shared/types';
import {
  generateSalt,
  deriveMasterKey,
  hashKeyForVerification,
  verifyKeyAgainstHash,
  DEFAULT_PBKDF2_ITERATIONS,
} from '../crypto/keyDerivation';
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
import { ensureDefaultVaultRegistry, createVaultMetadata } from '../file-system/storageManager';
import {
  readVaultAuthMetadata,
  writeVaultAuthMetadata,
  vaultAuthFileExists,
  migrateLegacyAuthToVault,
} from '../file-system/vaultAuthStorage';
import { listVaults, getVaultById } from '../file-system/vaultRegistry';
import { evaluateStrength } from '../crypto/passwordGenerator';
import { logger } from '../../shared/logger';

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
 * Locks the currently active vault: saves and closes the database,
 * wipes key material, and resets session state.
 *
 * Returns the vault ID that was locked, or null if no vault was active.
 */
export function lockCurrentVault(): string | null {
  const lockedVaultId = activeVaultId;

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

    const authMetadata = readVaultAuthMetadata(vaultId);
    const key = deriveMasterKey(masterPassword, authMetadata.salt, {
      algorithm: authMetadata.kdfAlgorithm,
      iterations: authMetadata.kdfIterations,
    });

    if (!verifyKeyAgainstHash(key, authMetadata.verificationHash)) {
      return { success: false, error: 'Invalid master password.' };
    }

    // Run per-vault migration before opening for use
    try {
      migrateVaultDatabase(vaultId);
    } catch (migrationError) {
      return {
        success: false,
        error: `Database migration failed: ${migrationError instanceof Error ? migrationError.message : String(migrationError)}`,
      };
    }

    // Open the vault database for ongoing use
    openDatabaseForVault(vaultId);

    // Set session state
    activeVaultId = vaultId;
    masterKey = key;
    currentSalt = authMetadata.salt;
    currentKdfAlgorithm = authMetadata.kdfAlgorithm;
    currentKdfIterations = authMetadata.kdfIterations;

    return { success: true, vaultId };
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

        // Run schema and migrations on the vault's own database file
        try {
          migrateVaultDatabase(vault.id);
        } catch (migrationError) {
          throw new Error(
            `Database migration failed for vault "${vault.name}": ${migrationError instanceof Error ? migrationError.message : String(migrationError)}`,
          );
        }

        // Re-open the vault database for ongoing use
        openDatabaseForVault(vault.id);

        // Derive key and create per-vault auth metadata
        const salt = generateSalt();
        const key = deriveMasterKey(masterPassword, salt, {
          algorithm: 'pbkdf2',
          iterations: DEFAULT_PBKDF2_ITERATIONS,
        });

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

        const authMetadata = readVaultAuthMetadata(vaultId);

        const oldKey = deriveMasterKey(oldPassword, authMetadata.salt, {
          algorithm: authMetadata.kdfAlgorithm,
          iterations: authMetadata.kdfIterations,
        });

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
        const newKey = deriveMasterKey(newPassword, newSalt, {
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
          };

          // Write per-vault auth metadata (replaces old vault auth file)
          writeVaultAuthMetadata(vaultId, newAuthMetadata);
          saveDatabase();

          // Update session state
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
}
