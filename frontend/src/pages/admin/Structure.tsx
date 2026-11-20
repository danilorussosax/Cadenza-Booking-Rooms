import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Building2, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { institutesApi } from '@/api/institutes';
import { structureApi } from '@/api/structure';
import { httpErrorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { EquipmentTemplatesSection } from '@/components/admin/EquipmentTemplatesSection';
import { InstituteFormDialog } from '@/components/admin/InstituteFormDialog';
import { BuildingFormDialog } from '@/components/admin/BuildingFormDialog';
import { RoomFormDialog } from '@/components/admin/RoomFormDialog';
import { EquipmentFormDialog } from '@/components/admin/EquipmentFormDialog';
import { CsvImportDialog } from '@/components/admin/CsvImportDialog';
import { ConfirmDeleteDialog } from '@/components/admin/ConfirmDeleteDialog';
import type { Building, Equipment, Institute, Room } from '@/types';
import { qk } from '@/lib/queryKeys';
import { invalidateStructure, invalidateStructureDeleted } from '@/lib/invalidation';

import { toggleSetItem } from '@/lib/setToggle';
import { BulkActionBar } from '@/pages/admin/structure/BulkActionBar';
import { InstituteCard } from '@/pages/admin/structure/InstituteCard';
import {
  STRUCTURE_TABS,
  STRUCTURE_VALID_TABS,
  type StructureTab,
} from '@/pages/admin/structure/structureTabs';
import { useStructureSelection } from '@/pages/admin/structure/useStructureSelection';

type DeleteTarget =
  | { kind: 'institute'; entity: Institute }
  | { kind: 'building'; entity: Building }
  | { kind: 'room'; entity: Room }
  | { kind: 'equipment'; entity: Equipment }
  | null;

export default function AdminStructure() {
  const qc = useQueryClient();
  const { t } = useTranslation();
  const query = useQuery({
    queryKey: qk.institutes.full(),
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

  const {
    selectedRooms,
    toggleRoomSelected,
    toggleSelectAllRoomsInBuilding,
    clearSelection,
    selectedBuildings,
    toggleBuildingSelected,
    clearBuildingSelection,
    buildingsSelectionSummary,
  } = useStructureSelection(query.data?.institutes);

  const [bulkConfirm, setBulkConfirm] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [bulkBuildingsConfirm, setBulkBuildingsConfirm] = useState(false);
  const [bulkBuildingsError, setBulkBuildingsError] = useState<string | null>(null);

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
      void invalidateStructure(qc);
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
      void invalidateStructure(qc);
      setBulkBuildingsConfirm(false);
      clearBuildingSelection();
    },
    onError: (err) => {
      setBulkBuildingsError(httpErrorMessage(err));
    },
  });

  const toggleBuilding = (id: number) => {
    setExpandedBuildings((prev) => toggleSetItem(prev, id));
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
      void invalidateStructureDeleted(qc);
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

      <BulkActionBar
        roomsCount={selectedRooms.size}
        buildingsCount={selectedBuildings.size}
        onClearBuildings={clearBuildingSelection}
        onDeleteBuildings={() => {
          setBulkBuildingsError(null);
          setBulkBuildingsConfirm(true);
        }}
        onClearRooms={clearSelection}
        onDeleteRooms={() => {
          setBulkError(null);
          setBulkConfirm(true);
        }}
      />
    </div>
  );
}
