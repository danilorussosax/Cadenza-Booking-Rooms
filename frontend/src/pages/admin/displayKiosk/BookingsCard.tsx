import { motion } from 'framer-motion';
import { CalendarCheck2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { buildingColor } from '@/lib/buildingColor';
import type { BookingsCfg, RowState } from '@/lib/displayKioskForm';
import { cn } from '@/lib/utils';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import type { Building } from '@/types';

interface BookingsCardProps {
  buildings: Building[];
  rows: Record<number, RowState | undefined>;
  updateRow: (id: number, patch: Partial<RowState>) => void;
  bookings: BookingsCfg;
  setBookings: (v: BookingsCfg) => void;
}

/**
 * Card "Rotazione prenotazioni": master toggle della sezione + tabella edifici
 * (per-row enabled + intervalSec + viewMode) come children. Disattivando il
 * master, l'intera tabella perde l'effetto sulla rotazione del kiosk (le slide
 * edifici non vengono inserite).
 */
export function BookingsCard({
  buildings,
  rows,
  updateRow,
  bookings,
  setBookings,
}: BookingsCardProps) {
  const { t } = useTranslation();
  return (
    <Card className={cn(!bookings.enabled && 'opacity-90')}>
      <CardContent className="space-y-5 p-5 sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-100 ring-1 ring-blue-300/60 dark:bg-blue-500/15 dark:ring-blue-400/30">
              <CalendarCheck2 className="h-5 w-5 text-blue-700 dark:text-blue-300" />
            </span>
            <div>
              <h2 className="text-base font-semibold">{t('admin.display.bookings_card.title')}</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {t('admin.display.bookings_card.subtitle')}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Switch
              checked={bookings.enabled}
              onCheckedChange={(v) => {
                setBookings({ enabled: v });
              }}
            />
            <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              {bookings.enabled ? t('admin.display.concerts_on') : t('admin.display.concerts_off')}
            </span>
          </div>
        </div>

        {/* Tabella edifici (children del riquadro padre): toggle
            rotazione + durata per ciascun edificio. */}
        <div
          className={cn(
            'overflow-x-auto rounded-lg border bg-card transition-opacity',
            !bookings.enabled && 'pointer-events-none opacity-50',
          )}
        >
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/50 text-left text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">{t('admin.display.table.building')}</th>
                <th className="px-4 py-3 font-medium">{t('admin.display.table.rooms_count')}</th>
                <th className="px-4 py-3 font-medium">{t('admin.display.table.enabled')}</th>
                <th className="px-4 py-3 font-medium">{t('admin.display.table.interval')}</th>
                <th className="px-4 py-3 font-medium">{t('admin.display.table.view_mode')}</th>
              </tr>
            </thead>
            <tbody>
              {buildings.map((b) => {
                const r = rows[b.id];
                if (!r) return null;
                const colors = buildingColor(b.id);
                return (
                  <motion.tr
                    key={b.id}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className={cn(
                      'border-b last:border-0 transition-opacity',
                      !r.enabled && 'opacity-60',
                    )}
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span
                          className={cn(
                            'inline-block h-2 w-2 rounded-full',
                            colors.tile.split(' ')[0],
                          )}
                        />
                        <span className={cn('font-medium', colors.text)}>{b.name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {b.rooms?.length ?? 0}
                    </td>
                    <td className="px-4 py-3">
                      <Switch
                        checked={r.enabled}
                        onCheckedChange={(v) => {
                          updateRow(b.id, { enabled: v });
                        }}
                        disabled={!bookings.enabled}
                      />
                    </td>
                    <td className="px-4 py-3">
                      <Input
                        type="number"
                        min={5}
                        max={600}
                        value={r.intervalSec}
                        onChange={(e) => {
                          updateRow(b.id, { intervalSec: Number(e.target.value) || 0 });
                        }}
                        className="w-24"
                        disabled={!r.enabled || !bookings.enabled}
                      />
                    </td>
                    <td className="px-4 py-3">
                      <select
                        value={r.viewMode}
                        onChange={(e) => {
                          updateRow(b.id, {
                            viewMode: e.target.value === 'daily' ? 'daily' : 'weekly',
                          });
                        }}
                        disabled={!r.enabled || !bookings.enabled}
                        className="w-36 rounded-md border border-input bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
                      >
                        <option value="weekly">{t('admin.display.view_mode_weekly')}</option>
                        <option value="daily">{t('admin.display.view_mode_daily')}</option>
                      </select>
                    </td>
                  </motion.tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <p className="text-xs text-muted-foreground">{t('admin.display.interval_help')}</p>
      </CardContent>
    </Card>
  );
}
