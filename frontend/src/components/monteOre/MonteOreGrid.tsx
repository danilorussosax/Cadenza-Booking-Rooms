import { memo, useCallback, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  CalendarRange,
  RefreshCcw,
  AlertCircle,
  History,
  CalendarPlus,
  MoreVertical,
  Clock,
  MapPin,
  Move,
} from 'lucide-react';
import {
  monteOreApi,
  amendmentSummary,
  type CalendarWeek,
  type MonteOreSlot,
  type MonteOreAmendment,
} from '@/api/monteOre';
import { roomsApi } from '@/api/rooms';
import { httpErrorMessage } from '@/lib/api';
import { sortRoomsCrossBuilding } from '@/lib/sortRooms';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { BookingType } from '@/types';

const DAYS_HEAD = ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab'];

function hoursOf(s: MonteOreSlot): number {
  const [sh, sm] = s.startTime.split(':').map(Number);
  const [eh, em] = s.endTime.split(':').map(Number);
  return eh + em / 60 - (sh + sm / 60);
}

interface Props {
  proposalStatus: 'draft' | 'submitted' | 'approved' | 'rejected' | 'generated';
  isPatternEmpty: boolean;
  /**
   * Soglia ore annue applicabile al docente. Se valorizzata, sostituisce
   * `settings.minRequiredHours` (soglia istituzionale) — usato per docenti
   * con override individuale (contratto orario, supplenti, part-time).
   * Quando null/undefined si ricade sulla soglia istituzionale.
   */
  minHoursOverride?: number | null;
  /** True se la soglia mostrata viene da override individuale: cambia la label. */
  isOverriddenThreshold?: boolean;
  /**
   * AA target del docente. Quando valorizzato viene propagato come `?year=`
   * a tutte le query (calendar / slots / amendments). Se omesso il backend
   * cade sull'AA corrente, compatibilità retro.
   */
  academicYear?: string;
}

/**
 * Sezione B — griglia settimanale di pianificazione monte ore.
 * Renderizza tante righe quante sono le settimane del calendario didattico
 * (al netto delle sospensioni full_week che vengono nascoste a monte).
 * Ogni cella Lun-Sab mostra le ore previste per il pattern del giorno;
 * un click attiva/disattiva quella occorrenza.
 */
