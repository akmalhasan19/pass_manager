import React, { useState, useCallback, useEffect, useId } from 'react';
import { useSettingsStore } from '../../stores/settingsStore';
import { useAuthStore } from '../../stores/authStore';
import { APP_NAME, APP_VERSION } from '../../../shared/constants';
import { useTranslation } from '../../i18n/useTranslation';
import { useExtensionStatus } from '../../hooks/useExtensionStatus';
import ImportDialog from '../import-export/ImportDialog';
import ExportDialog from '../import-export/ExportDialog';

const AUTO_LOCK_OPTIONS = [
  { value: 60000, labelKey: 'settings.autoLock.1min' },
  { value: 300000, labelKey: 'settings.autoLock.5min' },
  { value: 900000, labelKey: 'settings.autoLock.15min' },
  { value: 0, labelKey: 'settings.autoLock.never' },
] as const;

type ThemeOption = 'light' | 'dark' | 'system';

export default function SettingsView(): React.ReactElement {
  const { settings, loadSettings, updateSetting } = useSettingsStore();
  const { changePassword, activeVaultName } = useAuthStore();
  const { t } = useTranslation();
  const { status: extStatus, isLoading: extLoading, install, uninstall, openStore } = useExtensionStatus();

  const [activeSection, setActiveSection] = useState<string>('general');
  const [changePasswordOpen, setChangePasswordOpen] = useState(false);
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [passwordSuccess, setPasswordSuccess] = useState('');
  const [isChangingPassword, setIsChangingPassword] = useState(false);
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [showExportDialog, setShowExportDialog] = useState(false);
  const [installingHost, setInstallingHost] = useState(false);
  const passwordErrorId = useId();

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  // SECURITY: Clear password fields from React state on unmount to minimize
  // the window where plaintext passwords are held in memory.
  useEffect(() => {
    return () => {
      setOldPassword('');
      setNewPassword('');
      setConfirmPassword('');
    };
  }, []);

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
      setPasswordError(t('auth.error.currentPasswordRequired'));
      return;
    }
    if (newPassword.length < 8) {
      setPasswordError(t('auth.error.newPasswordTooShort'));
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError(t('auth.error.newPasswordMismatch'));
      return;
    }
    setIsChangingPassword(true);
    try {
      await changePassword(oldPassword, newPassword);
      setPasswordSuccess(t('auth.success.passwordChanged'));
      setOldPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setTimeout(() => {
        setChangePasswordOpen(false);
        setPasswordSuccess('');
      }, 2000);
    } catch (err) {
      setPasswordError(err instanceof Error ? err.message : t('auth.error.failedChangePassword'));
    } finally {
      setIsChangingPassword(false);
    }
  }, [oldPassword, newPassword, confirmPassword, changePassword, t]);

  const handleExportBackup = useCallback(async () => {
    setShowExportDialog(true);
  }, []);

  const handleImportBackup = useCallback(async () => {
    setShowImportDialog(true);
  }, []);

  const handlePurgeTrash = useCallback(async () => {
    if (confirm(t('settings.security.purgeConfirm'))) {
      try {
        await window.electron.trash.empty();
      } catch {
        // Error handled silently
      }
    }
  }, [t]);

  const sections = [
    {
      id: 'general',
      label: t('settings.section.general'),
      icon: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z',
    },
    {
      id: 'security',
      label: t('settings.section.security'),
      icon: 'M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z',
    },
    {
      id: 'passwordDefaults',
      label: t('settings.section.passwordDefaults'),
      icon: 'M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z',
    },
    {
      id: 'extension',
      label: 'Extension',
      icon: 'M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1',
    },
    {
      id: 'data',
      label: t('settings.section.data'),
      icon: 'M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4',
    },
    {
      id: 'about',
      label: t('settings.section.about'),
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
                {t('settings.general.heading')}
              </h2>

              {/* Theme */}
              <div className="space-y-3">
                <label className="text-sm font-medium text-surface-700 dark:text-surface-300">
                  {t('settings.general.theme')}
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
                  {t('settings.general.autoLock')}
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
                      {t(option.labelKey)}
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
                {t('settings.security.heading')}
              </h2>

              {/* Change master password */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium text-surface-700 dark:text-surface-300">
                    {t('settings.security.masterPassword')}
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
                    {changePasswordOpen ? t('settings.security.cancel') : t('settings.security.changePassword')}
                  </button>
                </div>

                {changePasswordOpen && (
                  <div className="space-y-3 rounded-lg border border-surface-200 bg-white p-4 dark:border-surface-700 dark:bg-surface-850">
                    <div>
                      <input
                        className="notion-input h-9"
                        type="password"
                        placeholder={t('settings.security.currentPassword')}
                        value={oldPassword}
                        onChange={(e) => setOldPassword(e.target.value)}
                        aria-invalid={!!passwordError || undefined}
                        aria-describedby={passwordError ? passwordErrorId : undefined}
                      />
                    </div>
                    <div>
                      <input
                        className="notion-input h-9"
                        type="password"
                        placeholder={t('settings.security.newPassword')}
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        aria-invalid={!!passwordError || undefined}
                        aria-describedby={passwordError ? passwordErrorId : undefined}
                      />
                    </div>
                    <div>
                      <input
                        className="notion-input h-9"
                        type="password"
                        placeholder={t('settings.security.confirmNewPassword')}
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        aria-invalid={!!passwordError || undefined}
                        aria-describedby={passwordError ? passwordErrorId : undefined}
                      />
                    </div>
                    {passwordError && (
                      <p id={passwordErrorId} role="alert" className="text-xs text-danger-500">
                        {passwordError}
                      </p>
                    )}
                    {passwordSuccess && (
                      <p aria-live="polite" className="text-xs text-success-500">
                        {passwordSuccess}
                      </p>
                    )}
                    <button
                      className="notion-button-primary h-9 text-sm"
                      onClick={handleChangePassword}
                      disabled={isChangingPassword}
                    >
                      {isChangingPassword ? t('settings.security.changing') : t('settings.security.updatePassword')}
                    </button>
                  </div>
                )}

                <p className="text-xs text-surface-400 dark:text-surface-500">
                  {t('settings.security.reencryptNote')}
                </p>
              </div>

              {/* Trash auto-purge */}
              <div className="mt-6 space-y-3">
                <label className="text-sm font-medium text-surface-700 dark:text-surface-300">
                  {t('settings.security.autoPurge')}
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
                  {t('settings.security.flagOutdated')}
                </label>
                <p className="text-xs text-surface-400 dark:text-surface-500">
                  {t('settings.security.flagOutdatedDesc')}
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

              {/* OTP Screen Privacy */}
              <div className="mt-6 space-y-3">
                <label className="flex cursor-pointer items-center gap-3">
                  <div
                    className={`flex h-5 w-5 items-center justify-center rounded border-2 transition-colors ${
                      settings.otpPrivacyMode
                        ? 'border-accent-500 bg-accent-500'
                        : 'border-surface-300 dark:border-surface-600'
                    }`}
                    onClick={() => updateSetting('otpPrivacyMode', !settings.otpPrivacyMode)}
                    role="checkbox"
                    aria-checked={settings.otpPrivacyMode}
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        updateSetting('otpPrivacyMode', !settings.otpPrivacyMode);
                      }
                    }}
                  >
                    {settings.otpPrivacyMode && (
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
                  <span className="text-sm font-medium text-surface-700 dark:text-surface-300">
                    {t('settings.security.otpPrivacyMode')}
                  </span>
                </label>
                <p className="text-xs text-surface-400 dark:text-surface-500">
                  {t('settings.security.otpPrivacyModeDesc')}
                </p>
              </div>
            </section>
          )}

          {/* Password Defaults */}
          {activeSection === 'passwordDefaults' && (
            <section>
              <h2 className="mb-6 text-lg font-semibold text-surface-900 dark:text-surface-50">
                {t('settings.passwordDefaults.heading')}
              </h2>

              <div className="space-y-5">
                {/* Length */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-sm font-medium text-surface-700 dark:text-surface-300">
                      {t('settings.passwordDefaults.length')}
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
                    { key: 'defaultPasswordUppercase' as const, labelKey: 'settings.passwordDefaults.uppercase' },
                    { key: 'defaultPasswordLowercase' as const, labelKey: 'settings.passwordDefaults.lowercase' },
                    { key: 'defaultPasswordNumbers' as const, labelKey: 'settings.passwordDefaults.numbers' },
                    { key: 'defaultPasswordSymbols' as const, labelKey: 'settings.passwordDefaults.symbols' },
                    {
                      key: 'defaultPasswordExcludeAmbiguous' as const,
                      labelKey: 'settings.passwordDefaults.excludeAmbiguous',
                    },
                  ].map(({ key, labelKey }) => (
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
                        {t(labelKey)}
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            </section>
          )}

          {/* Extension */}
          {activeSection === 'extension' && (
            <section>
              <h2 className="mb-6 text-lg font-semibold text-surface-900 dark:text-surface-50">
                Browser Extension
              </h2>

              <div className="space-y-5">
                {/* Enable/Disable integration */}
                <div className="rounded-lg border border-surface-200 p-4 dark:border-surface-700">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-sm font-medium text-surface-800 dark:text-surface-200">
                        Enable Extension Integration
                      </h3>
                      <p className="mt-0.5 text-xs text-surface-400">
                        Allow the desktop app to communicate with the SecurePass browser extension for autofill and quick access.
                      </p>
                    </div>
                    <label className="relative inline-flex cursor-pointer items-center">
                      <input
                        type="checkbox"
                        checked={settings.extensionIntegrationEnabled}
                        onChange={(e) => updateSetting('extensionIntegrationEnabled', e.target.checked)}
                        className="peer sr-only"
                      />
                      <div className="peer h-6 w-11 rounded-full bg-surface-300 after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:bg-white after:transition-all after:content-[''] peer-checked:bg-accent-500 peer-checked:after:translate-x-full peer-focus:ring-2 peer-focus:ring-accent-300 dark:bg-surface-600" />
                    </label>
                  </div>
                </div>

                {/* Native Host Status */}
                {settings.extensionIntegrationEnabled && (
                  <div className="rounded-lg border border-surface-200 p-4 dark:border-surface-700">
                    <h3 className="mb-3 text-sm font-medium text-surface-800 dark:text-surface-200">
                      Native Messaging Host Status
                    </h3>
                    <div className="space-y-2">
                      {extStatus ? (
                        Object.entries(extStatus.browsers).map(([browser, info]) => (
                          <div key={browser} className="flex items-center justify-between">
                            <span className="text-sm capitalize text-surface-700 dark:text-surface-300">
                              {browser}
                            </span>
                            <span
                              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
                                info.registered
                                  ? 'bg-success-100 text-success-700 dark:bg-success-900/20'
                                  : 'bg-surface-100 text-surface-500 dark:bg-surface-800'
                              }`}
                            >
                              {info.registered ? (
                                <>
                                  <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
                                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 adresinden 1.414 1.414L9 12.414l4.293-4.293z" clipRule="evenodd" />
                                  </svg>
                                  Installed
                                </>
                              ) : (
                                'Not installed'
                              )}
                            </span>
                          </div>
                        ))
                      ) : (
                        <p className="text-xs text-surface-400">Checking status...</p>
                      )}
                    </div>

                    <div className="mt-4 flex flex-wrap gap-2">
                      <button
                        onClick={async () => {
                          setInstallingHost(true);
                          await install();
                          setInstallingHost(false);
                        }}
                        disabled={installingHost || extLoading}
                        className="notion-button-primary h-8 text-xs disabled:opacity-50"
                      >
                        {installingHost ? 'Installing...' : 'Install Native Host'}
                      </button>

                      <button
                        onClick={async () => {
                          await openStore('chrome');
                        }}
                        className="notion-button-ghost h-8 text-xs"
                      >
                        Open Chrome Web Store
                      </button>

                      <button
                        onClick={async () => {
                          await openStore('firefox');
                        }}
                        className="notion-button-ghost h-8 text-xs"
                      >
                        Open Firefox Add-ons
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </section>
          )}

          {/* Data */}
          {activeSection === 'data' && (
            <section>
              <h2 className="mb-6 text-lg font-semibold text-surface-900 dark:text-surface-50">
                {t('settings.data.heading')}
              </h2>

              <div className="space-y-4">
                <div className="rounded-lg border border-surface-200 p-4 dark:border-surface-700">
                  <h3 className="mb-1 text-sm font-medium text-surface-800 dark:text-surface-200">
                    {t('settings.data.exportBackup')}
                  </h3>
                  <p className="mb-3 text-xs text-surface-400">
                    {t('settings.data.exportDesc')}
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
                    {t('settings.data.exportButton')}
                  </button>
                </div>

                <div className="rounded-lg border border-surface-200 p-4 dark:border-surface-700">
                  <h3 className="mb-1 text-sm font-medium text-surface-800 dark:text-surface-200">
                    {t('settings.data.importBackup')}
                  </h3>
                  <p className="mb-3 text-xs text-surface-400">
                    {t('settings.data.importDesc')}
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
                    {t('settings.data.importButton')}
                  </button>
                </div>

                <div className="rounded-lg border border-surface-200 p-4 dark:border-surface-700">
                  <h3 className="mb-1 text-sm font-medium text-surface-800 dark:text-surface-200">
                    {t('settings.data.purgeTrash')}
                  </h3>
                  <p className="mb-3 text-xs text-surface-400">
                    {t('settings.data.purgeDesc')}
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
                    {t('settings.data.purgeButton')}
                  </button>
                </div>
              </div>
            </section>
          )}

          {/* About */}
          {activeSection === 'about' && (
            <section>
              <h2 className="mb-6 text-lg font-semibold text-surface-900 dark:text-surface-50">
                {t('settings.about.heading')}
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
                    <p className="text-sm text-surface-500">{t('settings.about.versionValue', { version: APP_VERSION })}</p>
                  </div>
                </div>

                <div className="divide-y divide-surface-200 rounded-lg border border-surface-200 dark:divide-surface-700 dark:border-surface-700">
                  <div className="flex justify-between px-4 py-3">
                    <span className="text-sm text-surface-600 dark:text-surface-400">
                      {t('settings.about.application')}
                    </span>
                    <span className="text-sm font-medium text-surface-800 dark:text-surface-200">
                      {APP_NAME}
                    </span>
                  </div>
                  <div className="flex justify-between px-4 py-3">
                    <span className="text-sm text-surface-600 dark:text-surface-400">{t('settings.about.version')}</span>
                    <span className="text-sm font-medium text-surface-800 dark:text-surface-200">
                      {APP_VERSION}
                    </span>
                  </div>
                  <div className="flex justify-between px-4 py-3">
                    <span className="text-sm text-surface-600 dark:text-surface-400">
                      {t('settings.about.architecture')}
                    </span>
                    <span className="text-sm font-medium text-surface-800 dark:text-surface-200">
                      {t('settings.about.architectureValue')}
                    </span>
                  </div>
                  <div className="flex justify-between px-4 py-3">
                    <span className="text-sm text-surface-600 dark:text-surface-400">
                      {t('settings.about.encryption')}
                    </span>
                    <span className="text-sm font-medium text-surface-800 dark:text-surface-200">
                      {t('settings.about.encryptionValue')}
                    </span>
                  </div>
                  <div className="flex justify-between px-4 py-3">
                    <span className="text-sm text-surface-600 dark:text-surface-400">{t('settings.about.license')}</span>
                    <span className="text-sm font-medium text-surface-800 dark:text-surface-200">
                      {t('settings.about.licenseValue')}
                    </span>
                  </div>
                </div>

                <p className="text-xs leading-relaxed text-surface-400 dark:text-surface-500">
                  {t('settings.about.description')}
                </p>
              </div>
            </section>
          )}
        </div>
      </div>

      <ImportDialog
        isOpen={showImportDialog}
        onClose={() => setShowImportDialog(false)}
        activeVaultName={activeVaultName}
      />
      <ExportDialog
        isOpen={showExportDialog}
        onClose={() => setShowExportDialog(false)}
        activeVaultName={activeVaultName}
      />
    </div>
  );
}
