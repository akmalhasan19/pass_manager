import { ipcMain } from 'electron';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
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
  openDatabase,
  closeDatabase,
  saveDatabase,
  getDatabase,
  isDatabaseOpen,
} from '../database/connection';
import { initializeDatabase, authFileExists, getAuthPath } from '../database/migrations';
import { evaluateStrength } from '../crypto/passwordGenerator';

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

function readAuthMetadata(): AuthMetadata {
  const authPath = getAuthPath();
  if (!existsSync(authPath)) {
    throw new Error('App not initialized. Auth metadata not found.');
  }
  const raw = readFileSync(authPath, 'utf-8');
  const parsed = JSON.parse(raw);
  return {
    ...parsed,
    salt: Buffer.from(parsed.salt, 'base64'),
  };
}

function writeAuthMetadata(metadata: AuthMetadata): void {
  const authPath = getAuthPath();
  const obj = {
    ...metadata,
    salt: metadata.salt.toString('base64'),
  };
  writeFileSync(authPath, JSON.stringify(obj, null, 2), 'utf-8');
}

export function clearKeys(): void {
  // Security: securely overwrite buffers before releasing references
  // This prevents sensitive key material from lingering in memory after
  // the application is locked or the key is no longer needed.
  secureClear(masterKey);
  secureClear(currentSalt);
  masterKey = null;
  currentSalt = null;
  currentKdfAlgorithm = 'pbkdf2';
  currentKdfIterations = DEFAULT_PBKDF2_ITERATIONS;
}

export function registerAuthHandlers(): void {
  ipcMain.handle(
    IPC_CHANNELS.AUTH_INIT,
    async (_event, { masterPassword }: { masterPassword: string }) => {
      try {
        const strength = evaluateStrength(masterPassword);
        if (strength.score < 2) {
          return {
            success: false,
            error: `Master password too weak: ${strength.label}. Choose a stronger password.`,
          };
        }

        if (authFileExists()) {
          return { success: false, error: 'App is already initialized.' };
        }

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

          await initializeSqlJs();
          openDatabase();
          initializeDatabase();
          saveDatabase();
          writeAuthMetadata(authMetadata);

          masterKey = key;
          currentSalt = salt;
          currentKdfAlgorithm = 'pbkdf2';
          currentKdfIterations = DEFAULT_PBKDF2_ITERATIONS;

          return { success: true };
        } catch (innerError) {
          // SECURITY: Wipe derived key if anything fails before it's stored
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
    async (_event, { masterPassword }: { masterPassword: string }) => {
      try {
        if (!authFileExists()) {
          return { success: false, error: 'App not initialized. Please set up first.' };
        }

        const authMetadata = readAuthMetadata();
        const key = deriveMasterKey(masterPassword, authMetadata.salt, {
          algorithm: authMetadata.kdfAlgorithm,
          iterations: authMetadata.kdfIterations,
        });

        if (!verifyKeyAgainstHash(key, authMetadata.verificationHash)) {
          return { success: false, error: 'Invalid master password.' };
        }

        await initializeSqlJs();
        openDatabase();

        masterKey = key;
        currentSalt = authMetadata.salt;
        currentKdfAlgorithm = authMetadata.kdfAlgorithm;
        currentKdfIterations = authMetadata.kdfIterations;

        return { success: true };
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
      if (isDatabaseOpen()) {
        saveDatabase();
        closeDatabase();
      }

      clearKeys();

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error during lock',
      };
    }
  });

  ipcMain.handle(
    IPC_CHANNELS.AUTH_CHANGE_PASSWORD,
    async (_event, { oldPassword, newPassword }: { oldPassword: string; newPassword: string }) => {
      try {
        if (!authFileExists()) {
          return { success: false, error: 'App not initialized.' };
        }

        if (!isDatabaseOpen()) {
          return { success: false, error: 'Database is not open. Unlock first.' };
        }

        const authMetadata = readAuthMetadata();

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
              // SECURITY: Wipe immutable string reference — V8 strings cannot be
              // zeroed in place, but we drop the reference to allow GC collection.
              decrypted = secureClearString(decrypted);
              // SECURITY: Wipe sensitive material before leaving scope
              secureClear(encryptedBuf);
            }

            if (row.notes_encrypted) {
              const encryptedBuf = Buffer.from(row.notes_encrypted);
              let decrypted = decryptString(encryptedBuf, oldKey);
              newNotesEnc = encryptString(decrypted, newKey);
              // SECURITY: Wipe immutable string reference — V8 strings cannot be
              // zeroed in place, but we drop the reference to allow GC collection.
              decrypted = secureClearString(decrypted);
              // SECURITY: Wipe sensitive material before leaving scope
              secureClear(encryptedBuf);
            }

            // SECURITY: Wipe previous iteration's encrypted buffers before overwriting
            if (lastPasswordEnc) secureClear(lastPasswordEnc as unknown as Buffer);
            if (lastNotesEnc) secureClear(lastNotesEnc as unknown as Buffer);

            updateStmt.bind([newPasswordEnc, newNotesEnc, row.id]);
            updateStmt.step();
            updateStmt.reset();

            lastPasswordEnc = newPasswordEnc;
            lastNotesEnc = newNotesEnc;
          }

          // SECURITY: Wipe encrypted buffers from the final iteration
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

          writeAuthMetadata(newAuthMetadata);
          saveDatabase();

          masterKey = newKey;
          currentSalt = newSalt;
          currentKdfAlgorithm = 'pbkdf2';
          currentKdfIterations = DEFAULT_PBKDF2_ITERATIONS;

          // Security: securely overwrite the old key buffer to minimize key material in memory
          secureClear(oldKey);

          return { success: true };
        } catch (innerError) {
          // SECURITY: Wipe new key if anything fails before it's stored
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
    return { initialized: authFileExists() };
  });
}