export default function MonteOreGrid({
  proposalStatus,
  isPatternEmpty,
  minHoursOverride,
  isOverriddenThreshold,
  academicYear,
}: Props) {
  const qc = useQueryClient();
  const [newDayOpen, setNewDayOpen] = useState(false);
  // Slot selezionato per uno spostamento (change_time / change_room / move_to).
  const [movingSlot, setMovingSlot] = useState<MonteOreSlot | null>(null);
  // Spostamenti consentiti solo dopo approvazione (in draft il docente
  // edita direttamente il pattern, senza amendment workflow).
  const allowMove = ['approved', 'generated'].includes(proposalStatus);

  const calendarQuery = useQuery({
    queryKey: ['monte-ore', 'me', 'calendar', academicYear],
    queryFn: () => monteOreApi.getCalendar(academicYear),
    retry: false,
  });

  const slotsQuery = useQuery({
    queryKey: ['monte-ore', 'me', 'slots', academicYear],
    queryFn: () => monteOreApi.getMySlots(academicYear),
    enabled: !calendarQuery.isError,
  });

  const amendmentsQuery = useQuery({
    queryKey: ['monte-ore', 'me', 'amendments', academicYear],
    queryFn: () => monteOreApi.getMyAmendments(academicYear),
    enabled: !calendarQuery.isError && ['approved', 'generated'].includes(proposalStatus),
  });

  const regenerateMutation = useMutation({
    mutationFn: () => monteOreApi.regenerateSlots(),
    onSuccess: (data) => {
      toast.success(`Griglia rigenerata: ${data.result.created} celle`);
      // Regenerate riscrive tutti gli slot della proposta + aggiorna i
      // contatori sulla proposal. Niente impact su threshold/amendments.
      void qc.invalidateQueries({ queryKey: ['monte-ore', 'me', 'slots'] });
      void qc.invalidateQueries({
        queryKey: ['monte-ore', 'me'],
        // Solo la proposal-key (4 segmenti: ['monte-ore','me',<year>]),
        // non threshold/calendar/amendments.
        predicate: (q) => q.queryKey.length === 3 && q.queryKey[2] !== 'slots',
      });
    },
    onError: (err) => toast.error(httpErrorMessage(err)),
  });

  const toggleMutation = useMutation({
    mutationFn: (slotId: number) => monteOreApi.toggleSlot(slotId),
    onSuccess: (data) => {
      if (data.amendment) {
        toast.success(
          data.amendment.status === 'auto_approved'
            ? 'Variazione applicata automaticamente'
            : 'Richiesta inviata al coordinatore',
        );
      }
      // Aggiornamento "ottimistico" mirato: patcho lo slot nella cache locale
      // invece di rifare un fetch completo. Questo riduce drasticamente le
      // richieste API quando il docente clicca rapidamente molte celle.
      if (data.slot) {
        const updatedSlot = data.slot;
        qc.setQueryData<{ slots: MonteOreSlot[] }>(['monte-ore', 'me', 'slots'], (old) =>
          old
            ? {
                ...old,
                slots: old.slots.map((s) => (s.id === updatedSlot.id ? updatedSlot : s)),
              }
            : old,
        );
      } else {
        // Fallback: amendment senza slot aggiornato → invalida lo slots query
        void qc.invalidateQueries({ queryKey: ['monte-ore', 'me', 'slots'] });
      }
      // Se è stato creato un amendment, refresha la lista (light)
      if (data.amendment) {
        void qc.invalidateQueries({ queryKey: ['monte-ore', 'me', 'amendments'] });
      }
    },
    onError: (err) => toast.error(httpErrorMessage(err)),
  });

  const slotsByDate = useMemo(() => {
    const map = new Map<string, MonteOreSlot[]>();
    for (const s of slotsQuery.data?.slots ?? []) {
      const arr = map.get(s.date) ?? [];
      arr.push(s);
      map.set(s.date, arr);
    }
    return map;
  }, [slotsQuery.data]);

  const totals = useMemo(() => {
    let active = 0;
    for (const s of slotsQuery.data?.slots ?? []) {
      if (s.isActive && !s.isLocked) active += hoursOf(s);
    }
    return { active };
  }, [slotsQuery.data]);

  // Callback stabili (identità invariata fra render consecutivi) → senza
  // queste, React.memo su WeekRow/DayCell sarebbe un no-op perché la prop
  // funzione cambierebbe ad ogni render del parent. Devono essere
  // dichiarati PRIMA dei return condizionali (Rules of Hooks).
  const editable = ['draft', 'rejected', 'approved', 'generated'].includes(proposalStatus);
  const handleToggle = useCallback(
    (slotId: number) => {
      if (editable) toggleMutation.mutate(slotId);
    },
    [editable, toggleMutation],
  );
  const handleRequestMove = useCallback((s: MonteOreSlot) => {
    setMovingSlot(s);
  }, []);
  const onRequestMoveProp = allowMove ? handleRequestMove : undefined;

  if (calendarQuery.isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Griglia annuale</CardTitle>
        </CardHeader>
        <CardContent className="pt-0 sm:pt-0">
          <Skeleton className="h-64 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (calendarQuery.isError) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <CalendarRange className="h-5 w-5 text-muted-foreground" />
            Griglia annuale
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0 sm:pt-0">
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              Il coordinatore non ha ancora configurato il calendario didattico per quest'anno. Una
              volta pubblicato, qui apparirà la griglia settimana × giorno per pianificare le ore.
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  if (!calendarQuery.data) return null;
  const settings = calendarQuery.data.settings;
  const weeks = calendarQuery.data.weeks;
  // Se l'admin ha impostato una deroga per questo docente (override
  // personalizzato), usiamo quella soglia. Altrimenti la soglia istituzionale.
  const minRequired = minHoursOverride ?? settings.minRequiredHours;
  const progress = Math.min(100, (totals.active / minRequired) * 100);
  const slots = slotsQuery.data?.slots ?? [];
  const slotsCount = slots.length;
  const hasPendingPattern = isPatternEmpty;
  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div>
          <CardTitle className="text-lg flex items-center gap-2">
            <CalendarRange className="h-5 w-5 text-primary" />
            Griglia annuale
          </CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">
            Calendario didattico {settings.lessonsStartDate} → {settings.lessonsEndDate}. Clicca le
            celle per <strong>aggiungerle</strong> al tuo monte ore — il totale si somma man mano.
            Le celle rosse sono festività (non selezionabili).
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <div className="text-right">
            <div className="font-display text-2xl font-medium tabular-nums">
              {totals.active.toFixed(1)}{' '}
              <span className="text-sm text-muted-foreground">/ {minRequired} h</span>
            </div>
            <div className="h-1.5 w-40 overflow-hidden rounded-full bg-muted">
              <div
                className={`h-full ${totals.active >= minRequired ? 'bg-emerald-500' : 'bg-primary'}`}
                style={{ width: `${progress}%` }}
              />
            </div>
            {isOverriddenThreshold && (
              <p className="mt-1 text-[10px] uppercase tracking-wider text-muted-foreground">
                soglia personalizzata
              </p>
            )}
          </div>
          {['draft', 'rejected'].includes(proposalStatus) && !hasPendingPattern && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => regenerateMutation.mutate()}
              disabled={regenerateMutation.isPending}
            >
              <RefreshCcw className="h-4 w-4" />
              Rigenera dalla Sezione A
            </Button>
          )}
          {['approved', 'generated'].includes(proposalStatus) && (
            <Button size="sm" variant="outline" onClick={() => setNewDayOpen(true)}>
              <CalendarPlus className="h-4 w-4" />
              Richiedi nuovo giorno
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3 pt-0 sm:pt-0">
        {hasPendingPattern && (
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              Compila prima il pattern settimanale nella Sezione A, poi clicca "Rigenera dalla
              Sezione A" per popolare la griglia.
            </AlertDescription>
          </Alert>
        )}
        {!hasPendingPattern &&
          slotsCount === 0 &&
          ['draft', 'rejected'].includes(proposalStatus) && (
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                Hai modificato il pattern: clicca "Rigenera dalla Sezione A" per applicare le
                modifiche alla griglia.
              </AlertDescription>
            </Alert>
          )}
        {['approved', 'generated'].includes(proposalStatus) && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted/20 px-3 py-2">
            <p className="text-xs text-muted-foreground">
              Per <strong>sostituire</strong> un giorno con un altro dello stesso pattern
              settimanale, deseleziona la cella e seleziona la nuova: l'approvazione è automatica.
              Per giorni o orari <strong>fuori pattern</strong>, invia una richiesta al
              coordinatore.
            </p>
            <Button size="sm" variant="default" onClick={() => setNewDayOpen(true)}>
              <CalendarPlus className="h-4 w-4" />
              Richiedi nuovo giorno
            </Button>
          </div>
        )}

        {weeks.length > 0 && (
          <div className="overflow-x-auto rounded-lg border">
            {/* table-fixed + colgroup: i 6 giorni (Lun-Sab) si dividono in
                modo identico lo spazio rimanente dopo le colonne S, Settimana
                e Ore — senza questo, le colonne con celle bloccate si
                "schiacciavano" più di quelle con slot lunghi. */}
            <table className="w-full table-fixed text-sm">
              <colgroup>
                <col className="w-12" />
                <col className="w-32" />
                {/* I 6 giorni Lun-Sab senza width esplicito si dividono in
                    parti uguali lo spazio residuo grazie a table-fixed. */}
                {DAYS_HEAD.map((d) => (
                  <col key={d} />
                ))}
                <col className="w-16" />
              </colgroup>
              <thead className="border-b bg-muted/30 text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-2 py-2 text-center">S</th>
                  <th className="px-3 py-2 text-left">Settimana</th>
                  {DAYS_HEAD.map((d) => (
                    <th key={d} className="px-2 py-2 text-center">
                      {d}
                    </th>
                  ))}
                  <th className="px-2 py-2 text-right">Ore</th>
                </tr>
              </thead>
              <tbody>
                {weeks.map((w) => (
                  <WeekRow
                    key={w.weekStart}
                    week={w}
                    slotsByDate={slotsByDate}
                    onToggle={handleToggle}
                    onRequestMove={onRequestMoveProp}
                    disabled={toggleMutation.isPending || !editable}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}

        {amendmentsQuery.data?.amendments && amendmentsQuery.data.amendments.length > 0 && (
          <AmendmentList amendments={amendmentsQuery.data.amendments} />
        )}
      </CardContent>
      {newDayOpen && (
        <NewDayDialog
          open={newDayOpen}
          onClose={() => setNewDayOpen(false)}
          minDate={settings.lessonsStartDate}
          maxDate={settings.lessonsEndDate}
        />
      )}
      {movingSlot && (
        <SlotMoveDialog slot={movingSlot} allSlots={slots} onClose={() => setMovingSlot(null)} />
      )}
    </Card>
  );
}

interface WeekRowProps {
  week: CalendarWeek;
  slotsByDate: Map<string, MonteOreSlot[]>;
  onToggle: (slotId: number) => void;
  onRequestMove?: (slot: MonteOreSlot) => void;
  disabled: boolean;
}

const WeekRow = memo(function WeekRow({
  week,
  slotsByDate,
  onToggle,
  onRequestMove,
  disabled,
}: WeekRowProps) {
  let weekTotal = 0;
  for (const d of week.days) {
    const slots = slotsByDate.get(d.date) ?? [];
    weekTotal += slots
      .filter((s) => s.isActive && !s.isLocked)
      .reduce((acc, s) => acc + hoursOf(s), 0);
  }
  return (
    <tr className="border-b last:border-0">
      <td className="px-2 py-1.5 text-center font-medium tabular-nums text-muted-foreground">
        {week.weekIndex}
      </td>
      <td className="px-3 py-1.5 text-xs text-muted-foreground">{week.weekLabel}</td>
      {week.days.map((d) => (
        <td key={d.date} className="px-1 py-1 align-top">
          <DayCell
            day={d}
            slots={slotsByDate.get(d.date) ?? []}
            onToggle={onToggle}
            onRequestMove={onRequestMove}
            disabled={disabled}
          />
        </td>
      ))}
      <td className="px-2 py-1.5 text-right tabular-nums text-xs text-muted-foreground">
        {weekTotal > 0 ? `${weekTotal.toFixed(1)}h` : '—'}
      </td>
    </tr>
  );
});

interface DayCellProps {
  day: { date: string; isLocked: boolean; lockReason: string | null };
  slots: MonteOreSlot[];
  onToggle: (slotId: number) => void;
  onRequestMove?: (slot: MonteOreSlot) => void;
  disabled: boolean;
}

const DayCell = memo(function DayCell({
  day,
  slots,
  onToggle,
  onRequestMove,
  disabled,
}: DayCellProps) {
  if (day.isLocked) {
    return (
      <div
        className="flex min-h-[44px] items-center justify-center rounded-md bg-destructive/10 px-1 py-1 text-[10px] font-medium text-destructive"
        title={day.lockReason ?? 'Bloccato'}
      >
        {day.lockReason?.slice(0, 18) ?? '—'}
      </div>
    );
  }
  if (slots.length === 0) {
    return <div className="min-h-[44px] rounded-md bg-muted/20" />;
  }
  return (
    <div className="flex flex-col gap-0.5">
      {slots.map((s) => {
        const active = s.isActive && !s.isLocked;
        const locked = s.isLocked;
        const canMove = active && onRequestMove && !disabled;
        return (
          <div key={s.id} className="relative group">
            <button
              type="button"
              disabled={disabled || locked}
              onClick={() => onToggle(s.id)}
              className={`block w-full min-h-[36px] rounded-md px-1.5 py-1.5 text-[11px] font-medium tabular-nums transition active:scale-95 sm:min-h-0 sm:py-1 ${
                locked
                  ? 'cursor-not-allowed bg-destructive/10 text-destructive'
                  : active
                    ? 'bg-primary text-primary-foreground shadow-xs ring-1 ring-primary hover:bg-primary/90 pr-6'
                    : 'border border-dashed border-muted-foreground/40 text-muted-foreground hover:bg-muted/40 hover:text-foreground'
              }`}
              title={`${s.startTime}–${s.endTime}${locked && s.lockReason ? ` (${s.lockReason})` : ''}`}
            >
              {s.startTime}–{s.endTime}
            </button>
            {canMove && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onRequestMove(s);
                }}
                className="absolute right-0.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-primary-foreground/70 hover:bg-primary-foreground/15 hover:text-primary-foreground"
                title="Opzioni spostamento"
                aria-label="Apri opzioni di spostamento"
              >
                <MoreVertical className="h-3 w-3" />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
});

function AmendmentList({ amendments }: { amendments: MonteOreAmendment[] }) {
  const [open, setOpen] = useState(false);
  const pending = amendments.filter((a) => a.status === 'pending').length;
  const auto = amendments.filter((a) => a.status === 'auto_approved').length;
  return (
    <div className="rounded-lg border bg-muted/10">
      <button
        type="button"
        className="flex w-full items-center justify-between px-3 py-2 text-sm font-medium"
        onClick={() => setOpen((o) => !o)}
      >
        <span className="flex items-center gap-2">
          <History className="h-4 w-4" />
          Storico variazioni ({amendments.length})
        </span>
        <span className="flex items-center gap-2">
          {pending > 0 && <Badge variant="secondary">{pending} in attesa</Badge>}
          {auto > 0 && <Badge variant="success">{auto} auto-approvate</Badge>}
        </span>
      </button>
      {open && (
        <ul className="border-t px-3 py-2 text-xs">
          {amendments.map((a) => (
            <li
              key={a.id}
              className="flex items-center justify-between border-b py-1.5 last:border-0"
            >
              <span>
                {a.kind === 'toggle_off' && 'Disattivazione'}
                {a.kind === 'toggle_on' && 'Riattivazione'}
                {a.kind === 'change_time' && 'Cambio orario'}
                {a.kind === 'add_new_day' && 'Nuovo giorno'}
                {a.kind === 'change_room' && 'Cambio aula'}
                {a.kind === 'move_to' && 'Spostamento'}
                {' — '}
                {amendmentSummary(a)}
              </span>
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
              </Badge>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const NEW_DAY_TYPES: { value: BookingType; label: string }[] = [
  { value: 'lezione', label: 'Lezione' },
  { value: 'studio_individuale', label: 'Studio individuale' },
  { value: 'prova', label: 'Prova' },
];

function NewDayDialog({
  open,
  onClose,
  minDate,
  maxDate,
}: {
  open: boolean;
  onClose: () => void;
  minDate: string;
  maxDate: string;
}) {
  const qc = useQueryClient();
  const [date, setDate] = useState('');
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('11:00');
  const [roomId, setRoomId] = useState<number | null>(null);
  const [bookingType, setBookingType] = useState<BookingType>('lezione');
  const [notes, setNotes] = useState('');

  const roomsQuery = useQuery({
    queryKey: ['rooms', 'bookable'],
    queryFn: () => roomsApi.list({ bookable: true }),
    staleTime: 60_000,
    enabled: open,
  });
  const sortedRooms = sortRoomsCrossBuilding(roomsQuery.data?.rooms ?? []);

  const submitMutation = useMutation({
    mutationFn: () =>
      monteOreApi.requestNewDay({
        date,
        startTime,
        endTime,
        roomId: roomId ?? undefined,
        bookingType,
        notes: notes || null,
      }),
    onSuccess: () => {
      toast.success('Richiesta inviata al coordinatore');
      void qc.invalidateQueries({ queryKey: ['monte-ore', 'me', 'amendments'] });
      onClose();
      setDate('');
      setNotes('');
      setRoomId(null);
    },
    onError: (err) => toast.error(httpErrorMessage(err)),
  });

  const canSubmit =
    !!date && !!startTime && !!endTime && startTime < endTime && !submitMutation.isPending;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Richiedi un nuovo giorno</DialogTitle>
          <DialogDescription>
            Per giorni o orari fuori dal pattern settimanale approvato. La richiesta verrà inviata
            al coordinatore.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            submitMutation.mutate();
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="newday-date">Data</Label>
            <Input
              id="newday-date"
              type="date"
              min={minDate}
              max={maxDate}
              value={date}
              onChange={(e) => setDate(e.target.value)}
              required
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="newday-start">Inizio</Label>
              <Input
                id="newday-start"
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="newday-end">Fine</Label>
              <Input
                id="newday-end"
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                required
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Aula preferita (opzionale)</Label>
            <Select
              value={roomId ? String(roomId) : 'any'}
              onValueChange={(v) => setRoomId(v === 'any' ? null : Number(v))}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="any">— il coordinatore deciderà —</SelectItem>
                {sortedRooms.map((r) => (
                  <SelectItem key={r.id} value={String(r.id)}>
                    {r.name}
                    {r.building?.name ? ` · ${r.building.name}` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground">
              Se non scegli, l'aula verrà assegnata dal coordinatore in fase di approvazione.
            </p>
          </div>
          <div className="space-y-2">
            <Label>Tipo attività</Label>
            <Select value={bookingType} onValueChange={(v) => setBookingType(v as BookingType)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {NEW_DAY_TYPES.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="newday-notes">Motivazione (opzionale)</Label>
            <Textarea
              id="newday-notes"
              rows={3}
              maxLength={2000}
              value={notes}
              placeholder="Es. recupero lezione del 12 nov per malattia"
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Annulla
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              Invia richiesta
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================
// SlotMoveDialog — Tre modi per "spostare" una lezione dopo l'approvazione:
//   1. Cambia orario (stessa data, nuovi startTime/endTime). Auto se in pattern.
//   2. Cambia aula  (override sull'occorrenza, pattern intatto). Sempre pending.
//   3. Sposta a…   (toggle off+on atomico su un'altra cella, 1 sola variazione
//                    di budget). Auto se entrambe le celle sono in pattern.
// ============================================================

type MoveTab = 'time' | 'room' | 'move';

function SlotMoveDialog({
  slot,
  allSlots,
  onClose,
}: {
  slot: MonteOreSlot;
  allSlots: MonteOreSlot[];
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [tab, setTab] = useState<MoveTab>('time');

  // Form state per ognuna delle 3 azioni
  const [newStart, setNewStart] = useState(slot.startTime);
  const [newEnd, setNewEnd] = useState(slot.endTime);
  const [newRoomId, setNewRoomId] = useState<number | null>(null);
  const [targetSlotId, setTargetSlotId] = useState<number | null>(null);
  const [notes, setNotes] = useState('');

  const roomsQuery = useQuery({
    queryKey: ['rooms', 'bookable'],
    queryFn: () => roomsApi.list({ bookable: true }),
    staleTime: 60_000,
    enabled: tab === 'room',
  });
  const sortedRooms = sortRoomsCrossBuilding(roomsQuery.data?.rooms ?? []);

  // Slot candidati per il "Sposta a…": inattivi, non locked, stessa proposta.
  const moveTargets = useMemo(
    () =>
      allSlots
        .filter((s) => s.id !== slot.id && !s.isLocked && !s.isActive)
        .sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime)),
    [allSlots, slot.id],
  );

  const refresh = () => {
    // Amendment su slot (change_time/change_room/move_to) → cambia lo slot
    // e crea un amendment. Non tocca proposal, threshold o calendar.
    void qc.invalidateQueries({ queryKey: ['monte-ore', 'me', 'slots'] });
    void qc.invalidateQueries({ queryKey: ['monte-ore', 'me', 'amendments'] });
  };

  const changeTime = useMutation({
    mutationFn: () =>
      monteOreApi.changeSlotTime(slot.id, {
        startTime: newStart,
        endTime: newEnd,
        notes: notes || undefined,
      }),
    onSuccess: (data) => {
      toast.success(
        data.amendment.status === 'auto_approved'
          ? 'Orario aggiornato'
          : 'Richiesta orario inviata al coordinatore',
      );
      refresh();
      onClose();
    },
    onError: (err) => toast.error(httpErrorMessage(err)),
  });

  const changeRoom = useMutation({
    mutationFn: () => {
      if (newRoomId == null) throw new Error('roomId mancante');
      return monteOreApi.changeSlotRoom(slot.id, {
        roomId: newRoomId,
        notes: notes || undefined,
      });
    },
    onSuccess: () => {
      toast.success('Richiesta cambio aula inviata al coordinatore');
      refresh();
      onClose();
    },
    onError: (err) => toast.error(httpErrorMessage(err)),
  });

  const moveTo = useMutation({
    mutationFn: () => {
      if (targetSlotId == null) throw new Error('targetSlotId mancante');
      return monteOreApi.moveSlotTo(slot.id, {
        targetSlotId,
        notes: notes || undefined,
      });
    },
    onSuccess: (data) => {
      toast.success(
        data.amendment.status === 'auto_approved'
          ? 'Lezione spostata'
          : 'Richiesta di spostamento inviata al coordinatore',
      );
      refresh();
      onClose();
    },
    onError: (err) => toast.error(httpErrorMessage(err)),
  });

  const timeValid =
    /^\d{2}:\d{2}$/.test(newStart) && /^\d{2}:\d{2}$/.test(newEnd) && newStart < newEnd;
  const timeDirty = newStart !== slot.startTime || newEnd !== slot.endTime;
  const isPending = changeTime.isPending || changeRoom.isPending || moveTo.isPending;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Spostamento lezione</DialogTitle>
          <DialogDescription>
            {slot.date} · {slot.startTime}–{slot.endTime}
            {slot.scheduleId ? null : ' · fuori pattern'}
          </DialogDescription>
        </DialogHeader>

        {/* Tabs */}
        <div className="grid grid-cols-3 gap-1 rounded-md border bg-muted/30 p-1 text-sm">
          {(
            [
              { v: 'time', l: 'Cambia orario', i: Clock },
              { v: 'room', l: 'Cambia aula', i: MapPin },
              { v: 'move', l: 'Sposta a…', i: Move },
            ] as const
          ).map(({ v, l, i: Icon }) => (
            <button
              key={v}
              type="button"
              onClick={() => setTab(v)}
              className={`flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 transition ${
                tab === v
                  ? 'bg-background shadow-xs font-medium'
                  : 'text-muted-foreground hover:bg-background/60'
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {l}
            </button>
          ))}
        </div>

        {tab === 'time' && (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Modifica l'orario di questa singola occorrenza. Approvazione automatica se la cella
              era nel piano originale.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Nuovo inizio</Label>
                <Input type="time" value={newStart} onChange={(e) => setNewStart(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Nuova fine</Label>
                <Input type="time" value={newEnd} onChange={(e) => setNewEnd(e.target.value)} />
              </div>
            </div>
            {!timeValid && timeDirty && (
              <p className="text-xs text-destructive">
                L'orario di inizio deve essere prima della fine.
              </p>
            )}
          </div>
        )}

        {tab === 'room' && (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Cambia l'aula solo per questa occorrenza (le altre settimane restano invariate). La
              richiesta va sempre approvata dal coordinatore.
            </p>
            <div className="space-y-2">
              <Label>Aula richiesta</Label>
              <Select
                value={newRoomId ? String(newRoomId) : ''}
                onValueChange={(v) => setNewRoomId(v ? Number(v) : null)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="— scegli aula —" />
                </SelectTrigger>
                <SelectContent>
                  {sortedRooms.map((r) => (
                    <SelectItem key={r.id} value={String(r.id)}>
                      {r.name}
                      {r.building?.name ? ` · ${r.building.name}` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        )}

        {tab === 'move' && (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Sposta la lezione su una cella attualmente disattiva. Conta come una sola variazione.
              Approvazione automatica se la cella destinazione è già nel pattern.
            </p>
            <div className="space-y-2">
              <Label>Cella destinazione</Label>
              <Select
                value={targetSlotId ? String(targetSlotId) : ''}
                onValueChange={(v) => setTargetSlotId(v ? Number(v) : null)}
              >
                <SelectTrigger>
                  <SelectValue
                    placeholder={
                      moveTargets.length === 0
                        ? '— nessuna cella libera —'
                        : '— scegli destinazione —'
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {moveTargets.slice(0, 100).map((s) => (
                    <SelectItem key={s.id} value={String(s.id)}>
                      {s.date} · {s.startTime}–{s.endTime}
                      {s.scheduleId ? '' : ' · fuori pattern'}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground">
                {moveTargets.length} celle disponibili nella griglia.
              </p>
            </div>
          </div>
        )}

        <div className="space-y-2">
          <Label className="text-xs">Note al coordinatore (opzionale)</Label>
          <Textarea
            rows={2}
            maxLength={500}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Motivazione (es. impegno familiare, sostituzione esami)"
          />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isPending}>
            Annulla
          </Button>
          {tab === 'time' && (
            <Button
              onClick={() => changeTime.mutate()}
              disabled={!timeValid || !timeDirty || isPending}
            >
              Salva nuovo orario
            </Button>
          )}
          {tab === 'room' && (
            <Button onClick={() => changeRoom.mutate()} disabled={!newRoomId || isPending}>
              Richiedi cambio aula
            </Button>
          )}
          {tab === 'move' && (
            <Button onClick={() => moveTo.mutate()} disabled={!targetSlotId || isPending}>
              Sposta
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
