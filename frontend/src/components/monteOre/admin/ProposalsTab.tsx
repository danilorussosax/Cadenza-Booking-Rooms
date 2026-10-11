import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Upload } from 'lucide-react';
import { monteOreAdminApi, type MonteOreProposal } from '@/api/monteOre';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { DetailDialog } from './ProposalDetailDialog';
import { CONTRACT_LABEL, STATUS_LABEL, STATUS_VARIANT, resolveProposalThreshold } from './shared';

export function ProposalsTab({
  selectedYear,
  statusFilter,
  onStatusFilterChange,
}: {
  selectedYear: string | undefined;
  statusFilter: MonteOreProposal['status'] | 'all';
  onStatusFilterChange: (s: MonteOreProposal['status'] | 'all') => void;
}) {
  const qc = useQueryClient();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const listQuery = useQuery({
    queryKey: ['admin', 'monte-ore', 'list', statusFilter, selectedYear],
    queryFn: () =>
      monteOreAdminApi.list({
        ...(statusFilter === 'all' ? {} : { status: statusFilter }),
        ...(selectedYear ? { academicYear: selectedYear } : {}),
      }),
    enabled: !!selectedYear,
  });
  const proposals = listQuery.data?.proposals ?? [];

  return (
    <>
      <>
        <Card>
          <CardContent className="flex flex-wrap items-center gap-3 p-4 sm:p-6">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">
              Filtra:
            </Label>
            {(['submitted', 'approved', 'generated', 'rejected', 'draft', 'all'] as const).map(
              (s) => (
                <Button
                  key={s}
                  variant={statusFilter === s ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => onStatusFilterChange(s)}
                >
                  {s === 'all' ? 'Tutte' : STATUS_LABEL[s]}
                </Button>
              ),
            )}
            <span className="ml-auto text-xs text-muted-foreground">
              {proposals.length} proposte
            </span>
          </CardContent>
        </Card>

        {listQuery.isLoading ? (
          <Skeleton className="h-64 w-full" />
        ) : proposals.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center text-sm text-muted-foreground">
              Nessuna proposta in questo stato.
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-3">
            {proposals.map((p) => {
              const threshold = resolveProposalThreshold(p);
              const meetsThreshold =
                p.contractSnapshot?.mode === 'maximum'
                  ? p.totalHoursPlanned > 0 && p.totalHoursPlanned <= threshold.hours
                  : p.contractSnapshot?.mode === 'exact'
                    ? Math.round(p.totalHoursPlanned * 60) === Math.round(threshold.hours * 60)
                    : p.totalHoursPlanned >= threshold.hours;
              return (
                <Card
                  key={p.id}
                  className="cursor-pointer transition hover:shadow-md"
                  onClick={() => setSelectedId(p.id)}
                >
                  <CardContent className="grid gap-3 p-4 sm:p-6 sm:grid-cols-[1fr_auto_auto_auto] sm:items-center">
                    <div>
                      <p className="font-medium flex items-center gap-2 flex-wrap">
                        {p.user ? `${p.user.lastName} ${p.user.firstName}` : `User #${p.userId}`}
                        {threshold.contractType && threshold.contractType !== 'titolare' && (
                          <Badge variant="secondary" className="text-[10px]">
                            {CONTRACT_LABEL[threshold.contractType]}
                          </Badge>
                        )}
                        {p.source === 'admin_import' && (
                          <Badge
                            variant="outline"
                            className="text-[10px] gap-1"
                            title={
                              p.importedAt
                                ? `Importata da Excel il ${new Date(p.importedAt).toLocaleString('it-IT')}`
                                : 'Proposta importata da Excel'
                            }
                          >
                            <Upload className="h-3 w-3" />
                            importata
                          </Badge>
                        )}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        AA {p.academicYear} · {p.schedules.length} fasce ·{' '}
                        <span
                          className={
                            meetsThreshold
                              ? 'text-emerald-600 dark:text-emerald-400 font-medium'
                              : 'text-amber-600 dark:text-amber-400 font-medium'
                          }
                        >
                          {p.totalHoursPlanned.toFixed(1)} / {threshold.hours} h
                        </span>
                        {threshold.isCustom && (
                          <span className="ml-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                            (
                            {threshold.source === 'override'
                              ? 'override · non ancora submitted'
                              : 'soglia personalizzata'}
                            )
                          </span>
                        )}
                      </p>
                    </div>
                    <Badge variant={STATUS_VARIANT[p.status]}>{STATUS_LABEL[p.status]}</Badge>
                    <p className="text-xs text-muted-foreground">
                      Inviata:{' '}
                      {p.submittedAt ? new Date(p.submittedAt).toLocaleDateString('it-IT') : '—'}
                    </p>
                    <Button variant="outline" size="sm">
                      Apri
                    </Button>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </>
      {selectedId !== null && (
        <DetailDialog
          id={selectedId}
          onClose={() => setSelectedId(null)}
          onChanged={() => {
            void qc.invalidateQueries({ queryKey: ['admin', 'monte-ore'] });
          }}
        />
      )}
    </>
  );
}
