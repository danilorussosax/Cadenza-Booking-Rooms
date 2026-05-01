import { api } from '@/lib/api';
import type { BookingTypeCatalog } from '@/types';

export interface BookingTypeUpdatePayload {
  label?: string;
  color?: string;
  icon?: string;
  sortOrder?: number;
  isActive?: boolean;
  defaultDurationMinutes?: number | null;
  description?: string | null;
}

export const bookingTypesApi = {
  /**
   * Lista pubblica (auth-required) dei tipi attivi. Ordinati per sortOrder.
   * Usato dal BookingFormDialog per popolare la dropdown.
   */
  list: () => api<{ types: BookingTypeCatalog[] }>('/api/booking-types'),

  /**
   * Lista admin (TUTTI: anche disattivati). Ordinati per sortOrder.
   */
  listAdmin: () => api<{ types: BookingTypeCatalog[] }>('/api/admin/booking-types'),

  /**
   * Aggiorna un tipo identificato per `code`. Body: subset di campi editabili.
   * Restituisce la versione aggiornata.
   */
  update: (code: string, payload: BookingTypeUpdatePayload) =>
    api<{ type: BookingTypeCatalog }>(`/api/admin/booking-types/${code}`, {
      method: 'PUT',
      body: payload,
    }),
};
