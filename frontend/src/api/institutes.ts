import { api } from '@/lib/api';
import type { Building, Equipment, Institute, PublicInstitute, Room } from '@/types';

export interface FullInstitute extends Institute {
  buildings: (Building & { rooms: (Room & { equipment: Equipment[] })[] })[];
}

/** Le colonne note vivono come campi tipizzati; l'index signature permette
 *  però di aggiungere/leggere nuovi moduli dinamici (es. `moduleBotEnabled`)
 *  senza dover patchare il client TypeScript. */
export interface ModuleSettings {
  moduleMonteOreEnabled: boolean;
  moduleInstrumentLoansEnabled: boolean;
  [moduleColumn: string]: boolean;
}

export const institutesApi = {
  public: () =>
    api<{ institute: PublicInstitute | null }>('/api/structure/institutes/public', { auth: false }),

  listFull: () =>
    api<{ institutes: FullInstitute[] }>('/api/structure/institutes', {
      query: { full: true },
    }),

  getModuleSettings: () => api<ModuleSettings>('/api/structure/module-settings'),

  updateModuleSettings: (body: Partial<ModuleSettings>) =>
    api<ModuleSettings>('/api/structure/module-settings', {
      method: 'PUT',
      body,
    }),

  /** Aggiorna i campi modificabili dell'istituto (admin-only). */
  update: (id: number, body: Record<string, unknown>) =>
    api<{ institute: Institute }>(`/api/structure/institutes/${id}`, {
      method: 'PUT',
      body,
    }),
};
