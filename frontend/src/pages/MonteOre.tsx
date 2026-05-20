import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  CalendarRange,
  CheckCircle2,
  Clock,
  Info,
  Plus,
  Send,
  Trash2,
  AlertCircle,
  Pencil,
  GraduationCap,
  CalendarClock,
} from 'lucide-react';
import {
  monteOreApi,
  type MonteOreProposal,
  type MonteOreSchedule,
  type SchedulePayload,
} from '@/api/monteOre';
import { roomsApi } from '@/api/rooms';
import { httpErrorMessage } from '@/lib/api';
import { validateDailyConstraints, describeDailyViolation } from '@/lib/monteOreDailyValidator';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { sortRoomsCrossBuilding } from '@/lib/sortRooms';
import type { BookingType } from '@/types';
import MonteOreGrid from '@/components/monteOre/MonteOreGrid';
import { ModuleDisabledCard } from '@/components/ModuleDisabledCard';
import { isModuleDisabledError } from '@/lib/moduleFlags';

const DAYS_IT = ['Domenica', 'Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato'];
const TYPE_OPTIONS: { value: BookingType; label: string }[] = [
  { value: 'lezione', label: 'Lezione' },
  { value: 'studio_individuale', label: 'Studio individuale' },
  { value: 'prova', label: 'Prova' },
  { value: 'concerto', label: 'Concerto' },
];

function statusBadge(status: MonteOreProposal['status']) {
  const map: Record<
    MonteOreProposal['status'],
    { v: 'success' | 'secondary' | 'destructive' | 'muted'; lbl: string }
  > = {
    draft: { v: 'muted', lbl: 'Bozza' },
    submitted: { v: 'secondary', lbl: 'In attesa di approvazione' },
    approved: { v: 'success', lbl: 'Approvata' },
    rejected: { v: 'destructive', lbl: 'Rifiutata' },
    generated: { v: 'success', lbl: 'Prenotazioni create' },
  };
  const m = map[status];
  return <Badge variant={m.v}>{m.lbl}</Badge>;
}

