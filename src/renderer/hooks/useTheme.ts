import { useEffect, useCallback, useRef } from 'react';
import { useSettingsStore } from '../stores/settingsStore';
import { useUIStore } from '../stores/uiStore';

/**
 * Syncs the application's visual theme with the persisted setting.
 *
 * The settings DB is the source of truth. The effective theme is computed as:
 * - `light`  → light mode
 * - `dark`   → dark mode
 * - `system` → follows the OS preference
 *
 * The hook applies the Tailwind `dark` class to `<html>` and keeps the
 * `uiStore.darkMode` flag in sync for components that read it.
 */
export function useTheme(): void {
  const { settings, isLoaded, loadSettings } = useSettingsStore();
  const setDarkMode = useUIStore((state) => state.setDarkMode);
  const systemMediaRef = useRef<MediaQueryList | null>(null);

  const applyEffectiveTheme = useCallback(
    (theme: 'light' | 'dark' | 'system') => {
      const prefersDark = systemMediaRef.current?.matches ?? false;
      const isDark = theme === 'dark' || (theme === 'system' && prefersDark);

      const root = document.documentElement;
      if (isDark) {
        root.classList.add('dark');
      } else {
        root.classList.remove('dark');
      }

      setDarkMode(isDark);
    },
    [setDarkMode],
  );

  // Load settings on mount and apply the system preference immediately to avoid
  // an unstyled flash before the persisted setting is read.
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    systemMediaRef.current = media;

    if (!isLoaded) {
      const prefersDark = media.matches;
      const root = document.documentElement;
      if (prefersDark) {
        root.classList.add('dark');
      } else {
        root.classList.remove('dark');
      }
      setDarkMode(prefersDark);
      loadSettings();
    }
  }, [isLoaded, loadSettings, setDarkMode]);

  // Apply theme whenever the persisted setting changes.
  useEffect(() => {
    if (!isLoaded) return;
    applyEffectiveTheme(settings.theme);
  }, [settings.theme, isLoaded, applyEffectiveTheme]);

  // Re-evaluate theme when OS preference changes (only matters for 'system').
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const media = window.matchMedia('(prefers-color-scheme: dark)');
    systemMediaRef.current = media;

    const handleChange = () => {
      if (settings.theme === 'system') {
        applyEffectiveTheme('system');
      }
    };

    media.addEventListener('change', handleChange);
    return () => media.removeEventListener('change', handleChange);
  }, [settings.theme, applyEffectiveTheme]);
}
