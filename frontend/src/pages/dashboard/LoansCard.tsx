import { Link } from 'react-router-dom';
import { ArrowRight, PackageOpen } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { formatDate } from '@/lib/date';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { InstrumentLoan, LoanStatus } from '@/types';

const LOAN_STATUS_VARIANT: Record<LoanStatus, 'success' | 'secondary' | 'muted' | 'default'> = {
  requested: 'secondary',
  active: 'success',
  returned: 'muted',
  overdue: 'default',
  rejected: 'muted',
};

export function DashboardLoansCard({ loans }: { loans: InstrumentLoan[] }) {
  const { t } = useTranslation();
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2 font-display text-xl">
          <PackageOpen className="h-5 w-5 text-violet-600 dark:text-violet-400" />
          {t('dashboard.loans.title')}
        </CardTitle>
        <Button variant="ghost" size="sm" asChild>
          <Link to="/my-loans">
            {t('dashboard.loans.see_all')}
            <ArrowRight className="h-3.5 w-3.5 text-primary" />
          </Link>
        </Button>
      </CardHeader>
      <CardContent className="space-y-3 pt-0 sm:pt-0">
        {loans.map((loan) => (
          <LoanDashboardRow key={loan.id} loan={loan} />
        ))}
      </CardContent>
    </Card>
  );
}

function LoanDashboardRow({ loan }: { loan: InstrumentLoan }) {
  const { t } = useTranslation();
  const inst = loan.instrument;
  return (
    <div className="flex items-center gap-3 rounded-lg border bg-card p-3">
      <div className="relative aspect-square h-12 w-12 shrink-0 overflow-hidden rounded-md bg-muted">
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
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="truncate font-medium">{inst?.name ?? '—'}</p>
          <Badge variant={LOAN_STATUS_VARIANT[loan.status]}>
            {t(`loans.status.${loan.status}`)}
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground">
          {formatDate(loan.fromDate)} → {formatDate(loan.toDate)}
        </p>
      </div>
    </div>
  );
}
