import { motion } from 'framer-motion';
import { Building2, Home, Music2, Pencil, Trash2 } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { EQUIPMENT_TYPE_OPTIONS } from '@/api/structure';
import { institutesApi } from '@/api/institutes';
import { ROOM_TYPE_LABEL } from '@/lib/bookings';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import type { BookingQuota, Role } from '@/types';
import { qk } from '@/lib/queryKeys';
// =====================================================
// Card raggruppata per ruolo: header con conteggio + griglia di QuotaCard
// =====================================================
export function RoleQuotaGroup({
  role,
  quotas,
  onEdit,
  onDelete,
}: {
  role: Role;
  quotas: BookingQuota[];
  onEdit: (q: BookingQuota) => void;
  onDelete: (q: BookingQuota) => void;
}) {
  const { t } = useTranslation();
  const activeCount = quotas.filter((q) => q.isActive).length;
  return (
    <Card>
      <CardContent className="space-y-3 p-4 sm:p-6">
        <div className="flex items-center justify-between border-b pb-2">
          <h3 className="font-display text-base font-medium">{t(`admin.quotas.role.${role}`)}</h3>
          <span className="text-xs text-muted-foreground tabular-nums">
            {activeCount}/{quotas.length} {t('admin.quotas.active_count')}
          </span>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {quotas.map((q) => (
            <QuotaCard key={q.id} quota={q} onEdit={onEdit} onDelete={onDelete} />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function QuotaCard({
  quota,
  onEdit,
  onDelete,
}: {
  quota: BookingQuota;
  onEdit: (q: BookingQuota) => void;
  onDelete: (q: BookingQuota) => void;
}) {
  const { t } = useTranslation();
  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn(
        'group flex flex-col gap-2 rounded-lg border bg-background p-3 transition-colors hover:border-primary/40',
        !quota.isActive && 'opacity-60',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-1">
            <Badge variant="secondary" className="text-[10px]">
              {t(`admin.quotas.scope.${quota.scopeKind}`)}
            </Badge>
            {!quota.isActive && (
              <Badge variant="muted" className="text-[10px]">
                {t('admin.quotas.inactive')}
              </Badge>
            )}
          </div>
          <p className="truncate text-sm font-medium">
            <ScopeValueLabel quota={quota} />
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              onEdit(quota);
            }}
            title={t('common.edit')}
            className="h-7 w-7 p-0"
          >
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              onDelete(quota);
            }}
            className="h-7 w-7 p-0 text-destructive hover:bg-destructive/10 hover:text-destructive"
            title={t('common.delete')}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 border-t pt-2 text-xs">
        <div>
          <p className="text-muted-foreground">{t('admin.quotas.col_max_week')}</p>
          <p className="font-medium tabular-nums">
            {quota.maxHoursPerWeek > 0 ? `${quota.maxHoursPerWeek} h` : '—'}
          </p>
        </div>
        <div>
          <p className="text-muted-foreground">{t('admin.quotas.col_max_day')}</p>
          <p className="font-medium tabular-nums">
            {quota.maxHoursPerDay > 0 ? `${quota.maxHoursPerDay} h` : '—'}
          </p>
        </div>
      </div>
    </motion.div>
  );
}

// Mostra un'etichetta umana per scopeValue tenendo conto delle traduzioni
// dei tipi aula (room_types), elenco statico equipment, o id risolti dinamicamente
// per room/building.
function ScopeValueLabel({ quota }: { quota: BookingQuota }) {
  const { t } = useTranslation();

  // Per room/building serve il nome — query lazy una sola volta.
  const needsResolve = quota.scopeKind === 'room' || quota.scopeKind === 'building';
  const structureQuery = useQuery({
    queryKey: qk.structure.institutesFull(),
    queryFn: () => institutesApi.listFull(),
    staleTime: 5 * 60 * 1000,
    enabled: needsResolve,
  });

  if (quota.scopeKind === 'global') {
    return <span className="text-muted-foreground">{t('admin.quotas.scope_global_target')}</span>;
  }
  if (quota.scopeKind === 'roomType') {
    const labelKey = ROOM_TYPE_LABEL[quota.scopeValue as keyof typeof ROOM_TYPE_LABEL];
    return labelKey ? <span>{t(labelKey)}</span> : <span>{quota.scopeValue}</span>;
  }
  if (quota.scopeKind === 'room') {
    const id = Number(quota.scopeValue);
    const found = structureQuery.data?.institutes
      .flatMap((inst) => inst.buildings.flatMap((b) => b.rooms.map((r) => ({ ...r, b }))))
      .find((r) => r.id === id);
    return (
      <span className="inline-flex items-center gap-1">
        <Home className="h-3 w-3 text-muted-foreground" />
        {found ? `${found.b.name} · ${found.name}` : `Aula #${id}`}
      </span>
    );
  }
  if (quota.scopeKind === 'building') {
    const id = Number(quota.scopeValue);
    const found = structureQuery.data?.institutes
      .flatMap((inst) => inst.buildings)
      .find((b) => b.id === id);
    return (
      <span className="inline-flex items-center gap-1">
        <Building2 className="h-3 w-3 text-muted-foreground" />
        {found ? found.name : `Edificio #${id}`}
      </span>
    );
  }
  // equipmentType
  const opt = EQUIPMENT_TYPE_OPTIONS.find((o) => o.value === quota.scopeValue);
  return (
    <span className="inline-flex items-center gap-1">
      <Music2 className="h-3 w-3 text-muted-foreground" />
      {opt?.label ?? quota.scopeValue}
    </span>
  );
}
