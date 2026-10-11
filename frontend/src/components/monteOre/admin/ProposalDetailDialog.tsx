import PlanApproval from '@/components/monteOre/PlanApproval';
import { AmendmentEditor } from '@/components/monteOre/AmendmentEditor';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  CheckCircle2,
  Pencil,
  Plus,
  RotateCcw,
  Trash2,
  Unlock,
  Upload,
  XCircle,
  Zap,
} from 'lucide-react';
import { monteOreAdminApi, type MonteOreSchedule } from '@/api/monteOre';
import { httpErrorMessage } from '@/lib/api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { AmendmentsSection } from './ProposalAmendmentsSection';
import { ScheduleEditDialog } from './ScheduleEditDialog';
import {
  CONTRACT_LABEL,
  DAYS_IT,
  STATUS_LABEL,
  STATUS_VARIANT,
  TYPE_OPTIONS,
  resolveProposalThreshold,
} from './shared';

export function DetailDialog({
  id,
  onClose,
  onChanged,
}: {
  id: number;
  onClose: () => void;
  onChanged: () => void;
}) {
  const qc = useQueryClient();
  const [planApprovalOpen, setPlanApprovalOpen] = useState(false);
  const [revalidateOpen, setRevalidateOpen] = useState(false);
  const detailQuery = useQuery({
    queryKey: ['admin', 'monte-ore', id],
    queryFn: () => monteOreAdminApi.get(id),
  });
  const proposal = detailQuery.data?.proposal;

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['admin', 'monte-ore', id] });
    onChanged();
  };

  const rejectMutation = useMutation({
    mutationFn: (reason: string) => monteOreAdminApi.reject(id, reason),
    onSuccess: () => {
      toast.success('Proposta rifiutata');
      refresh();
    },
    onError: (err) => toast.error(httpErrorMessage(err)),
  });
  const generateMutation = useMutation({
    mutationFn: (includePast: boolean) => monteOreAdminApi.generate(id, { includePast }),
    onSuccess: (data) => {
      toast.success(
        `Prenotazioni create: ${data.result.created}` +
          (data.result.skipped.length ? ` (${data.result.skipped.length} saltate)` : ''),
      );
      refresh();
    },
    onError: (err) => toast.error(httpErrorMessage(err)),
  });
  const unlockMutation = useMutation({
    mutationFn: () => monteOreAdminApi.unlock(id),
    onSuccess: (data) => {
      toast.success(`Prenotazioni cancellate: ${data.cleared.cleared}`);
      refresh();
    },
    onError: (err) => toast.error(httpErrorMessage(err)),
  });
  // Fase 6.4 — riporta la proposta in 'draft' chiedendo al docente di modificarla.
  // Per 'generated' va prima eseguito unlock (che cancella i Booking generati).
  const revertMutation = useMutation({
    mutationFn: (reason: string) => monteOreAdminApi.revertToDraft(id, reason),
    onSuccess: () => {
      toast.success('Proposta riportata in bozza: il docente è stato avvisato');
      refresh();
    },
    onError: (err) => toast.error(httpErrorMessage(err)),
  });

  const [editingSchedule, setEditingSchedule] = useState<MonteOreSchedule | null>(null);
  const [adding, setAdding] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [confirmReject, setConfirmReject] = useState(false);
  const [confirmGenerate, setConfirmGenerate] = useState(false);
  const [includePast, setIncludePast] = useState(false);
  const [confirmRevert, setConfirmRevert] = useState(false);
  const [revertReason, setRevertReason] = useState('');

  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        {detailQuery.isLoading || !proposal ? (
          <div className="space-y-3 py-8">
            <Skeleton className="h-6 w-48" />
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-64 w-full" />
          </div>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-2 flex-wrap">
                  {proposal.user
                    ? `${proposal.user.lastName} ${proposal.user.firstName}`
                    : 'Proposta'}
                  {(() => {
                    const ct = proposal.user?.contractType;
                    return ct && ct !== 'titolare' ? (
                      <Badge variant="secondary" className="text-[10px]">
                        {CONTRACT_LABEL[ct]}
                      </Badge>
                    ) : null;
                  })()}
                </span>
                <Badge variant={STATUS_VARIANT[proposal.status]}>
                  {STATUS_LABEL[proposal.status]}
                </Badge>
              </DialogTitle>
              <DialogDescription>
                AA {proposal.academicYear} · validità {proposal.validFrom} → {proposal.validTo}
              </DialogDescription>
            </DialogHeader>

            {/* Riepilogo soglia ore: prominente, con confronto vs threshold. */}
            {(() => {
              const threshold = resolveProposalThreshold(proposal);
              const meets = proposal.totalHoursPlanned >= threshold.hours;
              return (
                <div
                  className={`rounded-lg border p-3 text-sm ${
                    meets
                      ? 'border-emerald-200 bg-emerald-50/50 dark:border-emerald-900 dark:bg-emerald-950/20'
                      : 'border-amber-200 bg-amber-50/50 dark:border-amber-900 dark:bg-amber-950/20'
                  }`}
                >
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div>
                      <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
                        Ore proposte / soglia annua
                      </Label>
                      <p className="font-display text-2xl font-medium tabular-nums leading-tight">
                        <span
                          className={
                            meets
                              ? 'text-emerald-700 dark:text-emerald-400'
                              : 'text-amber-700 dark:text-amber-400'
                          }
                        >
                          {proposal.totalHoursPlanned.toFixed(1)}
                        </span>
                        <span className="text-muted-foreground"> / {threshold.hours} h</span>
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
                        Origine soglia
                      </p>
                      <p className="text-sm font-medium">
                        {threshold.source === 'snapshot' &&
                          (threshold.isCustom
                            ? 'Snapshot al submit · soglia personalizzata'
                            : 'Snapshot al submit · CCNL 324h')}
                        {threshold.source === 'override' &&
                          'Deroga individuale (proposta non ancora submitted)'}
                        {threshold.source === 'ccnl' && 'CCNL standard 324h'}
                      </p>
                      {threshold.isCustom && proposal.user?.monteOreOverrideReason && (
                        <p className="mt-1 text-[11px] text-muted-foreground max-w-xs">
                          {proposal.user.monteOreOverrideReason}
                        </p>
                      )}
                    </div>
                  </div>
                  {!meets && (
                    <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">
                      Mancano {(threshold.hours - proposal.totalHoursPlanned).toFixed(1)} h al
                      raggiungimento della soglia.
                    </p>
                  )}
                  {proposal.user?.monteOreBypassDayConstraint && (
                    <p className="mt-2 text-xs text-muted-foreground">
                      ⓘ Esente dal vincolo 2-4 giorni/settimana.
                    </p>
                  )}
                </div>
              );
            })()}

            {proposal.notes && (
              <div className="rounded-lg border bg-muted/30 p-3 text-sm">
                <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
                  Note del docente
                </Label>
                <p className="mt-1 whitespace-pre-wrap">{proposal.notes}</p>
              </div>
            )}

            {proposal.source === 'admin_import' && (
              <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm">
                <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
                  Origine
                </Label>
                <p className="mt-1 flex items-center gap-2">
                  <Upload className="h-4 w-4 text-primary" />
                  Importata da Excel
                  {proposal.importedAt && (
                    <span className="text-muted-foreground">
                      · il {new Date(proposal.importedAt).toLocaleString('it-IT')}
                    </span>
                  )}
                </p>
                {proposal.importSourceRef && (
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    File: <span className="font-mono">{proposal.importSourceRef}</span>
                  </p>
                )}
              </div>
            )}

            {proposal.status === 'rejected' && proposal.rejectionReason && (
              <div className="rounded-lg border border-destructive/50 bg-destructive/5 p-3 text-sm">
                <Label className="text-[11px] uppercase tracking-wider text-destructive">
                  Motivo del rifiuto
                </Label>
                <p className="mt-1 whitespace-pre-wrap">{proposal.rejectionReason}</p>
              </div>
            )}

            {proposal.generationSummary && (
              <div className="rounded-lg border bg-muted/30 p-3 text-sm">
                <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
                  Esito generazione
                </Label>
                <p className="mt-1">
                  <strong>{proposal.generationSummary.created}</strong> prenotazioni create
                  {proposal.generationSummary.skipped > 0 && (
                    <>
                      , <strong>{proposal.generationSummary.skipped}</strong> saltate per conflitto
                    </>
                  )}
                  {proposal.generationSummary.errors > 0 && (
                    <>
                      , <strong>{proposal.generationSummary.errors}</strong> errori
                    </>
                  )}
                  .
                </p>
              </div>
            )}

            {/* Tabella fasce */}
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-3">
                <CardTitle className="text-base">Fasce orarie</CardTitle>
                {proposal.status !== 'generated' && (
                  <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
                    <Plus className="h-4 w-4" />
                    Aggiungi
                  </Button>
                )}
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="border-b text-left text-xs uppercase tracking-wider text-muted-foreground">
                      <tr>
                        <th className="px-3 py-2">Giorno</th>
                        <th className="px-3 py-2">Orario</th>
                        <th className="px-3 py-2">Aula</th>
                        <th className="px-3 py-2">Tipo</th>
                        <th className="px-3 py-2">Attività</th>
                        {proposal.status !== 'generated' && (
                          <th className="px-3 py-2 text-right">Azioni</th>
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {proposal.schedules.map((s) => (
                        <tr key={s.id} className="border-b last:border-0">
                          <td className="px-3 py-2 font-medium">{DAYS_IT[s.dayOfWeek]}</td>
                          <td className="px-3 py-2 tabular-nums">
                            {s.startTime}–{s.endTime}
                          </td>
                          <td
                            className={`px-3 py-2 ${s.room ? '' : 'text-amber-600 dark:text-amber-400'}`}
                          >
                            {s.room
                              ? `${s.room.name}${s.room.building ? ' · ' + s.room.building.name : ''}`
                              : '— DA ASSEGNARE —'}
                          </td>
                          <td className="px-3 py-2">
                            {TYPE_OPTIONS.find((o) => o.value === s.bookingType)?.label ??
                              s.bookingType}
                          </td>
                          <td className="px-3 py-2 text-muted-foreground">{s.purpose ?? ''}</td>
                          {proposal.status !== 'generated' && (
                            <td className="px-3 py-2 text-right">
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => setEditingSchedule(s)}
                              >
                                <Pencil className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="text-destructive"
                                onClick={async () => {
                                  await monteOreAdminApi.removeSchedule(id, s.id);
                                  refresh();
                                }}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>

            {/* Sezione amendments (solo se la proposta è approved/generated) */}
            {['approved', 'generated'].includes(proposal.status) && (
              <AmendmentsSection proposalId={proposal.id} onAfterDecision={refresh} />
            )}

            {proposal.requiresRevalidation && proposal.status === 'generated' && (
              <Button variant="outline" onClick={() => setRevalidateOpen(true)}>
                Rivalida piano e comunica al docente
              </Button>
            )}
            {revalidateOpen && (
              <AmendmentEditor
                adminPlanId={id}
                academicYear={proposal.academicYear}
                slots={proposal.slots ?? []}
                onClose={() => {
                  setRevalidateOpen(false);
                  refresh();
                }}
              />
            )}
            {/* Footer azioni stato-dipendenti */}
            <DialogFooter className="flex flex-wrap gap-2 sm:justify-between">
              <Button variant="outline" onClick={onClose}>
                Chiudi
              </Button>
              <div className="flex flex-wrap gap-2">
                {proposal.status === 'submitted' && (
                  <>
                    <Button
                      variant="outline"
                      onClick={() => setConfirmRevert(true)}
                      title="Riporta la proposta in bozza al docente"
                    >
                      <RotateCcw className="h-4 w-4" />
                      Richiedi modifica
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => setConfirmReject(true)}
                      className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                    >
                      <XCircle className="h-4 w-4" />
                      Rifiuta
                    </Button>
                    <Button
                      onClick={() => setPlanApprovalOpen(true)}
                      disabled={detailQuery.isPending}
                    >
                      <CheckCircle2 className="h-4 w-4" />
                      Verifica aule e approva
                    </Button>
                  </>
                )}
                {proposal.status === 'approved' && (
                  <>
                    <Button
                      variant="outline"
                      onClick={() => setConfirmRevert(true)}
                      title="Riporta la proposta in bozza al docente"
                    >
                      <RotateCcw className="h-4 w-4" />
                      Richiedi modifica
                    </Button>
                    <Button
                      onClick={() => {
                        setPlanApprovalOpen(true);
                      }}
                      disabled={
                        generateMutation.isPending ||
                        proposal.schedules.length === 0 ||
                        proposal.schedules.some((s) => !s.roomId)
                      }
                    >
                      <Zap className="h-4 w-4" />
                      Crea prenotazioni dal monte ore
                    </Button>
                  </>
                )}
                {proposal.status === 'generated' && (
                  <Button
                    variant="outline"
                    onClick={() => unlockMutation.mutate()}
                    disabled={unlockMutation.isPending}
                    title="Cancella i Booking generati e riporta la proposta a 'approved'. Per chiedere modifica al docente, esegui poi 'Richiedi modifica'."
                  >
                    <Unlock className="h-4 w-4" />
                    Annulla generazione
                  </Button>
                )}
              </div>
            </DialogFooter>

            {planApprovalOpen && (
              <PlanApproval
                proposalId={id}
                onClose={() => setPlanApprovalOpen(false)}
                onApproved={refresh}
              />
            )}
            {/* Edit/add schedule */}
            <ScheduleEditDialog
              open={adding || editingSchedule !== null}
              onClose={() => {
                setAdding(false);
                setEditingSchedule(null);
              }}
              proposalId={id}
              existing={editingSchedule}
              onSaved={refresh}
            />

            {/* Generate confirmation dialog (con opzione "includi date passate") */}
            <Dialog open={confirmGenerate} onOpenChange={setConfirmGenerate}>
              <DialogContent className="sm:max-w-md">
                <DialogHeader>
                  <DialogTitle>Crea prenotazioni dal monte ore</DialogTitle>
                  <DialogDescription>
                    Verranno create prenotazioni ricorrenti per ogni occorrenza del pattern nel
                    range di validità della proposta.
                  </DialogDescription>
                </DialogHeader>
                <label className="flex items-start gap-3 rounded-lg border p-3 cursor-pointer hover:bg-muted/30">
                  <input
                    type="checkbox"
                    className="mt-0.5 h-4 w-4"
                    checked={includePast}
                    onChange={(e) => setIncludePast(e.target.checked)}
                  />
                  <div className="text-sm">
                    <div className="font-medium">Includi anche le date già trascorse</div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      Materializza in Booking anche le occorrenze del pattern che cadono prima di
                      oggi (utile per ricostruire monte ore arretrato a metà AA, o per registrazione
                      contabile dell'attività già svolta).
                    </div>
                  </div>
                </label>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setConfirmGenerate(false)}>
                    Annulla
                  </Button>
                  <Button
                    onClick={() => {
                      generateMutation.mutate(includePast);
                      setConfirmGenerate(false);
                    }}
                    disabled={generateMutation.isPending}
                  >
                    <Zap className="h-4 w-4" />
                    Genera
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            {/* Revert-to-draft dialog (Fase 6.4) */}
            <Dialog open={confirmRevert} onOpenChange={setConfirmRevert}>
              <DialogContent className="sm:max-w-md">
                <DialogHeader>
                  <DialogTitle>Richiedi modifica al docente</DialogTitle>
                  <DialogDescription>
                    La proposta torna in <strong>bozza</strong>: il docente vedrà un banner con il
                    motivo, potrà modificare le fasce e re-inviare. La cronologia delle variazioni
                    resta tracciata.
                  </DialogDescription>
                </DialogHeader>
                <Textarea
                  rows={3}
                  maxLength={500}
                  value={revertReason}
                  onChange={(e) => setRevertReason(e.target.value)}
                  placeholder="Es. variazione contratto: rivedi le ore totali. Oppure: aula assegnata non più disponibile, scegline un'altra."
                />
                <DialogFooter>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setConfirmRevert(false);
                      setRevertReason('');
                    }}
                  >
                    Annulla
                  </Button>
                  <Button
                    onClick={() => {
                      revertMutation.mutate(revertReason.trim());
                      setConfirmRevert(false);
                      setRevertReason('');
                    }}
                    disabled={revertMutation.isPending}
                  >
                    <RotateCcw className="h-4 w-4" />
                    Riporta in bozza
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            {/* Reject reason dialog */}
            <Dialog open={confirmReject} onOpenChange={setConfirmReject}>
              <DialogContent className="sm:max-w-md">
                <DialogHeader>
                  <DialogTitle>Rifiuta proposta</DialogTitle>
                  <DialogDescription>
                    Indica un motivo (sarà visibile al docente).
                  </DialogDescription>
                </DialogHeader>
                <Textarea
                  rows={3}
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  placeholder="Es. monte ore eccessivo, conflitto con altro docente…"
                />
                <DialogFooter>
                  <Button variant="outline" onClick={() => setConfirmReject(false)}>
                    Annulla
                  </Button>
                  <Button
                    variant="destructive"
                    onClick={() => {
                      rejectMutation.mutate(rejectReason);
                      setConfirmReject(false);
                    }}
                    disabled={rejectMutation.isPending}
                  >
                    Conferma rifiuto
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
