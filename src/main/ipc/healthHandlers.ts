import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../shared/ipcChannels';
import { ItemRepository } from '../database/repositories/ItemRepository';
import { isDatabaseOpen } from '../database/connection';
import { getMasterKey } from './authHandlers';
import { decryptString } from '../crypto/encryption';
import { analyzeHealth } from '../crypto/passwordHealth';

const itemRepo = new ItemRepository();

export function registerHealthHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.HEALTH_ANALYZE, (_event, { oldDays }: { oldDays?: number } = {}) => {
    try {
      if (!isDatabaseOpen()) {
        return { success: false, error: 'Database is not open.' };
      }

      const key = getMasterKey();
      if (!key) {
        return { success: false, error: 'No master key available. Unlock first.' };
      }

      const items = itemRepo.getAll();
      const passwords = new Map<string, string>();

      for (const item of items) {
        if (item.passwordEncrypted) {
          try {
            const decrypted = decryptString(item.passwordEncrypted, key);
            passwords.set(item.id, decrypted);
          } catch {
            // Skip items that can't be decrypted
          }
        }
      }

      const report = analyzeHealth(items, passwords, { oldDays });
      return { success: true, data: report };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  });
}
