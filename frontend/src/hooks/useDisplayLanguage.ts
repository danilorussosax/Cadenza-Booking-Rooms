import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { detectBrowserLanguage } from '@/i18n';

/**
 * Auto-rilevamento lingua del browser per il kiosk (/display è pubblico e gira
 * su monitor dedicati): all'apertura salva la lingua corrente, applica quella
 * del browser (e la ri-rileva su `languagechange`); all'unmount ripristina la
 * lingua salvata per non "sporcare" la preferenza di un eventuale utente loggato.
 */
export function useDisplayLanguage() {
  const { i18n } = useTranslation();
  const restoreLangRef = useRef<string | null>(null);
  useEffect(() => {
    const previous = (i18n.resolvedLanguage ?? i18n.language) || 'it';
    const browser = detectBrowserLanguage();
    restoreLangRef.current = previous;
    if (previous !== browser) {
      void i18n.changeLanguage(browser);
    }
    const onLangChange = () => void i18n.changeLanguage(detectBrowserLanguage());
    window.addEventListener('languagechange', onLangChange);
    return () => {
      window.removeEventListener('languagechange', onLangChange);
      const restore = restoreLangRef.current;
      if (restore && restore !== (i18n.resolvedLanguage ?? i18n.language)) {
        void i18n.changeLanguage(restore);
      }
    };
  }, [i18n]);
}
