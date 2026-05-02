import { api, tokenStore } from '@/lib/api';
import type {
  Building,
  Equipment,
  EquipmentTemplate,
  EquipmentType,
  Institute,
  Role,
  Room,
  RoomType,
} from '@/types';

export interface UpsertInstitutePayload {
  name: string;
  code?: string | null;
  address?: string | null;
  city?: string | null;
  country?: string | null;
  timezone?: string | null;
  description?: string | null;
  logoUrl?: string | null;
  copyright?: string | null;
}

export interface UpsertBuildingPayload {
  instituteId: number;
  name: string;
  code?: string | null;
  address?: string | null;
  floors?: string[];
  description?: string | null;
  displayEnabled?: boolean;
  displayIntervalSec?: number;
  displayConcertsDays?: number;
  displayConcertsEnabled?: boolean;
  displayConcertsCount?: number;
  displayConcertsIntervalSec?: number;
  displayBookingsEnabled?: boolean;
  displayAnnouncementsEnabled?: boolean;
  displayAnnouncementsCount?: number;
  displayAnnouncementsIntervalSec?: number;
  displayAnnouncementsPinnedOnly?: boolean;
}

export interface UpsertRoomPayload {
  buildingId: number;
  name: string;
  code?: string | null;
  floor: string;
  capacity: number;
  type: RoomType;
  allowedRoles: Role[];
  allowedCourseIds: number[];
  isBookable: boolean;
  requireCheckIn?: boolean;
  requiresApproval?: boolean;
  notes?: string | null;
}

export interface UpsertEquipmentPayload {
  roomId: number;
  name: string;
  type: EquipmentType;
  brand?: string | null;
  model?: string | null;
  quantity?: number;
  serialNumber?: string | null;
  notes?: string | null;
  isWorking: boolean;
}

export interface CsvImportPayload {
  instituteId: number;
  csv: string;
}

export interface CsvImportResult {
  rowsTotal: number;
  buildingsCreated: number;
  buildingsUpdated: number;
  roomsCreated: number;
  roomsUpdated: number;
  equipmentCreated: number;
  equipmentUpdated: number;
  errors: { row: number; message: string }[];
}

