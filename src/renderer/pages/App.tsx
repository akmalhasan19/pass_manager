import React, { useEffect } from 'react';
import { useAuthStore } from '../stores/authStore';
import { useTheme } from '../hooks/useTheme';
import LockScreenPage from './LockScreenPage';
import MainAppPage from './MainAppPage';

export default function App(): React.ReactElement {
  const { status, checkAuth } = useAuthStore();

  // Apply theme before any rendered content appears to avoid flashes.
  useTheme();

  useEffect(() => {
    if (status === 'idle') {
      checkAuth();
    }
  }, [status, checkAuth]);

  if (status === 'idle' || status === 'checking') {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-surface-50 dark:bg-surface-900">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-surface-300 border-t-accent-500 dark:border-surface-600" />
          <p className="text-sm text-surface-500 dark:text-surface-400">
            Loading SecurePass Manager...
          </p>
        </div>
      </div>
    );
  }

  if (status === 'setup' || status === 'locked') {
    return <LockScreenPage />;
  }

  return <MainAppPage />;
}
