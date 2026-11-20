import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Filter, Gauge, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { quotasApi } from '@/api/quotas';
import { httpErrorMessage } from '@/lib/api';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { ConfirmDeleteDialog } from '@/components/admin/ConfirmDeleteDialog';
import type { BookingQuota, Role } from '@/types';
import { qk } from '@/lib/queryKeys';
import { invalidateQuotas } from '@/lib/invalidation';
import { RoleQuotaGroup } from '@/components/admin/quotas/QuotaCards';
import { QuotaFormDialog } from '@/components/admin/quotas/QuotaFormDialog';

export function QuotasManager() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [editing, setEditing] = useState<BookingQuota | null>(null);
  const [open, setOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<BookingQuota | null>(null);
  const [filterActiveOnly, setFilterActiveOnly] = useState(false);

  const query = useQuery({
    queryKey: qk.quotas.all(),
    queryFn: () => quotasApi.list(),
    staleTime: 30_000,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => quotasApi.remove(id),
    onSuccess: () => {
      toast.success(t('admin.quotas.deleted'));
      void invalidateQuotas(qc);
      setConfirmDelete(null);
    },
    onError: (err) => toast.error(httpErrorMessage(err)),
  });

  const openNew = () => {
    setEditing(null);
    setOpen(true);
  };
  const openEdit = (q: BookingQuota) => {
    setEditing(q);
    setOpen(true);
  };

  const allQuotas = query.data?.quotas ?? [];
  const visibleQuotas = filterActiveOnly ? allQuotas.filter((q) => q.isActive) : allQuotas;
  const byRole: Record<Role, BookingQuota[]> = { admin: [], docente: [], studente: [] };
  for (const q of visibleQuotas) byRole[q.role].push(q);

  return (
    <div className="space-y-4">
      <Alert variant="info">
        <AlertDescription className="text-xs">{t('admin.quotas.help')}</AlertDescription>
      </Alert>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-xl font-medium">{t('admin.quotas.title')}</h2>
        <div className="flex items-center gap-2">
          {/* Filtro rapido "solo attive" — UX intuitiva, niente CRUD ulteriore */}
          {allQuotas.length > 0 && (
            <Button
              type="button"
              variant={filterActiveOnly ? 'default' : 'outline'}
              size="sm"
              onClick={() => {
                setFilterActiveOnly((s) => !s);
              }}
            >
              <Filter className="h-3.5 w-3.5" />
              {filterActiveOnly
                ? t('admin.quotas.filter.only_active')
                : t('admin.quotas.filter.show_all')}
            </Button>
          )}
          <Button type="button" onClick={openNew}>
            <Plus className="h-4 w-4" />
            {t('admin.quotas.new')}
          </Button>
        </div>
      </div>

      {query.isLoading && (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      )}

      {!query.isLoading && allQuotas.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
            <Gauge className="h-10 w-10 text-muted-foreground" />
            <p className="font-medium">{t('admin.quotas.empty_title')}</p>
            <p className="text-sm text-muted-foreground">{t('admin.quotas.empty_subtitle')}</p>
          </CardContent>
        </Card>
      )}

      {!query.isLoading && allQuotas.length > 0 && (
        <div className="space-y-4">
          {(['studente', 'docente', 'admin'] as Role[]).map((role) => {
            const items = byRole[role];
            if (items.length === 0) return null;
            return (
              <RoleQuotaGroup
                key={role}
                role={role}
                quotas={items}
                onEdit={openEdit}
                onDelete={(q) => {
                  setConfirmDelete(q);
                }}
              />
            );
          })}
        </div>
      )}

      <QuotaFormDialog open={open} onOpenChange={setOpen} quota={editing} />

      <ConfirmDeleteDialog
        open={!!confirmDelete}
        onOpenChange={(o) => !o && setConfirmDelete(null)}
        title={t('admin.quotas.delete_title')}
        description={t('admin.quotas.delete_description')}
        onConfirm={() => confirmDelete && deleteMutation.mutate(confirmDelete.id)}
        loading={deleteMutation.isPending}
      />
    </div>
  );
}
