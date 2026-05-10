import { Fragment, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { dayjs, formatTime } from '@/lib/date';
import { BOOKING_TYPE_LABEL, BOOKING_TYPE_STYLES } from '@/lib/bookings';
import { cn } from '@/lib/utils';
import type { BookingType } from '@/types';

// =============================================================================
// Vista settimanale Aule × Giorni (Lun–Sab) con slot da 30' (08:00–20:00)
//
// Asse del tempo ORIZZONTALE: in ogni cella aula×giorno il tempo scorre da
// sinistra a destra (08:00 → 20:00). La cella è suddivisa in 24 quadrati,
// uno ogni 30 minuti.
//
// Layout (CSS grid):
//   ┌───────┬─────────────────── Lun 22/04 ──────────────────┬── Mar ──...
//   │       │  08  09  10  11  12  13  14  15  16  17  18  19│  08 ...
//   │ A.101 │ ░░│ ░░│ ░░│ ░░│ ░░│ ░░│ ░░│ ░░│ ░░│ ░░│ ░░│ ░░│ ...
//   │ A.102 │ ░░│ ░░│ ░░│ ░░│ ░░│ ░░│ ░░│ ░░│ ░░│ ░░│ ░░│ ░░│ ...
//   └───────┴────┴───┴───┴───┴───┴───┴───┴───┴───┴───┴───┴───┴───
//
//   Header riga 1: nome giorno (Lun 22 apr).
//   Header riga 2: 12 etichette ora (08, 09, …, 19) distribuite uniformemente
//                  sotto al nome del giorno; ogni etichetta copre 2 slot.
//   Body: una riga per aula. In ogni cella, 24 strisce verticali (slot 30').
//         I blocchi prenotazione si posizionano in absolute con left/width
//         in % rispetto alla finestra 08:00–20:00, quindi più slot consecutivi
//         si fondono visivamente in un unico rettangolo.
// =============================================================================

export interface WeeklyBlock {
  id: number | string;
  roomId: number;
  startTime: string;
  endTime: string;
  type: BookingType;
  /** Testo da mostrare dentro il blocco (es. "Prof. Rossi", "Stud", titolo concerto). */
  label: string;
  /** Tooltip esteso (mostra orari + dettagli se serve). */
  tooltip?: string;
}

export interface WeeklyRoom {
  id: number;
  /** Nome aula (fallback se manca il codice). */
  name: string;
  /** Codice aula breve (es. "A.101"). Quando presente è l'unico identificativo
   *  mostrato nella prima colonna della weekly view. */
  code?: string | null;
}

interface Props {
  /** YYYY-MM-DD del lunedì della settimana (uso isoWeek lato chiamante). */
  weekStart: string;
  rooms: WeeklyRoom[];
  blocks: WeeklyBlock[];
  startHour?: number; // default 8
  endHour?: number; // default 21
  slotMinutes?: number; // default 30
  daysCount?: number; // default 6 (Lun-Sab); usa 7 per includere domenica
  /** Indica visivamente l'ora corrente nel giorno odierno se cade nel range. */
  showNowIndicator?: boolean;
  /** Modalità compatta per il kiosk: meno padding, label più corte. */
  compact?: boolean;
  /** Le colonne giorno riempiono la larghezza disponibile (1fr), senza scroll
   *  orizzontale. Usato sul Display kiosk per visualizzare l'intera settimana
   *  Lun–Sab a tutta larghezza dello schermo. Se false (default), le colonne
   *  hanno larghezza fissa basata sugli slot e il container scrolla in X. */
  fillWidth?: boolean;
  /** Distribuisci le righe aula via `1fr` su tutta l'altezza disponibile (no
   *  scroll verticale): tutte le aule sono sempre visibili, le righe si
   *  rimpiccioliscono fino al `minRowRem` quando ci sono molte aule. Usato
   *  sull'Infopoint kiosk dove vogliamo mostrare l'intero edificio in un
   *  colpo solo. Default false → righe a altezza fissa con scroll verticale.
   *  Richiede che il container genitore abbia `h-full` (altezza definita). */
  autoFitRows?: boolean;
  /** Altezza minima riga (rem) quando autoFitRows=true. Default 1.25rem.
   *  Sotto questo valore i blocchi prenotazione diventano illeggibili. */
  minRowRem?: number;
  /** Click/drag su cella vuota: invocato in Dashboard per "Nuova prenotazione".
   *
   *  - **Click singolo** (pointer down + up senza spostamento): start allineato
   *    al sub-slot da 30', end = start + slotMinutes (un solo slot).
   *  - **Drag**: pointerdown su slot A, drag fino a slot B, rilascio → start
   *    allineato al min(A,B), end allineato a max(A,B)+1 (inclusivo). Durante
   *    il drag un overlay tratteggiato visualizza la selezione live.
   *
   *  Sostituisce l'uso del precedente `onSlotClick` con la nuova firma
   *  range-aware. La logica del consumer (es. Dashboard) può decidere se
   *  espandere a 1h di default quando end-start === slotMinutes (singolo slot). */
  onSlotRangeSelect?: (room: WeeklyRoom, start: Date, end: Date) => void;
  onBlockClick?: (block: WeeklyBlock) => void;
}

export function WeeklyRoomTimetable({
  weekStart,
  rooms,
  blocks,
  startHour = 8,
  endHour = 21,
  slotMinutes = 30,
  daysCount = 6,
  showNowIndicator = true,
  compact = false,
  fillWidth = false,
  autoFitRows = false,
  minRowRem = 1.25,
  onSlotRangeSelect,
  onBlockClick,
}: Props) {
  const { t } = useTranslation();
  const totalMinutes = (endHour - startHour) * 60;
  const slotsPerDay = totalMinutes / slotMinutes; // 26 con 8→21 e 30'
  const totalHours = endHour - startHour; // 13

  // Stato drag-to-select: tracciamo room/giorno e gli slot di inizio/fine.
  // Il drag è confinato a una singola cella (room × giorno): l'utente non
  // può selezionare attraverso giorni diversi — semantica naturale per il
  // dominio "una prenotazione = una stanza × un range di tempo lo stesso giorno".
  const [drag, setDrag] = useState<{
    roomId: number;
    dayIdx: number;
    startSlot: number;
    endSlot: number;
  } | null>(null);

  // Converte la posizione X del puntatore in indice slot (clamp [0, slotsPerDay-1]).
  const slotFromPointer = useCallback(
    (e: React.PointerEvent<HTMLDivElement>): number => {
      const rect = e.currentTarget.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      return Math.min(slotsPerDay - 1, Math.floor(ratio * slotsPerDay));
    },
    [slotsPerDay],
  );

  const days = useMemo(() => {
    const start = dayjs(weekStart);
    return Array.from({ length: daysCount }, (_, i) => start.add(i, 'day'));
  }, [weekStart, daysCount]);

  // Index dei blocchi per (roomId, dayIdx) → array di blocchi posizionati in %
  // (left/width sull'asse temporale orizzontale).
  const blocksByCell = useMemo(() => {
    const map = new Map<string, { block: WeeklyBlock; left: number; width: number }[]>();
    for (const b of blocks) {
      const start = dayjs(b.startTime);
      const end = dayjs(b.endTime);
      for (let i = 0; i < days.length; i++) {
        const dayStart = days[i].startOf('day').add(startHour, 'hour');
        const dayEnd = days[i].startOf('day').add(endHour, 'hour');
        if (start.isAfter(dayEnd) || end.isBefore(dayStart)) continue;
        const blockStart = start.isAfter(dayStart) ? start : dayStart;
        const blockEnd = end.isBefore(dayEnd) ? end : dayEnd;
        if (blockEnd.isSameOrBefore(blockStart)) continue;
        const left = (blockStart.diff(dayStart, 'minute') / totalMinutes) * 100;
        const width = (blockEnd.diff(blockStart, 'minute') / totalMinutes) * 100;
        const key = `${b.roomId}:${i}`;
        if (!map.has(key)) map.set(key, []);
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        map.get(key)!.push({ block: b, left, width });
      }
    }
    return map;
  }, [blocks, days, startHour, endHour, totalMinutes]);

  const today = dayjs();
  const todayDayIdx = days.findIndex((d) => d.isSame(today, 'day'));
  const nowPct = useMemo(() => {
    if (!showNowIndicator || todayDayIdx < 0) return null;
    const dayStart = days[todayDayIdx].startOf('day').add(startHour, 'hour');
    const minutes = today.diff(dayStart, 'minute');
    if (minutes < 0 || minutes > totalMinutes) return null;
    return (minutes / totalMinutes) * 100;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showNowIndicator, todayDayIdx, days, startHour, totalMinutes]);

  if (rooms.length === 0) {
    return (
      <div className="rounded-xl border bg-card p-10 text-center text-sm text-muted-foreground">
        {t('rooms.no_rooms')}
      </div>
    );
  }

  // Larghezze: colonna aule ridotta al minimo per mostrare SOLO il codice aula
  // (es. "A.101", "Sala 5").
  // - fillWidth=false (default Dashboard): colonne giorno a larghezza fissa
  //   slotsPerDay×slotRem → il quadrato 30' è chiaramente distinguibile
  //   e il container scrolla in X se serve.
  // - fillWidth=true (Display kiosk): colonne giorno a 1fr che riempiono la
  //   larghezza disponibile, così tutta la settimana Lun–Sab entra senza
  //   scroll orizzontale a costo di slot più stretti.
  //
  // Valori espressi in `rem` (non `px`) così la griglia scala assieme al
  // root font-size. Sul kiosk, useDisplayScale alza il root font-size in
  // base alla risoluzione del display HDMI (1× FHD → 2× 4K → ...) e tutto
  // il timetable cresce in modo uniforme con i testi e gli spazi Tailwind.
  // Default 16px root: 3.5rem = 56px (parity con la versione px precedente).
  const labelColRem = compact ? 3.5 : 4; // 56 / 64
  const slotRem = compact ? 0.6875 : 0.875; // 11 / 14
  const dayWidthRem = slotsPerDay * slotRem;
  const dayColTemplate = fillWidth ? 'minmax(0, 1fr)' : `${dayWidthRem}rem`;
  const minWidthRem = fillWidth ? undefined : labelColRem + days.length * dayWidthRem;

  // Altezza riga aula: solo lo spazio per la label del blocco. Compact ridotto
  // per mostrare più aule sul kiosk senza scroll verticale.
  const rowHeightRem = compact ? 2.25 : 3; // 36 / 48
  // Altezze dei due header (nome giorno + riga delle ore).
  const dayHeaderRem = compact ? 1.875 : 2.25; // 30 / 36
  const hourHeaderRem = compact ? 1.375 : 1.625; // 22 / 26

  // Colori delle linee divisorie degli slot — espliciti, indipendenti dal
  // token --border (troppo chiaro con opacity), così le mezzore sono SEMPRE
  // visibili in light/dark.
  const borderHour = 'border-l border-slate-300 dark:border-slate-700';
  const borderHalf = 'border-l border-dashed border-slate-300/70 dark:border-slate-700/70';
  // Separatore tra GIORNI distinto: doppio spessore + colore più scuro per
  // distinguersi nettamente dalle linee orarie interne. Usato come
  // border-left della prima cella di ogni giorno (header + body).
  const dayDivider = 'border-l-[0.1875rem] border-slate-500 dark:border-slate-400 border-l-solid';

  // Quando autoFitRows è attivo distribuiamo le righe-aula via `1fr` con un
  // floor `minRowRem` per evitare collasso illeggibile. Le righe header sono
  // a altezza fissa (header day + hour-label) per mantenere le label leggibili.
  const gridTemplateRows = autoFitRows
    ? `${dayHeaderRem}rem ${hourHeaderRem}rem repeat(${rooms.length}, minmax(${minRowRem}rem, 1fr))`
    : undefined; // default: ogni cella imposta la propria height inline (legacy)

  return (
    <div
      className={cn(
        'rounded-xl border bg-card',
        fillWidth ? 'w-full' : 'overflow-x-auto',
        autoFitRows && 'flex h-full flex-col overflow-hidden',
      )}
    >
      <div
        className={cn('grid', autoFitRows && 'min-h-0 flex-1')}
        style={{
          ...(minWidthRem !== undefined && { minWidth: `${minWidthRem}rem` }),
          gridTemplateColumns: `${labelColRem}rem repeat(${days.length}, ${dayColTemplate})`,
          ...(gridTemplateRows && { gridTemplateRows }),
        }}
      >
        {/* ── Header riga 1: angolo + nomi giorno ── */}
        <div
          className="flex items-center border-b border-r bg-muted/40 px-2 text-[0.625rem] font-medium uppercase tracking-wider text-muted-foreground"
          style={{ height: `${dayHeaderRem}rem` }}
        >
          {t('weekly_timetable.room_header')}
        </div>
        {days.map((d, i) => {
          const isToday = d.isSame(today, 'day');
          return (
            <div
              key={i}
              className={cn(
                'flex items-center justify-center gap-1.5 border-b text-center',
                dayDivider,
                isToday ? 'bg-primary/10' : 'bg-muted/40',
              )}
              style={{ height: `${dayHeaderRem}rem` }}
            >
              <span className="text-[0.625rem] font-medium uppercase tracking-wider text-muted-foreground">
                {d.format('ddd')}
              </span>
              <span className={cn('font-display text-sm leading-none', isToday && 'text-primary')}>
                {d.format('D MMM')}
              </span>
            </div>
          );
        })}

        {/* ── Header riga 2: "Ore" + 12 etichette HH per giorno ── */}
        <div
          className="flex items-center border-b border-r bg-muted/30 px-2 text-[0.625rem] font-medium uppercase tracking-wider text-muted-foreground"
          style={{ height: `${hourHeaderRem}rem` }}
        >
          {t('weekly_timetable.hour_header')}
        </div>
        {days.map((d, i) => {
          const isToday = d.isSame(today, 'day');
          return (
            <div
              key={i}
              className={cn(
                'relative border-b',
                dayDivider,
                isToday ? 'bg-primary/5' : 'bg-muted/20',
              )}
              style={{ height: `${hourHeaderRem}rem` }}
            >
              {/* 13 etichette ora distribuite con flex-1: ogni etichetta copre
                  un blocco di 2 slot (1 ora intera) ed è centrata orizzontalmente
                  nella propria cella, così il numero appare al centro dell'ora
                  invece che al bordo iniziale. */}
              <div className="flex h-full">
                {Array.from({ length: totalHours }).map((_, h) => (
                  <div
                    key={h}
                    className={cn(
                      'flex flex-1 items-center justify-center text-[0.5625rem] font-medium leading-none text-muted-foreground tabular-nums',
                      h > 0 && borderHour,
                    )}
                  >
                    {String(startHour + h).padStart(2, '0')}
                  </div>
                ))}
              </div>
            </div>
          );
        })}

        {/* ── Body: una riga per aula → [codice aula] + N celle giorno ── */}
        {rooms.map((room) => (
          <Fragment key={room.id}>
            {/* Colonna codice aula: SOLO codice (fallback al nome se assente),
                niente piano né tipo. Width minimal definito sopra. */}
            <div
              className="flex items-center justify-center border-b border-r bg-muted/20 px-1"
              style={autoFitRows ? undefined : { height: `${rowHeightRem}rem` }}
              title={room.name}
            >
              <p className="truncate text-sm font-semibold tabular-nums leading-none">
                {room.code?.trim() ?? room.name}
              </p>
            </div>

            {/* Celle giorno: ognuna è 24 strisce verticali con bordi solid
                (ora) / dashed (mezzora) e i blocchi prenotazione in absolute. */}
            {days.map((day, dayIdx) => {
              const cellBlocks = blocksByCell.get(`${room.id}:${dayIdx}`) ?? [];
              const isToday = day.isSame(today, 'day');
              const dayStartTs = day.startOf('day').add(startHour, 'hour');
              return (
                <div
                  key={dayIdx}
                  className={cn(
                    'relative overflow-hidden border-b',
                    dayDivider,
                    isToday && 'bg-primary/5',
                  )}
                  style={autoFitRows ? undefined : { height: `${rowHeightRem}rem` }}
                >
                  {/* SLOT GRID: 24 strisce verticali. Ora intera = solid;
                      mezzora = dashed più chiara. */}
                  <div className="pointer-events-none absolute inset-0 flex" aria-hidden>
                    {Array.from({ length: slotsPerDay }).map((_, i) => (
                      <div
                        key={i}
                        className={cn('flex-1', i > 0 && (i % 2 === 0 ? borderHour : borderHalf))}
                      />
                    ))}
                  </div>

                  {/* Pointer handler per slot vuoti — supporta sia click singolo
                      sia drag-to-select. Pointer events (vs mouse) garantiscono
                      compatibilità con touch screen tablet/kiosk e gesture pen. */}
                  {onSlotRangeSelect && (
                    <div
                      role="button"
                      tabIndex={0}
                      onPointerDown={(e) => {
                        if (e.button !== 0 && e.pointerType === 'mouse') return;
                        const slot = slotFromPointer(e);
                        e.currentTarget.setPointerCapture(e.pointerId);
                        setDrag({ roomId: room.id, dayIdx, startSlot: slot, endSlot: slot });
                      }}
                      onPointerMove={(e) => {
                        if (drag?.roomId !== room.id || drag.dayIdx !== dayIdx) return;
                        const slot = slotFromPointer(e);
                        if (slot !== drag.endSlot) {
                          setDrag({ ...drag, endSlot: slot });
                        }
                      }}
                      onPointerUp={(e) => {
                        if (drag?.roomId !== room.id || drag.dayIdx !== dayIdx) return;
                        const a = Math.min(drag.startSlot, drag.endSlot);
                        const b = Math.max(drag.startSlot, drag.endSlot);
                        const start = dayStartTs.add(a * slotMinutes, 'minute').toDate();
                        const end = dayStartTs.add((b + 1) * slotMinutes, 'minute').toDate();
                        setDrag(null);
                        try {
                          e.currentTarget.releasePointerCapture(e.pointerId);
                        } catch {
                          /* noop */
                        }
                        onSlotRangeSelect(room, start, end);
                      }}
                      onPointerCancel={() => {
                        setDrag(null);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          const start = dayStartTs.toDate();
                          const end = dayStartTs.add(slotMinutes, 'minute').toDate();
                          onSlotRangeSelect(room, start, end);
                        }
                      }}
                      className="absolute inset-0 z-0 cursor-cell touch-none select-none hover:bg-primary/5"
                      aria-label={t('weekly_timetable.book_aria', {
                        room: room.name,
                        day: day.format('ddd D MMM'),
                      })}
                    />
                  )}

                  {/* Overlay selezione live durante il drag: rettangolo blu
                      tratteggiato che copre lo span [minSlot, maxSlot+1] e
                      mostra la durata corrente in minuti. */}
                  {drag?.roomId === room.id &&
                    drag.dayIdx === dayIdx &&
                    (() => {
                      const a = Math.min(drag.startSlot, drag.endSlot);
                      const b = Math.max(drag.startSlot, drag.endSlot);
                      const leftPct = (a / slotsPerDay) * 100;
                      const widthPct = ((b - a + 1) / slotsPerDay) * 100;
                      const minutes = (b - a + 1) * slotMinutes;
                      return (
                        <div
                          className="pointer-events-none absolute z-5 flex items-center justify-center rounded-md border-2 border-dashed border-primary bg-primary/20 text-[0.625rem] font-semibold text-primary shadow-xs"
                          style={{
                            left: `calc(${leftPct}% + 0.0625rem)`,
                            width: `calc(${widthPct}% - 0.125rem)`,
                            top: '0.125rem',
                            bottom: '0.125rem',
                          }}
                          aria-hidden
                        >
                          <span className="truncate px-1">
                            {minutes >= 60
                              ? `${Math.floor(minutes / 60)}h${minutes % 60 ? ` ${minutes % 60}'` : ''}`
                              : `${minutes}'`}
                          </span>
                        </div>
                      );
                    })()}

                  {/* Blocchi prenotazione: posizione % all'interno della cella
                      sull'asse orizzontale (left/width). Altezza = riga piena. */}
                  {cellBlocks.map(({ block, left, width }) => {
                    const styles = BOOKING_TYPE_STYLES[block.type];
                    return (
                      <button
                        key={block.id}
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onBlockClick?.(block);
                        }}
                        className={cn(
                          // Rettangolo pieno (no rounded, no border) — riempie
                          // completamente il cell sull'asse verticale; un piccolo
                          // gap orizzontale (0.5px) separa visivamente blocchi
                          // adiacenti dello stesso slot senza rotture stilistiche.
                          'absolute z-10 flex flex-col items-center justify-center overflow-hidden px-1 text-center text-[0.625rem] font-semibold leading-tight',
                          styles.solid,
                          onBlockClick ? 'cursor-pointer hover:brightness-110' : 'cursor-default',
                        )}
                        style={{
                          left: `${left}%`,
                          width: `calc(${width}% - 0.0625rem)`,
                          top: 0,
                          bottom: 0,
                          minWidth: '0.5rem',
                        }}
                        title={
                          block.tooltip ??
                          `${formatTime(block.startTime)}–${formatTime(block.endTime)} · ${t(BOOKING_TYPE_LABEL[block.type])} · ${block.label}`
                        }
                      >
                        <span className="block w-full truncate">{block.label}</span>
                      </button>
                    );
                  })}

                  {/* Indicatore "ora" verticale solo nella colonna del giorno
                      corrente: linea verticale rosa alla X corrispondente. */}
                  {nowPct !== null && dayIdx === todayDayIdx && (
                    <div
                      className="pointer-events-none absolute top-0 bottom-0 z-20 w-0.5 bg-rose-500"
                      style={{ left: `${nowPct}%` }}
                      aria-hidden
                    >
                      <span className="absolute -top-1 -left-1 h-2 w-2 rounded-full bg-rose-500" />
                    </div>
                  )}
                </div>
              );
            })}
          </Fragment>
        ))}
      </div>
    </div>
  );
}
