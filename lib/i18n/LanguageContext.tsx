import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  Language,
  TranslationKey,
  translations,
  formatString,
} from '@/lib/i18n/translations';

const STORAGE_KEY = 'priorauth_language';

function initialLanguage(): Language {
  if (typeof window === 'undefined') return 'en';
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === 'ar' || stored === 'en') return stored;
  } catch {
    /* ignore storage errors */
  }
  const nav = window.navigator?.language?.toLowerCase?.() || '';
  if (nav.startsWith('ar')) return 'ar';
  return 'en';
}

interface LanguageContextValue {
  language: Language;
  dir: 'ltr' | 'rtl';
  setLanguage: (lang: Language) => void;
  toggleLanguage: () => void;
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
  translateServerError: (code: string | undefined, fallback: string) => string;
}

const LanguageContext = createContext<LanguageContextValue | null>(null);

export const LanguageProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [language, setLanguageState] = useState<Language>(initialLanguage);

  const setLanguage = useCallback((lang: Language) => {
    setLanguageState(lang);
    try {
      window.localStorage.setItem(STORAGE_KEY, lang);
    } catch {
      /* ignore storage errors */
    }
  }, []);

  const toggleLanguage = useCallback(() => {
    setLanguageState((prev) => {
      const next: Language = prev === 'en' ? 'ar' : 'en';
      try {
        window.localStorage.setItem(STORAGE_KEY, next);
      } catch {
        /* ignore storage errors */
      }
      return next;
    });
  }, []);

  // Sync <html lang/dir> for proper RTL/LTR behavior across the whole app.
  useEffect(() => {
    const root = document.documentElement;
    root.lang = language;
    root.dir = language === 'ar' ? 'rtl' : 'ltr';
    root.classList.toggle('rtl', language === 'ar');
    root.classList.toggle('ltr', language === 'en');
  }, [language]);

  const value = useMemo<LanguageContextValue>(
    () => ({
      language,
      dir: language === 'ar' ? 'rtl' : 'ltr',
      setLanguage,
      toggleLanguage,
      t: (key, params) => formatString(translations[language][key], params),
      translateServerError: (code, fallback) => {
        switch (code) {
          case 'NO_PAYER_MATCH':
            return translations[language].errNoPayerMatch;
          case 'NO_PAYERS_IN_DATABASE':
            return translations[language].errNoPayersInDb;
          case 'PAYLOAD_TOO_LARGE':
            return translations[language].errPayloadTooLarge;
          case 'EMPTY_PROMPT':
            return translations[language].errEmptyPrompt;
          default:
            return fallback;
        }
      },
    }),
    [language, setLanguage, toggleLanguage]
  );

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
};

export function useLanguage(): LanguageContextValue {
  const ctx = useContext(LanguageContext);
  if (!ctx) {
    throw new Error('useLanguage must be used within a LanguageProvider');
  }
  return ctx;
}

export { STORAGE_KEY };