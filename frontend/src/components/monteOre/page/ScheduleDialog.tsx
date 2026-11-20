import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { monteOreApi, type MonteOreSchedule, type SchedulePayload } from '@/api/monteOre';
import { roomsApi } from '@/api/rooms';
import { httpErrorMessage } from '@/lib/api';
import { invalidateMonteOreYearAndSlots } from '@/lib/invalidation';
import { scheduleToForm } from '@/lib/monteOreSchedule';
import { qk } from '@/lib/queryKeys';
import { sortRoomsCrossBuilding } from '@/lib/sortRooms';
import type { BookingType } from '@/types';
import { Button } from '@/components/ui/button';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { DAYS_IT, TYPE_OPTIONS } from './constants';

// ============================================================
// Dialog di edit/aggiunta riga schedule
// ============================================================

export function ScheduleDialog({
  open,
  onClose,
  existing,
  targetYear,
}: {
  open: boolean;
  onClose: () => void;
  existing: MonteOreSchedule | null;
  targetYear: string | undefined;
}) {
  const qc = useQueryClient();
  const isEdit = existing !== null;

  const roomsQuery = useQuery({
    queryKey: qk.rooms.bookable(),
    queryFn: () => roomsApi.list({ bookable: true }),
    staleTime: 60_000,
  });

  const [form, setForm] = useState<SchedulePayload>(() => scheduleToForm(existing));

  // Reset form quando il dialog si riapre su una schedule diversa.
  useEffect(() => {
    if (!open) return;
    setForm(scheduleToForm(existing));
  }, [open, existing]);

  const saveMutation = useMutation({
    mutationFn: () =>
      isEdit
        ? monteOreApi.updateMySchedule(existing.id, form, targetYear)
        : monteOreApi.addMySchedule(form, targetYear),
    onSuccess: () => {
      toast.success(isEdit ? 'Fascia aggiornata' : 'Fascia aggiunta');
      // Add/update di una schedule cambia proposal.schedules; gli slot
      // legati vanno rigenerati (regenerate-slots è esplicito), ma comunque
      // invalidiamoli per coerenza UI quando già materializzati.
      void invalidateMonteOreYearAndSlots(qc, targetYear);
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
