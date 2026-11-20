import { useTranslation } from 'react-i18next';
import { Search } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

import type { useUsersAdmin } from './useUsersAdmin';

type UsersAdmin = ReturnType<typeof useUsersAdmin>;

export function UsersFilters({
  search,
  setSearch,
  roleFilter,
  setRoleFilter,
  statusFilter,
  setStatusFilter,
  activeFilter,
  setActiveFilter,
}: Pick<
  UsersAdmin,
  | 'search'
  | 'setSearch'
  | 'roleFilter'
  | 'setRoleFilter'
  | 'statusFilter'
  | 'setStatusFilter'
  | 'activeFilter'
  | 'setActiveFilter'
>) {
  const { t } = useTranslation();
  return (
    <Card>
      <CardContent className="grid gap-3 p-4 sm:p-6 md:grid-cols-[1fr_auto_auto_auto] md:items-center">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
            }}
            placeholder={t('admin.users.search_placeholder')}
            className="pl-9"
          />
        </div>
        <Select value={roleFilter} onValueChange={setRoleFilter}>
          <SelectTrigger className="md:w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('admin.users.all_roles')}</SelectItem>
            <SelectItem value="admin">{t('roles.admin')}</SelectItem>
            <SelectItem value="docente">{t('roles.docente')}</SelectItem>
            <SelectItem value="studente">{t('roles.studente')}</SelectItem>
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="md:w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('admin.users.all_statuses')}</SelectItem>
            <SelectItem value="pending">{t('user_status.pending')}</SelectItem>
            <SelectItem value="approved">{t('user_status.approved')}</SelectItem>
            <SelectItem value="rejected">{t('user_status.rejected')}</SelectItem>
          </SelectContent>
        </Select>
        <Select value={activeFilter} onValueChange={setActiveFilter}>
          <SelectTrigger className="md:w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('admin.users.all_active')}</SelectItem>
            <SelectItem value="true">{t('admin.users.active_yes')}</SelectItem>
            <SelectItem value="false">{t('admin.users.active_no')}</SelectItem>
          </SelectContent>
        </Select>
      </CardContent>
    </Card>
  );
}
