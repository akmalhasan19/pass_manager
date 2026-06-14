import React, { useEffect } from 'react';
import TitleBar from '../components/layout/TitleBar';
import Sidebar from '../components/layout/Sidebar';
import MainPanel from '../components/layout/MainPanel';
import QuickFind from '../components/layout/QuickFind';
import { useUIStore } from '../stores/uiStore';

export default function MainAppPage(): React.ReactElement {
  const { darkMode } = useUIStore();

  useEffect(() => {
    const root = document.documentElement;
    if (darkMode) {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
  }, [darkMode]);

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-surface-50 dark:bg-surface-900">
      <TitleBar />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />
        <MainPanel />
      </div>
      <QuickFind />
    </div>
  );
}
