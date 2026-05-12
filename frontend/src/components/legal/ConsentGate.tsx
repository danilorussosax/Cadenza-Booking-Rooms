import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { LoaderCircle } from 'lucide-react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useAuth } from '@/contexts/AuthContext';
import { gdprApi } from '@/api/gdpr';
import { httpErrorMessage } from '@/lib/api';
import { PRIVACY_POLICY_VERSION, TERMS_VERSION } from '@/pages/legal/policyVersions';
import { useConsentGate } from '@/components/legal/useConsentGate';

// Banner-modale globale che obbliga l'utente autenticato ad accettare la
// versione corrente di Privacy Policy e Termini se quella registrata è
// assente o disallineata.
//
// Si attiva solo dopo il login (richiede `useAuth().user`). Non si attiva
// per gli admin: per loro un cambio policy dovrebbe arrivare per altre
// vie (notifica interna), non come blocco UI.
//
// La logica `needsConsent` vive in `useConsentGate()` ed e' condivisa
// col `CookieBanner` (che si nasconde finche' il gate e' attivo, per
// evitare il backdrop modale che intercetta i click sul banner).
export function ConsentGate() {
  const { logout } = useAuth();
  const qc = useQueryClient();
  const [acceptPrivacy, setAcceptPrivacy] = useState(false);
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const { needsConsent } = useConsentGate();

  const acceptMutation = useMutation({
    mutationFn: () =>
      Promise.all([
        gdprApi.setConsent({
          consentType: 'privacy_policy',
          granted: true,
          policyVersion: PRIVACY_POLICY_VERSION,
        }),
        gdprApi.setConsent({
          consentType: 'terms',
          granted: true,
          policyVersion: TERMS_VERSION,
        }),
      ]),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['gdpr', 'consents'] });
      toast.success('Grazie, consensi registrati.');
    },
    onError: (err) => {
      setServerError(httpErrorMessage(err));
    },
  });

  if (!needsConsent) return null;

  const canSubmit = acceptPrivacy && acceptTerms && !acceptMutation.isPending;

  return (
    <Dialog
      open={true}
      onOpenChange={() => {
        /* non chiudibile */
      }}
    >
      <DialogContent
        className="sm:max-w-lg"
        // Impedisce la chiusura con click fuori / tasto ESC: l'utente
        // deve scegliere "Accetta" oppure "Esci".
        onInteractOutside={(e) => {
          e.preventDefault();
        }}
        onEscapeKeyDown={(e) => {
          e.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>Aggiornamento dei documenti legali</DialogTitle>
          <DialogDescription>
            Abbiamo aggiornato la nostra Informativa sulla privacy e i Termini di servizio. Per
            continuare ad utilizzare l'applicazione è necessario prendere visione delle nuove
            versioni e accettarle.
          </DialogDescription>
        </DialogHeader>

        {serverError && (
          <Alert variant="destructive">
            <AlertDescription>{serverError}</AlertDescription>
          </Alert>
        )}

        <div className="space-y-3 text-sm">
          <label className="flex items-start gap-2">
            <Checkbox
              checked={acceptPrivacy}
              onCheckedChange={(v) => {
                setAcceptPrivacy(v === true);
              }}
            />
            <span className="leading-snug">
              Ho letto e accetto l'
              <Link to="/privacy-policy" target="_blank" rel="noreferrer" className="underline">
                Informativa sulla privacy
              </Link>{' '}
              (v. {PRIVACY_POLICY_VERSION}).
            </span>
          </label>
          <label className="flex items-start gap-2">
            <Checkbox
              checked={acceptTerms}
              onCheckedChange={(v) => {
                setAcceptTerms(v === true);
              }}
            />
            <span className="leading-snug">
              Accetto i{' '}
              <Link to="/terms" target="_blank" rel="noreferrer" className="underline">
                Termini di servizio
              </Link>{' '}
              (v. {TERMS_VERSION}).
            </span>
          </label>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              logout();
            }}
          >
            Esci
          </Button>
          <Button
            disabled={!canSubmit}
            onClick={() => {
              setServerError(null);
              acceptMutation.mutate();
            }}
          >
            {acceptMutation.isPending ? (
              <LoaderCircle className="h-4 w-4 animate-spin" />
            ) : (
              'Accetta e continua'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
