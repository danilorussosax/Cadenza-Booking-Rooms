import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { monteOreAdminApi, amendmentSummary } from '@/api/monteOre';
import { httpErrorMessage } from '@/lib/api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { AmendmentActions } from './AmendmentActions';
import { AMENDMENT_KIND_LABEL } from './shared';

export function AmendmentsRequestsTab() {
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<'pending' | 'all'>('pending');
  const listQuery = useQuery({
    queryKey: ['admin', 'monte-ore', 'amendments', 'list', statusFilter],
    queryFn: () =>
      monteOreAdminApi.listAmendments(statusFilter === 'all' ? {} : { status: statusFilter }),
  });

  const approve = useMutation({
    mutationFn: ({ pid, aid, roomId }: { pid: number; aid: number; roomId?: number }) =>
      monteOreAdminApi.approveAmendment(pid, aid, roomId ? { roomId } : {}),
    onSuccess: () => {
      toast.success('Variazione approvata');
      void qc.invalidateQueries({ queryKey: ['admin', 'monte-ore', 'amendments'] });
    },
    onError: (err) => toast.error(httpErrorMessage(err)),
  });

  const reject = useMutation({
    mutationFn: ({ pid, aid, reason }: { pid: number; aid: number; reason: string }) =>
      monteOreAdminApi.rejectAmendment(pid, aid, reason),
    onSuccess: () => {
      toast.success('Variazione rifiutata');
      void qc.invalidateQueries({ queryKey: ['admin', 'monte-ore', 'amendments'] });
    },
    onError: (err) => toast.error(httpErrorMessage(err)),
  });

  const items = listQuery.data?.amendments ?? [];

  return (
    <>
      <Card>
        <CardContent className="flex flex-wrap items-center gap-3 p-4">
          <Label className="text-xs uppercase tracking-wider text-muted-foreground">Filtra:</Label>
          {(['pending', 'all'] as const).map((s) => (
            <Button
              key={s}
              variant={statusFilter === s ? 'default' : 'outline'}
              size="sm"
              onClick={() => setStatusFilter(s)}
            >
              {s === 'pending' ? 'In attesa' : 'Tutte'}
            </Button>
          ))}
          <span className="ml-auto text-xs text-muted-foreground">{items.length} richieste</span>
        </CardContent>
      </Card>

      {listQuery.isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : items.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            Nessuna richiesta di variazione{statusFilter === 'pending' ? ' in attesa' : ''}.
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/30 text-left text-xs uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2">Docente</th>
                    <th className="px-3 py-2">Tipo</th>
                    <th className="px-3 py-2">Cella</th>
                    <th className="px-3 py-2">Note</th>
                    <th className="px-3 py-2">Stato</th>
                    <th className="px-3 py-2 text-right">Azioni</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((a) => (
                    <tr key={a.id} className="border-b last:border-0 align-top">
                      <td className="px-3 py-2">
                        <div className="font-medium">
                          {a.requester
                            ? `${a.requester.lastName} ${a.requester.firstName}`
                            : `User #${a.requesterId}`}
                        </div>
                        {a.proposal && (
                          <div className="text-xs text-muted-foreground">
                            AA {a.proposal.academicYear}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2">{AMENDMENT_KIND_LABEL[a.kind]}</td>
                      <td className="px-3 py-2 tabular-nums text-xs text-muted-foreground">
                        {amendmentSummary(a)}
                      </td>
                      <td className="px-3 py-2 text-xs text-muted-foreground max-w-[260px]">
                        {a.requestNotes ?? (
                          <span className="italic text-muted-foreground/60">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <Badge
                          variant={
                            a.status === 'auto_approved' || a.status === 'approved'
                              ? 'success'
                              : a.status === 'rejected'
                                ? 'destructive'
                                : 'secondary'
                          }
                        >
                          {a.status === 'pending' && 'In attesa'}
                          {a.status === 'auto_approved' && 'Auto-approvata'}
                          {a.status === 'approved' && 'Approvata'}
                          {a.status === 'rejected' && 'Rifiutata'}
                          {a.decisionNotes && (
                            <span className="block text-xs text-muted-foreground">
                              {a.decisionNotes}
                            </span>
                          )}
                          {a.emailStatus && (
                            <span className="block text-xs text-muted-foreground">
                              Email:{' '}
                              {a.emailStatus === 'sent'
                                ? 'inviata al server SMTP'
                                : a.emailStatus === 'dead'
                                  ? 'invio fallito'
                                  : 'accodata'}
                            </span>
                          )}
                        </Badge>
                      </td>
                      <td className="px-3 py-2 text-right">
                        {a.status === 'pending' && (
                          <AmendmentActions
                            amendment={a}
                            onApprove={(opts) =>
                              approve.mutate({ pid: a.proposalId, aid: a.id, roomId: opts.roomId })
                            }
                            onReject={(reason) =>
                              reject.mutate({ pid: a.proposalId, aid: a.id, reason })
                            }
                            isApproving={approve.isPending}
                            isRejecting={reject.isPending}
                          />
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </>
  );
}
