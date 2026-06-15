import { create } from 'zustand';

export type AuthStatus = 'idle' | 'checking' | 'setup' | 'locked' | 'unlocked' | 'error';

interface AuthState {
  status: AuthStatus;
  error: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  checkAuth: () => Promise<void>;
  initApp: (password: string) => Promise<void>;
  unlock: (password: string) => Promise<void>;
  lock: () => Promise<void>;
  changePassword: (oldPassword: string, newPassword: string) => Promise<void>;
  clearError: () => void;
}

function deriveFlags(status: AuthStatus): { isAuthenticated: boolean; isLoading: boolean } {
  return {
    isAuthenticated: status === 'unlocked',
    isLoading: status === 'idle' || status === 'checking',
  };
}

export const useAuthStore = create<AuthState>((set) => ({
  status: 'idle',
  error: null,
  ...deriveFlags('idle'),

  checkAuth: async () => {
    set({ status: 'checking', error: null, ...deriveFlags('checking') });
    try {
      const result = await window.electron.auth.check();
      const next: AuthStatus = result.initialized ? 'locked' : 'setup';
      set({ status: next, ...deriveFlags(next) });
    } catch {
      const next: AuthStatus = 'setup';
      set({ status: next, ...deriveFlags(next) });
    }
  },

  initApp: async (password: string) => {
    set({ status: 'checking', error: null, ...deriveFlags('checking') });
    try {
      if (!window.electron) {
        throw new Error('Electron IPC not available. Please restart the application.');
      }
      const result = await window.electron.auth.init(password);
      if (!result.success) {
        set({ status: 'setup', error: result.error || 'Failed to initialize', ...deriveFlags('setup') });
        return;
      }
      set({ status: 'unlocked', error: null, ...deriveFlags('unlocked') });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to initialize';
      set({ status: 'setup', error: message, ...deriveFlags('setup') });
    }
  },

  unlock: async (password: string) => {
    set({ status: 'checking', error: null, ...deriveFlags('checking') });
    try {
      if (!window.electron) {
        throw new Error('Electron IPC not available. Please restart the application.');
      }
      const result = await window.electron.auth.unlock(password);
      if (!result.success) {
        set({ status: 'locked', error: result.error || 'Incorrect master password', ...deriveFlags('locked') });
        return;
      }
      set({ status: 'unlocked', error: null, ...deriveFlags('unlocked') });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to unlock';
      set({ status: 'locked', error: message, ...deriveFlags('locked') });
    }
  },

  lock: async () => {
    set({ status: 'checking', ...deriveFlags('checking') });
    try {
      if (window.electron) {
        await window.electron.auth.lock();
      }
    } catch {
      // Lock should always proceed even if IPC fails
    } finally {
      set({ status: 'locked', error: null, ...deriveFlags('locked') });
    }
  },

  changePassword: async (oldPassword: string, newPassword: string) => {
    set({ error: null });
    try {
      if (!window.electron) {
        throw new Error('Electron IPC not available. Please restart the application.');
      }
      await window.electron.auth.changePassword(oldPassword, newPassword);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to change password';
      set({ error: message });
      throw err;
    }
  },

  clearError: () => set({ error: null }),
}));
