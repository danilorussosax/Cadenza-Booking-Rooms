import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowLeft, Home, ShieldAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { AuthLayout } from '@/components/layout/AuthLayout';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type Provider = 'google' | 'microsoft';

// =============================================================================
// /auth/oauth-unavailable — landing pagine quando l'utente clicca Login con
// Google / Microsoft ma la strategia non è registrata lato server (env vars
// mancanti E settings DB inattive). Il backend redirige qui invece di
// rispondere con JSON 503 — vedi backend/routes/auth.js.
//
// Riusa AuthLayout (stesso split sinistra brand + destra contenuto del login)
// così la transizione è coerente e l'utente capisce dov'è. Il pannello destro
// mostra le grafiche del provider (Google a 4 colori o Microsoft a 4 quadrati)
// in versione grande per chiarire visivamente quale flusso è indisponibile.
// =============================================================================
export default function OAuthUnavailable() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const rawProvider = params.get('provider');
  const provider: Provider = rawProvider === 'microsoft' ? 'microsoft' : 'google';
  const cfg = useMemo(() => PROVIDER_CONFIG[provider], [provider]);

  return (
    <AuthLayout>
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="space-y-6"
      >
        {/* Hero branded del provider */}
        <div
          className={cn(
            'flex items-center gap-4 rounded-xl border bg-card p-5 shadow-xs',
            cfg.borderClass,
          )}
        >
          <div
            className={cn(
              'flex h-16 w-16 shrink-0 items-center justify-center rounded-lg',
              cfg.iconBgClass,
            )}
          >
            {provider === 'google' ? <GoogleLogoLarge /> : <MicrosoftLogoLarge />}
          </div>
          <div className="min-w-0 space-y-0.5">
            <p
              className={cn(
                'text-[10px] font-semibold uppercase tracking-[0.2em]',
                cfg.eyebrowClass,
              )}
            >
              {t('auth.oauth_unavailable.eyebrow')}
            </p>
            <p className="font-display text-2xl font-semibold leading-tight">
              {t(cfg.providerNameKey)}
            </p>
          </div>
        </div>

        {/* Titolo + spiegazione */}
        <div className="space-y-2">
          <h1 className="font-display text-3xl font-medium tracking-tight">{t(cfg.titleKey)}</h1>
          <p className="text-sm text-muted-foreground">{t(cfg.bodyKey)}</p>
        </div>

        {/* Box info "perché vedo questa pagina" */}
        <div className="flex gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3.5 dark:border-amber-900/40 dark:bg-amber-950/30">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-700 dark:text-amber-400" />
          <p className="text-xs text-amber-900 dark:text-amber-200">
            {t('auth.oauth_unavailable.hint')}
          </p>
        </div>

        {/* Azioni */}
        <div className="grid gap-2 sm:grid-cols-2">
          <Button asChild className="h-11">
            <Link to="/login">
              <ArrowLeft className="h-4 w-4" />
              <span>{t('auth.oauth_unavailable.back_to_login')}</span>
            </Link>
          </Button>
          <Button asChild variant="outline" className="h-11">
            <Link to="/">
              <Home className="h-4 w-4" />
              <span>{t('auth.oauth_unavailable.go_home')}</span>
            </Link>
          </Button>
        </div>
      </motion.div>
    </AuthLayout>
  );
}

// ============================================================
// Provider configs — colore brand e classi della hero card
// ============================================================
const PROVIDER_CONFIG: Record<
  Provider,
  {
    providerNameKey: string;
    titleKey: string;
    bodyKey: string;
    borderClass: string;
    iconBgClass: string;
    eyebrowClass: string;
  }
> = {
  google: {
    providerNameKey: 'auth.oauth_unavailable.provider_google',
    titleKey: 'auth.oauth_unavailable.title_google',
    bodyKey: 'auth.oauth_unavailable.body_google',
    borderClass: 'border-[#4285F4]/30',
    iconBgClass: 'bg-[#4285F4]/8',
    eyebrowClass: 'text-[#4285F4]',
  },
  microsoft: {
    providerNameKey: 'auth.oauth_unavailable.provider_microsoft',
    titleKey: 'auth.oauth_unavailable.title_microsoft',
    bodyKey: 'auth.oauth_unavailable.body_microsoft',
    borderClass: 'border-[#00A4EF]/30',
    iconBgClass: 'bg-[#00A4EF]/8',
    eyebrowClass: 'text-[#0078D4]',
  },
};

// ============================================================
// Brand logos — versione grande del provider (38×38 contro 16
// del Login). Stesso pattern di Login.tsx, ma scalato per
// l'uso eroico nella hero card.
// ============================================================
const GoogleLogoLarge = () => (
  <svg viewBox="0 0 48 48" className="h-9 w-9" aria-hidden>
    <path
      fill="#4285F4"
      d="M45.12 24.5c0-1.56-.14-3.06-.4-4.5H24v8.51h11.84c-.51 2.75-2.06 5.08-4.39 6.64v5.52h7.11c4.16-3.83 6.56-9.47 6.56-16.17z"
    />
    <path
      fill="#34A853"
      d="M24 46c5.94 0 10.92-1.97 14.56-5.33l-7.11-5.52c-1.97 1.32-4.49 2.1-7.45 2.1-5.73 0-10.58-3.87-12.31-9.07H4.34v5.7C7.96 41.07 15.4 46 24 46z"
    />
    <path
      fill="#FBBC05"
      d="M11.69 28.18c-.44-1.32-.69-2.73-.69-4.18s.25-2.86.69-4.18v-5.7H4.34A21.98 21.98 0 0 0 2 24c0 3.55.85 6.91 2.34 9.88l7.35-5.7z"
    />
    <path
      fill="#EA4335"
      d="M24 10.75c3.23 0 6.13 1.11 8.41 3.29l6.31-6.31C34.91 4.18 29.93 2 24 2 15.4 2 7.96 6.93 4.34 14.12l7.35 5.7c1.73-5.2 6.58-9.07 12.31-9.07z"
    />
  </svg>
);

const MicrosoftLogoLarge = () => (
  <svg viewBox="0 0 24 24" className="h-9 w-9" aria-hidden>
    <rect x="2" y="2" width="9.5" height="9.5" fill="#F25022" />
    <rect x="12.5" y="2" width="9.5" height="9.5" fill="#7FBA00" />
    <rect x="2" y="12.5" width="9.5" height="9.5" fill="#00A4EF" />
    <rect x="12.5" y="12.5" width="9.5" height="9.5" fill="#FFB900" />
  </svg>
);
