import { useMemo } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { institutesApi } from '@/api/institutes';
import { ThemeToggle } from '@/components/ThemeToggle';
import { LanguageToggle } from '@/components/LanguageToggle';
import { AppFooter } from '@/components/AppFooter';
import { useAppIcon } from '@/hooks/useAppIcon';
import type { ReactNode } from 'react';

interface QuoteEntry {
  text: string;
  attribution: string;
}

interface Props {
  children: ReactNode;
  /** Subtitle / quote shown under the brand on the left panel */
  quote?: string;
  attribution?: string;
  /**
   * Immagine di sfondo per il pannello form (destra). Se valorizzata, viene
   * renderizzata sfocata con un overlay theme-aware per garantire la
   * leggibilità di input e testi sopra di essa. Solo /login la usa al momento.
   */
  formBgImage?: string;
}

export function AuthLayout({ children, quote, attribution, formBgImage }: Props) {
  const { t } = useTranslation();
  const appIcon = useAppIcon();
  const { data } = useQuery({
    queryKey: ['institute', 'public'],
    queryFn: () => institutesApi.public(),
    staleTime: 5 * 60 * 1000,
  });

  const institute = data?.institute;

  // Aforismi a rotazione: se i props quote/attribution non sono passati
  // (caso /login + /register, mentre /complete-profile ne forza i propri),
  // peschiamo casualmente da `auth.auth_layout.quotes` (i18n array di
  // {text, attribution}). useMemo con dep [] mantiene la quote stabile per
  // tutta la durata del mount — rotazione su page-load, non su re-render.
  const quotes = useMemo(() => {
    const raw = t('auth.auth_layout.quotes', { returnObjects: true }) as unknown;
    return Array.isArray(raw) ? (raw as QuoteEntry[]) : [];
  }, [t]);

  const pickedQuote = useMemo<QuoteEntry | null>(() => {
    if (quotes.length === 0) return null;
    return quotes[Math.floor(Math.random() * quotes.length)] ?? null;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- quote stabile per il mount: vogliamo rotazione su page-load, non su re-render quando cambia `quotes`
  }, []);

  const finalQuote = quote ?? pickedQuote?.text ?? '';
  const finalAttribution = attribution ?? pickedQuote?.attribution ?? '';

  return (
    <div className="relative">
      {/* Background image + overlay (login only): `fixed inset-0` per
       * coprire l'intero viewport incluse le safe-area iOS (notch + home
       * indicator). Posizionate al di FUORI del `<main>` (che ha
       * `overflow-hidden`) per evitare qualsiasi clipping. Su lg+ l'aside
       * a sinistra ha `bg-primary` solido che copre comunque il bg fixed
       * lì, quindi visualmente l'immagine appare solo sulla colonna form
       * (destra). */}
      {formBgImage && (
        <>
          <div
            aria-hidden
            className="pointer-events-none fixed inset-0 z-0 scale-105 bg-cover bg-center blur-xs saturate-110"
            style={{ backgroundImage: `url(${formBgImage})` }}
          />
          <div
            aria-hidden
            className="pointer-events-none fixed inset-0 z-0 bg-background/70 dark:bg-background/80"
          />
        </>
      )}
      <div className="relative z-10 grid min-h-dvh w-full lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
        {/* Brand panel */}
        <motion.aside
          initial={{ opacity: 0, x: -16 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.45, ease: 'easeOut' }}
          className="relative hidden overflow-hidden bg-primary text-primary-foreground lg:flex lg:flex-col lg:justify-between lg:p-12"
        >
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(255,255,255,0.18),transparent_55%),radial-gradient(circle_at_80%_80%,rgba(255,255,255,0.10),transparent_45%)]"
          />
          <div className="relative flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-white/10 ring-1 ring-white/20 backdrop-blur-sm">
              {institute?.logoUrl ? (
                <img
                  src={institute.logoUrl}
                  alt={institute.name}
                  className="h-9 w-9 object-contain"
                />
              ) : (
                <img src={appIcon} alt="" className="h-9 w-9 object-contain" />
              )}
            </div>
            <div>
              <p className="font-display text-lg font-medium leading-tight">
                {institute?.name ?? t('app.subtitle')}
              </p>
            </div>
          </div>

          <div className="relative max-w-md space-y-6">
            <h1 className="font-display text-4xl font-medium leading-tight">
              {t('auth.auth_layout.tagline')}
              <br />
              <span className="text-primary-foreground/70">{t('auth.auth_layout.tagline2')}</span>
            </h1>
            <blockquote className="border-l-2 border-primary-foreground/40 pl-4 text-base italic text-primary-foreground/80">
              «{finalQuote}»
              <footer className="mt-2 text-sm not-italic text-primary-foreground/60">
                — {finalAttribution}
              </footer>
            </blockquote>
          </div>

          <div className="relative text-xs text-primary-foreground/60">
            © {new Date().getFullYear()} {institute?.name ?? t('app.institute_default')}
            {institute?.city ? ` · ${institute.city}` : ''}
          </div>
        </motion.aside>

        {/* Form panel */}
        <main
          id="main-content"
          tabIndex={-1}
          className="relative flex min-h-full items-center justify-center px-4 py-10 focus-visible:outline-hidden sm:px-6 lg:px-12"
        >
          {/* Toggle bar (lingua + tema): safe-pt rispetta il notch / status bar
           * iOS (in PWA standalone e Safari mobile in landscape la status bar
           * coprirebbe i bottoni a top-4, intercettando i tap). */}
          <div className="safe-pt absolute right-4 top-4 z-10 flex items-center gap-1 sm:right-6 sm:top-6">
            <LanguageToggle />
            <ThemeToggle />
          </div>
          {/* Mobile institute brand: logo SOPRA il nome, centrato, sfondo
           * trasparente (niente container `bg-primary` colorato che alterava
           * i colori originali del logo dell'istituto). Posizionato in alto
           * col `safe-pt` per rispettare il notch, fuori dal motion.div
           * centrale così non si muove col form. */}
          <div className="safe-pt absolute inset-x-0 top-6 z-10 flex flex-col items-center gap-2 px-16 sm:top-8 lg:hidden">
            {institute?.logoUrl ? (
              <img
                src={institute.logoUrl}
                alt={institute.name}
                className="h-14 w-14 object-contain"
              />
            ) : (
              <img src={appIcon} alt="" className="h-14 w-14 object-contain" />
            )}
            <p className="text-center font-display text-sm font-medium leading-tight">
              {institute?.name ?? t('app.subtitle')}
            </p>
          </div>
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: 'easeOut', delay: 0.05 }}
            className="relative z-10 w-full max-w-md"
          >
            {children}
          </motion.div>
          <AppFooter className="absolute inset-x-0 bottom-0 z-10" />
        </main>
      </div>
    </div>
  );
}
