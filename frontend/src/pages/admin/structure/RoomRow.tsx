import { useTranslation } from 'react-i18next';
import { Cog, DoorOpen, Pencil, Plus, Trash2 } from 'lucide-react';
import { ROOM_TYPE_LABEL } from '@/lib/bookings';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import type { Equipment, Room } from '@/types';

interface RoomRowProps {
  room: Room;
  isSelected: boolean;
  onToggleSelect: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onAddEquipment: () => void;
  onEditEquipment: (e: Equipment) => void;
  onDeleteEquipment: (e: Equipment) => void;
}

export function RoomRow({
  room,
  isSelected,
  onToggleSelect,
  onEdit,
  onDelete,
  onAddEquipment,
  onEditEquipment,
  onDeleteEquipment,
}: RoomRowProps) {
  const { t } = useTranslation();
  return (
    <li className={cn('flex gap-3 px-5 py-3 transition-colors', isSelected && 'bg-primary/5')}>
      <Checkbox
        checked={isSelected}
        onCheckedChange={onToggleSelect}
        className="mt-1 shrink-0"
        aria-label={t('admin.structure.select_room_aria', { name: room.name })}
      />
      <div className="flex flex-1 flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <DoorOpen className="h-3.5 w-3.5 text-muted-foreground" />
            <p className="font-medium">{room.name}</p>
            <Badge variant="secondary">{t(ROOM_TYPE_LABEL[room.type])}</Badge>
            <Badge variant={room.isBookable ? 'success' : 'muted'}>
              {room.isBookable ? t('admin.structure.bookable') : t('admin.structure.not_bookable')}
            </Badge>
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {t(room.capacity === 1 ? 'admin.structure.seats_one' : 'admin.structure.seats_other', {
              count: room.capacity,
            })}
            {room.code ? ` · ${room.code}` : ''}
          </p>

          {/* Equipment chips */}
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {room.equipment?.length === 0 && (
              <span className="text-xs text-muted-foreground">
                {t('admin.structure.no_equipment')}
              </span>
            )}
            {room.equipment?.map((e) => (
              <button
                key={e.id}
                type="button"
                onClick={() => {
                  onEditEquipment(e);
                }}
                className={cn(
                  'group inline-flex items-center gap-1 rounded-md border bg-background px-2 py-0.5 text-[11px] transition-colors hover:border-primary',
                  !e.isWorking && 'opacity-50',
                )}
                title={t('common.edit')}
              >
                <Cog className="h-3 w-3" />
                {e.name}
                {e.quantity > 1 && ` ×${e.quantity}`}
                <span
                  role="button"
                  onClick={(ev) => {
                    ev.stopPropagation();
                    onDeleteEquipment(e);
                  }}
                  className="ml-1 text-muted-foreground hover:text-destructive"
                >
                  ✕
                </span>
              </button>
            ))}
            <button
              type="button"
              onClick={onAddEquipment}
              className="inline-flex items-center gap-1 rounded-md border border-dashed px-2 py-0.5 text-[11px] text-muted-foreground hover:border-primary hover:text-primary"
            >
              <Plus className="h-3 w-3" />
              {t('common.add')}
            </button>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <Button variant="ghost" size="icon" title={t('common.edit')} onClick={onEdit}>
            <Pencil className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            title={t('common.delete')}
            onClick={onDelete}
            className="text-destructive hover:bg-destructive/10 hover:text-destructive"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </li>
  );
}
