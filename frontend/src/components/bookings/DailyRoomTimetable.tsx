/**
 * Vista "giorno corrente" per il Display kiosk: matrice **aule (righe) × orari
 * (colonne)** con slot di 30 minuti tra 08:00 e 21:00. Replica fedele della
 * "Griglia oggi" del foglio Excel — stessa palette per tipo prenotazione,
 * merge orizzontale dei blocchi multi-slot, banda alternata al cambio piano.
 *
 * Pensato per il tabellone in portineria: a colpo d'occhio "chi ha l'aula 12
 * alle 15:00 di OGGI" senza scorrere la settimana intera.
 *
 * Differenza con WeeklyRoomTimetable:
 *   - Weekly: righe = slot orari, colonne = giorni (Lun→Sab) → 1 settimana
 *   - Daily: righe = aule, colonne = slot orari → 1 giorno
 */

import { useMemo, type ReactElement } from 'react';
import type { PublicBooking, PublicRoom, PublicBuilding } from '@/api/public';
import type { BookingType } from '@/types';
import { sortRoomsForBuilding } from '@/lib/sortRooms';
import { cn } from '@/lib/utils';
import { Building2 } from 'lucide-react';

// Slot 08:00 → 21:00 a 30 min = 26 colonne utili (l'ultimo bordo è 21:00).
const DAY_HOUR_START = 8;
const DAY_HOUR_END = 21;

function buildSlots(): string[] {
  const slots: string[] = [];
  for (let h = DAY_HOUR_START; h < DAY_HOUR_END; h++) {
    slots.push(`${String(h).padStart(2, '0')}:00`);
    slots.push(`${String(h).padStart(2, '0')}:30`);
  }
  return slots;
}

// Palette per tipo — derivata da BOOKING_TYPE_STYLES ma "saturata" per
// leggibilità a distanza sul tabellone (l'utente la legge da 2-3 metri).
const TYPE_CLASSES: Record<BookingType, string> = {
  studio_individuale:
    'bg-emerald-200 text-emerald-900 border-emerald-400 dark:bg-emerald-500/30 dark:text-emerald-100 dark:border-emerald-500/60',
  lezione:
    'bg-sky-200 text-sky-900 border-sky-400 dark:bg-sky-500/30 dark:text-sky-100 dark:border-sky-500/60',
  prova:
    'bg-amber-200 text-amber-900 border-amber-400 dark:bg-amber-500/30 dark:text-amber-100 dark:border-amber-500/60',
  concerto:
    'bg-rose-200 text-rose-900 border-rose-400 dark:bg-rose-500/30 dark:text-rose-100 dark:border-rose-500/60',
  altro:
    'bg-violet-200 text-violet-900 border-violet-400 dark:bg-violet-500/30 dark:text-violet-100 dark:border-violet-500/60',
};

interface BookingCell {
  booking: PublicBooking;
  startSlot: number; // colonna iniziale (0-based negli slot visibili)
  span: number; // numero di colonne
  label: string;
}

function cellLabel(b: PublicBooking): string {
  if (b.type === 'concerto') {
    return b.concertTitle ? `🎵 ${b.concertTitle}` : '🎵 Concerto';
  }
  // Riusa il displayName che il backend ha già normalizzato per privacy
  // ("Prof. {Cognome}" per docenti, ruolo per gli altri).
  return b.bookedBy?.displayName ?? b.type ?? 'Prenotato';
}

function buildBookingCells(room: PublicRoom, slotCount: number): BookingCell[] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const cells: BookingCell[] = [];
  for (const b of room.bookings) {
    const start = new Date(b.startTime);
    const end = new Date(b.endTime);
    if (
      start.getFullYear() !== today.getFullYear() ||
      start.getMonth() !== today.getMonth() ||
      start.getDate() !== today.getDate()
    ) {
      continue;
    }
    const startSlot = Math.max(
      0,
      (start.getHours() - DAY_HOUR_START) * 2 + (start.getMinutes() >= 30 ? 1 : 0),
    );
    const endSlot = Math.min(
      slotCount,
      (end.getHours() - DAY_HOUR_START) * 2 + (end.getMinutes() > 0 ? 1 : 0),
    );
    if (endSlot <= startSlot) continue;
    cells.push({
      booking: b,
      startSlot,
      span: endSlot - startSlot,
      label: cellLabel(b),
    });
  }
  return cells;
}

