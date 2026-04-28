import { api } from '@/lib/api';
import type { Building, Equipment, Institute, PublicInstitute, Room } from '@/types';

export interface FullInstitute extends Institute {
  buildings: (Building & { rooms: (Room & { equipment: Equipment[] })[] })[];
}

export const institutesApi = {
  public: () =>
    api<{ institute: PublicInstitute | null }>('/api/structure/institutes/public', { auth: false }),

  listFull: () =>
    api<{ institutes: FullInstitute[] }>('/api/structure/institutes', {
      query: { full: true },
    }),
};
