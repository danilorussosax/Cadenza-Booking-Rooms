import { useMemo } from 'react';
import { motion } from 'framer-motion';
import { Building2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { PublicBuilding, PublicStats } from '@/api/public';
import { dayjs } from '@/lib/date';
import { sortRoomsForBuilding } from '@/lib/sortRooms';
import { publicBookingsToBlocks } from '@/lib/weeklyBlocks';
import { BOOKING_TYPE_LABEL, BOOKING_TYPE_STYLES } from '@/lib/bookings';
import { cn } from '@/lib/utils';
import { WeeklyRoomTimetable, type WeeklyBlock } from '@/components/bookings/WeeklyRoomTimetable';
import type { BookingType } from '@/types';
import { LegendStats } from './LegendStats';

// Palette per distinguere gli edifici a colpo d'occhio (ciclica se >4)
const BUILDING_ACCENTS = [
  'bg-sky-100 text-sky-700 ring-sky-300/60 dark:bg-sky-500/15 dark:text-sky-300 dark:ring-sky-400/30',
  'bg-amber-100 text-amber-700 ring-amber-300/60 dark:bg-amber-500/15 dark:text-amber-300 dark:ring-amber-400/30',
  'bg-emerald-100 text-emerald-700 ring-emerald-300/60 dark:bg-emerald-500/15 dark:text-emerald-300 dark:ring-emerald-400/30',
  'bg-violet-100 text-violet-700 ring-violet-300/60 dark:bg-violet-500/15 dark:text-violet-300 dark:ring-violet-400/30',
] as const;

// ===========================
// Building timetable (kiosk): vista settimanale (Lun-Sab) → aule × giorni
// con slot 30' (08:00–21:00). Riusa il componente WeeklyRoomTimetable.
// ===========================
export function BuildingTable({
  building,
  weekStart,
  index,
  stats,
}: {
  building: PublicBuilding;
  weekStart: string;
  index: number;
  /** Statistiche d'uso istituto-wide. Se presenti vengono mostrate compatte
   *  in fondo alla legenda, dopo i codici colore — sostituisce il tile-row
   *  separato che occupava una banda verticale dedicata. */
  stats: PublicStats | undefined;
}) {
  const { t } = useTranslation();
  // Aule ordinate per piano (Building.floors) → nome (numeric-aware) per
  // righe stabili indipendenti dall'ordine API.
  const sortedRooms = useMemo(() => sortRoomsForBuilding(building.rooms, building), [building]);
  // Mappiamo le PublicBooking → WeeklyBlock con label "Prof. X / Doc / Stud /
  // titolo concerto" via publicBookingsToBlocks (versione bulk che disambigua
  // automaticamente i cognomi omonimi inserendo l'iniziale del nome quando
  // necessario, es. "Prof. M. Rossi" vs "Prof. L. Rossi").
  const blocks = useMemo<WeeklyBlock[]>(() => {
    const pairs: { booking: (typeof sortedRooms)[0]['bookings'][0]; roomId: number }[] = [];
    for (const room of sortedRooms) {
      for (const b of room.bookings) {
        pairs.push({ booking: b, roomId: room.id });
      }
    }
    return publicBookingsToBlocks(pairs);
  }, [sortedRooms]);

  const totalWeek = sortedRooms.reduce((s, r) => s + r.bookings.length, 0);
  const start = dayjs(weekStart);
  const end = start.add(5, 'day');

  return (
    <motion.section
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.08 * index, ease: 'easeOut' }}
      className="flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border bg-card"
    >
      <div className="flex shrink-0 items-center justify-between border-b px-4 py-2.5 2xl:px-6 2xl:py-3">
        <div className="flex items-center gap-2.5 2xl:gap-3">
          <span
            className={cn(
              'inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ring-1 2xl:h-11 2xl:w-11',
              BUILDING_ACCENTS[index % BUILDING_ACCENTS.length],
            )}
          >
            <Building2 className="h-5 w-5 2xl:h-6 2xl:w-6" />
          </span>
          <div>
            <h2 className="font-display text-lg font-medium leading-none 2xl:text-2xl">
              {building.name}
            </h2>
            <p className="mt-0.5 text-[0.6875rem] text-muted-foreground 2xl:text-sm">
              {t(
                sortedRooms.length === 1 ? 'display.rooms_count_one' : 'display.rooms_count_other',
                { count: sortedRooms.length },
              )}
              {' · '}
              {t(totalWeek === 1 ? 'display.bookings_week_one' : 'display.bookings_week_other', {
                count: totalWeek,
              })}
              {' · '}
              {start.format('D MMM')}–{end.format('D MMM')}
            </p>
          </div>
        </div>
      </div>

      {/* Body autoFit: tutte le aule sempre visibili senza scroll, le righe
          si rimpiccioliscono fino al floor minRowRem (1.25rem). overflow-hidden
          per rimuovere lo scroll-bar verticale che spezzava il layout pieno. */}
      <div className="flex min-h-0 flex-1 overflow-hidden p-1 2xl:p-1.5">
        {sortedRooms.length === 0 ? (
          <div className="px-5 py-10 text-center text-sm text-muted-foreground">
            {t('display.no_rooms_configured')}
          </div>
        ) : (
          <WeeklyRoomTimetable
            weekStart={weekStart}
            rooms={sortedRooms}
            blocks={blocks}
            compact
            fillWidth
            autoFitRows
          />
        )}
      </div>

      {/* Legenda + statistiche d'uso compatte sulla stessa banda inferiore.
          Layout: codici colore tipologia + cell-30min a sinistra, statistiche
          d'uso a destra (in_use, oggi, settimana, aule attive). flex-wrap
          fa scendere a riga successiva sotto risoluzioni strette senza
          rubare altezza al body della tabella. */}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 border-t bg-muted/20 px-4 py-1.5 text-[0.625rem] uppercase tracking-wider text-muted-foreground 2xl:gap-x-6 2xl:px-6 2xl:py-2 2xl:text-xs">
        <div className="flex flex-wrap items-center gap-2.5 2xl:gap-4">
          {(['studio_individuale', 'lezione', 'prova', 'concerto'] as BookingType[]).map((type) => (
            <span key={type} className="inline-flex items-center gap-1.5">
              <span className={cn('h-2 w-2 rounded-sm', BOOKING_TYPE_STYLES[type].dot)} />
              {t(BOOKING_TYPE_LABEL[type])}
            </span>
          ))}
          <span aria-hidden className="text-muted-foreground/40">
            ·
          </span>
          <span className="inline-flex items-center gap-1.5 normal-case text-muted-foreground/90">
            <span
              aria-hidden
              className="inline-block h-2 w-2 border border-dashed border-muted-foreground/60 bg-background"
            />
            {t('display.legend.cell_30min')}
          </span>
        </div>
        <LegendStats stats={stats} />
      </div>
    </motion.section>
  );
}
