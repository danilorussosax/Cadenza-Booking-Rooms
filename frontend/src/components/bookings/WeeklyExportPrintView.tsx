import { useTranslation } from 'react-i18next';
import { dayjs } from '@/lib/date';
import { WeeklyRoomTimetable, type WeeklyBlock } from './WeeklyRoomTimetable';
import type { Room } from '@/types';

// =============================================================================
// Print view per "Esporta PDF Settimanale".
//
// Visibile SOLO in modalità stampa (vedi @media print in index.css):
// - una pagina A4 LANDSCAPE per edificio
// - intestazione con nome edificio + range settimanale
// - corpo: WeeklyRoomTimetable (a colori) per le aule dell'edificio
// - page-break-after: always per separare gli edifici
//
// L'utente sceglie "Salva come PDF" dal dialog di stampa del browser → output
// PDF a colori, orizzontale, con una pagina per edificio. È una "simulazione"
// dell'esportazione coerente con la richiesta (no dipendenze pesanti lato JS).
// =============================================================================

interface BuildingPrintGroup {
  id: number;
  name: string;
  rooms: Room[];
}

interface Props {
  weekStart: string;
  buildings: BuildingPrintGroup[];
  blocks: WeeklyBlock[];
}

export function WeeklyExportPrintView({ weekStart, buildings, blocks }: Props) {
  const { t } = useTranslation();
  const start = dayjs(weekStart);
  const end = start.add(5, 'day');
  return (
    <div className="weekly-print-root" aria-hidden>
      {buildings.map((b) => {
        const roomIds = new Set(b.rooms.map((r) => r.id));
        const buildingBlocks = blocks.filter((blk) => roomIds.has(blk.roomId));
        return (
          <section key={b.id} className="weekly-print-page">
            <header className="weekly-print-header">
              <h1>{b.name}</h1>
              <p>
                {t('dashboard.export_weekly_pdf')} · {start.format('D MMM')} –{' '}
                {end.format('D MMM YYYY')}
              </p>
            </header>
            <div className="weekly-print-grid">
              <WeeklyRoomTimetable
                weekStart={weekStart}
                rooms={b.rooms}
                blocks={buildingBlocks}
                showNowIndicator={false}
                compact
              />
            </div>
          </section>
        );
      })}
    </div>
  );
}
