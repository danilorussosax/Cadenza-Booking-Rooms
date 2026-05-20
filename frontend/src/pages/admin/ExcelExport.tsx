import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  Download,
  FileSpreadsheet,
  HardDrive,
  RefreshCw,
} from 'lucide-react';
import { excelExportApi } from '@/api/excelExport';
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

function formatBytes(b: number): string {
  if (b === 0) return '—';
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1024 / 1024).toFixed(2)} MB`;
}

/**
 * Pannello admin per l'Export Excel periodico (business continuity).
 *
 * Configurazione in env vars del backend (richiede riavvio per cambiare).
 * Qui l'admin vede:
 *   - se il modulo è attivo e su che path scrive
 *   - ultimo export OK con conteggio righe, dimensione e durata
 *   - bottoni "Rigenera ora" e "Scarica ora"
 */
export default function AdminExcelExport() {
  const qc = useQueryClient();
  const statusQuery = useQuery({
    queryKey: ['admin', 'excel-export', 'status'],
    queryFn: () => excelExportApi.status(),
    refetchInterval: 30_000,
  });

  const exportMutation = useMutation({
    mutationFn: () => excelExportApi.exportNow(),
    onSuccess: (r) => {
      if (r.ok) {
        toast.success(`Export OK — ${r.rowCount} righe in ${r.durationMs} ms`);
        void qc.invalidateQueries({ queryKey: ['admin', 'excel-export', 'status'] });
      } else {
        toast.error('Export fallito', { description: r.reason });
      }
    },
    onError: (err) => toast.error(httpErrorMessage(err)),
  });

  const downloadMutation = useMutation({
    mutationFn: () => excelExportApi.download(),
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
        <AlertDescription>Impossibile leggere lo stato dell'export.</AlertDescription>
      </Alert>
    );
  }

  const isHealthy = status.enabled && status.lastExportAt && !status.lastExportError;

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
            <FileSpreadsheet
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
              Export Excel — business continuity
            </CardTitle>
            <p className="text-sm text-muted-foreground mt-0.5">
              Scrive le prenotazioni in un file <code className="text-xs">.xlsx</code> locale.
              Sincronizza la cartella verso OneDrive/Dropbox con rclone per averla anche offline.
            </p>
          </div>
          <Badge variant={isHealthy ? 'success' : status.enabled ? 'secondary' : 'muted'}>
            {!status.enabled
              ? 'Disattivato'
              : isHealthy
                ? 'Attivo'
                : status.lastExportError
                  ? 'Errore'
                  : 'In attesa primo export'}
          </Badge>
        </CardHeader>
        <CardContent className="space-y-4">
          {!status.enabled && (
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                <p>
                  Il modulo è <strong>disattivato</strong>. Per attivarlo:
                </p>
                <ol className="mt-2 list-decimal pl-5 text-sm space-y-1">
                  <li>
                    Imposta <code>EXCEL_EXPORT_ENABLED=true</code> nel backend <code>.env</code>
                  </li>
                  <li>
                    Verifica che il path <code>EXCEL_EXPORT_PATH</code> sia scrivibile dal processo
                    cadenza
                  </li>
                  <li>Riavvia il backend</li>
                  <li>
                    Configura il sync verso il cloud lanciando{' '}
                    <code>scripts/setup-rclone-sync.sh</code> (procedura guidata)
                  </li>
                </ol>
              </AlertDescription>
            </Alert>
          )}

          {status.lastExportError && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                <p className="font-medium">Ultimo export fallito</p>
                <p className="text-xs mt-1 font-mono break-all">{status.lastExportError}</p>
              </AlertDescription>
            </Alert>
          )}

          {/* Grid di metriche */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <MetricCard
              icon={<Clock className="h-4 w-4 text-muted-foreground" />}
              label="Ultimo export"
              value={formatRelative(status.lastExportAt)}
              hint={
                status.lastExportDurationMs ? `durata ${status.lastExportDurationMs} ms` : undefined
              }
            />
            <MetricCard
              icon={<CheckCircle2 className="h-4 w-4 text-muted-foreground" />}
              label="Record sincronizzati"
              value={String(status.lastExportRowCount)}
              hint={`finestra ${status.lookaheadDays} giorni`}
            />
            <MetricCard
              icon={<HardDrive className="h-4 w-4 text-muted-foreground" />}
              label="Dimensione file"
              value={formatBytes(status.lastExportSizeBytes)}
              hint={status.fileExists ? 'file presente su disco' : 'file non ancora generato'}
            />
          </div>

          <div className="rounded-lg border bg-muted/30 p-3">
            <div className="text-xs text-muted-foreground mb-1">Path file</div>
            <code className="text-xs break-all">{status.path}</code>
          </div>

          {/* Azioni */}
          <div className="flex flex-wrap gap-2 pt-2">
            <Button
              onClick={() => exportMutation.mutate()}
              disabled={!status.enabled || exportMutation.isPending}
            >
              <RefreshCw className={`h-4 w-4 ${exportMutation.isPending ? 'animate-spin' : ''}`} />
              Rigenera ora
            </Button>
            <Button
              variant="outline"
              onClick={() => downloadMutation.mutate()}
              disabled={!status.enabled || downloadMutation.isPending}
            >
              <Download className="h-4 w-4" />
              Scarica ora
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="py-4">
          <h3 className="text-sm font-medium mb-1">Come funziona durante un crash</h3>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Il file è una <strong>copia di sola lettura</strong>: le modifiche fatte sul file (es.
            su OneDrive da telefono) NON tornano in Cadenza. Se l'app è giù e devi annotare una
            prenotazione di emergenza, usa un foglio separato chiamato "Prenotazioni manuali
            (offline)" e poi trascrivile manualmente in Cadenza al ripristino. Niente conflict
            resolution automatica = niente bug oscuri al ritorno.
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
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className="font-display text-lg font-medium mt-0.5">{value}</div>
      {hint && <div className="text-[11px] text-muted-foreground mt-0.5">{hint}</div>}
    </div>
  );
}