export default function MonteOre() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<MonteOreSchedule | null>(null);
  const [adding, setAdding] = useState(false);

  // Risolve l'AA target del docente (current vs next a finestra aperta).
  // È l'autorità per tutte le query della pagina: tutti i fetch passano
  // `?year={target}` per evitare race su rollover anno (1 nov, finestra
  // submission aperta, ecc.).
  const targetYearQuery = useQuery({
    queryKey: ['monte-ore', 'academic-year', 'me'],
    queryFn: () => monteOreApi.getAcademicYearForTeacher(),
  });
  const targetItem = targetYearQuery.data?.items[0];
  const targetYear = targetItem?.academicYear;

  const proposalQuery = useQuery({
    queryKey: ['monte-ore', 'me', targetYear],
    queryFn: () => monteOreApi.getMine(targetYear),
    enabled: !!targetYear,
  });

  // Soglia personalizzata (override) — null se l'utente non è un docente.
  // Il banner viene mostrato solo se l'admin ha impostato un override (source
  // === 'user_override') o se il bypass del vincolo 2-4 giorni è attivo.
  const thresholdQuery = useQuery({
    queryKey: ['monte-ore', 'me', 'threshold', targetYear],
    queryFn: () => monteOreApi.getMyThreshold(targetYear),
    enabled: !!targetYear,
  });

  const proposal = proposalQuery.data?.proposal;
  const threshold = thresholdQuery.data;
  const hasIndividualOverride =
    threshold?.source === 'user_override' || threshold?.bypassDayConstraint === true;
  const isLocked = proposal && !['draft', 'rejected'].includes(proposal.status);

  // Replica client-side delle validazioni backend (routes/monteOre.js:265-335)
  // per disabilitare il submit e mostrare cosa manca. Il backend resta
  // l'autorità: se l'admin non ha configurato MonteOreSettings per l'AA
  // (threshold undefined) i blockers ore/giorni non si applicano.
  const submitBlockers: string[] = (() => {
    if (!proposal) return [];
    const out: string[] = [];
    if (proposal.schedules.length === 0) {
      out.push('Aggiungi almeno una fascia oraria settimanale.');
    }
    if (threshold && !threshold.bypassDayConstraint && proposal.schedules.length > 0) {
      const distinctDays = new Set(proposal.schedules.map((s) => s.dayOfWeek)).size;
      if (distinctDays < 2 || distinctDays > 4) {
        out.push(`Devi coprire tra 2 e 4 giorni della settimana (attualmente: ${distinctDays}).`);
      }
    }
    if (threshold && proposal.totalHoursRequested < threshold.minHours) {
      const missing = (threshold.minHours - proposal.totalHoursRequested).toFixed(1);
      out.push(
        `Ti mancano ${missing} h per raggiungere la soglia di ${threshold.minHours} h/anno.`,
      );
    }
    // Z2/Z3 — vincoli giornalieri (Regolamento Art. 2). Se l'admin non li
    // ha configurati (tutti null), il validator ritorna ok=true senza warning.
    if (threshold?.dailyConstraints && proposal.schedules.length > 0) {
      const daily = validateDailyConstraints(proposal.schedules, threshold.dailyConstraints);
      for (const v of daily.violations) {
        out.push(describeDailyViolation(v));
      }
    }
    return out;
  })();
  const canSubmit = submitBlockers.length === 0;

  const updateMutation = useMutation({
    mutationFn: (payload: {
      notes?: string | null;
      totalHoursRequested?: number;
      validFrom?: string;
      validTo?: string;
    }) => monteOreApi.updateMine(payload),
    onSuccess: () => {
      // Aggiorno solo la proposal (campi notes/hours/range); threshold e
      // slots non sono toccati da questa mutation.
      void qc.invalidateQueries({ queryKey: ['monte-ore', 'me', targetYear] });
    },
    onError: (err) => toast.error(httpErrorMessage(err)),
  });

  const removeMutation = useMutation({
    mutationFn: (id: number) => monteOreApi.removeMySchedule(id),
    onSuccess: () => {
      toast.success('Riga eliminata');
      // La rimozione di una schedule cambia proposal.schedules e rende stantii
      // gli slot legati a quella schedule (verranno rigenerati al prossimo
      // regenerate-slots o submit).
      void qc.invalidateQueries({ queryKey: ['monte-ore', 'me', targetYear] });
      void qc.invalidateQueries({ queryKey: ['monte-ore', 'me', 'slots'] });
    },
    onError: (err) => toast.error(httpErrorMessage(err)),
  });

  const submitMutation = useMutation({
    mutationFn: () => monteOreApi.submitMine(targetYear),
    onSuccess: () => {
      toast.success('Proposta inviata al coordinatore');
      // Cambia solo proposal.status (e timestamp): basta proposal.
      void qc.invalidateQueries({ queryKey: ['monte-ore', 'me', targetYear] });
    },
    onError: (err) => toast.error(httpErrorMessage(err)),
  });

  if (targetYearQuery.isLoading || proposalQuery.isLoading) {
    return (
      <div className="mx-auto max-w-7xl space-y-4">
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  // Modulo "Monte Ore" disattivato dalla Direzione → backend ritorna 404
  // MODULE_DISABLED. Mostriamo un placeholder leggibile invece dell'alert
  // generico "errore non specificato".
  if (isModuleDisabledError(proposalQuery.error)) {
    return <ModuleDisabledCard moduleLabel="Monte Ore" />;
  }

  if (!proposal) {
    return (
      <div className="mx-auto max-w-7xl">
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>Impossibile caricare la proposta.</AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-display text-3xl font-medium inline-flex items-center gap-2">
            <Clock className="h-6 w-6 text-primary" />
            Monte ore
          </h1>
          <p className="text-sm text-muted-foreground">
            Compila la tua proposta annuale e inviala al coordinatore della didattica.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {statusBadge(proposal.status)}
          {proposal.status === 'draft' && proposal.schedules.length > 0 && (
            <Button
              onClick={() => submitMutation.mutate()}
              disabled={submitMutation.isPending || !canSubmit}
              title={canSubmit ? undefined : submitBlockers[0]}
            >
              <Send className="h-4 w-4" />
              Invia al coordinatore
            </Button>
          )}
          {proposal.status === 'rejected' && proposal.schedules.length > 0 && (
            <Button
              onClick={() => submitMutation.mutate()}
              disabled={submitMutation.isPending || !canSubmit}
              title={canSubmit ? undefined : submitBlockers[0]}
            >
              <Send className="h-4 w-4" />
              Reinvia
            </Button>
          )}
        </div>
      </header>

      {/* Banner AA "non in corso" — visibile quando il docente sta compilando
          il monte ore dell'AA prossimo (rollover automatico durante la
          finestra di submission). Diversifica visivamente il caso normale
          (AA corrente) dal caso più raro (AA futuro) per evitare confusione. */}
      {targetItem && (!targetItem.isCurrent || targetItem.adminActivated) && (
        <Alert>
          <CalendarRange className="h-4 w-4" />
          <AlertDescription>
            <p className="font-medium">
              Stai compilando il monte ore per l'AA {targetItem.academicYear}
              {targetItem.adminActivated
                ? " (attivato dall'amministrazione)"
                : targetItem.isNext
                  ? ' (prossimo)'
                  : ''}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {targetItem.adminActivated
                ? "L'amministrazione ha selezionato questo anno accademico come quello attivo per l'inserimento."
                : targetItem.submissionOpen
                  ? 'La finestra di inserimento è attualmente aperta.'
                  : 'La finestra di inserimento non risulta aperta al momento.'}
            </p>
          </AlertDescription>
        </Alert>
      )}

      {hasIndividualOverride && (
        <Alert>
          <Info className="h-4 w-4" />
          <AlertDescription>
            <p className="font-medium">
              Soglia Monte Ore personalizzata: {threshold.minHours} ore/anno
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {threshold.contractType === 'contratto_orario' && (
                <>Tipo contratto: contratto orario · </>
              )}
              {threshold.contractType === 'supplente' && <>Tipo contratto: supplente · </>}
              {threshold.contractType === 'altro' && <>Tipo contratto: altro · </>}
              Vincolo 2-4 giorni/settimana:{' '}
              {threshold.bypassDayConstraint ? 'NON applicato' : 'applicato'}.
              {' Per modifiche contattare la Direzione.'}
            </p>
          </AlertDescription>
        </Alert>
      )}

      {proposal.requiresRevalidation && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            <p className="font-medium">Proposta da rivalidare</p>
            <p className="text-sm mt-1">
              {proposal.revalidationReason ??
                'I presupposti della tua proposta sono cambiati: rivedi e re-invia.'}
            </p>
          </AlertDescription>
        </Alert>
      )}

      {['draft', 'rejected'].includes(proposal.status) && submitBlockers.length > 0 && (
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            <p className="font-medium">Per inviare la proposta al coordinatore:</p>
            <ul className="mt-1 list-disc pl-5 text-sm">
              {submitBlockers.map((b, i) => (
                <li key={i}>{b}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      {/* Riepilogo + range */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <GraduationCap className="h-5 w-5 text-primary" />
            Anno accademico {proposal.academicYear}
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-3">
          <div>
            <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
              Inizio validità
            </Label>
            <Input
              type="date"
              defaultValue={proposal.validFrom}
              disabled={isLocked}
              onBlur={(e) => {
                if (e.target.value && e.target.value !== proposal.validFrom) {
                  updateMutation.mutate({ validFrom: e.target.value });
                }
              }}
            />
          </div>
          <div>
            <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
              Fine validità
            </Label>
            <Input
              type="date"
              defaultValue={proposal.validTo}
              disabled={isLocked}
              onBlur={(e) => {
                if (e.target.value && e.target.value !== proposal.validTo) {
                  updateMutation.mutate({ validTo: e.target.value });
                }
              }}
            />
          </div>
          <div>
            <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
              Ore totali (calcolate)
            </Label>
            {threshold ? (
              <div>
                <p className="font-display text-2xl font-medium tabular-nums leading-tight">
                  <span
                    className={
                      proposal.totalHoursRequested >= threshold.minHours
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : 'text-amber-600 dark:text-amber-400'
                    }
                  >
                    {proposal.totalHoursRequested.toFixed(1)}
                  </span>
                  <span className="text-muted-foreground"> / {threshold.minHours} h</span>
                </p>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  {proposal.totalHoursRequested >= threshold.minHours
                    ? '✓ Soglia raggiunta'
                    : `Mancano ${(threshold.minHours - proposal.totalHoursRequested).toFixed(1)} h`}
                  {threshold.source === 'user_override' && ' · soglia personalizzata'}
                </p>
              </div>
            ) : (
              <p className="font-display text-2xl font-medium tabular-nums">
                {proposal.totalHoursRequested.toFixed(1)} h
              </p>
            )}
          </div>
          <div className="sm:col-span-3">
            <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
              Note al coordinatore (opzionale)
            </Label>
            <Textarea
              rows={3}
              placeholder="Eventuali esigenze, vincoli particolari, richieste sull'aula…"
              defaultValue={proposal.notes ?? ''}
              disabled={isLocked}
              onBlur={(e) => {
                if ((proposal.notes ?? '') !== e.target.value) {
                  updateMutation.mutate({ notes: e.target.value || null });
                }
              }}
            />
          </div>
        </CardContent>
      </Card>

      {/* Stato approvazione */}
      {proposal.status === 'rejected' && proposal.rejectionReason && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            <strong>Proposta rifiutata.</strong> {proposal.rejectionReason}
          </AlertDescription>
        </Alert>
      )}
      {proposal.status === 'approved' && (
        <Alert>
          <CheckCircle2 className="h-4 w-4" />
          <AlertDescription>
            Proposta approvata dal coordinatore. Le prenotazioni verranno create dal sistema.
          </AlertDescription>
        </Alert>
      )}
      {proposal.status === 'generated' && (
        <Alert>
          <CheckCircle2 className="h-4 w-4" />
          <AlertDescription>
            Prenotazioni create automaticamente in base alla tua proposta — le trovi nella pagina{' '}
            <strong>Le mie prenotazioni</strong>.
            {proposal.generationSummary && (
              <span className="ml-2 text-muted-foreground">
                ({proposal.generationSummary.created} create
                {proposal.generationSummary.skipped > 0 &&
                  `, ${proposal.generationSummary.skipped} saltate per conflitto`}
                ).
              </span>
            )}
          </AlertDescription>
        </Alert>
      )}

      {/* Tabella schedules */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-lg flex items-center gap-2">
              <CalendarClock className="h-5 w-5 text-primary" />
              Pianificazione settimanale
            </CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              Aggiungi una riga per ogni "fascia ricorrente" (es. ogni lunedì 14–17 in Aula 102).
            </p>
          </div>
          {!isLocked && (
            <Button size="sm" onClick={() => setAdding(true)}>
              <Plus className="h-4 w-4" />
              Aggiungi fascia
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {proposal.schedules.length === 0 ? (
            <div className="rounded-lg border border-dashed bg-muted/20 px-4 py-10 text-center">
              <CalendarRange className="mx-auto h-8 w-8 text-muted-foreground" />
              <p className="mt-2 text-sm font-medium">Nessuna fascia ancora configurata.</p>
              <p className="text-xs text-muted-foreground">
                Clicca <em>Aggiungi fascia</em> per inserire la prima.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b text-left text-xs uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2">Giorno</th>
                    <th className="px-3 py-2">Orario</th>
                    <th className="px-3 py-2">Aula preferita</th>
                    <th className="px-3 py-2">Tipo</th>
                    <th className="px-3 py-2">Attività</th>
                    {!isLocked && <th className="px-3 py-2 text-right">Azioni</th>}
                  </tr>
                </thead>
                <tbody>
                  {proposal.schedules.map((s) => (
                    <tr key={s.id} className="border-b last:border-0">
                      <td className="px-3 py-2 font-medium">{DAYS_IT[s.dayOfWeek]}</td>
                      <td className="px-3 py-2 tabular-nums">
                        {s.startTime}–{s.endTime}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {s.room
                          ? `${s.room.name}${s.room.building ? ' · ' + s.room.building.name : ''}`
                          : '— qualunque —'}
                      </td>
                      <td className="px-3 py-2">
                        {TYPE_OPTIONS.find((o) => o.value === s.bookingType)?.label ??
                          s.bookingType}
                      </td>
                      <td className="px-3 py-2 truncate text-muted-foreground">
                        {s.purpose ?? ''}
                      </td>
                      {!isLocked && (
                        <td className="px-3 py-2 text-right">
                          <Button variant="ghost" size="icon" onClick={() => setEditing(s)}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => removeMutation.mutate(s.id)}
                            className="text-destructive hover:bg-destructive/10 hover:text-destructive"
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
          )}
        </CardContent>
      </Card>

      {/* Sezione B: griglia annuale (solo se calendar configurato dall'admin) */}
      <MonteOreGrid
        proposalStatus={proposal.status}
        isPatternEmpty={proposal.schedules.length === 0}
        minHoursOverride={threshold?.source === 'user_override' ? threshold.minHours : null}
        isOverriddenThreshold={threshold?.source === 'user_override'}
        academicYear={targetYear}
      />

      {/* Dialog: aggiungi/modifica riga */}
      <ScheduleDialog
        open={adding || editing !== null}
        onClose={() => {
          setAdding(false);
          setEditing(null);
        }}
        existing={editing}
        proposalId={proposal.id}
        targetYear={targetYear}
      />
    </div>
  );
}

// ============================================================
// Dialog di edit/aggiunta riga schedule
// ============================================================

function ScheduleDialog({
  open,
  onClose,
  existing,
  proposalId: _proposalId,
  targetYear,
}: {
  open: boolean;
  onClose: () => void;
  existing: MonteOreSchedule | null;
  proposalId: number;
  targetYear: string | undefined;
}) {
  const qc = useQueryClient();
  const isEdit = existing !== null;

  const roomsQuery = useQuery({
    queryKey: ['rooms', 'bookable'],
    queryFn: () => roomsApi.list({ bookable: true }),
    staleTime: 60_000,
  });

  const [form, setForm] = useState<SchedulePayload>(() => ({
    roomId: existing?.roomId ?? null,
    dayOfWeek: existing?.dayOfWeek ?? 1,
    startTime: existing?.startTime ?? '14:00',
    endTime: existing?.endTime ?? '16:00',
    bookingType: existing?.bookingType ?? 'lezione',
    purpose: existing?.purpose ?? '',
    notes: existing?.notes ?? '',
  }));

  // Reset form quando il dialog si riapre su una schedule diversa.
  useEffect(() => {
    if (!open) return;
    setForm({
      roomId: existing?.roomId ?? null,
      dayOfWeek: existing?.dayOfWeek ?? 1,
      startTime: existing?.startTime ?? '14:00',
      endTime: existing?.endTime ?? '16:00',
      bookingType: existing?.bookingType ?? 'lezione',
      purpose: existing?.purpose ?? '',
      notes: existing?.notes ?? '',
    });
  }, [open, existing]);

  const saveMutation = useMutation({
    mutationFn: () =>
      isEdit ? monteOreApi.updateMySchedule(existing.id, form) : monteOreApi.addMySchedule(form),
    onSuccess: () => {
      toast.success(isEdit ? 'Fascia aggiornata' : 'Fascia aggiunta');
      // Add/update di una schedule cambia proposal.schedules; gli slot
      // legati vanno rigenerati (regenerate-slots è esplicito), ma comunque
      // invalidiamoli per coerenza UI quando già materializzati.
      void qc.invalidateQueries({ queryKey: ['monte-ore', 'me', targetYear] });
      void qc.invalidateQueries({ queryKey: ['monte-ore', 'me', 'slots'] });
      onClose();
    },
    onError: (err) => toast.error(httpErrorMessage(err)),
  });

  const sortedRooms = sortRoomsCrossBuilding(roomsQuery.data?.rooms ?? []);

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Modifica fascia' : 'Nuova fascia oraria'}</DialogTitle>
          <DialogDescription>
            La fascia verrà ripetuta ogni settimana nel range della proposta.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            saveMutation.mutate();
          }}
        >
          <div className="space-y-2">
            <Label>Giorno</Label>
            <Select
              value={String(form.dayOfWeek)}
              onValueChange={(v) => setForm((f) => ({ ...f, dayOfWeek: Number(v) }))}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[1, 2, 3, 4, 5, 6, 0].map((d) => (
                  <SelectItem key={d} value={String(d)}>
                    {DAYS_IT[d]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Inizio</Label>
              <Input
                type="time"
                value={form.startTime}
                onChange={(e) => setForm((f) => ({ ...f, startTime: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label>Fine</Label>
              <Input
                type="time"
                value={form.endTime}
                onChange={(e) => setForm((f) => ({ ...f, endTime: e.target.value }))}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Aula preferita (opzionale)</Label>
            <Select
              value={form.roomId ? String(form.roomId) : 'any'}
              onValueChange={(v) =>
                setForm((f) => ({ ...f, roomId: v === 'any' ? null : Number(v) }))
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="any">— qualunque —</SelectItem>
                {sortedRooms.map((r) => (
                  <SelectItem key={r.id} value={String(r.id)}>
                    {r.name}
                    {r.building?.name ? ` · ${r.building.name}` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground">
              Il coordinatore confermerà o riassegnerà l'aula in fase di approvazione.
            </p>
          </div>
          <div className="space-y-2">
            <Label>Tipo attività</Label>
            <Select
              value={form.bookingType}
              onValueChange={(v) => setForm((f) => ({ ...f, bookingType: v as BookingType }))}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TYPE_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Etichetta (opzionale)</Label>
            <Input
              maxLength={255}
              value={form.purpose ?? ''}
              placeholder="es. Pianoforte 3°, Solfeggio biennio…"
              onChange={(e) => setForm((f) => ({ ...f, purpose: e.target.value }))}
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={saveMutation.isPending}
            >
              Annulla
            </Button>
            <Button type="submit" disabled={saveMutation.isPending}>
              {isEdit ? 'Salva modifiche' : 'Aggiungi'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
