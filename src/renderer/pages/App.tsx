import React, { useEffect } from 'react';
import { useAuthStore } from '../stores/authStore';
import { useItemStore } from '../stores/itemStore';
import { useFolderStore } from '../stores/folderStore';
import { useTheme } from '../hooks/useTheme';
import { useAuthNotifications } from '../hooks/useAuthNotifications';
import LockScreenPage from './LockScreenPage';
import MainAppPage from './MainAppPage';
import DebugPanel from '../components/debug/DebugPanel';
import { captureError } from '../stores/errorStore';

export default function App(): React.ReactElement {
  const { status, checkAuth, error: authError } = useAuthStore();
  const itemError = useItemStore((s) => s.error);
  const folderError = useFolderStore((s) => s.error);

  // Apply theme before any rendered content appears to avoid flashes.
  useTheme();

  // Listen for auth state changes and show notifications
  useAuthNotifications();

  useEffect(() => {
    if (authError) captureError(authError, 'authStore');
  }, [authError]);

  useEffect(() => {
    if (itemError) captureError(itemError, 'itemStore');
  }, [itemError]);

  useEffect(() => {
    if (folderError) captureError(folderError, 'folderStore');
  }, [folderError]);

  useEffect(() => {
    if (status === 'idle') {
      checkAuth();
    }
  }, [status, checkAuth]);

  return (
    <>
      {status === 'idle' || status === 'checking' ? (
        <div className="flex h-screen w-screen items-center justify-center bg-surface-50 dark:bg-surface-900">
          <div className="flex flex-col items-center gap-3">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-surface-300 border-t-accent-500 dark:border-surface-600" />
            <p className="text-sm text-surface-500 dark:text-surface-400">
              Loading SecurePass Manager...
            </p>
          </div>
        </div>
      ) : status === 'setup' || status === 'locked' ? (
        <LockScreenPage />
      ) : (
        <MainAppPage />
      )}
      <DebugPanel />
    </>
  );
}
