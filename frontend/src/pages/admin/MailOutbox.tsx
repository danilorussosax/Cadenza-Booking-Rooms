import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Inbox,
  LoaderCircle,
  RefreshCw,
  Trash2,
  XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { mailOutboxApi, type MailOutboxItem, type MailOutboxStatus } from '@/api/mailOutbox';
import { httpErrorMessage } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';

const REFETCH_INTERVAL_MS = 30_000;

type StatusFilter = MailOutboxStatus | 'all';

const STATUS_LABEL: Record<MailOutboxStatus, string> = {
  pending: 'In attesa',
  sent: 'Inviata',
  dead: 'Fallita',
};

function StatusBadge({ s }: { s: MailOutboxStatus }) {
  if (s === 'sent')
    return (
      <Badge variant="success" className="gap-1">
        <CheckCircle2 className="h-3 w-3" />
        {STATUS_LABEL.sent}
      </Badge>
    );
  if (s === 'dead')
    return (
      <Badge variant="destructive" className="gap-1">
        <XCircle className="h-3 w-3" />
        {STATUS_LABEL.dead}
      </Badge>
    );
  return (
    <Badge variant="muted" className="gap-1">
      <Clock className="h-3 w-3" />
      {STATUS_LABEL.pending}
    </Badge>
  );
}

function fmtDate(s: string | null) {
  if (!s) return '—';
  try {
    return new Intl.DateTimeFormat('it-IT', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(s));
  } catch {
    return s;
  }
}

function HealthBanner() {
  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'mail-outbox', 'health'],
    queryFn: () => mailOutboxApi.health(),
    refetchInterval: REFETCH_INTERVAL_MS,
  });
  if (isLoading || !data) return null;
  if (data.healthy) {
    return (
      <Alert variant="info">
        <AlertDescription className="flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4" />
          SMTP attivo e verificato. Coda pulita: nessuna email fallita.
        </AlertDescription>
      </Alert>
    );
  }
  if (!data.smtpConfigured) {
    return (
      <Alert variant="warning">
        <AlertDescription className="flex items-center gap-2">
          <AlertTriangle className="h-4 w-4" />
          SMTP non configurato. Le email accodate restano in attesa fino alla configurazione.
        </AlertDescription>
      </Alert>
    );
  }
  if (!data.verifyOk) {
    return (
      <Alert variant="destructive">
        <AlertDescription className="flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <div>
            <p className="font-medium">SMTP raggiungibile ma verifica fallita.</p>
            {data.verifyError && <p className="mt-1 text-xs opacity-80">{data.verifyError}</p>}
          </div>
        </AlertDescription>
      </Alert>
    );
  }
  if (data.dead > 0) {
    return (
      <Alert variant="destructive">
        <AlertDescription className="flex items-center gap-2">
          <AlertTriangle className="h-4 w-4" />
          {data.dead} email {data.dead === 1 ? 'fallita' : 'fallite'} oltre i tentativi consentiti —
          richiedono ispezione.
        </AlertDescription>
      </Alert>
    );
  }
  return null;
}

function StatusPills({
  current,
  onChange,
  counts,
}: {
  current: StatusFilter;
  onChange: (s: StatusFilter) => void;
  counts?: { pending: number; sent: number; dead: number; total: number };
}) {
  const pills: { value: StatusFilter; label: string; count?: number }[] = [
    { value: 'all', label: 'Tutte', count: counts?.total },
    { value: 'pending', label: STATUS_LABEL.pending, count: counts?.pending },
    { value: 'dead', label: STATUS_LABEL.dead, count: counts?.dead },
    { value: 'sent', label: STATUS_LABEL.sent, count: counts?.sent },
  ];
  return (
    <div className="flex flex-wrap gap-2">
      {pills.map((p) => (
        <button
          key={p.value}
          type="button"
          onClick={() => {
            onChange(p.value);
          }}
          className={
            'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors ' +
            (current === p.value
              ? 'border-primary bg-primary/10 text-primary'
              : 'border-border bg-background text-muted-foreground hover:bg-muted')
          }
        >
          <span>{p.label}</span>
          {typeof p.count === 'number' && (
            <span className="rounded-full bg-muted px-1.5 text-[10px]">{p.count}</span>
          )}
        </button>
      ))}
    </div>
  );
}

