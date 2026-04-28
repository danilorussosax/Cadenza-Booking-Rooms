import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Download, Smartphone, X } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import {
  clearDeferredPrompt,
  getDeferredPrompt,
  getVisitCount,
  isA2hsDismissed,
  isA2hsInstalled,
  isIos,
  isStandalone,
  setA2hsDismissed,
} from '@/lib/pwa';

// =============================================================================
// Add-to-HomeScreen prompt.
//
// Si mostra solo quando:
//   - l'app non è già installata (display:standalone)
//   - l'utente NON ha "X-out" il prompt in passato
//   - non è la prima visita (visit count >= 2) — evita di assillare al primo
//     accesso esplorativo
//   - il browser ha emesso `beforeinstallprompt` (Chrome/Edge/Android), oppure
//     siamo su iOS Safari (mostra istruzioni manuali)
//
// L'evento `beforeinstallprompt` può arrivare DOPO il render iniziale: stiamo
// quindi in ascolto via window listener invece di leggere subito.
// =============================================================================

const POLL_MS = 1500;
const MIN_VISITS = 2;

export function InstallPwaPrompt() {
  const { t } = useTranslation();
  const [show, setShow] = useState(false);
  const [iosMode, setIosMode] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (isStandalone() || isA2hsInstalled() || isA2hsDismissed()) return;
    if (getVisitCount() < MIN_VISITS) return;

    // iOS Safari: niente beforeinstallprompt → istruzioni manuali.
    if (isIos()) {
      setIosMode(true);
      // Piccolo delay per non saltare in faccia all'utente al boot.
      const timer = setTimeout(() => {
        setShow(true);
      }, 2000);
      return () => {
        clearTimeout(timer);
      };
    }

    // Android/desktop: aspettiamo che il prompt deferred sia disponibile.
    // Il listener su `beforeinstallprompt` è in `lib/pwa.ts` (setupPwa),
    // qui facciamo polling breve perché l'evento può arrivare prima/dopo
    // il mount di questo componente.
    let cancelled = false;
    const tick = () => {
      if (cancelled) return;
      if (getDeferredPrompt()) {
        setShow(true);
        return;
      }
      window.setTimeout(tick, POLL_MS);
    };
    tick();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!show) return null;

  const handleDismiss = () => {
    setA2hsDismissed();
    setShow(false);
  };

  const handleInstall = async () => {
    const deferred = getDeferredPrompt();
    if (!deferred) {
      setShow(false);
      return;
    }
    try {
      await deferred.prompt();
      const choice = await deferred.userChoice;
      if (choice.outcome === 'dismissed') setA2hsDismissed();
    } finally {
      clearDeferredPrompt();
      setShow(false);
    }
  };

  return (
    <AnimatePresence>
      <motion.div
        role="dialog"
        aria-live="polite"
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 24 }}
        transition={{ duration: 0.2 }}
        className="fixed inset-x-3 bottom-3 z-40 mx-auto max-w-md rounded-2xl border bg-card p-4 shadow-2xl sm:inset-x-auto sm:left-auto sm:right-4"
      >
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary ring-1 ring-primary/20">
            <Smartphone className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1 space-y-1.5">
            <p className="font-medium leading-tight">{t('pwa.install.title')}</p>
            <p className="text-xs text-muted-foreground">
              {iosMode ? t('pwa.install.subtitle_ios') : t('pwa.install.subtitle')}
            </p>
            <div className="flex flex-wrap gap-2 pt-1">
              {!iosMode && (
                <Button
                  size="sm"
                  onClick={() => {
                    void handleInstall();
                  }}
                >
                  <Download className="h-4 w-4" />
                  {t('pwa.install.cta')}
                </Button>
              )}
              <Button variant="ghost" size="sm" onClick={handleDismiss}>
                {t('pwa.install.dismiss')}
              </Button>
            </div>
          </div>
          <button
            type="button"
            onClick={handleDismiss}
            aria-label={t('pwa.install.dismiss')}
            className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
