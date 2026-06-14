import React, { useState, useCallback, useEffect } from 'react';
import { useSettingsStore } from '../../stores/settingsStore';
import { useAuthStore } from '../../stores/authStore';
import { APP_NAME, APP_VERSION } from '../../../shared/constants';

const AUTO_LOCK_OPTIONS = [
  { value: 60000, label: '1 minute' },
  { value: 300000, label: '5 minutes' },
  { value: 900000, label: '15 minutes' },
  { value: 0, label: 'Never' },
] as const;

type ThemeOption = 'light' | 'dark' | 'system';

export default function SettingsView(): React.ReactElement {
  const { settings, loadSettings, updateSetting } = useSettingsStore();
  const { changePassword } = useAuthStore();

  const [activeSection, setActiveSection] = useState<string>('general');
  const [changePasswordOpen, setChangePasswordOpen] = useState(false);
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [passwordSuccess, setPasswordSuccess] = useState('');
  const [isChangingPassword, setIsChangingPassword] = useState(false);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  const handleThemeChange = useCallback(
    (theme: ThemeOption) => {
      updateSetting('theme', theme);
    },
    [updateSetting],
  );

  const handleChangePassword = useCallback(async () => {
    setPasswordError('');
    setPasswordSuccess('');
    if (!oldPassword) {
      setPasswordError('Current password is required');
      return;
    }
    if (newPassword.length < 8) {
      setPasswordError('New password must be at least 8 characters');
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError('New passwords do not match');
      return;
    }
    setIsChangingPassword(true);
    try {
      await changePassword(oldPassword, newPassword);
      setPasswordSuccess('Master password changed successfully');
      setOldPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setTimeout(() => {
        setChangePasswordOpen(false);
        setPasswordSuccess('');
      }, 2000);
    } catch (err) {
      setPasswordError(err instanceof Error ? err.message : 'Failed to change password');
    } finally {
      setIsChangingPassword(false);
    }
  }, [oldPassword, newPassword, confirmPassword, changePassword]);

  const handleExportBackup = useCallback(async () => {
    try {
      await (window.electron.settings as any).exportBackup?.();
    } catch {
      // Feature not yet available
    }
  }, []);

  const handleImportBackup = useCallback(async () => {
    try {
      await (window.electron.settings as any).importBackup?.();
    } catch {
      // Feature not yet available
    }
  }, []);

  const handlePurgeTrash = useCallback(async () => {
    if (confirm('Permanently delete all items in trash? This cannot be undone.')) {
      try {
        await window.electron.trash.empty();
      } catch {
        // Error handled silently
      }
    }
  }, []);

  const sections = [
    {
      id: 'general',
      label: 'General',
      icon: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z',
    },
    {
      id: 'security',
      label: 'Security',
      icon: 'M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z',
    },
    {
      id: 'passwordDefaults',
      label: 'Password Defaults',
      icon: 'M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z',
    },
    {
      id: 'data',
      label: 'Data',
      icon: 'M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4',
    },
    {
      id: 'about',
      label: 'About',
      icon: 'M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
    },
  ];

  return (
    <div className="flex h-full">
      {/* Settings sidebar */}
      <nav className="w-48 shrink-0 space-y-0.5 border-r border-surface-200 bg-white p-2 dark:border-surface-700 dark:bg-surface-850">
        {sections.map((section) => (
          <button
            key={section.id}
            onClick={() => setActiveSection(section.id)}
            className={`flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
              activeSection === section.id
                ? 'bg-accent-100 text-accent-700 dark:bg-accent-900/30 dark:text-accent-300'
                : 'text-surface-600 hover:bg-surface-100 dark:text-surface-400 dark:hover:bg-surface-800'
            }`}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-4 w-4 shrink-0"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d={section.icon} />
            </svg>
            {section.label}
          </button>
        ))}
      </nav>

      {/* Content */}
      <div className="notion-scrollbar flex-1 overflow-y-auto">
        <div className="mx-auto max-w-2xl space-y-8 px-8 py-8">
          {/* General */}
          {activeSection === 'general' && (
            <section>
              <h2 className="mb-6 text-lg font-semibold text-surface-900 dark:text-surface-50">
                General
              </h2>

              {/* Theme */}
              <div className="space-y-3">
                <label className="text-sm font-medium text-surface-700 dark:text-surface-300">
                  Theme
                </label>
                <div className="flex gap-2">
                  {(['light', 'dark', 'system'] as ThemeOption[]).map((theme) => (
                    <button
                      key={theme}
                      onClick={() => handleThemeChange(theme)}
                      className={`flex items-center gap-2 rounded-lg border px-4 py-2.5 text-sm font-medium transition-all ${
                        settings.theme === theme
                          ? 'border-accent-400 bg-accent-50 text-accent-700 ring-1 ring-accent-400 dark:bg-accent-900/20 dark:text-accent-300'
                          : 'border-surface-200 text-surface-600 hover:border-surface-300 dark:border-surface-700 dark:text-surface-400 dark:hover:border-surface-600'
                      }`}
                    >
                      {theme === 'light' && (
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          className="h-4 w-4"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                          strokeWidth={2}
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z"
                          />
                        </svg>
                      )}
                      {theme === 'dark' && (
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          className="h-4 w-4"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                          strokeWidth={2}
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"
                          />
                        </svg>
                      )}
                      {theme === 'system' && (
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          className="h-4 w-4"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                          strokeWidth={2}
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
                          />
                        </svg>
                      )}
                      <span className="capitalize">{theme}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Auto-lock timer */}
              <div className="mt-6 space-y-3">
                <label className="text-sm font-medium text-surface-700 dark:text-surface-300">
                  Auto-lock timer
                </label>
                <div className="flex flex-wrap gap-2">
                  {AUTO_LOCK_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      onClick={() => updateSetting('autoLockTime', option.value)}
                      className={`rounded-lg border px-3 py-2 text-sm font-medium transition-all ${
                        settings.autoLockTime === option.value
                          ? 'border-accent-400 bg-accent-50 text-accent-700 ring-1 ring-accent-400 dark:bg-accent-900/20 dark:text-accent-300'
                          : 'border-surface-200 text-surface-600 hover:border-surface-300 dark:border-surface-700 dark:text-surface-400 dark:hover:border-surface-600'
                      }`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>
            </section>
          )}

          {/* Security */}
          {activeSection === 'security' && (
            <section>
              <h2 className="mb-6 text-lg font-semibold text-surface-900 dark:text-surface-50">
                Security
              </h2>

              {/* Change master password */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium text-surface-700 dark:text-surface-300">
                    Master Password
                  </label>
                  <button
                    className="notion-button-ghost h-8 text-xs"
                    onClick={() => {
                      setChangePasswordOpen(!changePasswordOpen);
                      setPasswordError('');
                      setPasswordSuccess('');
                      setOldPassword('');
                      setNewPassword('');
                      setConfirmPassword('');
                    }}
                  >
                    {changePasswordOpen ? 'Cancel' : 'Change Password'}
                  </button>
                </div>

                {changePasswordOpen && (
                  <div className="space-y-3 rounded-lg border border-surface-200 bg-white p-4 dark:border-surface-700 dark:bg-surface-850">
                    <div>
                      <input
                        className="notion-input h-9"
                        type="password"
                        placeholder="Current master password"
                        value={oldPassword}
                        onChange={(e) => setOldPassword(e.target.value)}
                      />
                    </div>
                    <div>
                      <input
                        className="notion-input h-9"
                        type="password"
                        placeholder="New master password (min. 8 characters)"
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                      />
                    </div>
                    <div>
                      <input
                        className="notion-input h-9"
                        type="password"
                        placeholder="Confirm new master password"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                      />
                    </div>
                    {passwordError && <p className="text-xs text-danger-500">{passwordError}</p>}
                    {passwordSuccess && (
                      <p className="text-xs text-success-500">{passwordSuccess}</p>
                    )}
                    <button
                      className="notion-button-primary h-9 text-sm"
                      onClick={handleChangePassword}
                      disabled={isChangingPassword}
                    >
                      {isChangingPassword ? 'Changing...' : 'Update Master Password'}
                    </button>
                  </div>
                )}

                <p className="text-xs text-surface-400 dark:text-surface-500">
                  Changing your master password will re-encrypt your entire database. This may take
                  a moment.
                </p>
              </div>

              {/* Trash auto-purge */}
              <div className="mt-6 space-y-3">
                <label className="text-sm font-medium text-surface-700 dark:text-surface-300">
                  Auto-purge trash after
                </label>
                <select
                  className="notion-input h-9 w-48"
                  value={settings.trashAutoPurgeDays}
                  onChange={(e) => updateSetting('trashAutoPurgeDays', Number(e.target.value))}
                >
                  <option value={1}>1 day</option>
                  <option value={7}>7 days</option>
                  <option value={30}>30 days</option>
                  <option value={90}>90 days</option>
                  <option value={0}>Never</option>
                </select>
              </div>

              {/* Password health: old password threshold */}
              <div className="mt-6 space-y-3">
                <label className="text-sm font-medium text-surface-700 dark:text-surface-300">
                  Flag passwords as outdated after
                </label>
                <p className="text-xs text-surface-400 dark:text-surface-500">
                  Passwords not changed within this period will appear in the outdated list on the
                  Health view.
                </p>
                <select
                  className="notion-input h-9 w-48"
                  value={settings.passwordHealthOldDays}
                  onChange={(e) => updateSetting('passwordHealthOldDays', Number(e.target.value))}
                >
                  <option value={30}>30 days</option>
                  <option value={60}>60 days</option>
                  <option value={90}>90 days</option>
                  <option value={180}>180 days</option>
                  <option value={365}>1 year</option>
                </select>
              </div>
            </section>
          )}

          {/* Password Defaults */}
          {activeSection === 'passwordDefaults' && (
            <section>
              <h2 className="mb-6 text-lg font-semibold text-surface-900 dark:text-surface-50">
                Password Generator Defaults
              </h2>

              <div className="space-y-5">
                {/* Length */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-sm font-medium text-surface-700 dark:text-surface-300">
                      Length
                    </label>
                    <span className="text-sm text-surface-500 dark:text-surface-400">
                      {settings.defaultPasswordLength}
                    </span>
                  </div>
                  <input
                    type="range"
                    min={4}
                    max={128}
                    value={settings.defaultPasswordLength}
                    onChange={(e) => updateSetting('defaultPasswordLength', Number(e.target.value))}
                    className="h-2 w-full cursor-pointer appearance-none rounded-full bg-surface-200 accent-accent-500 dark:bg-surface-700"
                  />
                  <div className="flex justify-between text-xs text-surface-400">
                    <span>4</span>
                    <span>128</span>
                  </div>
                </div>

                {/* Character sets */}
                <div className="space-y-3">
                  {[
                    { key: 'defaultPasswordUppercase' as const, label: 'A-Z (Uppercase)' },
                    { key: 'defaultPasswordLowercase' as const, label: 'a-z (Lowercase)' },
                    { key: 'defaultPasswordNumbers' as const, label: '0-9 (Numbers)' },
                    { key: 'defaultPasswordSymbols' as const, label: '!@#$% (Symbols)' },
                    {
                      key: 'defaultPasswordExcludeAmbiguous' as const,
                      label: 'Exclude ambiguous (0, O, l, 1)',
                    },
                  ].map(({ key, label }) => (
                    <label key={key} className="flex cursor-pointer items-center gap-3">
                      <div
                        className={`flex h-5 w-5 items-center justify-center rounded border-2 transition-colors ${
                          settings[key]
                            ? 'border-accent-500 bg-accent-500'
                            : 'border-surface-300 dark:border-surface-600'
                        }`}
                        onClick={() => updateSetting(key, !settings[key])}
                      >
                        {settings[key] && (
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            className="h-3.5 w-3.5 text-white"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                            strokeWidth={3}
                          >
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                          </svg>
                        )}
                      </div>
                      <span className="select-none text-sm text-surface-700 dark:text-surface-300">
                        {label}
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            </section>
          )}

          {/* Data */}
          {activeSection === 'data' && (
            <section>
              <h2 className="mb-6 text-lg font-semibold text-surface-900 dark:text-surface-50">
                Data Management
              </h2>

              <div className="space-y-4">
                <div className="rounded-lg border border-surface-200 p-4 dark:border-surface-700">
                  <h3 className="mb-1 text-sm font-medium text-surface-800 dark:text-surface-200">
                    Export Backup
                  </h3>
                  <p className="mb-3 text-xs text-surface-400">
                    Download an encrypted copy of your entire database.
                  </p>
                  <button className="notion-button-ghost h-8 text-xs" onClick={handleExportBackup}>
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      className="h-4 w-4"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                      />
                    </svg>
                    Export Database
                  </button>
                </div>

                <div className="rounded-lg border border-surface-200 p-4 dark:border-surface-700">
                  <h3 className="mb-1 text-sm font-medium text-surface-800 dark:text-surface-200">
                    Import Backup
                  </h3>
                  <p className="mb-3 text-xs text-surface-400">
                    Restore from a previously exported backup file.
                  </p>
                  <button className="notion-button-ghost h-8 text-xs" onClick={handleImportBackup}>
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      className="h-4 w-4"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M4 16v-4a1 1 0 011-1h4m6 0h4a1 1 0 011 1v4m-5-5l-3-3m0 0l3-3m-3 3h12"
                      />
                    </svg>
                    Import Database
                  </button>
                </div>

                <div className="rounded-lg border border-surface-200 p-4 dark:border-surface-700">
                  <h3 className="mb-1 text-sm font-medium text-surface-800 dark:text-surface-200">
                    Purge Trash
                  </h3>
                  <p className="mb-3 text-xs text-surface-400">
                    Permanently delete all items currently in the trash.
                  </p>
                  <button className="notion-button-danger h-8 text-xs" onClick={handlePurgeTrash}>
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      className="h-4 w-4"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                      />
                    </svg>
                    Purge Trash
                  </button>
                </div>
              </div>
            </section>
          )}

          {/* About */}
          {activeSection === 'about' && (
            <section>
              <h2 className="mb-6 text-lg font-semibold text-surface-900 dark:text-surface-50">
                About
              </h2>

              <div className="space-y-6">
                <div className="flex items-center gap-4">
                  <div className="flex h-16 w-16 items-center justify-center rounded-xl bg-accent-500 text-2xl font-bold text-white">
                    SP
                  </div>
                  <div>
                    <h3 className="text-xl font-bold text-surface-900 dark:text-surface-50">
                      {APP_NAME}
                    </h3>
                    <p className="text-sm text-surface-500">Version {APP_VERSION}</p>
                  </div>
                </div>

                <div className="divide-y divide-surface-200 rounded-lg border border-surface-200 dark:divide-surface-700 dark:border-surface-700">
                  <div className="flex justify-between px-4 py-3">
                    <span className="text-sm text-surface-600 dark:text-surface-400">
                      Application
                    </span>
                    <span className="text-sm font-medium text-surface-800 dark:text-surface-200">
                      {APP_NAME}
                    </span>
                  </div>
                  <div className="flex justify-between px-4 py-3">
                    <span className="text-sm text-surface-600 dark:text-surface-400">Version</span>
                    <span className="text-sm font-medium text-surface-800 dark:text-surface-200">
                      {APP_VERSION}
                    </span>
                  </div>
                  <div className="flex justify-between px-4 py-3">
                    <span className="text-sm text-surface-600 dark:text-surface-400">
                      Architecture
                    </span>
                    <span className="text-sm font-medium text-surface-800 dark:text-surface-200">
                      Zero-Knowledge, Local-First
                    </span>
                  </div>
                  <div className="flex justify-between px-4 py-3">
                    <span className="text-sm text-surface-600 dark:text-surface-400">
                      Encryption
                    </span>
                    <span className="text-sm font-medium text-surface-800 dark:text-surface-200">
                      AES-256-GCM + SQLCipher
                    </span>
                  </div>
                  <div className="flex justify-between px-4 py-3">
                    <span className="text-sm text-surface-600 dark:text-surface-400">License</span>
                    <span className="text-sm font-medium text-surface-800 dark:text-surface-200">
                      MIT
                    </span>
                  </div>
                </div>

                <p className="text-xs leading-relaxed text-surface-400 dark:text-surface-500">
                  SecurePass Manager is a zero-knowledge, local-first password manager. Your master
                  password never leaves your device. All data is encrypted before being written to
                  disk.
                </p>
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
