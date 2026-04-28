import { api } from '@/lib/api';
import type { Role } from '@/types';

export type AudienceKind = 'all' | 'role' | 'course' | 'building';

export interface Audience {
  kind: AudienceKind;
  /** role | corso.id | building.id (assente per kind='all') */
  value?: Role | number;
}

export interface Announcement {
  id: number;
  title: string;
  body: string; // markdown light
  publishedAt: string;
  expiresAt: string | null;
  audience: Audience;
  isPinned: boolean;
  isActive?: boolean;
  emailSentAt?: string | null;
  createdBy?: number | null;
  author?: {
    id: number;
    firstName: string;
    lastName: string;
    email: string;
  } | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface UpsertAnnouncementPayload {
  title: string;
  body: string;
  publishedAt?: string;
  expiresAt?: string | null;
  audience: Audience;
  isPinned?: boolean;
  isActive?: boolean;
  /** Solo create: se true, dopo create lancia il broadcast email. */
  sendEmail?: boolean;
}

export const announcementsApi = {
  // User feed (autenticato): filtrato per audience match con il profilo.
  listMine: () => api<{ announcements: Announcement[] }>('/api/announcements'),

  // Admin
  listAll: (filters: { isActive?: boolean } = {}) =>
    api<{ announcements: Announcement[] }>('/api/admin/announcements', {
      query: filters,
    }),
  create: (payload: UpsertAnnouncementPayload) =>
    api<{ announcement: Announcement }>('/api/admin/announcements', {
      method: 'POST',
      body: payload,
    }),
  update: (id: number, payload: Partial<UpsertAnnouncementPayload>) =>
    api<{ announcement: Announcement }>(`/api/admin/announcements/${id}`, {
      method: 'PUT',
      body: payload,
    }),
  remove: (id: number, force = false) =>
    api<{ message: string }>(`/api/admin/announcements/${id}`, {
      method: 'DELETE',
      query: force ? { force: 'true' } : undefined,
    }),
  resendEmail: (id: number) =>
    api<{ message: string; sent?: number; recipients?: number; skipped?: string }>(
      `/api/admin/announcements/${id}/resend`,
      { method: 'POST' },
    ),

  // Pubblico (kiosk): nessun auth richiesto.
  listPublic: (params: { pinned?: boolean; building?: number; limit?: number } = {}) =>
    api<{ announcements: Announcement[] }>('/api/public/announcements', {
      auth: false,
      query: {
        pinned: params.pinned ? 'true' : undefined,
        building: params.building,
        limit: params.limit,
      },
    }),
};
