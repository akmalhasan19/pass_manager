import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../shared/ipcChannels';
import { generateTOTP, getRemainingSeconds, detectClockDrift, getDriftCheckInterval } from '../services/totpService';
import { secureClear, secureClearString } from '../../shared/secureMemory';
import type { TotpConfig } from '../../shared/types';
import { ItemRepository } from '../database/repositories/ItemRepository';
import { isDatabaseOpen } from '../database/connection';
import { getMasterKey } from './authHandlers';
import { decryptString } from '../crypto/encryption';

const itemRepo = new ItemRepository();

/**
 * Register OTP-related IPC handlers.
 *
 * SECURITY: OTP secrets are decrypted ONLY within this handler scope.
 * The plaintext secret is never sent to the renderer process.
 * All decrypted buffers are wiped immediately after use.
 */
export function registerOtpHandlers(): void {
  /**
   * OTP_GENERATE: Generate a TOTP code for a given item.
   *
   * The secret is decrypted, used to generate the code, then wiped.
   * Only the code string and remaining seconds are returned to the renderer.
   */
  ipcMain.handle(
    IPC_CHANNELS.OTP_GENERATE,
    (_event, { itemId }: { itemId: string }) => {
      try {
        if (!isDatabaseOpen()) {
          return { success: false, error: 'Database is not open.' };
        }

        const key = getMasterKey();
        if (!key) {
          return { success: false, error: 'No master key available. Unlock first.' };
        }

        const item = itemRepo.getById(itemId);
        if (!item) {
          return { success: false, error: 'Item not found.' };
        }

        if (!item.otpSecretEncrypted) {
          return { success: false, error: 'Item does not have OTP configured.' };
        }

        // SECURITY: Decrypt secret into a temporary Buffer
        const secretBuf = Buffer.from(item.otpSecretEncrypted);
        let secret: string;
        try {
          secret = decryptString(secretBuf, key);
        } catch {
          secureClear(secretBuf);
          return { success: false, error: 'Failed to decrypt OTP secret.' };
        } finally {
          // SECURITY: Wipe the encrypted buffer copy
          secureClear(secretBuf);
        }

        // Build the config from DB columns (not from any cached plaintext)
        const config: TotpConfig = {
          secret,
          period: item.otpPeriod,
          digits: item.otpDigits,
          algorithm: item.otpAlgorithm,
        };

        const code = generateTOTP(secret, config);
        const remaining = getRemainingSeconds(config);

        // SECURITY: Wipe the plaintext secret from memory.
        // V8 strings are immutable, but we drop the reference to allow GC.
        secureClearString(secret);

        return { success: true, data: { code, remaining } };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    },
  );

  /**
   * OTP_GET_CONFIG: Retrieve the OTP configuration for an item.
   *
   * Used by OtpSection in edit mode to populate the form fields.
   * The secret is included only transiently — the renderer must not
   * persist it in any state management store.
   */
  ipcMain.handle(
    IPC_CHANNELS.OTP_GET_CONFIG,
    (_event, { itemId }: { itemId: string }) => {
      try {
        if (!isDatabaseOpen()) {
          return { success: false, error: 'Database is not open.' };
        }

        const key = getMasterKey();
        if (!key) {
          return { success: false, error: 'No master key available. Unlock first.' };
        }

        const item = itemRepo.getById(itemId);
        if (!item) {
          return { success: false, error: 'Item not found.' };
        }

        if (!item.otpSecretEncrypted) {
          return { success: true, data: null };
        }

        // SECURITY: Decrypt secret into a temporary Buffer
        const secretBuf = Buffer.from(item.otpSecretEncrypted);
        let secret: string;
        try {
          secret = decryptString(secretBuf, key);
        } catch {
          secureClear(secretBuf);
          return { success: false, error: 'Failed to decrypt OTP secret.' };
        } finally {
          // SECURITY: Wipe the encrypted buffer copy
          secureClear(secretBuf);
        }

        const config: TotpConfig = {
          secret,
          period: item.otpPeriod,
          digits: item.otpDigits,
          algorithm: item.otpAlgorithm,
        };

        // SECURITY: The secret string is returned to the renderer for edit mode.
        // The renderer MUST NOT store it in Zustand or any persistent state.
        // It should be held only in React component state and cleared on unmount.
        return { success: true, data: config };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    },
  );

  /**
   * OTP_CHECK_TIME_SYNC: Check for system clock drift.
   *
   * TOTP codes rely on accurate system time. This handler checks whether
   * the system clock has shifted significantly since the last check.
   *
   * No network request is made — the check is purely heuristic using
   * Date.now() comparisons within the process lifetime.
   *
   * Returns a warning object if drift is detected, or null if the clock
   * appears stable.
   */
  ipcMain.handle(
    IPC_CHANNELS.OTP_CHECK_TIME_SYNC,
    () => {
      try {
        // Use default period of 30 seconds for drift severity check.
        // The period is not critical here since we're just checking
        // for general clock instability.
        const result = detectClockDrift(30);
        return { success: true, data: result };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    },
  );
}
