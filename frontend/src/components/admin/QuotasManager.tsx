import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import {
  Building2,
  Filter,
  Gauge,
  Home,
  LoaderCircle,
  Music2,
  Pencil,
  Plus,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { quotasApi, type UpsertQuotaPayload } from '@/api/quotas';
import { EQUIPMENT_TYPE_OPTIONS, ROOM_TYPE_OPTIONS } from '@/api/structure';
import { institutesApi } from '@/api/institutes';
import { httpErrorMessage } from '@/lib/api';
import { ROOM_TYPE_LABEL } from '@/lib/bookings';
import { cn } from '@/lib/utils';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { FieldError } from '@/components/ui/field-error';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ConfirmDeleteDialog } from '@/components/admin/ConfirmDeleteDialog';
import type { BookingQuota, QuotaScopeKind, Role } from '@/types';

const ROLES: Role[] = ['admin', 'docente', 'studente'];
const SCOPE_KINDS: QuotaScopeKind[] = ['roomType', 'equipmentType', 'room', 'building', 'global'];
const TIME_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;

const schema = z
  .object({
    role: z.enum(['admin', 'docente', 'studente']),
    scopeKind: z.enum(['roomType', 'equipmentType', 'room', 'building', 'global']),
    scopeValue: z.string().optional(),
    maxHoursPerWeek: z.number().int().min(0).max(168),
    maxHoursPerDay: z.number().int().min(0).max(24),
    maxHoursPerMonth: z.number().int().min(0).max(744),
    maxBookings: z.number().int().min(0).max(999),
    daysOfWeek: z.array(z.number().int().min(0).max(6)),
    timeFrom: z.string().regex(TIME_REGEX, 'time_format').or(z.literal('')).optional(),
    timeTo: z.string().regex(TIME_REGEX, 'time_format').or(z.literal('')).optional(),
    isActive: z.boolean(),
  })
  .refine(
    (d) =>
      d.maxHoursPerWeek > 0 || d.maxHoursPerDay > 0 || d.maxHoursPerMonth > 0 || d.maxBookings > 0,
    { path: ['maxHoursPerWeek'], message: 'cap_required' },
  )
  .refine((d) => d.scopeKind === 'global' || (d.scopeValue && d.scopeValue.trim().length > 0), {
    path: ['scopeValue'],
    message: 'scope_required',
  })
  .refine((d) => (d.timeFrom && d.timeTo) ?? (!d.timeFrom && !d.timeTo), {
    path: ['timeTo'],
    message: 'time_pair',
  })
  .refine((d) => !d.timeFrom || !d.timeTo || d.timeFrom < d.timeTo, {
    path: ['timeTo'],
    message: 'time_order',
  });

type FormValues = z.infer<typeof schema>;

const DEFAULT_FORM: FormValues = {
  role: 'studente',
  scopeKind: 'roomType',
  scopeValue: '',
  maxHoursPerWeek: 4,
  maxHoursPerDay: 2,
  maxHoursPerMonth: 0,
  maxBookings: 0,
  daysOfWeek: [],
  timeFrom: '',
  timeTo: '',
  isActive: true,
};

