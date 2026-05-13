import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  Link2,
  RefreshCw,
  Sheet,
  ShieldCheck,
} from 'lucide-react';
import { googleSheetsApi } from '@/api/googleSheets';
import { httpErrorMessage } from '@/lib/api';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

function formatRelative(iso: string | null): string {
  if (!iso) return 'mai';
  const d = new Date(iso);
  const diffSec = Math.round((Date.now() - d.getTime()) / 1000);
  if (diffSec < 60) return `${diffSec}s fa`;
  if (diffSec < 3600) return `${Math.round(diffSec / 60)} min fa`;
  if (diffSec < 86400) return `${Math.round(diffSec / 3600)} h fa`;
  return d.toLocaleString('it-IT');
}

/**
 * Pannello admin per il Mirror Google Sheets.
 *
 * Stato di sola lettura: la configurazione (spreadsheetId, intervallo) è in
 * env vars del backend e richiede un riavvio per cambiare. Qui l'admin vede:
 *   - se il modulo è attivo e a quale foglio punta
 *   - ultimo sync OK con conteggio righe e durata
 *   - eventuale errore dell'ultimo tentativo
 *   - bottoni "Verifica connessione" e "Forza sync ora"
 */
export default function AdminGoogleSheetsMirror() {
  const qc = useQueryClient();
  const statusQuery = useQuery({
    queryKey: ['admin', 'google-sheets', 'status'],
    queryFn: () => googleSheetsApi.status(),
    refetchInterval: 30_000, // refresh ogni 30s per vedere il prossimo tick
  });

  const probeMutation = useMutation({
    mutationFn: () => googleSheetsApi.probe(),
    onSuccess: (r) => {
      if (r.ok) {
        toast.success(`Connessione OK — foglio "${r.title}"`, {
          description: r.tabs?.length
            ? `Tab presenti: ${r.tabs.join(', ')}`
            : 'Il foglio sarà popolato al primo sync.',
        });
      } else {
        toast.error('Connessione fallita', { description: r.error });
      }
    },
    onError: (err) => toast.error(httpErrorMessage(err)),
  });

  const syncMutation = useMutation({
    mutationFn: () => googleSheetsApi.sync(),
    onSuccess: (r) => {
      if (r.ok) {
        toast.success(`Sync completato — ${r.rowCount} righe in ${r.durationMs} ms`);
        void qc.invalidateQueries({ queryKey: ['admin', 'google-sheets', 'status'] });
      } else {
        toast.error('Sync fallito', { description: r.reason });
      }
    },
    onError: (err) => toast.error(httpErrorMessage(err)),
  });

  const status = statusQuery.data;

  if (statusQuery.isLoading) {
    return (
      <Card>
        <CardContent className="space-y-3 py-6">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-24 w-full" />
        </CardContent>
      </Card>
    );
  }
  if (statusQuery.isError || !status) {
    return (
      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>Impossibile leggere lo stato del mirror.</AlertDescription>
      </Alert>
    );
  }

  const isHealthy = status.enabled && status.lastSyncAt && !status.lastSyncError;
  const isConfigured = status.enabled && !!status.spreadsheetId;
  const sheetUrl = status.spreadsheetId
    ? `https://docs.google.com/spreadsheets/d/${status.spreadsheetId}/edit`
    : null;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-start gap-3 pb-3">
          <div
            className={`shrink-0 rounded-lg p-2.5 ${
              isHealthy
                ? 'bg-emerald-100 dark:bg-emerald-500/15'
                : status.enabled
                  ? 'bg-amber-100 dark:bg-amber-500/15'
                  : 'bg-muted'
            }`}
          >
            <Sheet
              className={`h-5 w-5 ${
                isHealthy
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : status.enabled
                    ? 'text-amber-600 dark:text-amber-400'
                    : 'text-muted-foreground'
              }`}
            />
          </div>
          <div className="flex-1">
            <CardTitle className="font-display text-base font-medium">
              Mirror Google Sheets — business continuity
            </CardTitle>
            <p className="text-sm text-muted-foreground mt-0.5">
              Riversa le prenotazioni confermate in un foglio Google. Se Cadenza è irraggiungibile,
              la portineria consulta il foglio dal telefono.
            </p>
          </div>
          <Badge variant={isHealthy ? 'success' : status.enabled ? 'secondary' : 'muted'}>
            {!status.enabled
              ? 'Disattivato'
              : isHealthy
                ? 'Attivo'
                : status.lastSyncError
                  ? 'Errore'
                  : 'In attesa primo sync'}
          </Badge>
        </CardHeader>
        <CardContent className="space-y-4">
          {!status.enabled && (
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                <p>
                  Il mirror è <strong>disattivato</strong>. Per attivarlo:
                </p>
                <ol className="mt-2 list-decimal pl-5 text-sm space-y-1">
                  <li>
                    Imposta <code>GOOGLE_SHEETS_MIRROR_ENABLED=true</code> nel backend
                    <code>.env</code>
                  </li>
                  <li>
                    Imposta <code>GOOGLE_SHEETS_SPREADSHEET_ID</code> con l'ID del foglio
                  </li>
                  <li>
                    Salva il JSON del Service Account in{' '}
                    <code>backend/secrets/google-sheets-sa.json</code>
                  </li>
                  <li>Riavvia il backend</li>
                </ol>
                <p className="mt-2 text-xs">
                  Guida completa: <code>docs/SHEETS_MIRROR.md</code>
                </p>
              </AlertDescription>
            </Alert>
          )}

          {status.enabled && !status.spreadsheetId && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                Modulo attivo ma <code>GOOGLE_SHEETS_SPREADSHEET_ID</code> non impostato. Aggiungilo
                al backend <code>.env</code> e riavvia.
              </AlertDescription>
            </Alert>
          )}

          {status.lastSyncError && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                <p className="font-medium">Ultimo sync fallito</p>
                <p className="text-xs mt-1 font-mono break-all">{status.lastSyncError}</p>
              </AlertDescription>
            </Alert>
          )}

          {/* Grid di metriche */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <MetricCard
              icon={<Clock className="h-4 w-4 text-muted-foreground" />}
              label="Ultimo sync"
              value={formatRelative(status.lastSyncAt)}
              hint={
                status.lastSyncDurationMs ? `durata ${status.lastSyncDurationMs} ms` : undefined
              }
            />
            <MetricCard
              icon={<CheckCircle2 className="h-4 w-4 text-muted-foreground" />}
              label="Record sincronizzati"
              value={String(status.lastSyncRowCount)}
              hint={`finestra ${status.lookaheadDays} giorni`}
            />
            <MetricCard
              icon={<Link2 className="h-4 w-4 text-muted-foreground" />}
              label="Foglio"
              value={status.spreadsheetId ? 'collegato' : 'non collegato'}
              hint={status.spreadsheetId ? `${status.spreadsheetId.slice(0, 12)}…` : undefined}
              href={sheetUrl}
            />
          </div>

          {/* Azioni */}
          <div className="flex flex-wrap gap-2 pt-2">
            <Button
              variant="outline"
              onClick={() => probeMutation.mutate()}
              disabled={!isConfigured || probeMutation.isPending}
            >
              <ShieldCheck className="h-4 w-4" />
              Verifica connessione
            </Button>
            <Button
              onClick={() => syncMutation.mutate()}
              disabled={!isConfigured || syncMutation.isPending}
            >
              <RefreshCw className={`h-4 w-4 ${syncMutation.isPending ? 'animate-spin' : ''}`} />
              Forza sync ora
            </Button>
            {sheetUrl && (
              <Button variant="outline" asChild>
                <a href={sheetUrl} target="_blank" rel="noopener noreferrer">
                  <Sheet className="h-4 w-4" />
                  Apri foglio
                </a>
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Nota didattica per la portineria */}
      <Card>
        <CardContent className="py-4">
          <h3 className="text-sm font-medium mb-1">Come funziona durante un crash</h3>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Il foglio è una <strong>copia di sola lettura</strong>: le modifiche fatte sul foglio
            NON tornano in Cadenza. Se l'app è giù e devi annotare una prenotazione di emergenza,
            usa un foglio separato chiamato "Prenotazioni manuali (offline)" e poi trascrivile
            manualmente in Cadenza al ripristino. Niente conflict resolution automatica = niente bug
            oscuri al ritorno.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function MetricCard({
  icon,
  label,
  value,
  hint,
  href,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint?: string;
  href?: string | null;
}) {
  const body = (
    <div className="rounded-lg border bg-card p-3">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className="font-display text-lg font-medium mt-0.5">{value}</div>
      {hint && <div className="text-[11px] text-muted-foreground mt-0.5">{hint}</div>}
    </div>
  );
  return href ? (
    <a href={href} target="_blank" rel="noopener noreferrer" className="block hover:no-underline">
      {body}
    </a>
  ) : (
    body
  );
}
