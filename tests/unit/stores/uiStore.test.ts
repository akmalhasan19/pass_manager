import { describe, it, expect, beforeEach } from 'vitest';
import { useUIStore } from '../../../src/renderer/stores/uiStore';

describe('uiStore', () => {
  beforeEach(() => {
    useUIStore.setState({
      sidebarOpen: true,
      darkMode: false,
      quickFindOpen: false,
      activeView: 'home',
    });
  });

  describe('initial state', () => {
    it('should start with sidebar open', () => {
      const state = useUIStore.getState();
      expect(state.sidebarOpen).toBe(true);
    });

    it('should start with quickFind closed', () => {
      const state = useUIStore.getState();
      expect(state.quickFindOpen).toBe(false);
    });

    it('should start with activeView as home', () => {
      const state = useUIStore.getState();
      expect(state.activeView).toBe('home');
    });
  });

  describe('toggleSidebar', () => {
    it('should toggle sidebar from open to closed', () => {
      useUIStore.getState().toggleSidebar();
      expect(useUIStore.getState().sidebarOpen).toBe(false);
    });

    it('should toggle sidebar back to open', () => {
      useUIStore.setState({ sidebarOpen: false });
      useUIStore.getState().toggleSidebar();
      expect(useUIStore.getState().sidebarOpen).toBe(true);
    });
  });

  describe('setSidebarOpen', () => {
    it('should set sidebarOpen to the given value', () => {
      useUIStore.getState().setSidebarOpen(false);
      expect(useUIStore.getState().sidebarOpen).toBe(false);

      useUIStore.getState().setSidebarOpen(true);
      expect(useUIStore.getState().sidebarOpen).toBe(true);
    });
  });

  describe('toggleDarkMode', () => {
    it('should toggle darkMode from false to true', () => {
      const store = useUIStore.getState();
      store.toggleDarkMode();
      expect(useUIStore.getState().darkMode).toBe(true);
    });

    it('should toggle darkMode back to false', () => {
      useUIStore.setState({ darkMode: true });
      useUIStore.getState().toggleDarkMode();
      expect(useUIStore.getState().darkMode).toBe(false);
    });
  });

  describe('setDarkMode', () => {
    it('should set darkMode to the given value', () => {
      useUIStore.getState().setDarkMode(true);
      expect(useUIStore.getState().darkMode).toBe(true);

      useUIStore.getState().setDarkMode(false);
      expect(useUIStore.getState().darkMode).toBe(false);
    });
  });

  describe('toggleQuickFind', () => {
    it('should toggle quickFindOpen from false to true', () => {
      useUIStore.getState().toggleQuickFind();
      expect(useUIStore.getState().quickFindOpen).toBe(true);
    });

    it('should toggle quickFindOpen back to false', () => {
      useUIStore.setState({ quickFindOpen: true });
      useUIStore.getState().toggleQuickFind();
      expect(useUIStore.getState().quickFindOpen).toBe(false);
    });
  });

  describe('setQuickFindOpen', () => {
    it('should set quickFindOpen to the given value', () => {
      useUIStore.getState().setQuickFindOpen(true);
      expect(useUIStore.getState().quickFindOpen).toBe(true);

      useUIStore.getState().setQuickFindOpen(false);
      expect(useUIStore.getState().quickFindOpen).toBe(false);
    });
  });

  describe('setActiveView', () => {
    it('should set activeView to home', () => {
      useUIStore.getState().setActiveView('home');
      expect(useUIStore.getState().activeView).toBe('home');
    });

    it('should set activeView to folder', () => {
      useUIStore.getState().setActiveView('folder');
      expect(useUIStore.getState().activeView).toBe('folder');
    });

    it('should set activeView to item', () => {
      useUIStore.getState().setActiveView('item');
      expect(useUIStore.getState().activeView).toBe('item');
    });

    it('should set activeView to health', () => {
      useUIStore.getState().setActiveView('health');
      expect(useUIStore.getState().activeView).toBe('health');
    });

    it('should set activeView to trash', () => {
      useUIStore.getState().setActiveView('trash');
      expect(useUIStore.getState().activeView).toBe('trash');
    });

    it('should set activeView to settings', () => {
      useUIStore.getState().setActiveView('settings');
      expect(useUIStore.getState().activeView).toBe('settings');
    });
  });
});
