import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, CheckCircle2, FileText, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { loansApi } from '@/api/instruments';
import { httpErrorMessage } from '@/lib/api';
import { formatDate } from '@/lib/date';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import type { InstrumentLoan } from '@/types';
import { qk } from '@/lib/queryKeys';
import { invalidateAdminLoans } from '@/lib/invalidation';
import { saveBlob } from '@/lib/download';
import { STATUS_VARIANT } from './constants';

// =====================================================
// Tab: Prestiti (all/overdue/expiring)
// =====================================================
export function LoansTab({ kind }: { kind: 'all' | 'overdue' | 'expiring' }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: qk.adminLoans.kind(kind),
    queryFn: () =>
      kind === 'overdue'
        ? loansApi.overdue()
        : kind === 'expiring'
          ? loansApi.expiring(2)
          : loansApi.list(),
  });

  const approveMutation = useMutation({
    mutationFn: (id: number) => loansApi.approve(id),
    onSuccess: () => {
      toast.success(t('admin.instruments.toast.approved'));
      void invalidateAdminLoans(qc);
    },
    onError: (err) => toast.error(httpErrorMessage(err)),
  });

  const rejectMutation = useMutation({
    mutationFn: (id: number) => loansApi.reject(id),
    onSuccess: () => {
      toast.success(t('admin.instruments.toast.rejected'));
      void invalidateAdminLoans(qc);
    },
    onError: (err) => toast.error(httpErrorMessage(err)),
  });

  const returnMutation = useMutation({
    mutationFn: (id: number) => loansApi.returnLoan(id),
    onSuccess: () => {
      toast.success(t('admin.instruments.toast.returned'));
      void invalidateAdminLoans(qc);
    },
    onError: (err) => toast.error(httpErrorMessage(err)),
  });

  const downloadPdf = async (loan: InstrumentLoan, type: 'delivery' | 'return') => {
    try {
      const blob = await loansApi.downloadPdf(loan.id, type);
      saveBlob(blob, `prestito-${loan.id}-${type}.pdf`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'PDF');
    }
  };

  const loans = query.data?.loans ?? [];

  return (
    <Card>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/50 text-left text-xs uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-4 py-3 font-medium">{t('admin.instruments.loans_table.user')}</th>
              <th className="px-4 py-3 font-medium">
                {t('admin.instruments.loans_table.instrument')}
              </th>
              <th className="px-4 py-3 font-medium">{t('admin.instruments.loans_table.period')}</th>
              <th className="px-4 py-3 font-medium">{t('admin.instruments.loans_table.status')}</th>
              <th className="px-4 py-3 text-right font-medium">
                {t('admin.instruments.loans_table.actions')}
              </th>
            </tr>
          </thead>
          <tbody>
            {query.isLoading &&
              [0, 1, 2].map((i) => (
                <tr key={i} className="border-b last:border-0">
                  <td colSpan={5} className="px-4 py-3">
                    <Skeleton className="h-8 w-full" />
                  </td>
                </tr>
              ))}
            {!query.isLoading && loans.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-12 text-center text-sm text-muted-foreground">
                  —
                </td>
              </tr>
            )}
            {loans.map((loan) => (
              <tr key={loan.id} className="border-b last:border-0">
                <td className="px-4 py-3">
                  <p className="font-medium">
                    {loan.user?.firstName} {loan.user?.lastName}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {loan.user?.matricola ? `${loan.user.matricola} · ` : ''}
                    {loan.user?.email}
                  </p>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    {/* Stessa thumbnail dell'inventario: 10×16 (4:5) con
                        fallback SVG. Allineata visualmente alle altre tab. */}
                    <div className="relative h-10 w-16 shrink-0 overflow-hidden rounded-md bg-muted">
                      <img
                        src={loan.instrument?.photoUrl ?? '/assets/instrument-default.svg'}
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
                    <div className="min-w-0">
                      <p className="truncate font-medium">{loan.instrument?.name ?? '—'}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {loan.instrument?.code ?? ''}
                        {loan.instrument?.family
                          ? ` · ${t(`instrument_families.${loan.instrument.family}`)}`
                          : ''}
                      </p>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3 text-xs text-muted-foreground">
                  {formatDate(loan.fromDate)} → {formatDate(loan.toDate)}
                </td>
                <td className="px-4 py-3">
                  <Badge variant={STATUS_VARIANT[loan.status]}>
                    {t(`loans.status.${loan.status}`)}
                  </Badge>
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="inline-flex flex-wrap items-center justify-end gap-1">
                    {loan.status === 'requested' && (
                      <>
                        <Button
                          variant="ghost"
                          size="icon"
                          title={t('admin.instruments.loan_actions.approve')}
                          onClick={() => {
                            approveMutation.mutate(loan.id);
                          }}
                          disabled={approveMutation.isPending}
                          className="text-emerald-600 hover:bg-emerald-50 hover:text-emerald-700 dark:text-emerald-400 dark:hover:bg-emerald-500/10"
                        >
                          <Check className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          title={t('admin.instruments.loan_actions.reject')}
                          onClick={() => {
                            rejectMutation.mutate(loan.id);
                          }}
                          disabled={rejectMutation.isPending}
                          className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </>
                    )}
                    {(loan.status === 'active' || loan.status === 'overdue') && (
                      <>
                        <Button
                          variant="ghost"
                          size="icon"
                          title={t('admin.instruments.loan_actions.print_delivery')}
                          onClick={() => downloadPdf(loan, 'delivery')}
                        >
                          <FileText className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          title={t('admin.instruments.loan_actions.force_return')}
                          onClick={() => {
                            returnMutation.mutate(loan.id);
                          }}
                          disabled={returnMutation.isPending}
                        >
                          <CheckCircle2 className="h-4 w-4" />
                        </Button>
                      </>
                    )}
                    {loan.status === 'returned' && (
                      <Button
                        variant="ghost"
                        size="icon"
                        title={t('admin.instruments.loan_actions.print_return')}
                        onClick={() => downloadPdf(loan, 'return')}
                      >
                        <FileText className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
