import React, { useState, useEffect, useCallback } from 'react';

export default function TitleBar(): React.ReactElement {
  const [isMaximized, setIsMaximized] = useState(false);
  const [platform, setPlatform] = useState<string>('win32');

  useEffect(() => {
    // Detect platform
    const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
    setPlatform(isMac ? 'darwin' : process.platform || 'win32');

    // Check initial maximize state
    window.electron.window.isMaximized().then(setIsMaximized);

    // Listen for maximize/unmaximize events via IPC if available
    const checkMaximized = async () => {
      const maximized = await window.electron.window.isMaximized();
      setIsMaximized(maximized);
    };

    // Poll maximize state (Electron doesn't expose window events to renderer easily)
    const interval = setInterval(checkMaximized, 1000);
    return () => clearInterval(interval);
  }, []);

  const handleMinimize = useCallback(async () => {
    await window.electron.window.minimize();
  }, []);

  const handleMaximize = useCallback(async () => {
    await window.electron.window.maximize();
    const maximized = await window.electron.window.isMaximized();
    setIsMaximized(maximized);
  }, []);

  const handleClose = useCallback(async () => {
    await window.electron.window.close();
  }, []);

  const isMacOS = platform === 'darwin';

  return (
    <div
      className={`h-10 flex items-center shrink-0 select-none ${
        isMacOS ? 'justify-center' : 'justify-between'
      } bg-white dark:bg-surface-850 border-b border-surface-200 dark:border-surface-700`}
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      {/* macOS traffic lights */}
      {isMacOS && (
        <div
          className="absolute left-3 top-1/2 -translate-y-1/2 flex items-center gap-2 z-10"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          <button
            className="w-3 h-3 rounded-full bg-[#ff5f57] hover:bg-[#ff4040] transition-colors flex items-center justify-center group"
            onClick={handleClose}
            aria-label="Close"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-2 w-2 text-[#4a0000] opacity-0 group-hover:opacity-100 transition-opacity" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
          <button
            className="w-3 h-3 rounded-full bg-[#febc2e] hover:bg-[#ffa500] transition-colors flex items-center justify-center group"
            onClick={handleMinimize}
            aria-label="Minimize"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-2 w-2 text-[#5a3e00] opacity-0 group-hover:opacity-100 transition-opacity" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M20 12H4" />
            </svg>
          </button>
          <button
            className="w-3 h-3 rounded-full bg-[#28c840] hover:bg-[#20a834] transition-colors flex items-center justify-center group"
            onClick={handleMaximize}
            aria-label={isMaximized ? 'Restore' : 'Maximize'}
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-2 w-2 text-[#0a4a00] opacity-0 group-hover:opacity-100 transition-opacity" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
              {isMaximized ? (
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 9V4.5M9 9H4.5M9 9L3.75 3.75M9 15v4.5M9 15H4.5M9 15l-5.25 5.25M15 9h4.5M15 9V4.5M15 9l5.25-5.25M15 15h4.5M15 15v4.5m0-4.5l5.25 5.25" />
              ) : (
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 9V4.5M9 9H4.5M9 9L3.75 3.75M15 15v4.5M15 15H4.5M15 15l-5.25 5.25" />
              )}
            </svg>
          </button>
        </div>
      )}

      {/* App logo and name (center for macOS, left for others) */}
      <div className={`flex items-center gap-2 ${isMacOS ? 'ml-20' : 'ml-3'}`}>
        <span className="text-base">🔐</span>
        <span className="text-xs font-medium text-surface-600 dark:text-surface-400">
          SecurePass Manager
        </span>
      </div>

      {/* Windows/Linux window controls */}
      {!isMacOS && (
        <div
          className="flex items-center h-full"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          <button
            className="h-full px-3 text-surface-500 hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors"
            onClick={handleMinimize}
            aria-label="Minimize"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M20 12H4" />
            </svg>
          </button>
          <button
            className="h-full px-3 text-surface-500 hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors"
            onClick={handleMaximize}
            aria-label={isMaximized ? 'Restore' : 'Maximize'}
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              {isMaximized ? (
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 9V4.5M9 9H4.5M9 9L3.75 3.75M9 15v4.5M9 15H4.5M9 15l-5.25 5.25M15 9h4.5M15 9V4.5M15 9l5.25-5.25M15 15h4.5M15 15v4.5m0-4.5l5.25 5.25" />
              ) : (
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 4h16v16H4z" />
              )}
            </svg>
          </button>
          <button
            className="h-full px-3 text-surface-500 hover:bg-danger-500 hover:text-white transition-colors"
            onClick={handleClose}
            aria-label="Close"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}
    </div>
  );
}
