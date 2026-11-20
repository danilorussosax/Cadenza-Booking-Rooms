import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Download, FileText, LoaderCircle, Lock, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { gdprApi } from '@/api/gdpr';
import { PRIVACY_POLICY_VERSION, TERMS_VERSION } from '@/pages/legal/policyVersions';
import { httpErrorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import { dayjs } from '@/lib/date';
import { qk } from '@/lib/queryKeys';
import { invalidateConsents } from '@/lib/invalidation';
import { isAdminUser } from '@/lib/roles';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { DeleteAccountDialog } from './DeleteAccountDialog';
import type { ProfileUser } from './types';
import { useTranslation } from 'react-i18next';

// =====================================================
// Privacy & GDPR section
// Espone i diritti dell'interessato (artt. 15, 17, 20):
//   - stato consensi correnti (privacy_policy / terms / marketing)
//   - download dei propri dati (portabilità)
//   - cancellazione account (con conferma testuale: l'utente deve digitare
//     la propria email per confermare un'operazione irreversibile)
// =====================================================
export function PrivacySection({ user }: { user: ProfileUser }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { logout } = useAuth();
  const [deleteOpen, setDeleteOpen] = useState(false);

  const consentsQuery = useQuery({
    queryKey: qk.gdpr.consents(),
    queryFn: () => gdprApi.getConsents(),
  });

  const exportMutation = useMutation({
    mutationFn: () => gdprApi.exportData(),
    onSuccess: ({ filename }) => toast.success(t('toasts.profile.export_downloaded', { filename })),
    onError: (err: Error) => toast.error(err.message),
  });

  const marketingMutation = useMutation({
    mutationFn: (granted: boolean) =>
      gdprApi.setConsent({
        consentType: 'marketing',
        granted,
        policyVersion: PRIVACY_POLICY_VERSION,
      }),
    onSuccess: (_, granted) => {
      void invalidateConsents(qc);
      toast.success(granted ? t('toasts.profile.marketing_on') : t('toasts.profile.marketing_off'));
    },
    onError: (err) => toast.error(httpErrorMessage(err)),
  });

  const consents = consentsQuery.data?.consents ?? {};
  const marketingGranted = consents.marketing?.granted ?? false;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 font-display text-xl">
          <Lock className="h-5 w-5 text-muted-foreground" />
          Privacy e dati personali
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5 pt-0 sm:pt-0">
        {/* Documenti legali */}
        <div className="space-y-2">
          <p className="text-sm font-medium">Documenti</p>
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline" size="sm">
              <Link to="/privacy-policy">
                <FileText className="h-3.5 w-3.5" />
                Privacy Policy (v. {PRIVACY_POLICY_VERSION})
              </Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link to="/terms">
                <FileText className="h-3.5 w-3.5" />
                Termini di servizio (v. {TERMS_VERSION})
              </Link>
            </Button>
          </div>
        </div>

        <Separator />

        {/* Stato consensi */}
        <div className="space-y-2">
          <p className="text-sm font-medium">I tuoi consensi</p>
          {consentsQuery.isLoading ? (
            <p className="text-xs text-muted-foreground">
              <LoaderCircle className="inline h-3 w-3 animate-spin" /> Caricamento…
            </p>
          ) : (
            <ul className="space-y-1 text-xs text-muted-foreground">
              <ConsentRow label="Informativa privacy" record={consents.privacy_policy} />
              <ConsentRow label="Termini di servizio" record={consents.terms} />
              <ConsentRow
                label="Comunicazioni promozionali (marketing)"
                record={consents.marketing}
              />
            </ul>
          )}

          <div className="flex items-center justify-between rounded-lg border bg-muted/30 p-3">
            <div className="pr-3">
              <p className="text-sm font-medium">Comunicazioni promozionali</p>
              <p className="text-xs text-muted-foreground">
                Newsletter su iniziative dell'Istituto. Revocabile in qualsiasi momento.
              </p>
            </div>
            <Switch
              checked={marketingGranted}
              disabled={marketingMutation.isPending}
              onCheckedChange={(v) => {
                marketingMutation.mutate(v);
              }}
              aria-label="Consenso marketing"
            />
          </div>
        </div>

        <Separator />

        {/* Diritti GDPR */}
        <div className="space-y-2">
          <p className="text-sm font-medium">Diritti GDPR</p>
          <p className="text-xs text-muted-foreground">
            Puoi scaricare una copia dei tuoi dati o richiedere la cancellazione del tuo account in
            qualsiasi momento.
          </p>

          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                exportMutation.mutate();
              }}
              disabled={exportMutation.isPending}
            >
              {exportMutation.isPending ? (
                <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Download className="h-3.5 w-3.5" />
              )}
              Scarica i miei dati (JSON)
            </Button>

            {!isAdminUser(user) && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                onClick={() => {
                  setDeleteOpen(true);
                }}
              >
                <Trash2 className="h-3.5 w-3.5" />
                Elimina il mio account
              </Button>
            )}
          </div>
          {isAdminUser(user) && (
            <p className="text-[11px] text-muted-foreground">
              Gli account amministratore non possono auto-eliminarsi: contatta un altro
              amministratore per la cancellazione.
            </p>
          )}
        </div>
      </CardContent>

      <DeleteAccountDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        userEmail={user.email}
        onDeleted={() => {
          setDeleteOpen(false);
          toast.success(t('toasts.profile.account_deleted'));
          logout();
        }}
      />
    </Card>
  );
}

function ConsentRow({
  label,
  record,
}: {
  label: string;
  record: { granted: boolean; policyVersion: string; decidedAt: string } | undefined;
}) {
  if (!record) {
    return (
      <li className="flex items-center justify-between gap-3">
        <span>{label}</span>
        <span className="text-muted-foreground">— nessuna scelta registrata</span>
      </li>
    );
  }
  return (
    <li className="flex items-center justify-between gap-3">
      <span>{label}</span>
      <span className={cn(record.granted ? 'text-emerald-600' : 'text-muted-foreground')}>
        {record.granted ? 'accettato' : 'rifiutato'} · v. {record.policyVersion} ·{' '}
        {dayjs(record.decidedAt).format('DD MMM YYYY')}
      </span>
    </li>
  );
}