export const structureApi = {
  // Institutes
  createInstitute: (payload: UpsertInstitutePayload) =>
    api<{ institute: Institute }>('/api/structure/institutes', {
      method: 'POST',
      body: payload,
    }),
  updateInstitute: (id: number, payload: Partial<UpsertInstitutePayload>) =>
    api<{ institute: Institute }>(`/api/structure/institutes/${id}`, {
      method: 'PUT',
      body: payload,
    }),
  deleteInstitute: (id: number) =>
    api<{ message: string }>(`/api/structure/institutes/${id}`, { method: 'DELETE' }),

  uploadInstituteLogo: (id: number, file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    return api<{ institute: Institute; logoUrl: string }>(`/api/structure/institutes/${id}/logo`, {
      method: 'POST',
      body: fd,
    });
  },
  deleteInstituteLogo: (id: number) =>
    api<{ institute: Institute }>(`/api/structure/institutes/${id}/logo`, {
      method: 'DELETE',
    }),

  // Buildings
  createBuilding: (payload: UpsertBuildingPayload) =>
    api<{ building: Building }>('/api/structure/buildings', {
      method: 'POST',
      body: payload,
    }),
  updateBuilding: (id: number, payload: Partial<UpsertBuildingPayload>) =>
    api<{ building: Building }>(`/api/structure/buildings/${id}`, {
      method: 'PUT',
      body: payload,
    }),
  deleteBuilding: (id: number) =>
    api<{ message: string }>(`/api/structure/buildings/${id}`, { method: 'DELETE' }),
  bulkDeleteBuildings: (ids: number[]) =>
    api<{ deleted: number; removedRooms: number; removedBookings: number }>(
      '/api/structure/buildings/bulk-delete',
      { method: 'POST', body: { ids } },
    ),

  // Rooms
  createRoom: (payload: UpsertRoomPayload) =>
    api<{ room: Room }>('/api/structure/rooms', { method: 'POST', body: payload }),
  updateRoom: (id: number, payload: Partial<UpsertRoomPayload>) =>
    api<{ room: Room }>(`/api/structure/rooms/${id}`, { method: 'PUT', body: payload }),
  deleteRoom: (id: number) =>
    api<{ message: string }>(`/api/structure/rooms/${id}`, { method: 'DELETE' }),
  bulkDeleteRooms: (ids: number[]) =>
    api<{ deleted: number }>('/api/structure/rooms/bulk-delete', {
      method: 'POST',
      body: { ids },
    }),
  // QR per il check-in: PNG via fetch+blob (Bearer auth richiesto, non
  // esprimibile via <a href>). Il chiamante salva/stampa il blob.
  async downloadRoomQr(id: number): Promise<Blob> {
    const token = tokenStore.get();
    if (!token) throw new Error('Sessione scaduta');
    const res = await fetch(`/api/structure/rooms/${id}/qr`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      throw new Error(res.status === 401 ? 'Sessione scaduta' : `Errore ${res.status}`);
    }
    return res.blob();
  },

  uploadRoomPhoto: (id: number, file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    return api<{ room: Room; photoUrl: string }>(`/api/structure/rooms/${id}/photo`, {
      method: 'POST',
      body: fd,
    });
  },
  deleteRoomPhoto: (id: number) =>
    api<{ room: Room }>(`/api/structure/rooms/${id}/photo`, { method: 'DELETE' }),

  // Equipment
  createEquipment: (payload: UpsertEquipmentPayload) =>
    api<{ equipment: Equipment }>('/api/structure/equipment', {
      method: 'POST',
      body: payload,
    }),
  updateEquipment: (id: number, payload: Partial<UpsertEquipmentPayload>) =>
    api<{ equipment: Equipment }>(`/api/structure/equipment/${id}`, {
      method: 'PUT',
      body: payload,
    }),
  deleteEquipment: (id: number) =>
    api<{ message: string }>(`/api/structure/equipment/${id}`, { method: 'DELETE' }),

  // CSV import
  import: (payload: CsvImportPayload) =>
    api<{ result: CsvImportResult }>('/api/structure/import', {
      method: 'POST',
      body: payload,
    }),

  /** Esporta la struttura completa di un istituto in formato CSV (round-trip
   *  con import). Bearer richiesto, non passabile via <a href>: scarica il
   *  blob via fetch e lascia al chiamante l'attivazione del download. */
  async downloadCsv(instituteId: number): Promise<Blob> {
    const token = tokenStore.get();
    if (!token) throw new Error('Sessione scaduta');
    const res = await fetch(
      `/api/structure/export.csv?instituteId=${encodeURIComponent(instituteId)}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!res.ok) {
      throw new Error(res.status === 401 ? 'Sessione scaduta' : `Errore ${res.status}`);
    }
    return res.blob();
  },

  // Equipment templates (catalogo dotazioni)
  listEquipmentTemplates: () =>
    api<{ templates: EquipmentTemplate[] }>('/api/structure/equipment-templates'),
  createEquipmentTemplate: (payload: { name: string; type?: EquipmentType }) =>
    api<{ template: EquipmentTemplate }>('/api/structure/equipment-templates', {
      method: 'POST',
      body: payload,
    }),
  updateEquipmentTemplate: (id: number, payload: { name?: string; type?: EquipmentType }) =>
    api<{ template: EquipmentTemplate }>(`/api/structure/equipment-templates/${id}`, {
      method: 'PUT',
      body: payload,
    }),
  deleteEquipmentTemplate: (id: number) =>
    api<{ message: string }>(`/api/structure/equipment-templates/${id}`, { method: 'DELETE' }),
  bulkDeleteEquipmentTemplates: (ids: number[]) =>
    api<{ deleted: number }>('/api/structure/equipment-templates/bulk-delete', {
      method: 'POST',
      body: { ids },
    }),
  importEquipmentTemplates: (csv: string) =>
    api<{
      result: {
        rowsTotal: number;
        created: number;
        skipped: number;
        errors: { row: number; message: string }[];
      };
    }>('/api/structure/equipment-templates/import', {
      method: 'POST',
      body: { csv },
    }),
  /** Export catalogo dotazioni in CSV (round-trip con import). Bearer
   *  richiesto, non passabile via <a href>: scarica via fetch+blob. */
  async downloadEquipmentTemplatesCsv(): Promise<Blob> {
    const token = tokenStore.get();
    if (!token) throw new Error('Sessione scaduta');
    const res = await fetch('/api/structure/equipment-templates/export.csv', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      throw new Error(res.status === 401 ? 'Sessione scaduta' : `Errore ${res.status}`);
    }
    return res.blob();
  },
};

export const ROOM_TYPE_OPTIONS: { value: RoomType; label: string }[] = [
  { value: 'studio', label: 'Studio' },
  { value: 'sala_prove', label: 'Sala prove' },
  { value: 'aula_concerti', label: 'Sala concerti' },
  { value: 'classe', label: 'Classe' },
  { value: 'aula_didattica', label: 'Aula didattica' },
  { value: 'altro', label: 'Altro' },
];

export const EQUIPMENT_TYPE_OPTIONS: { value: EquipmentType; label: string }[] = [
  { value: 'pianoforte', label: 'Pianoforte' },
  { value: 'pianoforte_a_coda', label: 'Pianoforte a coda' },
  { value: 'organo', label: 'Organo' },
  { value: 'clavicembalo', label: 'Clavicembalo' },
  { value: 'leggio', label: 'Leggio' },
  { value: 'amplificatore', label: 'Amplificatore' },
  { value: 'mixer', label: 'Mixer' },
  { value: 'microfono', label: 'Microfono' },
  { value: 'computer', label: 'Computer' },
  { value: 'proiettore', label: 'Proiettore' },
  { value: 'lavagna', label: 'Lavagna' },
  { value: 'sedia', label: 'Sedia' },
  { value: 'altro', label: 'Altro' },
];
