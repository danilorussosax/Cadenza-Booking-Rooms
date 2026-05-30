import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Database,
  Download,
  HardDriveDownload,
  Loader2 as LoaderCircle,
  Pencil,
  Power,
  RefreshCw,
  Save,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  backupsApi,
  type BackupItem,
  type SchedulerStatus,
  type UpdateSchedulerSettingsPayload,
} from '@/api/backups';
import { httpErrorMessage } from '@/lib/api';
import { dayjs } from '@/lib/date';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { ConfirmDeleteDialog } from '@/components/admin/ConfirmDeleteDialog';

// =============================================================================
// /admin/backups — gestione completa dei backup database + uploads.
//
// Funzionalità:
//   - Visualizza scheduler status (prossimo run, ultimo run, on/off)
//   - Lista backup con dimensione + data
//   - Trigger manuale "Backup adesso"
//   - Download archivio
//   - Upload backup esterno (es. trasferimento da altro server)
//   - Restore con doppia conferma + esecuzione di pre-restore snapshot
//   - Riavvio backend (solo se AUTO_RESTART_ENABLED=true lato server)
// =============================================================================

function formatBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1024 / 1024).toFixed(2)} MB`;
}

export default function AdminBackups() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [restoreTarget, setRestoreTarget] = useState<BackupItem | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<BackupItem | null>(null);
  const [showRestartConfirm, setShowRestartConfirm] = useState(false);
  const [restoreResult, setRestoreResult] = useState<{
    file: string;
    preSnapshot: string;
  } | null>(null);

  const query = useQuery({
    queryKey: ['admin', 'backups'],
    queryFn: () => backupsApi.list(),
    refetchInterval: 30_000,
  });

  const createMutation = useMutation({
    mutationFn: () => backupsApi.createNow(),
    onSuccess: (res) => {
      toast.success(t('admin.backups.toast.created', { file: res.file }));
      void qc.invalidateQueries({ queryKey: ['admin', 'backups'] });
    },
    onError: (err) => toast.error(httpErrorMessage(err)),
  });

  const deleteMutation = useMutation({
    mutationFn: (file: string) => backupsApi.remove(file),
    onSuccess: () => {
      toast.success(t('admin.backups.toast.deleted'));
      setDeleteTarget(null);
      void qc.invalidateQueries({ queryKey: ['admin', 'backups'] });
    },
    onError: (err) => toast.error(httpErrorMessage(err)),
  });

  const uploadMutation = useMutation({
    mutationFn: (file: File) => backupsApi.upload(file),
    onSuccess: (res) => {
      toast.success(t('admin.backups.toast.uploaded', { file: res.file }));
      void qc.invalidateQueries({ queryKey: ['admin', 'backups'] });
    },
    onError: (err) => toast.error(httpErrorMessage(err)),
  });

  const restoreMutation = useMutation({
    mutationFn: (file: string) => backupsApi.restore(file),
    onSuccess: (res) => {
      setRestoreTarget(null);
      setRestoreResult({ file: res.restoredFile, preSnapshot: res.preRestoreSnapshot });
      toast.success(t('admin.backups.toast.restored'));
      void qc.invalidateQueries({ queryKey: ['admin', 'backups'] });
    },
    onError: (err) => toast.error(httpErrorMessage(err)),
  });

  const restartMutation = useMutation({
    mutationFn: () => backupsApi.restart(),
    onSuccess: (res) => {
      toast.message(res.message, {
        description: t('admin.backups.restart.reload_hint'),
        duration: 8000,
      });
      // Aspetta qualche secondo poi forza il reload
      setTimeout(() => {
        window.location.reload();
      }, 4000);
    },
    onError: (err) => toast.error(httpErrorMessage(err)),
  });

  const handleDownload = async (file: string) => {
    try {
      const blob = await backupsApi.download(file);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = file;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Download fallito');
    }
  };

  const onUploadChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) uploadMutation.mutate(f);
    e.target.value = '';
  };

  const scheduler = query.data?.scheduler;
  const backups = query.data?.backups ?? [];

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1.5">
          <h1 className="font-display text-3xl font-medium inline-flex items-center gap-2">
            <Database className="h-6 w-6 text-primary" />
            {t('admin.backups.title')}
          </h1>
          <p className="text-sm text-muted-foreground">{t('admin.backups.subtitle')}</p>
        </div>
        <div className="flex flex-nowrap items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept=".tar.gz"
            className="hidden"
            onChange={onUploadChange}
          />
          <Button
            variant="outline"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploadMutation.isPending}
          >
            {uploadMutation.isPending ? (
              <LoaderCircle className="h-4 w-4 animate-spin" />
            ) : (
              <Upload className="h-4 w-4" />
            )}
            {t('admin.backups.upload')}
          </Button>
          <Button
            onClick={() => {
              createMutation.mutate();
            }}
            disabled={createMutation.isPending}
          >
            {createMutation.isPending ? (
              <LoaderCircle className="h-4 w-4 animate-spin" />
            ) : (
              <HardDriveDownload className="h-4 w-4" />
            )}
            {t('admin.backups.create_now')}
          </Button>
        </div>
      </header>

      {/* Scheduler card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 font-display text-lg">
            <Clock className="h-5 w-5 text-primary" />
            {t('admin.backups.scheduler.title')}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {!scheduler ? (
            <Skeleton className="h-16 w-full" />
          ) : (
            <>
              <div className="grid gap-3 text-sm sm:grid-cols-3">
                <div>
                  <p className="text-muted-foreground">{t('admin.backups.scheduler.status')}</p>
                  {scheduler.enabled ? (
                    <Badge variant="success" className="mt-1">
                      <CheckCircle2 className="mr-1 h-3 w-3" />
                      {t('admin.backups.scheduler.enabled')}
                    </Badge>
                  ) : (
                    <Badge variant="muted" className="mt-1">
                      {t('admin.backups.scheduler.disabled')}
                    </Badge>
                  )}
                </div>
                <div>
                  <p className="text-muted-foreground">{t('admin.backups.scheduler.scheduled')}</p>
                  <p className="font-medium tabular-nums">
                    {String(scheduler.scheduledHour).padStart(2, '0')}:
                    {String(scheduler.scheduledMinute).padStart(2, '0')}{' '}
                    {t('admin.backups.scheduler.daily')}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground">{t('admin.backups.scheduler.next_run')}</p>
                  <p className="font-medium">
                    {scheduler.nextRunAt ? dayjs(scheduler.nextRunAt).format('DD MMM HH:mm') : '—'}
                  </p>
                </div>
              </div>

              {scheduler.lastRun && (
                <Alert variant={scheduler.lastRun.status === 'ok' ? 'info' : 'destructive'}>
                  <AlertDescription className="text-xs">
                    {scheduler.lastRun.status === 'ok'
                      ? t('admin.backups.scheduler.last_ok', {
                          file: scheduler.lastRun.file ?? '—',
                          when: dayjs(scheduler.lastRun.finishedAt).format('DD MMM HH:mm'),
                          size: scheduler.lastRun.sizeBytes
                            ? formatBytes(scheduler.lastRun.sizeBytes)
                            : '?',
                        })
                      : t('admin.backups.scheduler.last_error', {
                          when: dayjs(scheduler.lastRun.finishedAt).format('DD MMM HH:mm'),
                          error: scheduler.lastRun.error ?? '—',
                        })}
                  </AlertDescription>
                </Alert>
              )}

              {/* Configurazione attiva — modificabile da UI.
                  Persistita su BackupSettings (singleton); env restano fallback
                  per il primo bootstrap e per BACKUP_DIR (non modificabile). */}
              <SchedulerConfigSection scheduler={scheduler} />
            </>
          )}
        </CardContent>
      </Card>

      {/* Backups list */}
      <Card>
        <CardHeader>
          <CardTitle className="font-display text-lg">{t('admin.backups.list.title')}</CardTitle>
        </CardHeader>
        <CardContent>
          {query.isLoading && <Skeleton className="h-32 w-full" />}
          {!query.isLoading && backups.length === 0 && (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {t('admin.backups.list.empty')}
            </p>
          )}
          {!query.isLoading && backups.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b text-left text-xs uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">{t('admin.backups.list.col_file')}</th>
                    <th className="px-3 py-2 font-medium">{t('admin.backups.list.col_when')}</th>
                    <th className="px-3 py-2 font-medium">{t('admin.backups.list.col_size')}</th>
                    <th className="px-3 py-2 text-right font-medium">
                      {t('admin.backups.list.col_actions')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {backups.map((b) => (
                    <tr key={b.file} className="border-b last:border-0">
                      <td className="px-3 py-3 font-mono text-xs">{b.file}</td>
                      <td className="px-3 py-3 text-xs text-muted-foreground">
                        {dayjs(b.createdAt).format('DD MMM YYYY · HH:mm')}
                      </td>
                      <td className="px-3 py-3 text-xs tabular-nums">{formatBytes(b.sizeBytes)}</td>
                      <td className="px-3 py-3 text-right">
                        <div className="inline-flex gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            title={t('admin.backups.list.download')}
                            onClick={() => {
                              void handleDownload(b.file);
                            }}
                          >
                            <Download className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            title={t('admin.backups.list.restore')}
                            onClick={() => {
                              setRestoreTarget(b);
                            }}
                            className="text-amber-600 hover:bg-amber-100 dark:text-amber-400 dark:hover:bg-amber-500/10"
                          >
                            <RefreshCw className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            title={t('common.delete')}
                            onClick={() => {
                              setDeleteTarget(b);
                            }}
                            className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Restore success card with restart prompt */}
      {restoreResult && (
        <Card className="border-amber-300/60 bg-amber-50/60 dark:border-amber-500/30 dark:bg-amber-500/10">
          <CardContent className="space-y-3 p-4 sm:p-6">
            <div className="flex items-start gap-3">
              <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
              <div className="space-y-1">
                <p className="font-semibold">
                  {t('admin.backups.restore_success.title', { file: restoreResult.file })}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t('admin.backups.restore_success.pre_snapshot', {
                    file: restoreResult.preSnapshot,
                  })}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t('admin.backups.restore_success.help')}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="default"
                size="sm"
                onClick={() => {
                  setShowRestartConfirm(true);
                }}
              >
                <Power className="h-4 w-4" />
                {t('admin.backups.restart.button')}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setRestoreResult(null);
                }}
              >
                {t('common.close')}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Restore confirm dialog */}
      <ConfirmDeleteDialog
        open={!!restoreTarget}
        onOpenChange={(o) => {
          if (!o) setRestoreTarget(null);
        }}
        title={t('admin.backups.restore_dialog.title', { file: restoreTarget?.file ?? '' })}
        description={t('admin.backups.restore_dialog.description')}
        confirmLabel={t('admin.backups.restore_dialog.confirm')}
        loading={restoreMutation.isPending}
        onConfirm={() => {
          if (restoreTarget) restoreMutation.mutate(restoreTarget.file);
        }}
      />

      {/* Delete confirm dialog */}
      <ConfirmDeleteDialog
        open={!!deleteTarget}
        onOpenChange={(o) => {
          if (!o) setDeleteTarget(null);
        }}
        title={t('admin.backups.delete_dialog.title', { file: deleteTarget?.file ?? '' })}
        description={t('admin.backups.delete_dialog.description')}
        loading={deleteMutation.isPending}
        onConfirm={() => {
          if (deleteTarget) deleteMutation.mutate(deleteTarget.file);
        }}
      />

      {/* Restart confirm dialog */}
      <ConfirmDeleteDialog
        open={showRestartConfirm}
        onOpenChange={setShowRestartConfirm}
        title={t('admin.backups.restart.confirm_title')}
        description={t('admin.backups.restart.confirm_description')}
        confirmLabel={t('admin.backups.restart.button')}
        variant="default"
        loading={restartMutation.isPending}
        onConfirm={() => {
          restartMutation.mutate();
        }}
      >
        <Alert variant="warning">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription className="text-xs">
            {t('admin.backups.restart.warning')}
          </AlertDescription>
        </Alert>
      </ConfirmDeleteDialog>
    </div>
  );
}

// =============================================================================
// SchedulerConfigSection — view/edit della configurazione scheduler
//
// View mode:  griglia label/valore + pulsante "Modifica" in alto a destra.
// Edit mode:  toggle/number inputs editabili, footer con "Salva" / "Annulla".
//
// Persistenza: PUT /api/admin/backups/settings → backend persiste su
// BackupSettings (singleton id=1) e chiama scheduler.reschedule().
// =============================================================================

interface FormState {
  autoEnabled: boolean;
  scheduledHour: number;
  scheduledMinute: number;
  keepDaily: number;
  keepWeekly: number;
  keepMonthly: number;
  autoRestartEnabled: boolean;
}

function buildFormState(s: SchedulerStatus): FormState {
  return {
    autoEnabled: s.autoEnabledEnv,
    scheduledHour: s.scheduledHour,
    scheduledMinute: s.scheduledMinute,
    keepDaily: s.config.keepDaily,
    keepWeekly: s.config.keepWeekly,
    keepMonthly: s.config.keepMonthly,
    autoRestartEnabled: s.config.autoRestartEnabled,
  };
}

function SchedulerConfigSection({ scheduler }: { scheduler: SchedulerStatus }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<FormState>(() => buildFormState(scheduler));

  // Re-seed quando entriamo in edit (così se altri admin avevano modificato la
  // config nel frattempo, la ricarica via refetchInterval entra nel form).
  const startEdit = () => {
    setForm(buildFormState(scheduler));
    setEditing(true);
  };

  const saveMutation = useMutation({
    mutationFn: (payload: UpdateSchedulerSettingsPayload) => backupsApi.updateSettings(payload),
    onSuccess: () => {
      toast.success(t('admin.backups.scheduler.saved_toast'));
      setEditing(false);
      void qc.invalidateQueries({ queryKey: ['admin', 'backups'] });
    },
    onError: (err) => toast.error(httpErrorMessage(err)),
  });

  if (!editing) {
    return (
      <div className="rounded-md border border-dashed bg-muted/30 p-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {t('admin.backups.scheduler.config_title')}
          </p>
          <Button size="sm" variant="ghost" onClick={startEdit} className="h-7 px-2 text-xs">
            <Pencil className="h-3 w-3" />
            {t('admin.backups.scheduler.edit_button')}
          </Button>
        </div>
        <dl className="grid gap-x-6 gap-y-2 text-xs sm:grid-cols-2">
          <ConfigRow
            label={t('admin.backups.scheduler.f_auto_enabled')}
            value={scheduler.autoEnabledEnv ? t('common.enabled') : t('common.disabled')}
          />
          <ConfigRow
            label={t('admin.backups.scheduler.f_auto_restart')}
            value={scheduler.config.autoRestartEnabled ? t('common.enabled') : t('common.disabled')}
          />
          <ConfigRow
            label={t('admin.backups.scheduler.f_tick_time')}
            value={`${String(scheduler.scheduledHour).padStart(2, '0')}:${String(scheduler.scheduledMinute).padStart(2, '0')}`}
            mono
          />
          <ConfigRow
            label={t('admin.backups.scheduler.f_keep_daily')}
            value={String(scheduler.config.keepDaily)}
            mono
          />
          <ConfigRow
            label={t('admin.backups.scheduler.f_keep_weekly')}
            value={String(scheduler.config.keepWeekly)}
            mono
          />
          <ConfigRow
            label={t('admin.backups.scheduler.f_keep_monthly')}
            value={String(scheduler.config.keepMonthly)}
            mono
          />
          <div className="flex justify-between gap-3 sm:col-span-2">
            <dt className="text-muted-foreground">{t('admin.backups.scheduler.f_dir')}</dt>
            <dd className="truncate font-mono" title={scheduler.config.backupDir}>
              {scheduler.config.backupDir}
            </dd>
          </div>
        </dl>
        <p className="mt-2 text-[11px] text-muted-foreground">
          {scheduler.config.source === 'db'
            ? t('admin.backups.scheduler.source_db')
            : t('admin.backups.scheduler.source_env')}
        </p>
      </div>
    );
  }

  // Edit mode
  const num = (key: keyof FormState, min: number, max: number) => (
    <Input
      type="number"
      min={min}
      max={max}
      value={form[key] as number}
      onChange={(e) => {
        const n = Number(e.target.value);
        setForm((s) => ({ ...s, [key]: Number.isFinite(n) ? n : (s[key] as number) }));
      }}
      className="h-9 w-24 tabular-nums"
    />
  );

  return (
    <form
      className="space-y-3 rounded-md border border-primary/30 bg-primary/5 p-3"
      onSubmit={(e) => {
        e.preventDefault();
        saveMutation.mutate({
          autoEnabled: form.autoEnabled,
          scheduledHour: form.scheduledHour,
          scheduledMinute: form.scheduledMinute,
          keepDaily: form.keepDaily,
          keepWeekly: form.keepWeekly,
          keepMonthly: form.keepMonthly,
          autoRestartEnabled: form.autoRestartEnabled,
        });
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wider text-primary">
          {t('admin.backups.scheduler.edit_title')}
        </p>
      </div>

      {/* Toggle: backup automatico abilitato */}
      <div className="flex items-center justify-between gap-3 rounded border bg-background p-2">
        <div>
          <Label className="text-sm">{t('admin.backups.scheduler.f_auto_enabled')}</Label>
          <p className="text-[11px] text-muted-foreground">
            {t('admin.backups.scheduler.f_auto_enabled_help')}
          </p>
        </div>
        <Switch
          checked={form.autoEnabled}
          onCheckedChange={(v) => {
            setForm((s) => ({ ...s, autoEnabled: v }));
          }}
        />
      </div>

      {/* Orario tick */}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label className="text-xs">{t('admin.backups.scheduler.f_hour')}</Label>
          {num('scheduledHour', 0, 23)}
        </div>
        <div className="space-y-1">
          <Label className="text-xs">{t('admin.backups.scheduler.f_minute')}</Label>
          {num('scheduledMinute', 0, 59)}
        </div>
      </div>

      {/* Rotation */}
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1">
          <Label className="text-xs">{t('admin.backups.scheduler.f_keep_daily')}</Label>
          {num('keepDaily', 1, 365)}
        </div>
        <div className="space-y-1">
          <Label className="text-xs">{t('admin.backups.scheduler.f_keep_weekly')}</Label>
          {num('keepWeekly', 1, 104)}
        </div>
        <div className="space-y-1">
          <Label className="text-xs">{t('admin.backups.scheduler.f_keep_monthly')}</Label>
          {num('keepMonthly', 1, 60)}
        </div>
      </div>

      {/* Toggle: auto-restart */}
      <div className="flex items-center justify-between gap-3 rounded border bg-background p-2">
        <div>
          <Label className="text-sm">{t('admin.backups.scheduler.f_auto_restart')}</Label>
          <p className="text-[11px] text-muted-foreground">
            {t('admin.backups.scheduler.f_auto_restart_help')}
          </p>
        </div>
        <Switch
          checked={form.autoRestartEnabled}
          onCheckedChange={(v) => {
            setForm((s) => ({ ...s, autoRestartEnabled: v }));
          }}
        />
      </div>

      <div className="flex justify-end gap-2 pt-1">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            setEditing(false);
          }}
          disabled={saveMutation.isPending}
        >
          <X className="h-4 w-4" />
          {t('common.cancel')}
        </Button>
        <Button type="submit" size="sm" disabled={saveMutation.isPending}>
          {saveMutation.isPending ? (
            <LoaderCircle className="h-4 w-4 animate-spin" />
          ) : (
            <Save className="h-4 w-4" />
          )}
          {t('admin.backups.scheduler.save_button')}
        </Button>
      </div>
    </form>
  );
}

function ConfigRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={mono ? 'font-mono tabular-nums' : ''}>{value}</dd>
    </div>
  );
}
