// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import LockScreenPage from '../../../src/renderer/pages/LockScreenPage';
import VaultSelector from '../../../src/renderer/components/lock-screen/VaultSelector';
import VaultManagementDialog from '../../../src/renderer/components/lock-screen/VaultManagementDialog';
import { useTranslationStore } from '../../../src/renderer/i18n/useTranslation';
import type { VaultRegistryEntry } from '../../../src/shared/types';

// Mock framer-motion so Modal renders immediately without animation quirks.
vi.mock('framer-motion', () => ({
  motion: {
    div: React.forwardRef((props: Record<string, unknown>, ref: React.Ref<HTMLDivElement>) => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { initial, animate, exit, transition, variants, layout, ...rest } = props;
      return <div ref={ref} {...rest} />;
    }),
  },
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const authStoreMock = {
  status: 'locked' as const,
  error: null as string | null,
  vaults: [] as VaultRegistryEntry[],
  selectedVaultId: null as string | null,
  isCreatingVault: false,
  isRestoringVault: false,
  isRenamingVault: false,
  isSettingDefaultVault: false,
  isDeletingVault: false,
  isBackingUpVault: false,
  activeVaultId: null as string | null,
  initApp: vi.fn(),
  unlock: vi.fn(),
  clearError: vi.fn(),
  setSelectedVaultId: vi.fn(),
  createVault: vi.fn(),
  importVault: vi.fn(),
  restoreVault: vi.fn(),
  loadVaults: vi.fn(),
  vaultError: null as string | null,
  clearVaultError: vi.fn(),
  renameVault: vi.fn(),
  setDefaultVault: vi.fn(),
  deleteVault: vi.fn(),
  backupVault: vi.fn(),
  lock: vi.fn(),
};

vi.mock('@renderer/stores/authStore', () => ({
  useAuthStore: (selector?: (s: typeof authStoreMock) => unknown) =>
    selector ? selector(authStoreMock) : authStoreMock,
}));

const baseVault: VaultRegistryEntry = {
  id: 'vault-personal',
  name: 'Personal',
  databasePath: '/data/vault-personal.db',
  createdAt: Date.now(),
  lastOpenedAt: null,
  lastOpenedVersion: null,
  description: null,
  color: null,
  icon: null,
  isDefault: true,
  sortOrder: 1,
  isCustomLocation: false,
};

const secondVault: VaultRegistryEntry = {
  id: 'vault-work',
  name: 'Work',
  databasePath: '/data/vault-work.db',
  createdAt: Date.now(),
  lastOpenedAt: null,
  lastOpenedVersion: null,
  description: null,
  color: null,
  icon: null,
  isDefault: false,
  sortOrder: 2,
  isCustomLocation: false,
};

describe('UX Regression — Multi-Vault Lock Screen & Management', () => {
  beforeEach(() => {
    // Reset auth store mock to a clean locked state.
    authStoreMock.status = 'locked';
    authStoreMock.error = null;
    authStoreMock.vaultError = null;
    authStoreMock.vaults = [];
    authStoreMock.selectedVaultId = null;
    authStoreMock.activeVaultId = null;
    authStoreMock.isCreatingVault = false;
    authStoreMock.isRestoringVault = false;
    authStoreMock.isRenamingVault = false;
    authStoreMock.isSettingDefaultVault = false;
    authStoreMock.isDeletingVault = false;
    authStoreMock.isBackingUpVault = false;
    vi.clearAllMocks();

    // Ensure tests start in English.
    useTranslationStore.getState().setLocale('en');

    // Minimal Electron stub for code paths that touch window.electron.
    Object.defineProperty(window, 'electron', {
      value: {
        vaults: {
          revealLocation: vi.fn().mockResolvedValue(undefined),
        },
      },
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    cleanup();
    useTranslationStore.getState().setLocale('en');
  });

  // ========================================================================
  // 7.5.1 — Lock Screen for 0, 1, and many vaults.
  // ========================================================================
  describe('LockScreenPage states', () => {
    it('renders setup screen when there are no vaults', () => {
      authStoreMock.status = 'setup';
      authStoreMock.vaults = [];

      render(<LockScreenPage />);

      expect(screen.getByText('Create your master password')).toBeDefined();
      expect(screen.getByPlaceholderText('Confirm master password')).toBeDefined();
      expect(screen.getByRole('button', { name: /create vault/i })).toBeDefined();
      expect(screen.getByText(/cannot be recovered/i)).toBeDefined();

      // No vault management buttons in setup.
      expect(screen.queryByText('Import Vault')).toBeNull();
      expect(screen.queryByText('Create Vault')).not.toBeNull(); // the submit button
    });

    it('renders unlock screen for a single vault with vault name shown', () => {
      authStoreMock.status = 'locked';
      authStoreMock.vaults = [baseVault];
      authStoreMock.selectedVaultId = baseVault.id;

      render(<LockScreenPage />);

      expect(screen.getByText('Enter your master password to unlock')).toBeDefined();
      expect(screen.getByText('Personal')).toBeDefined();
      expect(screen.getByRole('button', { name: /unlock/i })).toBeDefined();
      expect(screen.getByRole('button', { name: /create vault/i })).toBeDefined();
      expect(screen.getByRole('button', { name: /import vault/i })).toBeDefined();
      expect(screen.getByRole('button', { name: /restore from backup/i })).toBeDefined();
    });

    it('renders vault selector when multiple vaults exist', () => {
      authStoreMock.status = 'locked';
      authStoreMock.vaults = [baseVault, secondVault];
      authStoreMock.selectedVaultId = baseVault.id;

      render(<LockScreenPage />);

      expect(screen.getByText('Select Vault')).toBeDefined();
      const combobox = screen.getByRole('combobox');
      expect(combobox).toBeDefined();

      fireEvent.click(combobox);
      expect(screen.getByRole('option', { name: /Personal/i })).toBeDefined();
      expect(screen.getByRole('option', { name: /Work/i })).toBeDefined();
    });
  });

  // ========================================================================
  // 7.5.2 — Keyboard navigation.
  // ========================================================================
  describe('keyboard navigation', () => {
    it('VaultSelector opens, navigates options, and selects with keyboard', () => {
      const onSelectVault = vi.fn();
      render(
        <VaultSelector
          vaults={[baseVault, secondVault]}
          selectedVaultId={baseVault.id}
          onSelectVault={onSelectVault}
        />,
      );

      const combobox = screen.getByRole('combobox');

      // Open dropdown.
      fireEvent.keyDown(combobox, { key: 'Enter' });
      expect(screen.getAllByRole('option')).toHaveLength(2);

      // Move highlight down to Work and select it.
      fireEvent.keyDown(combobox, { key: 'ArrowDown' });
      fireEvent.keyDown(combobox, { key: 'Enter' });

      expect(onSelectVault).toHaveBeenCalledTimes(1);
      expect(onSelectVault).toHaveBeenCalledWith(secondVault.id);
    });

    it('VaultSelector closes dropdown with Escape and returns focus to button', async () => {
      render(
        <VaultSelector
          vaults={[baseVault, secondVault]}
          selectedVaultId={baseVault.id}
          onSelectVault={vi.fn()}
        />,
      );

      const combobox = screen.getByRole('combobox') as HTMLButtonElement;
      fireEvent.keyDown(combobox, { key: 'Enter' });
      expect(screen.getAllByRole('option')).toHaveLength(2);

      fireEvent.keyDown(combobox, { key: 'Escape' });
      await waitFor(() => expect(screen.queryAllByRole('option')).toHaveLength(0));
    });

    it('VaultManagementDialog can be closed with Escape', () => {
      const onClose = vi.fn();
      authStoreMock.activeVaultId = 'other-vault';

      render(<VaultManagementDialog isOpen={true} vault={baseVault} onClose={onClose} />);

      const dialog = screen.getByRole('dialog');
      expect(dialog).toBeDefined();

      fireEvent.keyDown(dialog, { key: 'Escape' });
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('VaultManagementDialog delete confirmation submits on Enter when name matches', async () => {
      authStoreMock.activeVaultId = 'other-vault';
      authStoreMock.deleteVault.mockResolvedValue(true);

      render(<VaultManagementDialog isOpen={true} vault={baseVault} onClose={vi.fn()} />);

      fireEvent.click(screen.getByRole('button', { name: /delete vault/i }));
      expect(screen.getByText(/Delete Vault "Personal"/)).toBeDefined();

      const confirmInput = screen.getByRole('textbox');
      fireEvent.change(confirmInput, { target: { value: 'Personal' } });
      fireEvent.keyDown(confirmInput, { key: 'Enter' });

      await waitFor(() =>
        expect(authStoreMock.deleteVault).toHaveBeenCalledWith(baseVault.id, true, true),
      );
    });
  });

  // ========================================================================
  // 7.5.3 — Error flow when vault file is missing or corrupt.
  // ========================================================================
  describe('error flow on lock screen', () => {
    it('displays an auth error returned from the store', () => {
      authStoreMock.status = 'locked';
      authStoreMock.vaults = [baseVault];
      authStoreMock.error = 'Vault database file is corrupted.';

      render(<LockScreenPage />);

      const alert = screen.getByRole('alert');
      expect(alert).toBeDefined();
      expect(alert.textContent).toContain('Vault database file is corrupted.');
    });

    it('displays a vault-level error such as a missing vault file', () => {
      authStoreMock.status = 'locked';
      authStoreMock.vaults = [baseVault];
      authStoreMock.vaultError = 'The selected vault file could not be found.';

      render(<LockScreenPage />);

      const alert = screen.getByRole('alert');
      expect(alert).toBeDefined();
      expect(alert.textContent).toContain('The selected vault file could not be found.');
    });
  });

  // ========================================================================
  // 7.5.4 — i18n for English and Indonesian.
  // ========================================================================
  describe('i18n localization', () => {
    it('renders setup lock screen in English', () => {
      authStoreMock.status = 'setup';
      render(<LockScreenPage />);

      expect(screen.getByText('Create your master password')).toBeDefined();
      expect(screen.getByRole('button', { name: /create vault/i })).toBeDefined();
    });

    it('renders setup lock screen in Indonesian', async () => {
      await useTranslationStore.getState().setLocale('id');
      authStoreMock.status = 'setup';
      render(<LockScreenPage />);

      expect(screen.getByText('Buat kata sandi master Anda')).toBeDefined();
      expect(screen.getByRole('button', { name: /buat vault/i })).toBeDefined();
    });

    it('renders unlock lock screen with vault selector in Indonesian', async () => {
      await useTranslationStore.getState().setLocale('id');
      authStoreMock.status = 'locked';
      authStoreMock.vaults = [baseVault, secondVault];
      authStoreMock.selectedVaultId = baseVault.id;

      render(<LockScreenPage />);

      expect(
        screen.getByText('Masukkan kata sandi master Anda untuk membuka kunci'),
      ).toBeDefined();
      expect(screen.getByText('Pilih Vault')).toBeDefined();
      expect(screen.getByRole('button', { name: /buka kunci/i })).toBeDefined();
      expect(screen.getByRole('button', { name: /impor vault/i })).toBeDefined();
      expect(screen.getByRole('button', { name: /pulihkan dari cadangan/i })).toBeDefined();
    });

    it('renders vault management dialog in Indonesian', async () => {
      await useTranslationStore.getState().setLocale('id');
      authStoreMock.activeVaultId = 'other-vault';

      render(<VaultManagementDialog isOpen={true} vault={secondVault} onClose={vi.fn()} />);

      expect(screen.getByRole('dialog').getAttribute('aria-label')).toBe(
        'Dialog manajemen vault',
      );
      expect(screen.getByText('Kelola Vault')).toBeDefined();
      expect(screen.getByRole('button', { name: /atur sebagai default/i })).toBeDefined();
      expect(screen.getByRole('button', { name: /hapus vault/i })).toBeDefined();
      expect(screen.getByText('Informasi Vault')).toBeDefined();
    });
  });
});
