import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Clock, MapPin, Move } from 'lucide-react';
import type { MonteOreSlot } from '@/api/monteOre';
import { roomsApi } from '@/api/rooms';
import { isValidTimeRange, pickMoveTargets } from '@/lib/monteOreGrid';
import { qk } from '@/lib/queryKeys';
import { sortRoomsCrossBuilding } from '@/lib/sortRooms';
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
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useSlotMoveMutations } from './useSlotMoveMutations';

// ============================================================
// SlotMoveDialog — Tre modi per "spostare" una lezione dopo l'approvazione:
//   1. Cambia orario (stessa data, nuovi startTime/endTime). Auto se in pattern.
//   2. Cambia aula  (override sull'occorrenza, pattern intatto). Sempre pending.
//   3. Sposta a…   (toggle off+on atomico su un'altra cella, 1 sola variazione
//                    di budget). Auto se entrambe le celle sono in pattern.
// ============================================================

type MoveTab = 'time' | 'room' | 'move';

export function SlotMoveDialog({
  slot,
  allSlots,
  onClose,
}: {
  slot: MonteOreSlot;
  allSlots: MonteOreSlot[];
  onClose: () => void;
}) {
  const [tab, setTab] = useState<MoveTab>('time');

  // Form state per ognuna delle 3 azioni
  const [newStart, setNewStart] = useState(slot.startTime);
  const [newEnd, setNewEnd] = useState(slot.endTime);
  const [newRoomId, setNewRoomId] = useState<number | null>(null);
  const [targetSlotId, setTargetSlotId] = useState<number | null>(null);
  const [notes, setNotes] = useState('');

  const roomsQuery = useQuery({
    queryKey: qk.rooms.bookable(),
    queryFn: () => roomsApi.list({ bookable: true }),
    staleTime: 60_000,
    enabled: tab === 'room',
  });
  const sortedRooms = sortRoomsCrossBuilding(roomsQuery.data?.rooms ?? []);

  // Slot candidati per il "Sposta a…": inattivi, non locked, stessa proposta.
  const moveTargets = useMemo(() => pickMoveTargets(allSlots, slot.id), [allSlots, slot.id]);

  const { changeTime, changeRoom, moveTo, isPending } = useSlotMoveMutations(
    slot,
    { newStart, newEnd, newRoomId, targetSlotId, notes },
    onClose,
  );

  const timeValid = isValidTimeRange(newStart, newEnd);
  const timeDirty = newStart !== slot.startTime || newEnd !== slot.endTime;

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
              Modifica l'orario di questa singola occorrenza: il revisore deve approvare la
              richiesta.
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
              Il revisore deve approvare la richiesta.
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
