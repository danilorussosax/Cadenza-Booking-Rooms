import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { LucideIcon } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import {
  Building2,
  ChevronDown,
  ChevronRight,
  Cog,
  DoorOpen,
  Download,
  FileUp,
  Layers,
  Pencil,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { institutesApi, type FullInstitute } from '@/api/institutes';
import { structureApi } from '@/api/structure';
import { httpErrorMessage } from '@/lib/api';
import { ROOM_TYPE_LABEL } from '@/lib/bookings';
import { buildingColor } from '@/lib/buildingColor';
import { groupRoomsByFloor, sortRoomsForBuilding } from '@/lib/sortRooms';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { EquipmentTemplatesSection } from '@/components/admin/EquipmentTemplatesSection';
import { InstituteFormDialog } from '@/components/admin/InstituteFormDialog';
import { BuildingFormDialog } from '@/components/admin/BuildingFormDialog';
import { RoomFormDialog } from '@/components/admin/RoomFormDialog';
import { EquipmentFormDialog } from '@/components/admin/EquipmentFormDialog';
import { CsvImportDialog } from '@/components/admin/CsvImportDialog';
import { ConfirmDeleteDialog } from '@/components/admin/ConfirmDeleteDialog';
import type { Building, Equipment, Institute, Room } from '@/types';

type DeleteTarget =
  | { kind: 'institute'; entity: Institute }
  | { kind: 'building'; entity: Building }
  | { kind: 'room'; entity: Room }
  | { kind: 'equipment'; entity: Equipment }
  | null;

// Macro-tab in stile pagina /admin/server-settings: card grandi con icona+label,
// active state con bg-background + ring + colore icona acceso, sotto un header
// descrittivo con la stessa estetica.
type StructureTab = 'sedi' | 'dotazioni';

interface StructureTabDef {
  value: StructureTab;
  labelKey: string;
  descriptionKey: string;
  icon: LucideIcon;
  iconColor: string;
  iconBg: string;
}

const STRUCTURE_TABS: StructureTabDef[] = [
  {
    value: 'sedi',
    labelKey: 'admin.structure.tab_sedi',
    descriptionKey: 'admin.structure.tab_sedi_description',
    icon: Building2,
    iconColor: 'text-blue-600 dark:text-blue-400',
    iconBg: 'bg-blue-100 dark:bg-blue-500/15',
  },
  {
    value: 'dotazioni',
    labelKey: 'admin.structure.tab_dotazioni',
    descriptionKey: 'admin.structure.tab_dotazioni_description',
    icon: Cog,
    iconColor: 'text-violet-600 dark:text-violet-400',
    iconBg: 'bg-violet-100 dark:bg-violet-500/15',
  },
];

const STRUCTURE_VALID_TABS = STRUCTURE_TABS.map((t) => t.value);

export default function AdminStructure() {
  const qc = useQueryClient();
  const { t } = useTranslation();
  const query = useQuery({
    queryKey: ['institutes', 'full'],
    queryFn: () => institutesApi.listFull(),
  });

  const [expandedBuildings, setExpandedBuildings] = useState<Set<number>>(new Set());

  const [instituteDialog, setInstituteDialog] = useState<{
    open: boolean;
    institute: Institute | null;
  }>({ open: false, institute: null });
  const [buildingDialog, setBuildingDialog] = useState<{
    open: boolean;
    instituteId: number | null;
    building: Building | null;
  }>({ open: false, instituteId: null, building: null });
  const [roomDialog, setRoomDialog] = useState<{
    open: boolean;
    building: Building | null;
    room: Room | null;
  }>({ open: false, building: null, room: null });
  const [equipmentDialog, setEquipmentDialog] = useState<{
    open: boolean;
    roomId: number | null;
    equipment: Equipment | null;
  }>({ open: false, roomId: null, equipment: null });
  const [csvDialog, setCsvDialog] = useState<{
    open: boolean;
    institute: Institute | null;
  }>({ open: false, institute: null });
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const [selectedRooms, setSelectedRooms] = useState<Set<number>>(new Set());
  const [bulkConfirm, setBulkConfirm] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);

  const [selectedBuildings, setSelectedBuildings] = useState<Set<number>>(new Set());
  const [bulkBuildingsConfirm, setBulkBuildingsConfirm] = useState(false);
  const [bulkBuildingsError, setBulkBuildingsError] = useState<string | null>(null);

  const toggleBuildingSelected = (id: number) => {
    setSelectedBuildings((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const clearBuildingSelection = () => {
    setSelectedBuildings(new Set());
  };

  // Riepilogo per il dialog di conferma: aule contenute negli edifici selezionati.
  // Le prenotazioni non sono caricate in questa view, quindi non possiamo
  // anticiparne il count: l'API risponde con il totale rimosso.
  const buildingsSelectionSummary = useMemo(() => {
    let rooms = 0;
    for (const inst of query.data?.institutes ?? []) {
      for (const b of inst.buildings) {
        if (selectedBuildings.has(b.id)) rooms += b.rooms.length;
      }
    }
    return { rooms };
  }, [query.data, selectedBuildings]);

  const toggleRoomSelected = (id: number) => {
    setSelectedRooms((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAllRoomsInBuilding = (roomIds: number[]) => {
    setSelectedRooms((prev) => {
      const next = new Set(prev);
      const allIn = roomIds.every((id) => next.has(id));
      if (allIn) for (const id of roomIds) next.delete(id);
      else for (const id of roomIds) next.add(id);
      return next;
    });
  };

  const clearSelection = () => {
    setSelectedRooms(new Set());
  };

  const bulkDeleteMutation = useMutation({
    mutationFn: () => structureApi.bulkDeleteRooms(Array.from(selectedRooms)),
    onSuccess: ({ deleted }) => {
      toast.success(
        t(
          deleted === 1
            ? 'admin.structure.rooms_deleted_one'
            : 'admin.structure.rooms_deleted_other',
          { count: deleted },
        ),
      );
      void qc.invalidateQueries({ queryKey: ['institutes'] });
      void qc.invalidateQueries({ queryKey: ['rooms'] });
      void qc.invalidateQueries({ queryKey: ['public'] });
      setBulkConfirm(false);
      clearSelection();
    },
    onError: (err) => {
      setBulkError(httpErrorMessage(err));
    },
  });

  const bulkDeleteBuildingsMutation = useMutation({
    mutationFn: () => structureApi.bulkDeleteBuildings(Array.from(selectedBuildings)),
    onSuccess: ({ deleted, removedRooms, removedBookings }) => {
      toast.success(
        t('admin.structure.buildings_deleted_toast', {
          count: deleted,
          removedRooms,
          removedBookings,
        }),
      );
      void qc.invalidateQueries({ queryKey: ['institutes'] });
      void qc.invalidateQueries({ queryKey: ['rooms'] });
      void qc.invalidateQueries({ queryKey: ['public'] });
      setBulkBuildingsConfirm(false);
      clearBuildingSelection();
    },
    onError: (err) => {
      setBulkBuildingsError(httpErrorMessage(err));
    },
  });

  const toggleBuilding = (id: number) => {
    setExpandedBuildings((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const deleteMutation = useMutation({
    mutationFn: () => {
      if (!deleteTarget) return Promise.reject(new Error('No delete target'));
      switch (deleteTarget.kind) {
        case 'institute':
          return structureApi.deleteInstitute(deleteTarget.entity.id);
        case 'building':
          return structureApi.deleteBuilding(deleteTarget.entity.id);
        case 'room':
          return structureApi.deleteRoom(deleteTarget.entity.id);
        case 'equipment':
          return structureApi.deleteEquipment(deleteTarget.entity.id);
      }
    },
    onSuccess: () => {
      toast.success(t('admin.structure.delete_completed'));
      void qc.invalidateQueries({ queryKey: ['institutes'] });
      void qc.invalidateQueries({ queryKey: ['institute', 'public'] });
      // Eliminazione di room/building/institute si riflette ovunque le aule
      // sono elencate (Dashboard, Booking) e sul Display kiosk.
      void qc.invalidateQueries({ queryKey: ['rooms'] });
      void qc.invalidateQueries({ queryKey: ['public'] });
      setDeleteTarget(null);
    },
    onError: (err) => {
      setDeleteError(httpErrorMessage(err));
    },
  });

  const [params, setParams] = useSearchParams();
  const initialTab = params.get('tab');
  const [tab, setTab] = useState<StructureTab>(
    initialTab && STRUCTURE_VALID_TABS.includes(initialTab as StructureTab)
      ? (initialTab as StructureTab)
      : 'sedi',
  );
  const activeTab = STRUCTURE_TABS.find((td) => td.value === tab) ?? STRUCTURE_TABS[0];
  const ActiveIcon = activeTab.icon;
  const onSelectTab = (next: StructureTab) => {
    setTab(next);
    const np = new URLSearchParams(params);
    np.set('tab', next);
    setParams(np, { replace: true });
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <header className="space-y-1.5">
        <h1 className="font-display text-3xl font-medium">{t('admin.structure.title')}</h1>
        <p className="text-sm text-muted-foreground">{t('admin.structure.subtitle')}</p>
      </header>

      {/* Strip macro-tab in stile /admin/server-settings */}
      <div className="grid gap-2 rounded-xl border bg-muted/30 p-1.5 sm:grid-cols-2">
        {STRUCTURE_TABS.map((td) => {
          const Icon = td.icon;
          const isActive = td.value === tab;
          return (
            <button
              key={td.value}
              type="button"
              onClick={() => {
                onSelectTab(td.value);
              }}
              className={cn(
                'flex items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-center transition-all',
                isActive
                  ? 'bg-background shadow-xs ring-1 ring-border'
                  : 'text-muted-foreground hover:bg-background/60',
              )}
            >
              <Icon className={cn('h-4 w-4', isActive ? td.iconColor : '')} />
              <span className={cn('text-sm font-medium', isActive && 'text-foreground')}>
                {t(td.labelKey)}
              </span>
            </button>
          );
        })}
      </div>

      {/* Header descrittivo della tab attiva */}
      <Card>
        <CardContent className="flex items-center gap-3 p-4 sm:p-6">
          <div className={cn('rounded-lg p-2', activeTab.iconBg)}>
            <ActiveIcon className={cn('h-4 w-4', activeTab.iconColor)} />
          </div>
          <div className="space-y-0.5">
            <h2 className="font-display text-lg font-medium leading-tight">
              {t(activeTab.labelKey)}
            </h2>
            <p className="text-xs text-muted-foreground">{t(activeTab.descriptionKey)}</p>
          </div>
        </CardContent>
      </Card>

      {/* Contenuti per tab */}
      {tab === 'dotazioni' && <EquipmentTemplatesSection />}

      {tab === 'sedi' && (
        <div className="space-y-6">
          <div className="flex items-center justify-end">
            <Button
              onClick={() => {
                setInstituteDialog({ open: true, institute: null });
              }}
            >
              <Plus className="h-4 w-4" />
              {t('admin.structure.new_institute')}
            </Button>
          </div>

          {query.isLoading && (
            <div className="space-y-3">
              {[0, 1].map((i) => (
                <Skeleton key={i} className="h-40 w-full" />
              ))}
            </div>
          )}

          {!query.isLoading && (query.data?.institutes.length ?? 0) === 0 && (
            <Card>
              <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
                <Building2 className="h-10 w-10 text-muted-foreground" />
                <div>
                  <p className="font-medium">{t('admin.structure.no_institutes_title')}</p>
                  <p className="text-sm text-muted-foreground">
                    {t('admin.structure.no_institutes_subtitle')}
                  </p>
                </div>
                <Button
                  onClick={() => {
                    setInstituteDialog({ open: true, institute: null });
                  }}
                >
                  <Plus className="h-4 w-4" />
                  {t('admin.structure.create_institute')}
                </Button>
              </CardContent>
            </Card>
          )}

          {query.data?.institutes.map((institute) => (
            <InstituteCard
              key={institute.id}
              institute={institute}
              expandedBuildings={expandedBuildings}
              onToggleBuilding={toggleBuilding}
              onEditInstitute={() => {
                setInstituteDialog({ open: true, institute });
              }}
              onDeleteInstitute={() => {
                setDeleteError(null);
                setDeleteTarget({ kind: 'institute', entity: institute });
              }}
              onImportCsv={() => {
                setCsvDialog({ open: true, institute });
              }}
              onAddBuilding={() => {
                setBuildingDialog({ open: true, instituteId: institute.id, building: null });
              }}
              onEditBuilding={(b) => {
                setBuildingDialog({ open: true, instituteId: institute.id, building: b });
              }}
              onDeleteBuilding={(b) => {
                setDeleteError(null);
                setDeleteTarget({ kind: 'building', entity: b });
              }}
              onAddRoom={(b) => {
                setRoomDialog({ open: true, building: b, room: null });
              }}
              onEditRoom={(b, r) => {
                setRoomDialog({ open: true, building: b, room: r });
              }}
              onDeleteRoom={(r) => {
                setDeleteError(null);
                setDeleteTarget({ kind: 'room', entity: r });
              }}
              onAddEquipment={(r) => {
                setEquipmentDialog({ open: true, roomId: r.id, equipment: null });
              }}
              onEditEquipment={(r, e) => {
                setEquipmentDialog({ open: true, roomId: r.id, equipment: e });
              }}
              onDeleteEquipment={(e) => {
                setDeleteError(null);
                setDeleteTarget({ kind: 'equipment', entity: e });
              }}
              selectedRooms={selectedRooms}
              onToggleRoomSelected={toggleRoomSelected}
              onToggleAllRoomsInBuilding={toggleSelectAllRoomsInBuilding}
              selectedBuildings={selectedBuildings}
              onToggleBuildingSelected={toggleBuildingSelected}
            />
          ))}
        </div>
      )}

      <InstituteFormDialog
        open={instituteDialog.open}
        onOpenChange={(o) => {
          setInstituteDialog((s) => ({ ...s, open: o }));
        }}
        institute={instituteDialog.institute}
      />
      {buildingDialog.instituteId !== null && (
        <BuildingFormDialog
          open={buildingDialog.open}
          onOpenChange={(o) => {
            setBuildingDialog((s) => ({ ...s, open: o }));
          }}
          instituteId={buildingDialog.instituteId}
          building={buildingDialog.building}
        />
      )}
      {roomDialog.building && (
        <RoomFormDialog
          open={roomDialog.open}
          onOpenChange={(o) => {
            setRoomDialog((s) => ({ ...s, open: o }));
          }}
          building={roomDialog.building}
          room={roomDialog.room}
        />
      )}
      {equipmentDialog.roomId !== null && (
        <EquipmentFormDialog
          open={equipmentDialog.open}
          onOpenChange={(o) => {
            setEquipmentDialog((s) => ({ ...s, open: o }));
          }}
          roomId={equipmentDialog.roomId}
          equipment={equipmentDialog.equipment}
        />
      )}
      {csvDialog.institute && (
        <CsvImportDialog
          open={csvDialog.open}
          onOpenChange={(o) => {
            setCsvDialog((s) => ({ ...s, open: o }));
          }}
          instituteId={csvDialog.institute.id}
          instituteName={csvDialog.institute.name}
        />
      )}
      <ConfirmDeleteDialog
        open={!!deleteTarget}
        onOpenChange={(o) => {
          if (!o) {
            setDeleteTarget(null);
            setDeleteError(null);
          }
        }}
        title={
          deleteTarget?.kind === 'institute'
            ? t('admin.structure.delete_institute_title', { name: deleteTarget.entity.name })
            : deleteTarget?.kind === 'building'
              ? t('admin.structure.delete_building_title', { name: deleteTarget.entity.name })
              : deleteTarget?.kind === 'room'
                ? t('admin.structure.delete_room_title', { name: deleteTarget.entity.name })
                : deleteTarget?.kind === 'equipment'
                  ? t('admin.structure.delete_equipment_title', { name: deleteTarget.entity.name })
                  : t('admin.structure.delete_dialog_default_title')
        }
        description={t('admin.structure.delete_dialog_description')}
        loading={deleteMutation.isPending}
        error={deleteError}
        onConfirm={() => {
          deleteMutation.mutate();
        }}
      />
      <ConfirmDeleteDialog
        open={bulkConfirm}
        onOpenChange={(o) => {
          if (!o) {
            setBulkConfirm(false);
            setBulkError(null);
          }
        }}
        title={t(
          selectedRooms.size === 1
            ? 'admin.structure.delete_rooms_title_one'
            : 'admin.structure.delete_rooms_title_other',
          { count: selectedRooms.size },
        )}
        description={t('admin.structure.delete_rooms_description')}
        confirmLabel={t('admin.structure.delete_label', { count: selectedRooms.size })}
        loading={bulkDeleteMutation.isPending}
        error={bulkError}
        onConfirm={() => {
          bulkDeleteMutation.mutate();
        }}
      />

      <ConfirmDeleteDialog
        open={bulkBuildingsConfirm}
        onOpenChange={(o) => {
          if (!o) {
            setBulkBuildingsConfirm(false);
            setBulkBuildingsError(null);
          }
        }}
        title={t(
          selectedBuildings.size === 1
            ? 'admin.structure.delete_buildings_title_one'
            : 'admin.structure.delete_buildings_title_other',
          { count: selectedBuildings.size },
        )}
        description={t('admin.structure.delete_buildings_description', {
          count: selectedBuildings.size,
          rooms: buildingsSelectionSummary.rooms,
        })}
        confirmLabel={t('admin.structure.delete_label', { count: selectedBuildings.size })}
        loading={bulkDeleteBuildingsMutation.isPending}
        error={bulkBuildingsError}
        onConfirm={() => {
          bulkDeleteBuildingsMutation.mutate();
        }}
      />

      {/* Floating bulk action bar */}
      <AnimatePresence>
        {(selectedRooms.size > 0 || selectedBuildings.size > 0) && (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 16 }}
            transition={{ duration: 0.18 }}
            className="fixed inset-x-0 bottom-6 z-30 flex justify-center px-4"
          >
            <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-primary/30 bg-card/95 px-5 py-3 shadow-2xl backdrop-blur-sm sm:rounded-full">
              {selectedBuildings.size > 0 && (
                <>
                  <p className="text-sm">
                    {t(
                      selectedBuildings.size === 1
                        ? 'admin.structure.buildings_selected_one'
                        : 'admin.structure.buildings_selected_other',
                      { count: selectedBuildings.size },
                    )}
                  </p>
                  <Button variant="ghost" size="sm" onClick={clearBuildingSelection}>
                    <X className="h-4 w-4" />
                    {t('admin.structure.deselect')}
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => {
                      setBulkBuildingsError(null);
                      setBulkBuildingsConfirm(true);
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                    {t('admin.structure.delete_buildings_selected')}
                  </Button>
                </>
              )}
              {selectedRooms.size > 0 && selectedBuildings.size > 0 && (
                <span className="hidden h-6 w-px bg-border sm:block" />
              )}
              {selectedRooms.size > 0 && (
                <>
                  <p className="text-sm">
                    {t(
                      selectedRooms.size === 1
                        ? 'admin.structure.rooms_selected_one'
                        : 'admin.structure.rooms_selected_other',
                      { count: selectedRooms.size },
                    )}
                  </p>
                  <Button variant="ghost" size="sm" onClick={clearSelection}>
                    <X className="h-4 w-4" />
                    {t('admin.structure.deselect')}
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => {
                      setBulkError(null);
                      setBulkConfirm(true);
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                    {t('admin.structure.delete_selected')}
                  </Button>
                </>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

interface InstituteCardProps {
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

function InstituteCard({
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
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = `struttura-${institute.code ?? institute.id}-${new Date().toISOString().slice(0, 10)}.csv`;
                  document.body.appendChild(a);
                  a.click();
                  document.body.removeChild(a);
                  URL.revokeObjectURL(url);
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

function RoomRow({
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
