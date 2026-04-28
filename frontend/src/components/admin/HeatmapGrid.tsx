import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';

const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;

export interface HeatmapCell {
  count: number;
  hours: number;
}

export interface HeatmapGridProps {
  /** Matrice 7×24: indice 0 = Lunedì, 6 = Domenica; per ogni giorno 24 celle (ora 0..23). */
  heatmap: HeatmapCell[][];
  /** Valore massimo usato per scalare l'intensità del colore. */
  max: number;
}

function colorFor(count: number, max: number): string {
  if (count === 0) return 'bg-muted';
  const intensity = Math.min(1, count / Math.max(1, max));
  if (intensity < 0.2) return 'bg-rose-100 dark:bg-rose-500/15';
  if (intensity < 0.4) return 'bg-rose-200 dark:bg-rose-500/30';
  if (intensity < 0.6) return 'bg-rose-300 dark:bg-rose-500/50';
  if (intensity < 0.8) return 'bg-rose-400 dark:bg-rose-500/70';
  return 'bg-rose-500 dark:bg-rose-500';
}

export function HeatmapGrid({ heatmap, max }: HeatmapGridProps) {
  const { t } = useTranslation();
  const hours = Array.from({ length: 24 }, (_, h) => h);

  return (
    <div className="overflow-x-auto">
      <div className="inline-block min-w-full">
        <div
          data-testid="heatmap-grid"
          className="grid"
          style={{ gridTemplateColumns: '60px repeat(24, minmax(28px, 1fr))', gap: '2px' }}
        >
          {/* Header ore */}
          <div />
          {hours.map((h) => (
            <div key={h} className="text-center text-[10px] tabular-nums text-muted-foreground">
              {h}
            </div>
          ))}

          {/* Righe giorni */}
          {DAYS.map((day, dowIdx) => (
            <motion.div
              key={day}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.02 * dowIdx }}
              className="contents"
            >
              <div
                data-testid={`heatmap-day-${day}`}
                className="flex items-center justify-end pr-2 text-xs font-medium uppercase tracking-wider text-muted-foreground"
              >
                {t(`admin.analytics.heatmap.day.${day}`)}
              </div>
              {hours.map((h) => {
                const cell = heatmap[dowIdx]?.[h] ?? { count: 0, hours: 0 };
                return (
                  <div
                    key={h}
                    data-testid={`heatmap-cell-${dowIdx}-${h}`}
                    data-count={cell.count}
                    className={cn('h-6 rounded transition-colors', colorFor(cell.count, max))}
                    title={`${cell.count} prenotazioni · ${cell.hours} h`}
                  />
                );
              })}
            </motion.div>
          ))}
        </div>
      </div>
    </div>
  );
}
