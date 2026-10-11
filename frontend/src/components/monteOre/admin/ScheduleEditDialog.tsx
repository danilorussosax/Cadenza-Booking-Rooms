import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ShieldAlert } from 'lucide-react';
import { monteOreAdminApi, type MonteOreSchedule, type SchedulePayload } from '@/api/monteOre';
import { roomsApi } from '@/api/rooms';
import { httpErrorMessage } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
import { sortRoomsCrossBuilding } from '@/lib/sortRooms';
import type { BookingType } from '@/types';
import { DAYS_IT, TYPE_OPTIONS } from './shared';

export function ScheduleEditDialog({
  open,
  onClose,
  proposalId,
  existing,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  proposalId: number;
  existing: MonteOreSchedule | null;
  onSaved: () => void;
}) {
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
  }));

  useEffect(() => {
    if (!open) return;
    setForm({
      roomId: existing?.roomId ?? null,
      dayOfWeek: existing?.dayOfWeek ?? 1,
      startTime: existing?.startTime ?? '14:00',
      endTime: existing?.endTime ?? '16:00',
      bookingType: existing?.bookingType ?? 'lezione',
      purpose: existing?.purpose ?? '',
    });
  }, [open, existing]);

  const saveMutation = useMutation({
    mutationFn: () =>
      isEdit
        ? monteOreAdminApi.updateSchedule(proposalId, existing.id, form)
        : monteOreAdminApi.addSchedule(proposalId, form),
    onSuccess: () => {
      toast.success(isEdit ? 'Fascia aggiornata' : 'Fascia aggiunta');
      onSaved();
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
          <DialogTitle>{isEdit ? 'Modifica fascia' : 'Nuova fascia'}</DialogTitle>
          {!form.roomId && (
            <DialogDescription className="text-amber-600 dark:text-amber-400">
              <ShieldAlert className="mr-1 inline h-4 w-4" />
              Per generare le prenotazioni l'aula è obbligatoria.
            </DialogDescription>
          )}
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
            <Label>Aula assegnata</Label>
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
                <SelectItem value="any">— da assegnare —</SelectItem>
                {sortedRooms.map((r) => (
                  <SelectItem key={r.id} value={String(r.id)}>
                    {r.name}
                    {r.building?.name ? ` · ${r.building.name}` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Tipo</Label>
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
            <Label>Etichetta</Label>
            <Input
              value={form.purpose ?? ''}
              maxLength={255}
              onChange={(e) => setForm((f) => ({ ...f, purpose: e.target.value }))}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Annulla
            </Button>
            <Button type="submit" disabled={saveMutation.isPending}>
              {isEdit ? 'Salva' : 'Aggiungi'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
