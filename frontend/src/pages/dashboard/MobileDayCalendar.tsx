import { Building2, ChevronDown, ChevronLeft, ChevronRight, DoorOpen } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { dayjs, formatTime } from '@/lib/date';
import type { BuildingDayBookings } from '@/lib/dashboardData';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import type { Booking } from '@/types';

interface Props {
  dayStart: string;
  today: string;
  isToday: boolean;
  isLoading: boolean;
  buildingsWithDayBookings: BuildingDayBookings[];
  currentUserId: number | undefined;
  onDayChange: (day: string) => void;
  onBookingClick: (b: Booking) => void;
}

export function MobileDayCalendar({
  dayStart,
  today,
  isToday,
  isLoading,
  buildingsWithDayBookings,
  currentUserId,
  onDayChange,
  onBookingClick,
}: Props) {
  const { t } = useTranslation();
  return (
    <Card className="lg:hidden">
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <div className="min-w-0">
          <CardTitle className="text-base">{t('dashboard.calendar_title')}</CardTitle>
          <p className="mt-0.5 truncate text-xs capitalize text-muted-foreground">
            {dayjs(dayStart).format('dddd D MMMM')}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            title={t('dashboard.prev_day')}
            onClick={() => {
              onDayChange(dayjs(dayStart).subtract(1, 'day').format('YYYY-MM-DD'));
            }}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-8 px-2 text-xs"
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
            className="h-8 w-8"
            title={t('dashboard.next_day')}
            onClick={() => {
              onDayChange(dayjs(dayStart).add(1, 'day').format('YYYY-MM-DD'));
            }}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-2 pt-0 sm:pt-0">
        {isLoading ? (
          <>
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </>
        ) : buildingsWithDayBookings.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">{t('rooms.no_rooms')}</p>
        ) : (
          buildingsWithDayBookings.map(({ building, rooms: bldgRooms, totalBookings }) => (
            <details
              key={building.id}
              // Auto-apri solo se c'e' un unico edificio (evita il tap extra
              // ridondante). Multi-edificio: tutti chiusi, l'utente sceglie.
              open={buildingsWithDayBookings.length === 1}
              className="group rounded-lg border bg-card transition-colors open:bg-muted/20 [&_summary::-webkit-details-marker]:hidden"
            >
              <summary className="flex cursor-pointer list-none items-center justify-between gap-2 p-3 text-sm">
                <div className="flex min-w-0 items-center gap-2">
                  <Building2 className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0">
                    <p className="truncate font-medium">{building.name}</p>
                    <p className="truncate text-[11px] text-muted-foreground">
                      {bldgRooms.length} {bldgRooms.length === 1 ? 'aula' : 'aule'}
                    </p>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Badge variant={totalBookings === 0 ? 'success' : 'secondary'}>
                    {totalBookings === 0 ? 'Tutte libere' : `${totalBookings} prenot.`}
                  </Badge>
                  <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-180" />
                </div>
              </summary>
              <div className="space-y-1.5 border-t p-2">
                {bldgRooms.length === 0 ? (
                  <p className="py-2 text-center text-xs text-muted-foreground">
                    Nessuna aula prenotabile in questo edificio
                  </p>
                ) : (
                  bldgRooms.map(({ room, bookings: dayBookings }) => (
                    <details
                      key={room.id}
                      className="group/room rounded-md border bg-background transition-colors open:bg-muted/40"
                    >
                      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 p-2 text-xs">
                        <div className="flex min-w-0 items-center gap-2">
                          <DoorOpen className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                          <div className="min-w-0">
                            <p className="truncate font-medium">{room.name}</p>
                            {room.floor && (
                              <p className="truncate text-[10px] text-muted-foreground">
                                {room.floor}
                              </p>
                            )}
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-1.5">
                          <Badge
                            variant={dayBookings.length === 0 ? 'success' : 'secondary'}
                            className="text-[10px]"
                          >
                            {dayBookings.length === 0 ? 'Libera' : `${dayBookings.length}`}
                          </Badge>
                          <ChevronDown className="h-3 w-3 text-muted-foreground transition-transform group-open/room:rotate-180" />
                        </div>
                      </summary>
                      <div className="space-y-1 border-t p-2">
                        {dayBookings.length === 0 ? (
                          <p className="py-1 text-center text-[10px] text-muted-foreground">
                            Nessuna prenotazione oggi
                          </p>
                        ) : (
                          dayBookings.map((b) => {
                            const owned = currentUserId === b.userId;
                            return (
                              <button
                                type="button"
                                key={b.id}
                                onClick={() => {
                                  onBookingClick(b);
                                }}
                                className={
                                  owned
                                    ? 'flex w-full items-center gap-2 rounded-md border-2 border-primary/40 bg-primary/5 p-1.5 text-left text-[11px] transition-colors hover:bg-primary/10'
                                    : 'flex w-full items-center gap-2 rounded-md border bg-card p-1.5 text-left text-[11px] transition-colors hover:bg-accent'
                                }
                              >
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center gap-1.5">
                                    <span className="font-medium tabular-nums">
                                      {formatTime(b.startTime)}–{formatTime(b.endTime)}
                                    </span>
                                    <span className="truncate capitalize text-[9px] text-muted-foreground">
                                      · {b.type.replace('_', ' ')}
                                    </span>
                                  </div>
                                  {b.user && (
                                    <p className="truncate text-[9px] text-muted-foreground">
                                      {b.user.firstName} {b.user.lastName}
                                    </p>
                                  )}
                                </div>
                              </button>
                            );
                          })
                        )}
                      </div>
                    </details>
                  ))
                )}
              </div>
            </details>
          ))
        )}
      </CardContent>
    </Card>
  );
}
