import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { gdprApi } from '@/api/gdpr';
import { PRIVACY_POLICY_VERSION, TERMS_VERSION } from '@/pages/legal/policyVersions';

/**
 * Stato del ConsentGate (Dialog "Aggiornamento documenti legali").
 *
 * `needsConsent` è `true` quando l'utente loggato (non-admin) deve ancora
 * accettare la versione corrente di Privacy Policy / Termini di servizio.
 * Quando true il `ConsentGate` mostra un Dialog modale non chiudibile.
 *
 * Esposto come hook condiviso così che altri componenti possano
 * coordinarsi col gate. In particolare, il `CookieBanner` lo usa per
 * nascondersi finché il gate è aperto: senza coordinazione, il backdrop
 * full-screen del Dialog (z-50, bg-black/50) intercetterebbe i click sui
 * bottoni del banner cookie (che vive in z-50 ma sotto al backdrop nel
 * DOM order via Portal).
 */
export function useConsentGate(): { needsConsent: boolean; isLoading: boolean } {
  const { user } = useAuth();

  const consentsQuery = useQuery({
    queryKey: ['gdpr', 'consents'],
    queryFn: () => gdprApi.getConsents(),
    enabled: !!user && user.role !== 'admin',
    staleTime: 60 * 1000,
  });

  const needsConsent = useMemo(() => {
    if (!user) return false;
    if (user.role === 'admin') return false;
    // Mentre la query carica, NON mostriamo il gate (false) per evitare
    // flash del Dialog all'arrivo dei dati. Stesso comportamento del
    // ConsentGate originale.
    if (consentsQuery.isLoading) return false;
    const c = consentsQuery.data?.consents ?? {};
    const privacyOk =
      c.privacy_policy?.granted === true &&
      c.privacy_policy.policyVersion === PRIVACY_POLICY_VERSION;
    const termsOk = c.terms?.granted === true && c.terms.policyVersion === TERMS_VERSION;
    return !privacyOk || !termsOk;
  }, [user, consentsQuery.data, consentsQuery.isLoading]);

  return { needsConsent, isLoading: consentsQuery.isLoading };
}
