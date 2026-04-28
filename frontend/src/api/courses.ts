import { api } from '@/lib/api';
import type { Course, CourseLevel } from '@/types';

export interface UpsertCoursePayload {
  code: string;
  name: string;
  department?: string | null;
  levels: CourseLevel[];
  description?: string | null;
  isActive: boolean;
}

export const coursesApi = {
  list: (opts: { active?: boolean } = {}) =>
    api<{ courses: Course[] }>('/api/courses', {
      query: { active: opts.active ?? true },
      auth: false,
    }),

  listAll: () =>
    api<{ courses: Course[] }>('/api/courses', { query: { active: false }, auth: false }),

  create: (payload: UpsertCoursePayload) =>
    api<{ course: Course }>('/api/courses', { method: 'POST', body: payload }),

  update: (id: number, payload: Partial<UpsertCoursePayload>) =>
    api<{ course: Course }>(`/api/courses/${id}`, { method: 'PUT', body: payload }),

  remove: (id: number) => api<{ message: string }>(`/api/courses/${id}`, { method: 'DELETE' }),

  bulkDelete: (ids: number[]) =>
    api<{ deleted: number }>('/api/courses/bulk-delete', {
      method: 'POST',
      body: { ids },
    }),

  importCsv: (csv: string) =>
    api<{
      result: {
        rowsTotal: number;
        created: number;
        updated: number;
        errors: { row: number; message: string }[];
      };
    }>('/api/courses/import', {
      method: 'POST',
      body: { csv },
    }),

  /** Esporta i corsi (SAD + denominazione + flag attivo) in CSV. */
  exportCsvUrl: () => '/api/courses/export.csv',
};

export const COURSE_LEVELS: { value: CourseLevel; label: string }[] = [
  { value: 'propedeutico', label: 'Propedeutico' },
  { value: 'triennio', label: 'Triennio' },
  { value: 'biennio', label: 'Biennio' },
  { value: 'master', label: 'Master' },
  { value: 'altro', label: 'Altro' },
];
