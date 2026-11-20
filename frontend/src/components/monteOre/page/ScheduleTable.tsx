import { CalendarClock, CalendarRange, Pencil, Plus, Trash2 } from 'lucide-react';
import type { MonteOreSchedule } from '@/api/monteOre';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DAYS_IT, TYPE_OPTIONS } from './constants';

interface ScheduleTableProps {
  schedules: MonteOreSchedule[];
  isLocked: boolean;
  onAdd: () => void;
  onEdit: (schedule: MonteOreSchedule) => void;
  onRemove: (id: number) => void;
}

/** Card "Pianificazione settimanale": elenco delle fasce ricorrenti del docente. */
export function ScheduleTable({
  schedules,
  isLocked,
  onAdd,
  onEdit,
  onRemove,
}: ScheduleTableProps) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle className="text-lg flex items-center gap-2">
            <CalendarClock className="h-5 w-5 text-primary" />
            Pianificazione settimanale
          </CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">
            Aggiungi una riga per ogni "fascia ricorrente" (es. ogni lunedì 14–17 in Aula 102).
          </p>
        </div>
        {!isLocked && (
          <Button size="sm" onClick={onAdd}>
            <Plus className="h-4 w-4" />
            Aggiungi fascia
          </Button>
        )}
      </CardHeader>
      <CardContent className="pt-0 sm:pt-0">
        {schedules.length === 0 ? (
          <div className="rounded-lg border border-dashed bg-muted/20 px-4 py-10 text-center">
            <CalendarRange className="mx-auto h-8 w-8 text-muted-foreground" />
            <p className="mt-2 text-sm font-medium">Nessuna fascia ancora configurata.</p>
            <p className="text-xs text-muted-foreground">
              Clicca <em>Aggiungi fascia</em> per inserire la prima.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b text-left text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-3 py-2">Giorno</th>
                  <th className="px-3 py-2">Orario</th>
                  <th className="px-3 py-2">Aula preferita</th>
                  <th className="px-3 py-2">Tipo</th>
                  <th className="px-3 py-2">Attività</th>
                  {!isLocked && <th className="px-3 py-2 text-right">Azioni</th>}
                </tr>
              </thead>
              <tbody>
                {schedules.map((s) => (
                  <tr key={s.id} className="border-b last:border-0">
                    <td className="px-3 py-2 font-medium">{DAYS_IT[s.dayOfWeek]}</td>
                    <td className="px-3 py-2 tabular-nums">
                      {s.startTime}–{s.endTime}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {s.room
                        ? `${s.room.name}${s.room.building ? ' · ' + s.room.building.name : ''}`
                        : '— qualunque —'}
                    </td>
                    <td className="px-3 py-2">
                      {TYPE_OPTIONS.find((o) => o.value === s.bookingType)?.label ?? s.bookingType}
                    </td>
                    <td className="px-3 py-2 truncate text-muted-foreground">{s.purpose ?? ''}</td>
                    {!isLocked && (
                      <td className="px-3 py-2 text-right">
                        <Button variant="ghost" size="icon" onClick={() => onEdit(s)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => onRemove(s.id)}
                          className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
