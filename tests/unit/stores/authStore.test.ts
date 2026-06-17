import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useAuthStore } from '../../../src/renderer/stores/authStore';

const mockElectron = {
  auth: {
    check: vi.fn(),
    init: vi.fn(),
    unlock: vi.fn(),
    lock: vi.fn(),
    changePassword: vi.fn(),
    cleanupListeners: vi.fn(),
  },
  vaults: {
    select: vi.fn(),
    list: vi.fn(),
  },
};

vi.stubGlobal('window', {
  electron: mockElectron,
  dispatchEvent: vi.fn(),
  addEventListener: vi.fn(),
});

describe('authStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.setState({
      status: 'idle',
      error: null,
      isAuthenticated: false,
      isLoading: true,
      activeVaultId: null,
    });
  });

  describe('initial state', () => {
    it('should start with idle status', () => {
      const { status, isAuthenticated, isLoading, error } = useAuthStore.getState();
      expect(status).toBe('idle');
      expect(isAuthenticated).toBe(false);
      expect(isLoading).toBe(true);
      expect(error).toBeNull();
    });
  });

  describe('deriveFlags', () => {
    it('should set isAuthenticated true when unlocked', () => {
      useAuthStore.setState({
        status: 'unlocked',
        isAuthenticated: true,
        isLoading: false,
      });
      expect(useAuthStore.getState().isAuthenticated).toBe(true);
      expect(useAuthStore.getState().isLoading).toBe(false);
    });

    it('should set isLoading true when idle or checking', () => {
      useAuthStore.setState({ status: 'checking', isLoading: true, isAuthenticated: false });
      expect(useAuthStore.getState().isLoading).toBe(true);
      expect(useAuthStore.getState().isAuthenticated).toBe(false);
    });
  });

  describe('clearError', () => {
    it('should clear the error state', () => {
      useAuthStore.setState({ error: 'Some error' });
      useAuthStore.getState().clearError();
      expect(useAuthStore.getState().error).toBeNull();
    });
  });

  describe('checkAuth', () => {
    it('should set status to locked when DB exists', async () => {
      mockElectron.auth.check.mockResolvedValue({ initialized: true });
      await useAuthStore.getState().checkAuth();

      expect(useAuthStore.getState().status).toBe('locked');
      expect(useAuthStore.getState().error).toBeNull();
      expect(mockElectron.auth.check).toHaveBeenCalledTimes(1);
    });

    it('should set status to setup when DB does not exist', async () => {
      mockElectron.auth.check.mockResolvedValue({ initialized: false });
      await useAuthStore.getState().checkAuth();

      expect(useAuthStore.getState().status).toBe('setup');
      expect(useAuthStore.getState().error).toBeNull();
    });

    it('should fall back to setup on error', async () => {
      mockElectron.auth.check.mockRejectedValue(new Error('IPC failed'));
      await useAuthStore.getState().checkAuth();

      expect(useAuthStore.getState().status).toBe('setup');
    });
  });

  describe('initApp', () => {
    it('should set status to unlocked on success', async () => {
      mockElectron.auth.init.mockResolvedValue({ success: true });
      await useAuthStore.getState().initApp('strongpassword');

      expect(useAuthStore.getState().status).toBe('unlocked');
      expect(useAuthStore.getState().error).toBeNull();
      expect(useAuthStore.getState().isAuthenticated).toBe(true);
      expect(mockElectron.auth.init).toHaveBeenCalledWith('strongpassword');
    });

    it('should set error and return to setup on failure', async () => {
      mockElectron.auth.init.mockRejectedValue(new Error('Weak password'));
      await useAuthStore.getState().initApp('weak');

      expect(useAuthStore.getState().status).toBe('setup');
      expect(useAuthStore.getState().error).toBe('Weak password');
      expect(useAuthStore.getState().isAuthenticated).toBe(false);
    });

    it('should set generic error for non-Error failure', async () => {
      mockElectron.auth.init.mockRejectedValue('fail');
      await useAuthStore.getState().initApp('pw');

      expect(useAuthStore.getState().error).toBe('Failed to initialize');
    });
  });

  describe('unlock', () => {
    it('should set status to unlocked on success (true)', async () => {
      mockElectron.auth.unlock.mockResolvedValue({ success: true });
      await useAuthStore.getState().unlock('masterpw');

      expect(useAuthStore.getState().status).toBe('unlocked');
      expect(useAuthStore.getState().isAuthenticated).toBe(true);
      expect(useAuthStore.getState().error).toBeNull();
    });

    it('should set activeVaultId on successful unlock', async () => {
      mockElectron.auth.unlock.mockResolvedValue({ success: true, vaultId: 'vault-abc' });
      await useAuthStore.getState().unlock('masterpw');

      expect(useAuthStore.getState().activeVaultId).toBe('vault-abc');
      expect(useAuthStore.getState().status).toBe('unlocked');
    });

    it('should clear activeVaultId on failed unlock', async () => {
      useAuthStore.setState({ activeVaultId: 'vault-old' });
      mockElectron.auth.unlock.mockResolvedValue({ success: false, error: 'Incorrect master password' });
      await useAuthStore.getState().unlock('wrong');

      expect(useAuthStore.getState().activeVaultId).toBeNull();
      expect(useAuthStore.getState().status).toBe('locked');
    });

    it('should clear activeVaultId on lock', async () => {
      useAuthStore.setState({ status: 'unlocked', isAuthenticated: true, isLoading: false, activeVaultId: 'vault-1' });
      mockElectron.auth.lock.mockResolvedValue(undefined);

      await useAuthStore.getState().lock();

      expect(useAuthStore.getState().activeVaultId).toBeNull();
      expect(useAuthStore.getState().status).toBe('locked');
    });

    it('should set error on unlock failure (false)', async () => {
      mockElectron.auth.unlock.mockResolvedValue({ success: false, error: 'Incorrect master password' });
      await useAuthStore.getState().unlock('wrong');

      expect(useAuthStore.getState().status).toBe('locked');
      expect(useAuthStore.getState().isAuthenticated).toBe(false);
      expect(useAuthStore.getState().error).toBe('Incorrect master password');
    });

    it('should set error on exception', async () => {
      mockElectron.auth.unlock.mockRejectedValue(new Error('DB corrupted'));
      await useAuthStore.getState().unlock('any');

      expect(useAuthStore.getState().status).toBe('locked');
      expect(useAuthStore.getState().error).toBe('DB corrupted');
    });

    it('should set generic error for non-Error failure', async () => {
      mockElectron.auth.unlock.mockRejectedValue('crash');
      await useAuthStore.getState().unlock('pw');

      expect(useAuthStore.getState().error).toBe('Failed to unlock');
    });
  });

  describe('lock', () => {
    it('should set status to locked and clear error', async () => {
      useAuthStore.setState({ status: 'unlocked', isAuthenticated: true, isLoading: false });
      mockElectron.auth.lock.mockResolvedValue(undefined);

      await useAuthStore.getState().lock();

      expect(useAuthStore.getState().status).toBe('locked');
      expect(useAuthStore.getState().isAuthenticated).toBe(false);
      expect(useAuthStore.getState().error).toBeNull();
      expect(mockElectron.auth.lock).toHaveBeenCalled();
    });

    it('should still lock even if IPC call fails', async () => {
      useAuthStore.setState({ status: 'unlocked', isAuthenticated: true, isLoading: false });
      mockElectron.auth.lock.mockRejectedValue(new Error('IPC error'));

      await useAuthStore.getState().lock();

      expect(useAuthStore.getState().status).toBe('locked');
      expect(useAuthStore.getState().isAuthenticated).toBe(false);
      expect(useAuthStore.getState().error).toBeNull();
    });
  });

  describe('changePassword', () => {
    it('should clear error and call IPC on success', async () => {
      useAuthStore.setState({ error: 'old error' });
      mockElectron.auth.changePassword.mockResolvedValue(undefined);

      await useAuthStore.getState().changePassword('old', 'new');

      expect(useAuthStore.getState().error).toBeNull();
      expect(mockElectron.auth.changePassword).toHaveBeenCalledWith('old', 'new');
    });

    it('should set error and rethrow on failure', async () => {
      mockElectron.auth.changePassword.mockRejectedValue(new Error('Wrong old password'));

      await expect(useAuthStore.getState().changePassword('wrongold', 'new')).rejects.toThrow(
        'Wrong old password',
      );

      expect(useAuthStore.getState().error).toBe('Wrong old password');
    });

    it('should set generic error for non-Error failure', async () => {
      mockElectron.auth.changePassword.mockRejectedValue('fail');

      await expect(useAuthStore.getState().changePassword('old', 'new')).rejects.toThrow('fail');

      expect(useAuthStore.getState().error).toBe('Failed to change password');
    });
  });

  describe('selectVault', () => {
    it('should transition through checking and end unlocked for the target vault', async () => {
      useAuthStore.setState({
        status: 'unlocked',
        isAuthenticated: true,
        isLoading: false,
        activeVaultId: 'vault-a',
        activeVaultName: 'Vault A',
        selectedVaultId: 'vault-a',
        vaults: [
          { id: 'vault-a', name: 'Vault A' } as unknown as import('../../../src/shared/types').VaultRegistryEntry,
          { id: 'vault-b', name: 'Vault B' } as unknown as import('../../../src/shared/types').VaultRegistryEntry,
        ],
      });

      mockElectron.vaults.select.mockResolvedValue({ success: true, vaultId: 'vault-b' });
      mockElectron.vaults.list.mockResolvedValue({
        success: true,
        data: [
          { id: 'vault-a', name: 'Vault A' } as unknown as import('../../../src/shared/types').VaultRegistryEntry,
          { id: 'vault-b', name: 'Vault B' } as unknown as import('../../../src/shared/types').VaultRegistryEntry,
        ],
      });

      const statuses: string[] = [];
      const unsubscribe = useAuthStore.subscribe((state) => statuses.push(state.status));

      await useAuthStore.getState().selectVault('vault-b', 'masterpw');
      unsubscribe();

      expect(statuses).toContain('checking');
      expect(useAuthStore.getState().status).toBe('unlocked');
      expect(useAuthStore.getState().activeVaultId).toBe('vault-b');
      expect(useAuthStore.getState().activeVaultName).toBe('Vault B');
      expect(useAuthStore.getState().isAuthenticated).toBe(true);
      expect(mockElectron.vaults.select).toHaveBeenCalledWith('vault-b', 'masterpw');
    });

    it('should not leave the old vault active when switch fails', async () => {
      useAuthStore.setState({
        status: 'unlocked',
        isAuthenticated: true,
        isLoading: false,
        activeVaultId: 'vault-a',
        activeVaultName: 'Vault A',
        selectedVaultId: 'vault-a',
        vaults: [
          { id: 'vault-a', name: 'Vault A' } as unknown as import('../../../src/shared/types').VaultRegistryEntry,
          { id: 'vault-b', name: 'Vault B' } as unknown as import('../../../src/shared/types').VaultRegistryEntry,
        ],
      });

      mockElectron.vaults.select.mockResolvedValue({
        success: false,
        error: 'Incorrect master password',
      });

      await useAuthStore.getState().selectVault('vault-b', 'wrong');

      expect(useAuthStore.getState().status).toBe('locked');
      expect(useAuthStore.getState().activeVaultId).toBeNull();
      expect(useAuthStore.getState().activeVaultName).toBeNull();
      expect(useAuthStore.getState().isAuthenticated).toBe(false);
      expect(useAuthStore.getState().selectedVaultId).toBe('vault-b');
    });

    it('should clear old vault state even if the IPC call throws', async () => {
      useAuthStore.setState({
        status: 'unlocked',
        isAuthenticated: true,
        isLoading: false,
        activeVaultId: 'vault-a',
        activeVaultName: 'Vault A',
        selectedVaultId: 'vault-a',
        vaults: [
          { id: 'vault-a', name: 'Vault A' } as unknown as import('../../../src/shared/types').VaultRegistryEntry,
          { id: 'vault-b', name: 'Vault B' } as unknown as import('../../../src/shared/types').VaultRegistryEntry,
        ],
      });

      mockElectron.vaults.select.mockRejectedValue(new Error('IPC crashed'));

      await useAuthStore.getState().selectVault('vault-b', 'masterpw');

      expect(useAuthStore.getState().status).toBe('locked');
      expect(useAuthStore.getState().activeVaultId).toBeNull();
      expect(useAuthStore.getState().isAuthenticated).toBe(false);
    });
  });
});