interface Props {
  building: PublicBuilding;
  /** Mostra il titolo "Edificio X" sopra la tabella. Default true. */
  showHeader?: boolean;
}

export function DailyRoomTimetable({ building, showHeader = true }: Props) {
  const slots = useMemo(() => buildSlots(), []);
  const sortedRooms = useMemo(() => sortRoomsForBuilding(building.rooms, building), [building]);

  // Calcola le celle per ogni aula UNA volta (useMemo evita ricalcoli a ogni
  // tick del ticker globale del display).
  const cellsByRoom = useMemo(() => {
    const m = new Map<number, BookingCell[]>();
    for (const room of sortedRooms) {
      m.set(room.id, buildBookingCells(room, slots.length));
    }
    return m;
  }, [sortedRooms, slots.length]);

  const todayLabel = useMemo(() => {
    const today = new Date();
    return today.toLocaleDateString('it-IT', {
      weekday: 'long',
      day: '2-digit',
      month: 'long',
    });
  }, []);

  return (
    <div className="flex h-full flex-col gap-2">
      {showHeader && (
        <div className="flex items-baseline justify-between gap-3 px-1">
          <div className="flex items-center gap-2 text-2xl 2xl:text-3xl font-display font-medium">
            <Building2 className="h-6 w-6 2xl:h-7 2xl:w-7" />
            <span>{building.name}</span>
          </div>
          <div className="text-sm 2xl:text-base text-muted-foreground first-letter:uppercase">
            {todayLabel}
          </div>
        </div>
      )}

      <div className="flex-1 overflow-hidden rounded-xl border bg-card">
        <div className="h-full overflow-auto">
          <table className="min-w-full border-collapse text-sm" style={{ tableLayout: 'fixed' }}>
            <colgroup>
              <col style={{ width: '140px' }} />
              {slots.map((s) => (
                <col key={s} style={{ width: '52px' }} />
              ))}
            </colgroup>
            <thead className="sticky top-0 z-10 bg-muted text-xs font-medium uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="sticky left-0 z-20 border-b border-r bg-muted px-2 py-1.5 text-left">
                  Aula
                </th>
                {slots.map((s, i) => (
                  <th
                    key={s}
                    className={cn(
                      'border-b border-r px-1 py-1.5 text-center font-mono text-[0.65rem]',
                      // Evidenzia ogni ora intera per leggibilità
                      i % 2 === 0 ? 'bg-muted' : 'bg-muted/70',
                    )}
                  >
                    {s}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sortedRooms.map((room, rowIdx) => {
                const cells = cellsByRoom.get(room.id) ?? [];
                const isOddRow = rowIdx % 2 === 1;
                return (
                  <tr key={room.id} className={isOddRow ? 'bg-muted/30' : ''}>
                    <th
                      scope="row"
                      className={cn(
                        'sticky left-0 z-[1] border-b border-r px-2 py-1.5 text-left text-xs font-medium',
                        isOddRow ? 'bg-muted/40' : 'bg-card',
                      )}
                    >
                      <div className="truncate">{room.name}</div>
                      {room.floor && (
                        <div className="truncate text-[0.625rem] text-muted-foreground">
                          {room.floor}
                        </div>
                      )}
                    </th>
                    {(() => {
                      const tds: ReactElement[] = [];
                      let i = 0;
                      while (i < slots.length) {
                        const block = cells.find((c) => c.startSlot === i);
                        if (block) {
                          tds.push(
                            <td
                              key={`b-${block.booking.id}`}
                              colSpan={block.span}
                              className={cn(
                                'border-b border-r border-l p-1 align-middle text-center text-xs font-medium leading-tight',
                                TYPE_CLASSES[block.booking.type] ?? TYPE_CLASSES.altro,
                              )}
                              title={block.label}
                            >
                              <div className="truncate">{block.label}</div>
                            </td>,
                          );
                          i += block.span;
                        } else {
                          tds.push(
                            <td
                              key={`e-${i}`}
                              className={cn(
                                'border-b border-r',
                                i % 2 === 0 ? 'bg-card/40' : 'bg-card',
                              )}
                            />,
                          );
                          i++;
                        }
                      }
                      return tds;
                    })()}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
