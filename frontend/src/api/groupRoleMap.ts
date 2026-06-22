import { api } from '@/lib/api';

export type CadenzaRole = 'admin' | 'docente' | 'studente';

export interface GroupRoleMapRule {
  groupId: string | null;
  groupDisplayName: string;
  role: CadenzaRole;
  priority: number;
}

export interface TenantGroup {
  id: string;
  displayName: string;
}

export interface GroupRoleMapResponse {
  rules: GroupRoleMapRule[];
  /** null se manca il consenso/credenziali Graph → la UI ricade su input testo libero. */
  tenantGroups: TenantGroup[] | null;
  ruoli: CadenzaRole[];
}

export type UserOverviewStato = 'allineato' | 'disallineato' | 'non_mappato';

export interface UserOverviewRow {
  email: string;
  nome: string;
  isActive: boolean;
  status: string;
  m365Groups: string[];
  role: CadenzaRole;
  roleRisolto: CadenzaRole | null;
  stato: UserOverviewStato;
}

export const groupRoleMapApi = {
  get: () => api<GroupRoleMapResponse>('/api/admin/group-role-map'),
  update: (rules: GroupRoleMapRule[]) =>
    api<{ rules: GroupRoleMapRule[] }>('/api/admin/group-role-map', {
      method: 'PUT',
      body: { rules },
    }),
};

export const usersOverviewApi = {
  list: () => api<{ users: UserOverviewRow[] }>('/api/admin/users-overview'),
  realign: (email: string) =>
    api<{ email: string; role: CadenzaRole; status: string }>('/api/admin/users-overview/realign', {
      method: 'POST',
      body: { email },
    }),
};
