import React from 'react';
import TitleBar from '../components/layout/TitleBar';
import Sidebar from '../components/layout/Sidebar';
import MainPanel from '../components/layout/MainPanel';
import QuickFind from '../components/layout/QuickFind';
import ToastContainer from '../components/ui/ToastContainer';
import { useAutoLock } from '../hooks/useAutoLock';
import { useUIStore } from '../stores/uiStore';

export default function MainAppPage(): React.ReactElement {
  const { timeRemaining, showWarning, extendTimer, isEnabled } = useAutoLock();
  const activeView = useUIStore((s) => s.activeView);

  const formatTime = (ms: number): string => {
    if (ms === Infinity) return '';
    const seconds = Math.ceil(ms / 1000);
    if (seconds >= 60) {
      const min = Math.floor(seconds / 60);
      const sec = seconds % 60;
      return `${min}m ${sec}s`;
    }
    return `${seconds}s`;
  };

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-surface-50 dark:bg-surface-900">
      <TitleBar />
      <div className="flex flex-1 overflow-hidden">
        {activeView !== 'home' && <Sidebar />}
        <MainPanel />
      </div>
      <QuickFind />
      <ToastContainer />

      {/* Auto-lock idle warning */}
      {isEnabled && showWarning && (
        <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 animate-slide-up">
          <div className="flex items-center gap-4 rounded-xl border border-surface-600 bg-surface-800 px-5 py-3 text-white shadow-2xl dark:bg-surface-700">
            <div className="flex items-center gap-2">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-5 w-5 shrink-0 text-warning-400"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                />
              </svg>
              <div>
                <p className="text-sm font-medium">Session expiring</p>
                <p className="text-xs text-surface-300">Auto-lock in {formatTime(timeRemaining)}</p>
              </div>
            </div>
            <button
              className="shrink-0 rounded-md bg-white/10 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-white/20"
              onClick={extendTimer}
            >
              Extend session
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
