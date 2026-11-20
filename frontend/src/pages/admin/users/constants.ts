import type { Role, UserStatus } from '@/types';

// I label di Role/Status sono ora chiavi i18n; risolvile con t() nel render.
export const ROLE_LABEL_KEY: Record<Role, string> = {
  admin: 'roles.admin_short',
  docente: 'roles.docente_short',
  studente: 'roles.studente_short',
};

export const ROLE_VARIANT: Record<Role, 'default' | 'secondary' | 'muted'> = {
  admin: 'default',
  docente: 'secondary',
  studente: 'muted',
};

export const STATUS_LABEL_KEY: Record<UserStatus, string> = {
  pending: 'user_status.pending',
  approved: 'user_status.approved',
  rejected: 'user_status.rejected',
};

export type UsersTab = 'users' | 'sso';
export const VALID_USERS_TABS: UsersTab[] = ['users', 'sso'];
