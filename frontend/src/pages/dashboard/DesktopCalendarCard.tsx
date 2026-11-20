import { ChevronLeft, ChevronRight, FileDown } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { dayjs } from '@/lib/date';
import type { BuildingGroup } from '@/lib/dashboardData';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { WeeklyRoomTimetable, type WeeklyBlock } from '@/components/bookings/WeeklyRoomTimetable';
import type { CalendarRange } from './useCalendarPrefs';
import type { Room } from '@/types';

interface Props {
  dayStart: string;
  today: string;
  isToday: boolean;
  isLoading: boolean;
  calendarRange: CalendarRange;
  calendarDaysCount: number;
  buildings: BuildingGroup[];
  buildingTab: string;
  calendarRooms: Room[];
  weeklyBlocks: WeeklyBlock[];
  currentUserId: number | null;
  onDayChange: (day: string) => void;
  onRangeChange: (range: CalendarRange) => void;
  onBuildingTabChange: (tab: string) => void;
  onExport: () => void;
  onSlotRangeSelect: (room: { id: number }, start: Date, end: Date) => void;
  onBlockClick: (blk: WeeklyBlock) => void;
}

export function DesktopCalendarCard({
  dayStart,
  today,
  isToday,
  isLoading,
  calendarRange,
  calendarDaysCount,
  buildings,
  buildingTab,
  calendarRooms,
  weeklyBlocks,
  currentUserId,
  onDayChange,
  onRangeChange,
  onBuildingTabChange,
  onExport,
  onSlotRangeSelect,
  onBlockClick,
}: Props) {
  const { t } = useTranslation();
  return (
    <Card className="hidden lg:block">
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <CardTitle className="font-display text-xl">{t('dashboard.calendar_title')}</CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">{t('dashboard.calendar_help')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* Toggle vista: singolo giorno (default) o 3 giorni consecutivi.
                Il giorno mostrato in `dayStart` resta il primo della finestra
                (es. oggi + 2 successivi quando `calendarRange='three'`). */}
          <div
            role="group"
            aria-label={t('dashboard.calendar_range.label')}
            className="inline-flex rounded-md border bg-background p-0.5"
          >
            <Button
              type="button"
              variant={calendarRange === 'single' ? 'default' : 'ghost'}
              size="sm"
              className="h-8 px-3 text-xs"
              onClick={() => {
                onRangeChange('single');
              }}
              aria-pressed={calendarRange === 'single'}
            >
              {t('dashboard.calendar_range.single')}
            </Button>
            <Button
              type="button"
              variant={calendarRange === 'three' ? 'default' : 'ghost'}
              size="sm"
              className="h-8 px-3 text-xs"
              onClick={() => {
                onRangeChange('three');
              }}
              aria-pressed={calendarRange === 'three'}
            >
              {t('dashboard.calendar_range.three')}
            </Button>
          </div>
          <Button
            variant="outline"
            size="icon"
            title={t('dashboard.prev_day')}
            onClick={() => {
              onDayChange(dayjs(dayStart).subtract(calendarDaysCount, 'day').format('YYYY-MM-DD'));
            }}
          >
            <ChevronLeft className="h-4 w-4 text-primary" />
          </Button>
          <Input
            type="date"
            value={dayStart}
            onChange={(e) => {
              if (!e.target.value) return;
              onDayChange(dayjs(e.target.value).format('YYYY-MM-DD'));
            }}
            className="w-auto"
          />
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              onDayChange(today);
            }}
            disabled={isToday}
          >
            {t('dashboard.today')}
          </Button>
          <Button
            variant="outline"
            size="icon"
            title={t('dashboard.next_day')}
            onClick={() => {
              onDayChange(dayjs(dayStart).add(calendarDaysCount, 'day').format('YYYY-MM-DD'));
            }}
          >
            <ChevronRight className="h-4 w-4 text-primary" />
          </Button>
          <Button
            variant="default"
            size="sm"
            onClick={onExport}
            disabled={isLoading || buildings.length === 0}
          >
            <FileDown className="h-4 w-4" />
            {t('dashboard.export_weekly_pdf')}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 pt-0 sm:pt-0">
        {/* Building tabs */}
        {buildings.length > 1 && (
          <Tabs value={buildingTab} onValueChange={onBuildingTabChange}>
            <TabsList>
              {buildings.map((b) => (
                <TabsTrigger key={b.id} value={String(b.id)}>
                  {b.name} · {b.rooms.length}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        )}

        <p className="font-display text-base capitalize">
          {calendarRange === 'three'
            ? t('dashboard.calendar_range.range_label', {
                from: dayjs(dayStart).format('dddd D MMMM'),
                to: dayjs(dayStart).add(2, 'day').format('dddd D MMMM YYYY'),
              })
            : dayjs(dayStart).format('dddd D MMMM YYYY')}
        </p>

        {isLoading ? (
          <Skeleton className="h-[520px] w-full" />
        ) : (
          <WeeklyRoomTimetable
            weekStart={dayStart}
            daysCount={calendarDaysCount}
            rooms={calendarRooms}
            blocks={weeklyBlocks.filter((blk) => calendarRooms.some((r) => r.id === blk.roomId))}
            currentUserId={currentUserId}
            onSlotRangeSelect={onSlotRangeSelect}
            onBlockClick={onBlockClick}
          />
        )}
      </CardContent>
    </Card>
  );
}