function ItemActions({ item }: { item: MailOutboxItem }) {
  const qc = useQueryClient();
  const retryMut = useMutation({
    mutationFn: () => mailOutboxApi.retry(item.id),
    onSuccess: () => {
      toast.success('Email rimessa in coda per il prossimo tick');
      void qc.invalidateQueries({ queryKey: ['admin', 'mail-outbox'] });
    },
    onError: (err) => {
      toast.error(httpErrorMessage(err));
    },
  });
  const delMut = useMutation({
    mutationFn: () => mailOutboxApi.remove(item.id),
    onSuccess: () => {
      toast.success('Email eliminata dalla coda');
      void qc.invalidateQueries({ queryKey: ['admin', 'mail-outbox'] });
    },
    onError: (err) => {
      toast.error(httpErrorMessage(err));
    },
  });
  return (
    <div className="flex items-center gap-1">
      {item.status === 'dead' && (
        <Button
          size="sm"
          variant="outline"
          disabled={retryMut.isPending}
          onClick={() => {
            retryMut.mutate();
          }}
        >
          {retryMut.isPending ? (
            <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
          <span className="hidden sm:inline">Riprova</span>
        </Button>
      )}
      <Button
        size="sm"
        variant="ghost"
        disabled={delMut.isPending}
        onClick={() => {
          if (confirm(`Eliminare definitivamente l'email a ${item.to}?`)) delMut.mutate();
        }}
        aria-label="Elimina"
      >
        {delMut.isPending ? (
          <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Trash2 className="h-3.5 w-3.5" />
        )}
      </Button>
    </div>
  );
}

export default function AdminMailOutbox() {
  const [status, setStatus] = useState<StatusFilter>('all');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);

  const countsQuery = useQuery({
    queryKey: ['admin', 'mail-outbox', 'counts'],
    queryFn: () => mailOutboxApi.counts(),
    refetchInterval: REFETCH_INTERVAL_MS,
  });

  const listQuery = useQuery({
    queryKey: ['admin', 'mail-outbox', 'list', { status, q, page }],
    queryFn: () =>
      mailOutboxApi.list({
        status: status === 'all' ? undefined : status,
        q: q || undefined,
        page,
        limit: 25,
      }),
    refetchInterval: REFETCH_INTERVAL_MS,
  });

  const items = listQuery.data?.items ?? [];

  return (
    <div className="space-y-6">
      <header className="space-y-1.5">
        <h1 className="font-display text-3xl font-medium">Coda email</h1>
        <p className="text-sm text-muted-foreground">
          Storico e gestione delle email accodate dal sistema. Le fallite (5 tentativi superati)
          possono essere rimesse manualmente in coda.
        </p>
      </header>

      <HealthBanner />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 font-display text-xl">
            <Inbox className="h-5 w-5 text-muted-foreground" />
            Coda
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 pt-0 sm:pt-0">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <StatusPills
              current={status}
              onChange={(s) => {
                setStatus(s);
                setPage(1);
              }}
              counts={countsQuery.data}
            />
            <Input
              type="search"
              placeholder="Cerca email o oggetto…"
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setPage(1);
              }}
              className="sm:max-w-xs"
            />
          </div>

          {listQuery.isLoading && <Skeleton className="h-64 w-full" />}

          {!listQuery.isLoading && items.length === 0 && (
            <p className="py-12 text-center text-sm text-muted-foreground">
              Nessuna email in coda con questi filtri.
            </p>
          )}

          {!listQuery.isLoading && items.length > 0 && (
            <>
              {/* Desktop: tabella */}
              <div className="hidden overflow-x-auto sm:block">
                <table className="w-full text-sm">
                  <thead className="border-b text-left text-xs uppercase tracking-wider text-muted-foreground">
                    <tr>
                      <th className="py-2 pr-3">Stato</th>
                      <th className="py-2 pr-3">Tipo</th>
                      <th className="py-2 pr-3">Destinatario</th>
                      <th className="py-2 pr-3">Oggetto</th>
                      <th className="py-2 pr-3">Tentativi</th>
                      <th className="py-2 pr-3">Quando</th>
                      <th className="py-2 pr-3"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {items.map((it) => (
                      <tr key={it.id} className="align-top">
                        <td className="py-2 pr-3">
                          <StatusBadge s={it.status} />
                        </td>
                        <td className="py-2 pr-3">
                          <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{it.kind}</code>
                        </td>
                        <td className="py-2 pr-3">{it.to}</td>
                        <td className="py-2 pr-3 max-w-md truncate" title={it.subject}>
                          {it.subject}
                          {it.lastError && (
                            <p className="mt-0.5 text-[11px] text-destructive">{it.lastError}</p>
                          )}
                        </td>
                        <td className="py-2 pr-3 tabular-nums">
                          {it.attempts}/{it.maxAttempts}
                        </td>
                        <td className="py-2 pr-3 text-xs text-muted-foreground tabular-nums">
                          {it.status === 'sent'
                            ? fmtDate(it.sentAt)
                            : it.status === 'pending'
                              ? `→ ${fmtDate(it.nextAttemptAt)}`
                              : fmtDate(it.updatedAt)}
                        </td>
                        <td className="py-2 pr-3">
                          <ItemActions item={it} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Mobile: card-stack */}
              <div className="space-y-2 sm:hidden">
                {items.map((it) => (
                  <div key={it.id} className="rounded-lg border p-3 text-sm">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="mb-1 flex flex-wrap items-center gap-2">
                          <StatusBadge s={it.status} />
                          <code className="rounded bg-muted px-1 py-0.5 text-[10px]">
                            {it.kind}
                          </code>
                        </div>
                        <p className="truncate font-medium" title={it.to}>
                          {it.to}
                        </p>
                        <p
                          className="mt-0.5 truncate text-xs text-muted-foreground"
                          title={it.subject}
                        >
                          {it.subject}
                        </p>
                        {it.lastError && (
                          <p className="mt-1 text-[11px] text-destructive">{it.lastError}</p>
                        )}
                        <p className="mt-1 text-[11px] text-muted-foreground tabular-nums">
                          {it.attempts}/{it.maxAttempts} ·{' '}
                          {it.status === 'sent'
                            ? fmtDate(it.sentAt)
                            : it.status === 'pending'
                              ? `→ ${fmtDate(it.nextAttemptAt)}`
                              : fmtDate(it.updatedAt)}
                        </p>
                      </div>
                      <ItemActions item={it} />
                    </div>
                  </div>
                ))}
              </div>

              {/* Paginazione */}
              {listQuery.data && listQuery.data.pages > 1 && (
                <div className="flex items-center justify-between gap-2 pt-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={page <= 1}
                    onClick={() => {
                      setPage((p) => Math.max(1, p - 1));
                    }}
                  >
                    Precedente
                  </Button>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {page} / {listQuery.data.pages} · {listQuery.data.total} totali
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={page >= listQuery.data.pages}
                    onClick={() => {
                      setPage((p) => p + 1);
                    }}
                  >
                    Successiva
                  </Button>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