export function QuotasManager() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [editing, setEditing] = useState<BookingQuota | null>(null);
  const [open, setOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<BookingQuota | null>(null);
  const [filterActiveOnly, setFilterActiveOnly] = useState(false);

  const query = useQuery({
    queryKey: ['quotas'],
    queryFn: () => quotasApi.list(),
    staleTime: 30_000,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => quotasApi.remove(id),
    onSuccess: () => {
      toast.success(t('admin.quotas.deleted'));
      void qc.invalidateQueries({ queryKey: ['quotas'] });
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

// =====================================================
// Card raggruppata per ruolo: header con conteggio + griglia di QuotaCard
// =====================================================
function RoleQuotaGroup({
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
    queryKey: ['structure', 'institutes', 'full'],
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

function QuotaFormDialog({
  open,
  onOpenChange,
  quota,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  quota: BookingQuota | null;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const isEdit = !!quota;

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: DEFAULT_FORM,
    values: quota
      ? {
          role: quota.role,
          scopeKind: quota.scopeKind,
          scopeValue: quota.scopeKind === 'global' ? '' : quota.scopeValue,
          maxHoursPerWeek: quota.maxHoursPerWeek,
          maxHoursPerDay: quota.maxHoursPerDay,
          maxHoursPerMonth: quota.maxHoursPerMonth,
          maxBookings: quota.maxBookings,
          daysOfWeek: quota.daysOfWeek,
          timeFrom: quota.timeFrom ?? '',
          timeTo: quota.timeTo ?? '',
          isActive: quota.isActive,
        }
      : undefined,
  });
  const scopeKind = form.watch('scopeKind');

  // Carico la struttura (edifici + aule) solo quando il dialog è aperto e
  // lo scope richiede un picker dinamico (room/building).
  const needsStructure = open && (scopeKind === 'room' || scopeKind === 'building');
  const structureQuery = useQuery({
    queryKey: ['structure', 'institutes', 'full'],
    queryFn: () => institutesApi.listFull(),
    staleTime: 5 * 60 * 1000,
    enabled: needsStructure,
  });

  // Flatten dei buildings/rooms per i Select dinamici.
  const allBuildings = (structureQuery.data?.institutes ?? []).flatMap((inst) =>
    inst.buildings.map((b) => ({
      id: b.id,
      label: `${inst.name} · ${b.name}`,
    })),
  );
  const allRooms = (structureQuery.data?.institutes ?? []).flatMap((inst) =>
    inst.buildings.flatMap((b) =>
      b.rooms.map((r) => ({
        id: r.id,
        label: `${b.name} · ${r.name}`,
      })),
    ),
  );

  const submitMutation = useMutation({
    mutationFn: (values: FormValues) => {
      const payload: UpsertQuotaPayload = {
        role: values.role,
        scopeKind: values.scopeKind,
        scopeValue: values.scopeKind === 'global' ? '*' : (values.scopeValue ?? '').trim(),
        maxHoursPerWeek: values.maxHoursPerWeek,
        maxHoursPerDay: values.maxHoursPerDay,
        maxHoursPerMonth: values.maxHoursPerMonth,
        maxBookings: values.maxBookings,
        daysOfWeek: values.daysOfWeek,
        timeFrom: values.timeFrom ?? null,
        timeTo: values.timeTo ?? null,
        isActive: values.isActive,
      };
      return isEdit ? quotasApi.update(quota.id, payload) : quotasApi.create(payload);
    },
    onSuccess: () => {
      toast.success(isEdit ? t('admin.quotas.updated') : t('admin.quotas.created'));
      void qc.invalidateQueries({ queryKey: ['quotas'] });
      onOpenChange(false);
    },
    onError: (err) => toast.error(httpErrorMessage(err)),
  });

  // Helper testo errore su zod refine custom (chiavi i18n locali)
  const tFieldError = (key?: string) => {
    if (!key) return undefined;
    if (key === 'cap_required') return t('admin.quotas.errors.cap_required');
    if (key === 'scope_required') return t('admin.quotas.errors.scope_required');
    return key;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? t('admin.quotas.edit_title') : t('admin.quotas.new_title')}
          </DialogTitle>
          <DialogDescription>{t('admin.quotas.dialog_help')}</DialogDescription>
        </DialogHeader>

        <form
          onSubmit={form.handleSubmit((v) => {
            submitMutation.mutate(v);
          })}
          className="space-y-4"
          noValidate
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>{t('admin.quotas.field.role')}</Label>
              <Select
                value={form.watch('role')}
                onValueChange={(v) => {
                  form.setValue('role', v as Role);
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ROLES.map((r) => (
                    <SelectItem key={r} value={r}>
                      {t(`admin.quotas.role.${r}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label className="inline-flex items-center gap-1">
                <Sparkles className="h-3.5 w-3.5 text-muted-foreground" />
                {t('admin.quotas.field.scope')}
              </Label>
              <Select
                value={scopeKind}
                onValueChange={(v) => {
                  form.setValue('scopeKind', v as QuotaScopeKind);
                  form.setValue('scopeValue', '');
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SCOPE_KINDS.map((k) => (
                    <SelectItem key={k} value={k}>
                      {t(`admin.quotas.scope.${k}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {scopeKind !== 'global' && (
            <div className="space-y-2">
              <Label>{t('admin.quotas.field.target')}</Label>
              <Select
                value={form.watch('scopeValue') ?? ''}
                onValueChange={(v) => {
                  form.setValue('scopeValue', v, { shouldValidate: true });
                }}
                disabled={
                  (scopeKind === 'room' || scopeKind === 'building') && structureQuery.isLoading
                }
              >
                <SelectTrigger
                  aria-invalid={!!form.formState.errors.scopeValue}
                  aria-describedby={form.formState.errors.scopeValue ? 'q-scope-error' : undefined}
                >
                  <SelectValue placeholder={t('common.select_placeholder')} />
                </SelectTrigger>
                <SelectContent>
                  {scopeKind === 'roomType' &&
                    ROOM_TYPE_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {t(ROOM_TYPE_LABEL[o.value])}
                      </SelectItem>
                    ))}
                  {scopeKind === 'equipmentType' &&
                    EQUIPMENT_TYPE_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  {scopeKind === 'room' &&
                    allRooms.map((r) => (
                      <SelectItem key={r.id} value={String(r.id)}>
                        {r.label}
                      </SelectItem>
                    ))}
                  {scopeKind === 'building' &&
                    allBuildings.map((b) => (
                      <SelectItem key={b.id} value={String(b.id)}>
                        {b.label}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
              <FieldError id="q-scope-error">
                {form.formState.errors.scopeValue &&
                  tFieldError(form.formState.errors.scopeValue.message)}
              </FieldError>
            </div>
          )}

          {/* Cap orari (settimana, giorno, mese) */}
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="q-week">{t('admin.quotas.field.max_week')}</Label>
              <Input
                id="q-week"
                type="number"
                min={0}
                max={168}
                {...form.register('maxHoursPerWeek', { valueAsNumber: true })}
              />
              <p className="text-[11px] text-muted-foreground">
                {t('admin.quotas.field.zero_disables')}
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="q-day">{t('admin.quotas.field.max_day')}</Label>
              <Input
                id="q-day"
                type="number"
                min={0}
                max={24}
                {...form.register('maxHoursPerDay', { valueAsNumber: true })}
              />
              <p className="text-[11px] text-muted-foreground">
                {t('admin.quotas.field.zero_disables')}
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="q-month">{t('admin.quotas.field.max_month')}</Label>
              <Input
                id="q-month"
                type="number"
                min={0}
                max={744}
                {...form.register('maxHoursPerMonth', { valueAsNumber: true })}
              />
              <p className="text-[11px] text-muted-foreground">
                {t('admin.quotas.field.zero_disables')}
              </p>
            </div>
          </div>

          {/* Cap numerico (count prenotazioni) */}
          <div className="space-y-2">
            <Label htmlFor="q-count">{t('admin.quotas.field.max_bookings')}</Label>
            <Input
              id="q-count"
              type="number"
              min={0}
              max={999}
              {...form.register('maxBookings', { valueAsNumber: true })}
            />
            <p className="text-[11px] text-muted-foreground">
              {t('admin.quotas.field.max_bookings_help')}
            </p>
          </div>

          {form.formState.errors.maxHoursPerWeek?.message === 'cap_required' && (
            <p role="alert" className="text-xs text-destructive">
              {tFieldError('cap_required')}
            </p>
          )}

          {/* Filtri di applicabilità: giorni della settimana + fascia oraria */}
          <DaysOfWeekPicker
            value={form.watch('daysOfWeek')}
            onChange={(v) => {
              form.setValue('daysOfWeek', v, { shouldDirty: true });
            }}
          />

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="q-from">{t('admin.quotas.field.time_from')}</Label>
              <Input id="q-from" type="time" {...form.register('timeFrom')} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="q-to">{t('admin.quotas.field.time_to')}</Label>
              <Input
                id="q-to"
                type="time"
                {...form.register('timeTo')}
                aria-invalid={!!form.formState.errors.timeTo}
                aria-describedby={form.formState.errors.timeTo ? 'q-to-error' : undefined}
              />
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground">{t('admin.quotas.field.time_help')}</p>
          <FieldError id="q-to-error">
            {form.formState.errors.timeTo &&
              (form.formState.errors.timeTo.message === 'time_pair'
                ? t('admin.quotas.errors.time_pair')
                : form.formState.errors.timeTo.message === 'time_order'
                  ? t('admin.quotas.errors.time_order')
                  : t('admin.quotas.errors.time_format'))}
          </FieldError>

          <div className="flex items-center justify-between rounded-lg border p-3">
            <div>
              <p className="text-sm font-medium">{t('admin.quotas.field.active')}</p>
              <p className="text-xs text-muted-foreground">{t('admin.quotas.field.active_help')}</p>
            </div>
            <Switch
              checked={form.watch('isActive')}
              onCheckedChange={(v) => {
                form.setValue('isActive', v);
              }}
            />
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                onOpenChange(false);
              }}
              disabled={submitMutation.isPending}
            >
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={submitMutation.isPending}>
              {submitMutation.isPending ? (
                <LoaderCircle className="h-4 w-4 animate-spin" />
              ) : (
                t('common.save')
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// =====================================================
// Picker giorni della settimana — toggle multi-selezione (0=dom .. 6=sab).
// Array vuoto = "tutti i giorni" (semantica del backend), così l'utente
// non deve toggleare 7 giorni ogni volta.
// =====================================================
const DOW_LABELS: { value: number; label: string }[] = [
  { value: 1, label: 'Lun' },
  { value: 2, label: 'Mar' },
  { value: 3, label: 'Mer' },
  { value: 4, label: 'Gio' },
  { value: 5, label: 'Ven' },
  { value: 6, label: 'Sab' },
  { value: 0, label: 'Dom' },
];

function DaysOfWeekPicker({
  value,
  onChange,
}: {
  value: number[];
  onChange: (v: number[]) => void;
}) {
  const { t } = useTranslation();
  const toggle = (d: number) => {
    if (value.includes(d)) onChange(value.filter((x) => x !== d));
    else onChange([...value, d].sort());
  };
  return (
    <div className="space-y-2">
      <Label>{t('admin.quotas.field.days_of_week')}</Label>
      <div className="flex flex-wrap gap-1">
        {DOW_LABELS.map((d) => {
          const active = value.includes(d.value);
          return (
            <button
              key={d.value}
              type="button"
              onClick={() => {
                toggle(d.value);
              }}
              className={cn(
                'min-w-[44px] rounded-md border px-2.5 py-1 text-xs font-medium transition-colors',
                active
                  ? 'border-primary bg-primary/10 text-foreground'
                  : 'bg-background text-muted-foreground hover:border-primary/40',
              )}
            >
              {d.label}
            </button>
          );
        })}
      </div>
      <p className="text-[11px] text-muted-foreground">
        {t('admin.quotas.field.days_of_week_help')}
      </p>
    </div>
  );
}
