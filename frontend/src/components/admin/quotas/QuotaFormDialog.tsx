import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { LoaderCircle, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { quotasApi } from '@/api/quotas';
import { EQUIPMENT_TYPE_OPTIONS, ROOM_TYPE_OPTIONS } from '@/api/structure';
import { institutesApi } from '@/api/institutes';
import { httpErrorMessage } from '@/lib/api';
import { ROOM_TYPE_LABEL } from '@/lib/bookings';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { FieldError } from '@/components/ui/field-error';
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
import type { BookingQuota, QuotaScopeKind, Role } from '@/types';
import { qk } from '@/lib/queryKeys';
import { invalidateQuotas } from '@/lib/invalidation';
import { DaysOfWeekPicker } from '@/components/admin/quotas/DaysOfWeekPicker';
import {
  DEFAULT_QUOTA_FORM,
  ROLES,
  SCOPE_KINDS,
  formValuesToPayload,
  quotaSchema,
  quotaToFormValues,
  type QuotaFormValues,
} from '@/components/admin/quotas/quotaForm';
export function QuotaFormDialog({
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

  const form = useForm<QuotaFormValues>({
    resolver: zodResolver(quotaSchema),
    defaultValues: DEFAULT_QUOTA_FORM,
    values: quota ? quotaToFormValues(quota) : undefined,
  });
  const scopeKind = form.watch('scopeKind');

  // Carico la struttura (edifici + aule) solo quando il dialog è aperto e
  // lo scope richiede un picker dinamico (room/building).
  const needsStructure = open && (scopeKind === 'room' || scopeKind === 'building');
  const structureQuery = useQuery({
    queryKey: qk.structure.institutesFull(),
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
    mutationFn: (values: QuotaFormValues) => {
      const payload = formValuesToPayload(values);
      return isEdit ? quotasApi.update(quota.id, payload) : quotasApi.create(payload);
    },
    onSuccess: () => {
      toast.success(isEdit ? t('admin.quotas.updated') : t('admin.quotas.created'));
      void invalidateQuotas(qc);
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
