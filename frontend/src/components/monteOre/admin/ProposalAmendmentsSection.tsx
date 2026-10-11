import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { monteOreAdminApi, amendmentSummary } from '@/api/monteOre';
import { httpErrorMessage } from '@/lib/api';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { AmendmentActions } from './AmendmentActions';
import { AMENDMENT_KIND_LABEL } from './shared';

export function AmendmentsSection({
  proposalId,
  onAfterDecision,
}: {
  proposalId: number;
  onAfterDecision: () => void;
}) {
  const qc = useQueryClient();
  const amendmentsQuery = useQuery({
    queryKey: ['admin', 'monte-ore', 'amendments', proposalId],
    queryFn: () => monteOreAdminApi.listProposalAmendments(proposalId),
  });

  const approveMutation = useMutation({
    mutationFn: ({ aid, roomId }: { aid: number; roomId?: number }) =>
      monteOreAdminApi.approveAmendment(proposalId, aid, roomId ? { roomId } : {}),
    onSuccess: () => {
      toast.success('Variazione approvata');
      void qc.invalidateQueries({ queryKey: ['admin', 'monte-ore', 'amendments', proposalId] });
      onAfterDecision();
    },
    onError: (err) => toast.error(httpErrorMessage(err)),
  });

  const rejectMutation = useMutation({
    mutationFn: ({ aid, reason }: { aid: number; reason: string }) =>
      monteOreAdminApi.rejectAmendment(proposalId, aid, reason),
    onSuccess: () => {
      toast.success('Variazione rifiutata');
      void qc.invalidateQueries({ queryKey: ['admin', 'monte-ore', 'amendments', proposalId] });
      onAfterDecision();
    },
    onError: (err) => toast.error(httpErrorMessage(err)),
  });

  const items = amendmentsQuery.data?.amendments ?? [];
  const pending = items.filter((a) => a.status === 'pending');
  const decided = items.filter((a) => a.status !== 'pending');

  if (amendmentsQuery.isLoading) return <Skeleton className="h-24 w-full" />;
  if (items.length === 0) return null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">
          Richieste di variazione
          {pending.length > 0 && (
            <Badge variant="secondary" className="ml-2">
              {pending.length} in attesa
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b text-left text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Tipo</th>
                <th className="px-3 py-2">Cella</th>
                <th className="px-3 py-2">Stato</th>
                <th className="px-3 py-2 text-right">Azioni</th>
              </tr>
            </thead>
            <tbody>
              {[...pending, ...decided].map((a) => (
                <tr key={a.id} className="border-b last:border-0">
                  <td className="px-3 py-2">{AMENDMENT_KIND_LABEL[a.kind]}</td>
                  <td className="px-3 py-2 tabular-nums text-xs text-muted-foreground">
                    {amendmentSummary(a)}
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
                          approveMutation.mutate({ aid: a.id, roomId: opts.roomId })
                        }
                        onReject={(reason) => rejectMutation.mutate({ aid: a.id, reason })}
                        isApproving={approveMutation.isPending}
                        isRejecting={rejectMutation.isPending}
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
  );
}
