import { create } from 'zustand';
import enTranslations from './locales/en.json';
import type idTranslations from './locales/id.json';

export type Locale = 'en' | 'id';

type TranslationMap = Record<string, string>;

const localeLoaders: Record<Locale, () => Promise<TranslationMap>> = {
  en: async () => enTranslations as unknown as TranslationMap,
  id: async () => {
    const mod = await import('./locales/id.json');
    return (mod.default ?? mod) as unknown as TranslationMap;
  },
};

interface TranslationStore {
  locale: Locale;
  translations: TranslationMap;
  setLocale: (locale: Locale) => Promise<void>;
}

export const useTranslationStore = create<TranslationStore>((set) => ({
  locale: 'en',
  translations: enTranslations as unknown as TranslationMap,
  setLocale: async (locale: Locale) => {
    const loader = localeLoaders[locale];
    if (!loader) return;
    const translations = await loader();
    set({ locale, translations });
  },
}));

function interpolate(template: string, params?: Record<string, string | number>): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (_, key: string) => {
    const value = params[key];
    return value !== undefined ? String(value) : `{${key}}`;
  });
}

/**
 * Translation function for use outside React components (e.g., in Zustand stores).
 * Accesses the translation store directly.
 */
export function t(key: string, params?: Record<string, string | number>): string {
  const translations = useTranslationStore.getState().translations;
  const template = translations[key];
  if (template === undefined) {
    return key.split('.').pop() ?? key;
  }
  return interpolate(template, params);
}

export function useTranslation() {
  const translations = useTranslationStore((s) => s.translations);
  const locale = useTranslationStore((s) => s.locale);
  const setLocale = useTranslationStore((s) => s.setLocale);

  function t(key: string, params?: Record<string, string | number>): string {
    const template = translations[key];
    if (template === undefined) {
      return key.split('.').pop() ?? key;
    }
    return interpolate(template, params);
  }

  return { t, locale, setLocale };
}
