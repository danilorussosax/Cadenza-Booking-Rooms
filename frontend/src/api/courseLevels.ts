import { api } from '@/lib/api';
import type { CourseLevelEntity } from '@/types';

export interface UpsertCourseLevelPayload {
  code: string;
  name: string;
  sortOrder?: number;
}

export const courseLevelsApi = {
  list: () => api<{ levels: CourseLevelEntity[] }>('/api/course-levels', { auth: false }),

  create: (payload: UpsertCourseLevelPayload) =>
    api<{ level: CourseLevelEntity }>('/api/course-levels', {
      method: 'POST',
      body: payload,
    }),

  update: (id: number, payload: Partial<UpsertCourseLevelPayload>) =>
    api<{ level: CourseLevelEntity }>(`/api/course-levels/${id}`, {
      method: 'PUT',
      body: payload,
    }),

  remove: (id: number) =>
    api<{ message: string }>(`/api/course-levels/${id}`, { method: 'DELETE' }),

  bulkDelete: (ids: number[]) =>
    api<{ deleted: number }>('/api/course-levels/bulk-delete', {
      method: 'POST',
      body: { ids },
    }),
};
