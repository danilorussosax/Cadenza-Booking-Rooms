import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import {
  Building2,
  ChevronDown,
  ChevronRight,
  Download,
  FileUp,
  Layers,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import { type FullInstitute } from '@/api/institutes';
import { structureApi } from '@/api/structure';
import { httpErrorMessage } from '@/lib/api';
import { buildingColor } from '@/lib/buildingColor';
import { groupRoomsByFloor, sortRoomsForBuilding } from '@/lib/sortRooms';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import type { Building, Equipment, Room } from '@/types';
import { todayLocalIso } from '@/lib/date';
import { saveBlob } from '@/lib/download';

import { RoomRow } from '@/pages/admin/structure/RoomRow';
export interface InstituteCardProps {
  institute: FullInstitute;
  expandedBuildings: Set<number>;
  onToggleBuilding: (id: number) => void;
  onEditInstitute: () => void;
  onDeleteInstitute: () => void;
  onImportCsv: () => void;
  onAddBuilding: () => void;
  onEditBuilding: (b: Building) => void;
  onDeleteBuilding: (b: Building) => void;
  onAddRoom: (b: Building) => void;
  onEditRoom: (b: Building, r: Room) => void;
  onDeleteRoom: (r: Room) => void;
  onAddEquipment: (r: Room) => void;
  onEditEquipment: (r: Room, e: Equipment) => void;
  onDeleteEquipment: (e: Equipment) => void;
  selectedRooms: Set<number>;
  onToggleRoomSelected: (id: number) => void;
  onToggleAllRoomsInBuilding: (ids: number[]) => void;
  selectedBuildings: Set<number>;
  onToggleBuildingSelected: (id: number) => void;
}

export function InstituteCard({
  institute,
  expandedBuildings,
  onToggleBuilding,
  onEditInstitute,
  onDeleteInstitute,
  onImportCsv,
  onAddBuilding,
  onEditBuilding,
  onDeleteBuilding,
  onAddRoom,
  onEditRoom,
  onDeleteRoom,
  onAddEquipment,
  onEditEquipment,
  onDeleteEquipment,
  selectedRooms,
  onToggleRoomSelected,
  onToggleAllRoomsInBuilding,
  selectedBuildings,
  onToggleBuildingSelected,
}: InstituteCardProps) {
  const { t } = useTranslation();
  return (
    <Card>
      <CardContent className="space-y-4 p-0">
        {/* Institute header */}
        <div className="flex flex-col gap-3 border-b p-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="font-display text-xl font-medium">{institute.name}</h2>
            <p className="text-xs text-muted-foreground">
              {institute.city ? `${institute.city} · ` : ''}
              {institute.code ?? t('admin.structure.no_code')} ·{' '}
              {t(
                institute.buildings.length === 1
                  ? 'admin.structure.buildings_count_one'
                  : 'admin.structure.buildings_count_other',
                { count: institute.buildings.length },
              )}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                try {
                  const blob = await structureApi.downloadCsv(institute.id);
                  saveBlob(
                    blob,
                    `struttura-${institute.code ?? institute.id}-${todayLocalIso()}.csv`,
                  );
                } catch (err) {
                  toast.error(httpErrorMessage(err));
                }
              }}
              title={t('admin.structure.export_csv')}
            >
              <Download className="h-4 w-4" />
              {t('admin.structure.export_csv')}
            </Button>
            <Button variant="outline" size="sm" onClick={onImportCsv}>
              <FileUp className="h-4 w-4" />
              {t('admin.structure.import_csv')}
            </Button>
            <Button variant="outline" size="sm" onClick={onAddBuilding}>
              <Plus className="h-4 w-4" />
              {t('admin.structure.new_building')}
            </Button>
            <Button variant="ghost" size="icon" title={t('common.edit')} onClick={onEditInstitute}>
              <Pencil className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              title={t('common.delete')}
              onClick={onDeleteInstitute}
              className="text-destructive hover:bg-destructive/10 hover:text-destructive"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Buildings */}
        {institute.buildings.length === 0 ? (
          <div className="py-10 text-center text-sm text-muted-foreground">
            {t('admin.structure.no_buildings')}
          </div>
        ) : (
          <div className="divide-y">
            {institute.buildings.map((building) => {
              const expanded = expandedBuildings.has(building.id);
              // Aule ordinate per piano (seguendo Building.floors) poi nome
              // aula con confronto numerico-aware. Crea un nuovo array per non
              // mutare la response query.
              const sortedRooms = sortRoomsForBuilding(building.rooms, building);
              // Stessa cosa, ma raggruppata per piano per il rendering
              // (sezioni con header). I piani vuoti non compaiono.
              const roomsByFloor = groupRoomsByFloor(building.rooms, building);
              const buildingSelected = selectedBuildings.has(building.id);
              return (
                <div key={building.id} className={cn(buildingSelected && 'bg-primary/5')}>
                  <div className="flex items-center justify-between gap-3 p-4">
                    <Checkbox
                      checked={buildingSelected}
                      onCheckedChange={() => {
                        onToggleBuildingSelected(building.id);
                      }}
                      className="shrink-0"
                      aria-label={t('admin.structure.select_building_aria', {
                        name: building.name,
                      })}
                    />
                    <button
                      type="button"
                      onClick={() => {
                        onToggleBuilding(building.id);
                      }}
                      className="flex min-w-0 flex-1 items-center gap-3 text-left"
                    >
                      {expanded ? (
                        <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                      ) : (
                        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                      )}
                      <div
                        className={cn(
                          'flex h-9 w-9 shrink-0 items-center justify-center rounded-md',
                          buildingColor(building.id).tile,
                        )}
                      >
                        <Building2 className="h-4 w-4" />
                      </div>
                      <div className="min-w-0">
                        <p className="truncate font-medium">{building.name}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {t(
                            building.rooms.length === 1
                              ? 'admin.structure.rooms_count_one'
                              : 'admin.structure.rooms_count_other',
                            { count: building.rooms.length },
                          )}
                          {' · '}
                          {building.floors.join(', ')}
                        </p>
                      </div>
                    </button>
                    <div className="flex shrink-0 items-center gap-1">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          onAddRoom(building);
                        }}
                      >
                        <Plus className="h-3.5 w-3.5" />
                        {t('admin.structure.new_room')}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        title={t('admin.structure.edit_building')}
                        onClick={() => {
                          onEditBuilding(building);
                        }}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        title={t('admin.structure.delete_building')}
                        onClick={() => {
                          onDeleteBuilding(building);
                        }}
                        className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>

                  {expanded && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      transition={{ duration: 0.2 }}
                      className="overflow-hidden border-t bg-muted/30"
                    >
                      {building.rooms.length === 0 ? (
                        <p className="py-6 text-center text-xs text-muted-foreground">
                          {t('admin.structure.no_rooms_in_building')}
                        </p>
                      ) : (
                        <>
                          {/* Per-building select-all bar */}
                          <div className="flex items-center justify-between border-b px-5 py-2 text-xs text-muted-foreground">
                            <label className="inline-flex cursor-pointer items-center gap-2">
                              <Checkbox
                                checked={
                                  sortedRooms.every((r) => selectedRooms.has(r.id))
                                    ? true
                                    : sortedRooms.some((r) => selectedRooms.has(r.id))
                                      ? 'indeterminate'
                                      : false
                                }
                                onCheckedChange={() => {
                                  onToggleAllRoomsInBuilding(sortedRooms.map((r) => r.id));
                                }}
                              />
                              <span>
                                {t('admin.structure.select_all_rooms', { building: building.name })}
                              </span>
                            </label>
                            <span>
                              {sortedRooms.filter((r) => selectedRooms.has(r.id)).length} /{' '}
                              {sortedRooms.length}
                            </span>
                          </div>
                          <div className="divide-y">
                            {roomsByFloor.map(({ floor, rooms: floorRooms }) => (
                              <section key={floor || '_unknown'}>
                                <header className="flex items-center justify-between gap-2 bg-muted/40 px-5 py-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                                  <span className="inline-flex items-center gap-1.5">
                                    <Layers className="h-3 w-3" />
                                    {floor || t('admin.structure.unknown_floor')}
                                  </span>
                                  <span className="font-mono tabular-nums">
                                    {t(
                                      floorRooms.length === 1
                                        ? 'admin.structure.rooms_count_one'
                                        : 'admin.structure.rooms_count_other',
                                      { count: floorRooms.length },
                                    )}
                                  </span>
                                </header>
                                <ul className="divide-y">
                                  {floorRooms.map((room) => (
                                    <RoomRow
                                      key={room.id}
                                      room={room}
                                      isSelected={selectedRooms.has(room.id)}
                                      onToggleSelect={() => {
                                        onToggleRoomSelected(room.id);
                                      }}
                                      onEdit={() => {
                                        onEditRoom(building, room);
                                      }}
                                      onDelete={() => {
                                        onDeleteRoom(room);
                                      }}
                                      onAddEquipment={() => {
                                        onAddEquipment(room);
                                      }}
                                      onEditEquipment={(e) => {
                                        onEditEquipment(room, e);
                                      }}
                                      onDeleteEquipment={(e) => {
                                        onDeleteEquipment(e);
                                      }}
                                    />
                                  ))}
                                </ul>
                              </section>
                            ))}
                          </div>
                        </>
                      )}
                    </motion.div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
