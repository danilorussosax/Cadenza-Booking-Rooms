import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { loadConsent, saveConsent } from './cookieConsent';
import { useConsentGate } from './useConsentGate';

// Rotte pubbliche kiosk-style su cui il banner cookie NON deve apparire:
// /display gira su monitor pubblici senza utente loggato e senza profilazione,
// e il banner ruberebbe spazio verticale critico (specialmente su browser TV
// con viewport ridotto, es. 1200×615). I cookie tecnici di sessione/lingua
// non richiedono consenso (Provv. Garante 10/06/2021).
const KIOSK_ROUTES = ['/display'];

export function CookieBanner() {
  const location = useLocation();
  const [visible, setVisible] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [functional, setFunctional] = useState(false);
  const [analytics, setAnalytics] = useState(false);
  const { needsConsent: legalGateOpen } = useConsentGate();

  useEffect(() => {
    if (loadConsent() == null) setVisible(true);
  }, []);

  if (!visible) return null;
  if (KIOSK_ROUTES.some((r) => location.pathname.startsWith(r))) return null;
  // Se il ConsentGate (Aggiornamento documenti legali) e' aperto, il banner
  // resta nascosto: il backdrop modale del Dialog (z-50) intercettava i
  // click sui bottoni del banner che vive in z-50 ma e' renderizzato prima
  // nel DOM. Sequenza UX corretta: prima il consent legale (bloccante),
  // poi appare il banner cookie quando il dialog si chiude.
  if (legalGateOpen) return null;

  const acceptAll = () => {
    saveConsent({ functional: true, analytics: true });
    setVisible(false);
  };
  const rejectAll = () => {
    saveConsent({ functional: false, analytics: false });
    setVisible(false);
  };
  const saveCustom = () => {
    saveConsent({ functional, analytics });
    setVisible(false);
  };

  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-label="Preferenze cookie"
      className="fixed inset-x-0 bottom-0 z-50 border-t border-border/60 bg-background/95 px-4 py-4 shadow-lg backdrop-blur-sm"
    >
      <div className="mx-auto flex max-w-4xl flex-col gap-3">
        <div className="text-sm">
          <p>
            Questa applicazione utilizza <strong>cookie tecnici</strong> necessari al funzionamento
            del servizio (sessione, lingua) e, solo previo tuo consenso esplicito, cookie funzionali
            e di analisi statistica anonima. Rifiutare i cookie non essenziali non pregiudica l'uso
            del servizio. Per i dettagli consulta la{' '}
            <Link to="/privacy-policy" className="underline">
              Privacy Policy
            </Link>
            .
          </p>
        </div>

        {showDetails && (
          <div className="flex flex-col gap-3 rounded-md border border-border/60 bg-muted/30 p-3 text-sm">
            <div className="flex items-center justify-between gap-3">
              <div>
                <Label className="font-medium">Necessari</Label>
                <p className="text-xs text-muted-foreground">
                  Indispensabili per autenticazione e funzionamento. Sempre attivi.
                </p>
              </div>
              <Switch checked disabled aria-label="Cookie necessari (sempre attivi)" />
            </div>
            <div className="flex items-center justify-between gap-3">
              <div>
                <Label htmlFor="cookie-functional" className="font-medium">
                  Funzionali
                </Label>
                <p className="text-xs text-muted-foreground">
                  Memorizzano preferenze di visualizzazione (tema, layout).
                </p>
              </div>
              <Switch id="cookie-functional" checked={functional} onCheckedChange={setFunctional} />
            </div>
            <div className="flex items-center justify-between gap-3">
              <div>
                <Label htmlFor="cookie-analytics" className="font-medium">
                  Analisi statistica
                </Label>
                <p className="text-xs text-muted-foreground">
                  Misurazione anonima dell'uso, senza profilazione.
                </p>
              </div>
              <Switch id="cookie-analytics" checked={analytics} onCheckedChange={setAnalytics} />
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-end gap-2">
          {!showDetails && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setShowDetails(true);
              }}
            >
              Personalizza
            </Button>
          )}
          {/* Provvedimento Garante 10/06/2021: "Rifiuta" deve avere
              prominenza pari ad "Accetta" — stesso variant e stessa size. */}
          <Button variant="outline" size="sm" onClick={rejectAll}>
            Rifiuta
          </Button>
          {showDetails ? (
            <Button size="sm" onClick={saveCustom}>
              Salva preferenze
            </Button>
          ) : (
            <Button size="sm" onClick={acceptAll}>
              Accetta
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
