import i18n from 'i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import { initReactI18next } from 'react-i18next';
import dayjs from 'dayjs';
import 'dayjs/locale/it';
import 'dayjs/locale/en';
import 'dayjs/locale/es';
import 'dayjs/locale/de';
import 'dayjs/locale/fr';

import it from './locales/it.json';
import en from './locales/en.json';
import es from './locales/es.json';
import de from './locales/de.json';
import fr from './locales/fr.json';

export const SUPPORTED_LANGUAGES = ['it', 'en', 'es', 'de', 'fr'] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

export const LANGUAGE_NAMES: Record<SupportedLanguage, string> = {
  it: 'Italiano',
  en: 'English',
  es: 'Español',
  de: 'Deutsch',
  fr: 'Français',
};

const STORAGE_KEY = 'conservatory_lang';

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      it: { translation: it },
      en: { translation: en },
      es: { translation: es },
      de: { translation: de },
      fr: { translation: fr },
    },
    fallbackLng: 'it',
    supportedLngs: SUPPORTED_LANGUAGES,
    interpolation: { escapeValue: false },
    detection: {
      order: ['localStorage', 'navigator', 'htmlTag'],
      caches: ['localStorage'],
      lookupLocalStorage: STORAGE_KEY,
    },
  });

// Allinea il locale di dayjs alla lingua corrente.
function syncDayjsLocale(lng: string) {
  const base = (lng || 'it').split('-')[0];
  const supported = (SUPPORTED_LANGUAGES as readonly string[]).includes(base) ? base : 'it';
  dayjs.locale(supported);
  document.documentElement.lang = supported;
}
syncDayjsLocale((i18n.resolvedLanguage ?? i18n.language) || 'it');
i18n.on('languageChanged', syncDayjsLocale);

/**
 * Rileva la lingua preferita dal browser ignorando completamente la preferenza
 * salvata in localStorage. Usata dalla pagina /display (kiosk pubblico) per
 * adattarsi automaticamente alle impostazioni del dispositivo.
 *
 * Ritorna il primo codice supportato in `navigator.languages`,
 * altrimenti il fallback 'it'.
 */
export function detectBrowserLanguage(): SupportedLanguage {
  const candidates = (
    typeof navigator !== 'undefined'
      ? navigator.languages.length
        ? navigator.languages
        : [navigator.language]
      : []
  ) as string[];
  for (const raw of candidates) {
    if (!raw) continue;
    const base = raw.toLowerCase().split('-')[0];
    if ((SUPPORTED_LANGUAGES as readonly string[]).includes(base)) {
      return base as SupportedLanguage;
    }
  }
  return 'it';
}

export default i18n;
