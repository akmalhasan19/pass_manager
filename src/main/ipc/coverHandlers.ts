import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../shared/ipcChannels';
import { saveCoverImage, readCoverImage, deleteCoverImage } from '../file-system/coverImageStorage';
import { getActiveVaultId } from '../database/connection';

export function registerCoverHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.COVER_UPLOAD, async (_event, { filePath }: { filePath: string }) => {
    try {
      if (!filePath) {
        return { success: false, error: 'No file path provided.' };
      }

      const vaultId = getActiveVaultId();
      if (!vaultId) {
        return { success: false, error: 'No active vault.' };
      }

      const coverName = saveCoverImage(filePath, vaultId);
      return { success: true, data: coverName };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  });

  ipcMain.handle(IPC_CHANNELS.COVER_READ, async (_event, { coverName }: { coverName: string }) => {
    try {
      if (!coverName) {
        return { success: false, error: 'No cover name provided.' };
      }

      const vaultId = getActiveVaultId();
      if (!vaultId) {
        return { success: false, error: 'No active vault.' };
      }

      const dataUrl = readCoverImage(coverName, vaultId);
      return { success: true, data: dataUrl };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  });

  ipcMain.handle(
    IPC_CHANNELS.COVER_DELETE,
    async (_event, { coverName }: { coverName: string }) => {
      try {
        if (!coverName) {
          return { success: false, error: 'No cover name provided.' };
        }

        const vaultId = getActiveVaultId();
        if (!vaultId) {
          return { success: false, error: 'No active vault.' };
        }

        deleteCoverImage(coverName, vaultId);
        return { success: true };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    },
  );
}
