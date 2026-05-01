import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CalendarRange, RefreshCcw, AlertCircle, History, CalendarPlus } from 'lucide-react';
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

const DAYS_HEAD = ['Lun', 'Mar', 'Mer', 'Gio', 'Ven'];

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
}

/**
 * Sezione B — griglia settimanale di pianificazione monte ore.
 * Renderizza tante righe quante sono le settimane del calendario didattico
 * (al netto delle sospensioni full_week che vengono nascoste a monte).
 * Ogni cella Lun-Ven mostra le ore previste per il pattern del giorno;
 * un click attiva/disattiva quella occorrenza.
 */
export default function MonteOreGrid({
  proposalStatus,
  isPatternEmpty,
  minHoursOverride,
  isOverriddenThreshold,
}: Props) {
  const qc = useQueryClient();
  const [newDayOpen, setNewDayOpen] = useState(false);

  const calendarQuery = useQuery({
    queryKey: ['monte-ore', 'me', 'calendar'],
    queryFn: () => monteOreApi.getCalendar(),
    retry: false,
  });

  const slotsQuery = useQuery({
    queryKey: ['monte-ore', 'me', 'slots'],
    queryFn: () => monteOreApi.getMySlots(),
    enabled: !calendarQuery.isError,
  });

  const amendmentsQuery = useQuery({
    queryKey: ['monte-ore', 'me', 'amendments'],
    queryFn: () => monteOreApi.getMyAmendments(),
    enabled: !calendarQuery.isError && ['approved', 'generated'].includes(proposalStatus),
  });

  const regenerateMutation = useMutation({
    mutationFn: () => monteOreApi.regenerateSlots(),
    onSuccess: (data) => {
      toast.success(`Griglia rigenerata: ${data.result.created} celle`);
      void qc.invalidateQueries({ queryKey: ['monte-ore', 'me'] });
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

  if (calendarQuery.isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Griglia annuale</CardTitle>
        </CardHeader>
        <CardContent>
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
        <CardContent>
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

  const settings = calendarQuery.data!.settings;
  const weeks = calendarQuery.data!.weeks;
  // Se l'admin ha impostato una deroga per questo docente (override
  // personalizzato), usiamo quella soglia. Altrimenti la soglia istituzionale.
  const minRequired = minHoursOverride != null ? minHoursOverride : settings.minRequiredHours;
  const progress = Math.min(100, (totals.active / minRequired) * 100);
  const slots = slotsQuery.data?.slots ?? [];
  const slotsCount = slots.length;
  const hasPendingPattern = isPatternEmpty;
  const editable = ['draft', 'rejected', 'approved', 'generated'].includes(proposalStatus);

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
      <CardContent className="space-y-3">
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
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/30 text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="w-12 px-2 py-2 text-center">S</th>
                  <th className="w-32 px-3 py-2 text-left">Settimana</th>
                  {DAYS_HEAD.map((d) => (
                    <th key={d} className="px-2 py-2 text-center">
                      {d}
                    </th>
                  ))}
                  <th className="w-16 px-2 py-2 text-right">Ore</th>
                </tr>
              </thead>
              <tbody>
                {weeks.map((w) => (
                  <WeekRow
                    key={w.weekStart}
                    week={w}
                    slotsByDate={slotsByDate}
                    onToggle={(slotId) => editable && toggleMutation.mutate(slotId)}
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
    </Card>
  );
}

function WeekRow({
  week,
  slotsByDate,
  onToggle,
  disabled,
}: {
  week: CalendarWeek;
  slotsByDate: Map<string, MonteOreSlot[]>;
  onToggle: (slotId: number) => void;
  disabled: boolean;
}) {
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
            disabled={disabled}
          />
        </td>
      ))}
      <td className="px-2 py-1.5 text-right tabular-nums text-xs text-muted-foreground">
        {weekTotal > 0 ? `${weekTotal.toFixed(1)}h` : '—'}
      </td>
    </tr>
  );
}

function DayCell({
  day,
  slots,
  onToggle,
  disabled,
}: {
  day: { date: string; isLocked: boolean; lockReason: string | null };
  slots: MonteOreSlot[];
  onToggle: (slotId: number) => void;
  disabled: boolean;
}) {
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
        return (
          <button
            key={s.id}
            type="button"
            disabled={disabled || locked}
            onClick={() => onToggle(s.id)}
            className={`min-h-[36px] rounded-md px-1.5 py-1.5 text-[11px] font-medium tabular-nums transition active:scale-95 sm:min-h-0 sm:py-1 ${
              locked
                ? 'cursor-not-allowed bg-destructive/10 text-destructive'
                : active
                  ? 'bg-primary text-primary-foreground shadow-sm ring-1 ring-primary hover:bg-primary/90'
                  : 'border border-dashed border-muted-foreground/40 text-muted-foreground hover:bg-muted/40 hover:text-foreground'
            }`}
            title={`${s.startTime}–${s.endTime}${locked && s.lockReason ? ` (${s.lockReason})` : ''}`}
          >
            {s.startTime}–{s.endTime}
          </button>
        );
      })}
    </div>
  );
}

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
