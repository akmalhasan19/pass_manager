import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../shared/ipcChannels';
import { isDatabaseOpen, getDatabase } from '../database/connection';

export function registerSettingsHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.SETTINGS_GET, (_event, { key }: { key: string }) => {
    try {
      if (!isDatabaseOpen()) {
        return { success: false, error: 'Database is not open.' };
      }

      const db = getDatabase();
      if (!db) {
        return { success: false, error: 'Database not available.' };
      }

      const stmt = db.prepare('SELECT value FROM settings WHERE key = ?');
      stmt.bind([key]);

      let value: string | null = null;
      if (stmt.step()) {
        const row = stmt.getAsObject() as { value: string };
        value = row.value;
      }
      stmt.free();

      return { success: true, data: value };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  });

  ipcMain.handle(
    IPC_CHANNELS.SETTINGS_SET,
    (_event, { key, value }: { key: string; value: string }) => {
      try {
        if (!isDatabaseOpen()) {
          return { success: false, error: 'Database is not open.' };
        }

        const db = getDatabase();
        if (!db) {
          return { success: false, error: 'Database not available.' };
        }

        db.run(
          'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
          [key, value],
        );

        return { success: true };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    },
  );

  ipcMain.handle(IPC_CHANNELS.SETTINGS_GET_ALL, () => {
    try {
      if (!isDatabaseOpen()) {
        return { success: false, error: 'Database is not open.' };
      }

      const db = getDatabase();
      if (!db) {
        return { success: false, error: 'Database not available.' };
      }

      const stmt = db.prepare('SELECT key, value FROM settings ORDER BY key ASC');
      const settings: Record<string, string> = {};

      while (stmt.step()) {
        const row = stmt.getAsObject() as { key: string; value: string };
        settings[row.key] = row.value;
      }

      stmt.free();

      return { success: true, data: settings };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  });
}
