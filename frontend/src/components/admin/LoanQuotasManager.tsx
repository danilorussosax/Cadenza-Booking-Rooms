import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import {
  CalendarClock,
  Filter,
  LoaderCircle,
  Music2,
  Package,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import {
  loanQuotasApi,
  INSTRUMENT_FAMILY_OPTIONS,
  type InstrumentLoanQuota,
  type LoanQuotaScopeKind,
  type UpsertLoanQuotaPayload,
} from '@/api/loanQuotas';
import { instrumentsApi } from '@/api/instruments';
import { httpErrorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
import type { Role } from '@/types';

const ROLES: Role[] = ['admin', 'docente', 'studente'];
const SCOPE_KINDS: LoanQuotaScopeKind[] = ['family', 'instrument', 'global'];

const schema = z
  .object({
    role: z.enum(['admin', 'docente', 'studente']),
    scopeKind: z.enum(['family', 'instrument', 'global']),
    scopeValue: z.string().optional(),
    maxConcurrent: z.coerce.number().int().min(0).max(99),
    maxDaysPerYear: z.coerce.number().int().min(0).max(366),
    isActive: z.boolean(),
  })
  .refine((d) => d.maxConcurrent > 0 || d.maxDaysPerYear > 0, {
    path: ['maxConcurrent'],
    message: 'cap_required',
  })
  .refine((d) => d.scopeKind === 'global' || (d.scopeValue && d.scopeValue.trim().length > 0), {
    path: ['scopeValue'],
    message: 'scope_required',
  });

type FormValues = z.infer<typeof schema>;

const DEFAULT_FORM: FormValues = {
  role: 'studente',
  scopeKind: 'family',
  scopeValue: '',
  maxConcurrent: 1,
  maxDaysPerYear: 60,
  isActive: true,
};

export function LoanQuotasManager() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [editing, setEditing] = useState<InstrumentLoanQuota | null>(null);
  const [open, setOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<InstrumentLoanQuota | null>(null);
  const [filterActiveOnly, setFilterActiveOnly] = useState(false);

  const query = useQuery({
    queryKey: ['loan-quotas'],
    queryFn: () => loanQuotasApi.list(),
    staleTime: 30_000,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => loanQuotasApi.remove(id),
    onSuccess: () => {
      toast.success(t('admin.loan_quotas.deleted'));
      void qc.invalidateQueries({ queryKey: ['loan-quotas'] });
      setConfirmDelete(null);
    },
    onError: (err) => toast.error(httpErrorMessage(err)),
  });

  const openNew = () => {
    setEditing(null);
    setOpen(true);
  };
  const openEdit = (q: InstrumentLoanQuota) => {
    setEditing(q);
    setOpen(true);
  };

  const allQuotas = query.data?.quotas ?? [];
  const visibleQuotas = filterActiveOnly ? allQuotas.filter((q) => q.isActive) : allQuotas;
  const byRole: Record<Role, InstrumentLoanQuota[]> = { admin: [], docente: [], studente: [] };
  for (const q of visibleQuotas) byRole[q.role].push(q);

  return (
    <div className="space-y-4">
      <Alert variant="info">
        <AlertDescription className="text-xs">{t('admin.loan_quotas.help')}</AlertDescription>
      </Alert>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-xl font-medium">{t('admin.loan_quotas.title')}</h2>
        <div className="flex items-center gap-2">
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
            {t('admin.loan_quotas.new')}
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
            <Package className="h-10 w-10 text-muted-foreground" />
            <p className="font-medium">{t('admin.loan_quotas.empty_title')}</p>
            <p className="text-sm text-muted-foreground">{t('admin.loan_quotas.empty_subtitle')}</p>
          </CardContent>
        </Card>
      )}

      {!query.isLoading && allQuotas.length > 0 && (
        <div className="space-y-4">
          {(['studente', 'docente', 'admin'] as Role[]).map((role) => {
            const items = byRole[role];
            if (items.length === 0) return null;
            return (
              <RoleLoanQuotaGroup
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

      <LoanQuotaFormDialog open={open} onOpenChange={setOpen} quota={editing} />

      <ConfirmDeleteDialog
        open={!!confirmDelete}
        onOpenChange={(o) => !o && setConfirmDelete(null)}
        title={t('admin.loan_quotas.delete_title')}
        description={t('admin.loan_quotas.delete_description')}
        onConfirm={() => confirmDelete && deleteMutation.mutate(confirmDelete.id)}
        loading={deleteMutation.isPending}
      />
    </div>
  );
}

function RoleLoanQuotaGroup({
  role,
  quotas,
  onEdit,
  onDelete,
}: {
  role: Role;
  quotas: InstrumentLoanQuota[];
  onEdit: (q: InstrumentLoanQuota) => void;
  onDelete: (q: InstrumentLoanQuota) => void;
}) {
  const { t } = useTranslation();
  const activeCount = quotas.filter((q) => q.isActive).length;
  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex items-center justify-between border-b pb-2">
          <h3 className="font-display text-base font-medium">{t(`admin.quotas.role.${role}`)}</h3>
          <span className="text-xs text-muted-foreground tabular-nums">
            {activeCount}/{quotas.length} {t('admin.quotas.active_count')}
          </span>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {quotas.map((q) => (
            <LoanQuotaCard key={q.id} quota={q} onEdit={onEdit} onDelete={onDelete} />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function LoanQuotaCard({
  quota,
  onEdit,
  onDelete,
}: {
  quota: InstrumentLoanQuota;
  onEdit: (q: InstrumentLoanQuota) => void;
  onDelete: (q: InstrumentLoanQuota) => void;
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
              {t(`admin.loan_quotas.scope.${quota.scopeKind}`)}
            </Badge>
            {!quota.isActive && (
              <Badge variant="muted" className="text-[10px]">
                {t('admin.quotas.inactive')}
              </Badge>
            )}
          </div>
          <p className="truncate text-sm font-medium">
            <LoanScopeValueLabel quota={quota} />
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
          <p className="text-muted-foreground inline-flex items-center gap-1">
            <Package className="h-3 w-3" />
            {t('admin.loan_quotas.col_max_concurrent')}
          </p>
          <p className="font-medium tabular-nums">
            {quota.maxConcurrent > 0 ? quota.maxConcurrent : '—'}
          </p>
        </div>
        <div>
          <p className="text-muted-foreground inline-flex items-center gap-1">
            <CalendarClock className="h-3 w-3" />
            {t('admin.loan_quotas.col_max_days_year')}
          </p>
          <p className="font-medium tabular-nums">
            {quota.maxDaysPerYear > 0 ? `${quota.maxDaysPerYear} gg` : '—'}
          </p>
        </div>
      </div>
    </motion.div>
  );
}

// Etichetta target umana: famiglia tradotta, nome strumento per id, "Tutti" per global.
function LoanScopeValueLabel({ quota }: { quota: InstrumentLoanQuota }) {
  const { t } = useTranslation();
  // Cache leggera: l'elenco strumenti viene chiesto solo se serve la
  // risoluzione id→nome. Niente n+1 al rendering: una sola query.
  const enabled = quota.scopeKind === 'instrument';
  const instrumentsQuery = useQuery({
    queryKey: ['instruments', 'all-for-quota'],
    queryFn: () => instrumentsApi.list({}),
    staleTime: 5 * 60 * 1000,
    enabled,
  });

  if (quota.scopeKind === 'global') {
    return (
      <span className="text-muted-foreground">{t('admin.loan_quotas.scope_global_target')}</span>
    );
  }
  if (quota.scopeKind === 'family') {
    const opt = INSTRUMENT_FAMILY_OPTIONS.find((o) => o.value === quota.scopeValue);
    return (
      <span className="inline-flex items-center gap-1">
        <Music2 className="h-3 w-3 text-muted-foreground" />
        {opt?.label ?? quota.scopeValue}
      </span>
    );
  }
  // instrument
  const id = Number(quota.scopeValue);
  const inst = instrumentsQuery.data?.instruments.find((i) => i.id === id);
  return (
    <span className="inline-flex items-center gap-1">
      <Package className="h-3 w-3 text-muted-foreground" />
      {inst ? `${inst.name}${inst.code ? ` · ${inst.code}` : ''}` : `#${quota.scopeValue}`}
    </span>
  );
}

function LoanQuotaFormDialog({
  open,
  onOpenChange,
  quota,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  quota: InstrumentLoanQuota | null;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const isEdit = !!quota;

  // Carichiamo gli strumenti solo quando il dialog è aperto e lo scope è
  // 'instrument' — evita query inutili.
  const instrumentsQuery = useQuery({
    queryKey: ['instruments', 'for-loan-quota-dialog'],
    queryFn: () => instrumentsApi.list({}),
    staleTime: 5 * 60 * 1000,
    enabled: open,
  });

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: DEFAULT_FORM,
    values: quota
      ? {
          role: quota.role,
          scopeKind: quota.scopeKind,
          scopeValue: quota.scopeKind === 'global' ? '' : quota.scopeValue,
          maxConcurrent: quota.maxConcurrent,
          maxDaysPerYear: quota.maxDaysPerYear,
          isActive: quota.isActive,
        }
      : undefined,
  });
  const scopeKind = form.watch('scopeKind');

  const submitMutation = useMutation({
    mutationFn: (values: FormValues) => {
      const payload: UpsertLoanQuotaPayload = {
        role: values.role,
        scopeKind: values.scopeKind,
        scopeValue: values.scopeKind === 'global' ? '*' : (values.scopeValue ?? '').trim(),
        maxConcurrent: values.maxConcurrent,
        maxDaysPerYear: values.maxDaysPerYear,
        isActive: values.isActive,
      };
      return isEdit ? loanQuotasApi.update(quota.id, payload) : loanQuotasApi.create(payload);
    },
    onSuccess: () => {
      toast.success(isEdit ? t('admin.loan_quotas.updated') : t('admin.loan_quotas.created'));
      void qc.invalidateQueries({ queryKey: ['loan-quotas'] });
      onOpenChange(false);
    },
    onError: (err) => toast.error(httpErrorMessage(err)),
  });

  const tFieldError = (key?: string) => {
    if (!key) return undefined;
    if (key === 'cap_required') return t('admin.loan_quotas.errors.cap_required');
    if (key === 'scope_required') return t('admin.quotas.errors.scope_required');
    return key;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? t('admin.loan_quotas.edit_title') : t('admin.loan_quotas.new_title')}
          </DialogTitle>
          <DialogDescription>{t('admin.loan_quotas.dialog_help')}</DialogDescription>
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
              <Label>{t('admin.loan_quotas.field.scope')}</Label>
              <Select
                value={scopeKind}
                onValueChange={(v) => {
                  form.setValue('scopeKind', v as LoanQuotaScopeKind);
                  form.setValue('scopeValue', '');
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SCOPE_KINDS.map((k) => (
                    <SelectItem key={k} value={k}>
                      {t(`admin.loan_quotas.scope.${k}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {scopeKind !== 'global' && (
            <div className="space-y-2">
              <Label>{t('admin.loan_quotas.field.target')}</Label>
              <Select
                value={form.watch('scopeValue') ?? ''}
                onValueChange={(v) => {
                  form.setValue('scopeValue', v, { shouldValidate: true });
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder={t('common.select_placeholder')} />
                </SelectTrigger>
                <SelectContent>
                  {scopeKind === 'family' &&
                    INSTRUMENT_FAMILY_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  {scopeKind === 'instrument' &&
                    (instrumentsQuery.data?.instruments ?? []).map((i) => (
                      <SelectItem key={i.id} value={String(i.id)}>
                        {i.name}
                        {i.code ? ` · ${i.code}` : ''}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
              {form.formState.errors.scopeValue && (
                <p className="text-xs text-destructive">
                  {tFieldError(form.formState.errors.scopeValue.message)}
                </p>
              )}
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="lq-conc">{t('admin.loan_quotas.field.max_concurrent')}</Label>
              <Input
                id="lq-conc"
                type="number"
                min={0}
                max={99}
                {...form.register('maxConcurrent')}
              />
              <p className="text-[11px] text-muted-foreground">
                {t('admin.quotas.field.zero_disables')}
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="lq-days">{t('admin.loan_quotas.field.max_days_year')}</Label>
              <Input
                id="lq-days"
                type="number"
                min={0}
                max={366}
                {...form.register('maxDaysPerYear')}
              />
              <p className="text-[11px] text-muted-foreground">
                {t('admin.quotas.field.zero_disables')}
              </p>
            </div>
          </div>
          {form.formState.errors.maxConcurrent?.message === 'cap_required' && (
            <p className="text-xs text-destructive">{tFieldError('cap_required')}</p>
          )}

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
