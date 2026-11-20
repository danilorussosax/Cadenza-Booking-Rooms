import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { Check, Clock, Pencil, ShieldCheck, ShieldX, Trash2, UserX, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Checkbox } from '@/components/ui/checkbox';
import { isAdminUser } from '@/lib/roles';

import { ROLE_LABEL_KEY, ROLE_VARIANT, STATUS_LABEL_KEY } from './constants';

import type { useUsersAdmin } from './useUsersAdmin';

type UsersAdmin = ReturnType<typeof useUsersAdmin>;

export function UsersTable({
  query,
  filtered,
  selected,
  currentUser,
  allSelected,
  someSelected,
  toggleAll,
  toggleOne,
  approveMutation,
  rejectMutation,
  setEditTarget,
  setDeleteError,
  setDeleteTarget,
}: Pick<
  UsersAdmin,
  | 'query'
  | 'filtered'
  | 'selected'
  | 'currentUser'
  | 'allSelected'
  | 'someSelected'
  | 'toggleAll'
  | 'toggleOne'
  | 'approveMutation'
  | 'rejectMutation'
  | 'setEditTarget'
  | 'setDeleteError'
  | 'setDeleteTarget'
>) {
  const { t } = useTranslation();
  return (
    <Card>
      {/* Tabella utenti scrollabile internamente: oltre i ~10 utenti
            visibili la lista scorre dentro il card senza far crescere la
            pagina (la sezione OAuth/Isidata in fondo resta sempre visibile).
            sticky thead per non perdere il riferimento delle colonne. */}
      <div className="max-h-[60vh] overflow-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10 border-b bg-muted/95 text-left text-xs uppercase tracking-wider text-muted-foreground backdrop-blur-sm supports-backdrop-filter:bg-muted/70">
            <tr>
              <th className="w-10 px-4 py-3">
                <Checkbox
                  checked={allSelected || (someSelected ? 'indeterminate' : false)}
                  onCheckedChange={(v) => {
                    toggleAll(v === true);
                  }}
                  aria-label={t('common.select')}
                />
              </th>
              <th className="px-4 py-3 font-medium">{t('admin.users.table.user')}</th>
              <th className="px-4 py-3 font-medium">{t('admin.users.table.role')}</th>
              <th className="px-4 py-3 font-medium">{t('admin.users.table.matricola')}</th>
              <th className="px-4 py-3 font-medium">{t('admin.users.table.course')}</th>
              <th className="px-4 py-3 font-medium">{t('admin.users.table.approval')}</th>
              <th className="px-4 py-3 font-medium">{t('admin.users.table.status')}</th>
              <th className="px-4 py-3 font-medium text-right">{t('admin.users.table.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {query.isLoading &&
              [0, 1, 2, 3].map((i) => (
                <tr key={i} className="border-b last:border-0">
                  <td className="px-4 py-3" colSpan={8}>
                    <Skeleton className="h-8 w-full" />
                  </td>
                </tr>
              ))}
            {!query.isLoading && filtered.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-12 text-center">
                  <UserX className="mx-auto mb-2 h-8 w-8 text-muted-foreground" />
                  <p className="text-sm font-medium">{t('admin.users.empty.title')}</p>
                  <p className="text-xs text-muted-foreground">{t('admin.users.empty.subtitle')}</p>
                </td>
              </tr>
            )}
            {filtered.map((u) => (
              <motion.tr
                key={u.id}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="border-b last:border-0"
              >
                <td className="px-4 py-3">
                  <Checkbox
                    checked={selected.has(u.id)}
                    onCheckedChange={(v) => {
                      toggleOne(u.id, v === true);
                    }}
                    disabled={u.id === currentUser?.id}
                    aria-label={t('common.select')}
                  />
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    <Avatar>
                      {u.profilePhotoUrl && <AvatarImage src={u.profilePhotoUrl} alt="" />}
                      <AvatarFallback className="bg-primary/10 text-primary text-xs">
                        {`${u.firstName[0]}${u.lastName[0]}`}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0">
                      <p className="truncate font-medium">
                        {u.firstName} {u.lastName}
                        {currentUser?.id === u.id && (
                          <span className="ml-2 text-[10px] uppercase text-primary">
                            {t('admin.users.you_label')}
                          </span>
                        )}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">{u.email}</p>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3">
                  <Badge variant={ROLE_VARIANT[u.role]}>
                    {isAdminUser(u) && <ShieldCheck className="mr-1 h-3 w-3" />}
                    {t(ROLE_LABEL_KEY[u.role])}
                  </Badge>
                </td>
                <td className="px-4 py-3 text-xs text-muted-foreground">{u.matricola ?? '—'}</td>
                <td className="px-4 py-3 text-xs text-muted-foreground">
                  {u.course ? `${u.course.code} — ${u.course.name}` : '—'}
                </td>
                <td className="px-4 py-3">
                  {isAdminUser(u) ? (
                    <Badge variant="success">
                      <ShieldCheck className="mr-1 h-3 w-3" />
                      {t(STATUS_LABEL_KEY.approved)}
                    </Badge>
                  ) : u.status === 'approved' ? (
                    <Badge variant="success">
                      <Check className="mr-1 h-3 w-3" />
                      {t(STATUS_LABEL_KEY.approved)}
                    </Badge>
                  ) : u.status === 'rejected' ? (
                    <Badge variant="muted" className="text-destructive">
                      <ShieldX className="mr-1 h-3 w-3" />
                      {t(STATUS_LABEL_KEY.rejected)}
                    </Badge>
                  ) : (
                    <Badge variant="secondary">
                      <Clock className="mr-1 h-3 w-3" />
                      {t(STATUS_LABEL_KEY.pending)}
                    </Badge>
                  )}
                </td>
                <td className="px-4 py-3">
                  <Badge variant={u.isActive ? 'success' : 'muted'}>
                    {u.isActive ? t('common.active') : t('common.inactive')}
                  </Badge>
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="inline-flex items-center gap-1">
                    {!isAdminUser(u) && u.status === 'pending' && (
                      <>
                        <Button
                          variant="ghost"
                          size="icon"
                          title={t('admin.users.approve')}
                          disabled={approveMutation.isPending}
                          onClick={() => {
                            approveMutation.mutate(u.id);
                          }}
                          className="text-emerald-600 hover:bg-emerald-50 hover:text-emerald-700 dark:text-emerald-400 dark:hover:bg-emerald-500/10"
                        >
                          <Check className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          title={t('admin.users.reject')}
                          disabled={rejectMutation.isPending}
                          onClick={() => {
                            rejectMutation.mutate(u.id);
                          }}
                          className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      title={t('common.edit')}
                      onClick={() => {
                        setEditTarget(u);
                      }}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      title={t('common.delete')}
                      disabled={currentUser?.id === u.id}
                      onClick={() => {
                        setDeleteError(null);
                        setDeleteTarget(u);
                      }}
                      className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </td>
              </motion.tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
