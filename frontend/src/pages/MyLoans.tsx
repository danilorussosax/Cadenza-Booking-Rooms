import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { CheckCircle2, Download, FileText, Music4, PackageX, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { loansApi } from '@/api/instruments';
import { httpErrorMessage } from '@/lib/api';
import { formatDate } from '@/lib/date';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { InstrumentLoan, LoanStatus } from '@/types';
import { ModuleDisabledCard } from '@/components/ModuleDisabledCard';
import { isModuleDisabledError } from '@/lib/moduleFlags';

type Tab = 'active' | 'requested' | 'history';

const STATUS_VARIANT: Record<LoanStatus, 'success' | 'secondary' | 'muted' | 'default'> = {
  requested: 'secondary',
  active: 'success',
  returned: 'muted',
  overdue: 'default',
  rejected: 'muted',
};

export default function MyLoans() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>('active');

  const query = useQuery({
    queryKey: ['loans', 'mine'],
    queryFn: () => loansApi.mine(),
  });

  const grouped = useMemo(() => {
    const all = query.data?.loans ?? [];
    return {
      active: all.filter((l) => l.status === 'active' || l.status === 'overdue'),
      requested: all.filter((l) => l.status === 'requested'),
      history: all.filter((l) => l.status === 'returned' || l.status === 'rejected'),
    };
  }, [query.data]);

  const counts = {
    active: grouped.active.length,
    requested: grouped.requested.length,
    history: grouped.history.length,
  };

  const returnMutation = useMutation({
    mutationFn: (id: number) => loansApi.returnLoan(id),
    onSuccess: () => {
      toast.success(t('my_loans.toast.returned'));
      void qc.invalidateQueries({ queryKey: ['loans', 'mine'] });
      void qc.invalidateQueries({ queryKey: ['instruments'] });
    },
    onError: (err) => toast.error(httpErrorMessage(err)),
  });

  const cancelMutation = useMutation({
    mutationFn: (id: number) => loansApi.cancel(id),
    onSuccess: () => {
      toast.success(t('my_loans.toast.cancelled'));
      void qc.invalidateQueries({ queryKey: ['loans', 'mine'] });
      void qc.invalidateQueries({ queryKey: ['instruments'] });
    },
    onError: (err) => toast.error(httpErrorMessage(err)),
  });

  // Modulo disattivato → backend 404 MODULE_DISABLED. Tutti gli hook sono
  // già stati chiamati: ora possiamo gestire l'early return safely.
  if (isModuleDisabledError(query.error)) {
    return <ModuleDisabledCard moduleLabel="Prestito strumenti" />;
  }

  const downloadPdf = async (loan: InstrumentLoan, kind: 'delivery' | 'return') => {
    try {
      const blob = await loansApi.downloadPdf(loan.id, kind);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `prestito-${loan.id}-${kind}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('my_loans.toast.pdf_failed'));
    }
  };

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <header className="space-y-1.5">
        <h1 className="font-display text-3xl font-medium">{t('my_loans.title')}</h1>
        <p className="text-sm text-muted-foreground">{t('my_loans.subtitle')}</p>
      </header>

      <Tabs
        value={tab}
        onValueChange={(v) => {
          setTab(v as Tab);
        }}
      >
        <TabsList>
          <TabsTrigger value="active">
            {t('my_loans.tabs.active')} · {counts.active}
          </TabsTrigger>
          <TabsTrigger value="requested">
            {t('my_loans.tabs.requested')} · {counts.requested}
          </TabsTrigger>
          <TabsTrigger value="history">
            {t('my_loans.tabs.history')} · {counts.history}
          </TabsTrigger>
        </TabsList>

        {(['active', 'requested', 'history'] as Tab[]).map((key) => (
          <TabsContent key={key} value={key} className="space-y-3">
            {query.isLoading ? (
              [0, 1, 2].map((i) => <Skeleton key={i} className="h-28 w-full" />)
            ) : grouped[key].length === 0 ? (
              <EmptyState tab={key} />
            ) : (
              <motion.div
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                className="space-y-3"
              >
                {grouped[key].map((loan) => (
                  <LoanRow
                    key={loan.id}
                    loan={loan}
                    onReturn={() => {
                      returnMutation.mutate(loan.id);
                    }}
                    onCancel={() => {
                      cancelMutation.mutate(loan.id);
                    }}
                    onDownloadDelivery={() => downloadPdf(loan, 'delivery')}
                    onDownloadReturn={() => downloadPdf(loan, 'return')}
                    busy={returnMutation.isPending || cancelMutation.isPending}
                  />
                ))}
              </motion.div>
            )}
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}

function EmptyState({ tab }: { tab: Tab }) {
  const { t } = useTranslation();
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
        <PackageX className="h-10 w-10 text-muted-foreground" />
        <div>
          <p className="font-medium">{t(`my_loans.empty.${tab}_title`)}</p>
          <p className="text-sm text-muted-foreground">{t(`my_loans.empty.${tab}_subtitle`)}</p>
        </div>
        <Button asChild variant="outline">
          <Link to="/instruments">
            <Music4 className="h-4 w-4" />
            {t('my_loans.empty.browse')}
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}

function LoanRow({
  loan,
  busy,
  onReturn,
  onCancel,
  onDownloadDelivery,
  onDownloadReturn,
}: {
  loan: InstrumentLoan;
  busy: boolean;
  onReturn: () => void;
  onCancel: () => void;
  onDownloadDelivery: () => void;
  onDownloadReturn: () => void;
}) {
  const { t } = useTranslation();
  const inst = loan.instrument;

  return (
    <Card>
      <CardContent className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:gap-5">
        {/* Foto strumento 16:9 mini */}
        <div className="relative aspect-video w-full overflow-hidden rounded-md bg-muted sm:w-40 sm:shrink-0">
          <img
            src={inst?.photoUrl ?? '/assets/instrument-default.svg'}
            alt=""
            loading="lazy"
            className="absolute inset-0 h-full w-full object-cover"
            onError={(e) => {
              const img = e.currentTarget;
              if (!img.src.endsWith('/assets/instrument-default.svg')) {
                img.src = '/assets/instrument-default.svg';
              }
            }}
          />
        </div>

        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-display text-base font-medium leading-tight">
              {inst?.name ?? '—'}
            </h3>
            <Badge variant={STATUS_VARIANT[loan.status]}>{t(`loans.status.${loan.status}`)}</Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            {inst?.family ? t(`instrument_families.${inst.family}`) : ''}
            {inst?.code ? ` · ${inst.code}` : ''}
            {inst?.brand ? ` · ${inst.brand}` : ''}
          </p>
          <p className="text-sm text-muted-foreground">
            {t('my_loans.period', {
              from: formatDate(loan.fromDate),
              to: formatDate(loan.toDate),
            })}
          </p>
          {loan.notes && <p className="text-xs italic text-muted-foreground">"{loan.notes}"</p>}
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {(loan.status === 'active' || loan.status === 'overdue') && (
            <>
              <Button variant="outline" size="sm" onClick={onDownloadDelivery}>
                <FileText className="h-4 w-4" />
                {t('my_loans.actions.print_delivery')}
              </Button>
              <Button size="sm" onClick={onReturn} disabled={busy}>
                <CheckCircle2 className="h-4 w-4" />
                {t('my_loans.actions.return')}
              </Button>
            </>
          )}
          {loan.status === 'returned' && (
            <Button variant="outline" size="sm" onClick={onDownloadReturn}>
              <Download className="h-4 w-4" />
              {t('my_loans.actions.print_return')}
            </Button>
          )}
          {loan.status === 'requested' && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onCancel}
              disabled={busy}
              className="text-destructive hover:bg-destructive/10 hover:text-destructive"
            >
              <Trash2 className="h-4 w-4" />
              {t('my_loans.actions.cancel_request')}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
