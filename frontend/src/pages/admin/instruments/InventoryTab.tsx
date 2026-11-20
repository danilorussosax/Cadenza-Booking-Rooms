import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Check, Pencil, Search, Trash2, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { instrumentsApi } from '@/api/instruments';
import { httpErrorMessage } from '@/lib/api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ConfirmDeleteDialog } from '@/components/admin/ConfirmDeleteDialog';
import type { Instrument, InstrumentFamily } from '@/types';
import { qk } from '@/lib/queryKeys';
import { invalidateInstruments } from '@/lib/invalidation';
import { FAMILY_KEYS, CONDITION_KEYS, STATUS_VARIANT } from './constants';

// =====================================================
// Tab: Inventario
// =====================================================
export function InventoryTab({
  onEdit,
  onDelete,
}: {
  onEdit: (i: Instrument) => void;
  onDelete: (i: Instrument) => void;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [family, setFamily] = useState<string>('all');
  const [condition, setCondition] = useState<string>('all');
  const [loanable, setLoanable] = useState<string>('all');
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [bulkAction, setBulkAction] = useState<
    'delete' | 'enable_loanable' | 'disable_loanable' | null
  >(null);

  const query = useQuery({
    queryKey: qk.adminInstruments.filtered({ family, loanable }),
    queryFn: () =>
      instrumentsApi.list({
        family: family === 'all' ? undefined : (family as InstrumentFamily),
        loanable: loanable === 'all' ? null : loanable === 'true',
      }),
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: () => instrumentsApi.bulkDelete(Array.from(selected)),
    onSuccess: ({ deleted, removedLoans }) => {
      toast.success(t('admin.instruments.bulk.deleted_toast', { count: deleted, removedLoans }));
      void invalidateInstruments(qc);
      setSelected(new Set());
      setBulkAction(null);
    },
    onError: (err) => toast.error(httpErrorMessage(err)),
  });

  const bulkToggleMutation = useMutation({
    mutationFn: (isLoanable: boolean) =>
      instrumentsApi.bulkToggleLoanable(Array.from(selected), isLoanable),
    onSuccess: ({ changed }, isLoanable) => {
      toast.success(
        t(
          isLoanable
            ? 'admin.instruments.bulk.enabled_toast'
            : 'admin.instruments.bulk.disabled_toast',
          { count: changed },
        ),
      );
      void invalidateInstruments(qc);
      setSelected(new Set());
      setBulkAction(null);
    },
    onError: (err) => toast.error(httpErrorMessage(err)),
  });

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    let out = query.data?.instruments ?? [];
    if (condition !== 'all') out = out.filter((i) => i.condition === condition);
    if (term) {
      out = out.filter((i) =>
        [i.name, i.code, i.brand, i.model]
          .filter((v): v is string => Boolean(v))
          .some((v) => v.toLowerCase().includes(term)),
      );
    }
    return out;
  }, [query.data, search, condition]);

  const allChecked = filtered.length > 0 && filtered.every((i) => selected.has(i.id));
  const someChecked = filtered.some((i) => selected.has(i.id)) && !allChecked;
  const toggleAll = (v: boolean) => {
    setSelected(v ? new Set(filtered.map((i) => i.id)) : new Set());
  };
  const toggleOne = (id: number, v: boolean) => {
    const next = new Set(selected);
    if (v) next.add(id);
    else next.delete(id);
    setSelected(next);
  };

  return (
    <>
      <Card>
        <CardContent className="grid gap-3 p-4 sm:p-6 md:grid-cols-[1fr_auto_auto_auto] md:items-center">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
              }}
              placeholder={t('admin.instruments.search_placeholder')}
              className="pl-9"
            />
          </div>
          <Select value={family} onValueChange={setFamily}>
            <SelectTrigger className="md:w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('admin.instruments.all_families')}</SelectItem>
              {FAMILY_KEYS.map((f) => (
                <SelectItem key={f} value={f}>
                  {t(`instrument_families.${f}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={condition} onValueChange={setCondition}>
            <SelectTrigger className="md:w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('admin.instruments.all_conditions')}</SelectItem>
              {CONDITION_KEYS.map((c) => (
                <SelectItem key={c} value={c}>
                  {t(`instrument_conditions.${c}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={loanable} onValueChange={setLoanable}>
            <SelectTrigger className="md:w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('admin.instruments.loanable_all')}</SelectItem>
              <SelectItem value="true">{t('admin.instruments.loanable_yes')}</SelectItem>
              <SelectItem value="false">{t('admin.instruments.loanable_no')}</SelectItem>
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {selected.size > 0 && (
        <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }}>
          <Card className="border-amber-300/60 bg-amber-50/60 dark:border-amber-500/30 dark:bg-amber-500/10">
            <CardContent className="flex flex-col gap-3 p-4 sm:p-6 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm font-medium">
                {t('admin.instruments.bulk.selected_count', { count: selected.size })}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setSelected(new Set());
                  }}
                >
                  {t('admin.instruments.bulk.clear')}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setBulkAction('enable_loanable');
                  }}
                >
                  <Check className="h-4 w-4" />
                  {t('admin.instruments.bulk.enable_loanable')}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setBulkAction('disable_loanable');
                  }}
                >
                  <X className="h-4 w-4" />
                  {t('admin.instruments.bulk.disable_loanable')}
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => {
                    setBulkAction('delete');
                  }}
                >
                  <Trash2 className="h-4 w-4" />
                  {t('admin.instruments.bulk.delete')}
                </Button>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      )}

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/50 text-left text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="w-10 px-4 py-3">
                  <Checkbox
                    checked={allChecked || (someChecked ? 'indeterminate' : false)}
                    onCheckedChange={(v) => {
                      toggleAll(v === true);
                    }}
                    aria-label={t('common.select')}
                  />
                </th>
                <th className="px-4 py-3 font-medium">{t('admin.instruments.table.instrument')}</th>
                <th className="px-4 py-3 font-medium">{t('admin.instruments.table.family')}</th>
                <th className="px-4 py-3 font-medium">{t('admin.instruments.table.code')}</th>
                <th className="px-4 py-3 font-medium">{t('admin.instruments.table.condition')}</th>
                <th className="px-4 py-3 font-medium">{t('admin.instruments.table.loanable')}</th>
                <th className="px-4 py-3 font-medium">
                  {t('admin.instruments.table.loan_status')}
                </th>
                <th className="px-4 py-3 text-right font-medium">
                  {t('admin.instruments.table.actions')}
                </th>
              </tr>
            </thead>
            <tbody>
              {query.isLoading &&
                [0, 1, 2].map((i) => (
                  <tr key={i} className="border-b last:border-0">
                    <td colSpan={8} className="px-4 py-3">
                      <Skeleton className="h-8 w-full" />
                    </td>
                  </tr>
                ))}
              {!query.isLoading && filtered.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center">
                    <p className="text-sm font-medium">{t('admin.instruments.empty.title')}</p>
                    <p className="text-xs text-muted-foreground">
                      {t('admin.instruments.empty.subtitle')}
                    </p>
                  </td>
                </tr>
              )}
              {filtered.map((it) => (
                <motion.tr
                  key={it.id}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="border-b last:border-0"
                >
                  <td className="px-4 py-3">
                    <Checkbox
                      checked={selected.has(it.id)}
                      onCheckedChange={(v) => {
                        toggleOne(it.id, v === true);
                      }}
                      aria-label={t('common.select')}
                    />
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="relative h-10 w-16 shrink-0 overflow-hidden rounded-md bg-muted">
                        <img
                          src={it.photoUrl ?? '/assets/instrument-default.svg'}
                          alt=""
                          className="absolute inset-0 h-full w-full object-cover"
                          onError={(e) => {
                            const img = e.currentTarget;
                            if (!img.src.endsWith('/assets/instrument-default.svg')) {
                              img.src = '/assets/instrument-default.svg';
                            }
                          }}
                        />
                      </div>
                      <div className="min-w-0">
                        <p className="truncate font-medium">{it.name}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {[it.brand, it.model, it.serialNumber].filter(Boolean).join(' · ') || '—'}
                        </p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant="secondary">{t(`instrument_families.${it.family}`)}</Badge>
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">{it.code ?? '—'}</td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {t(`instrument_conditions.${it.condition}`)}
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant={it.isLoanable ? 'success' : 'muted'}>
                      {it.isLoanable
                        ? t('admin.instruments.loanable_yes')
                        : t('admin.instruments.loanable_no')}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-xs">
                    {it.currentLoanStatus ? (
                      <Badge variant={STATUS_VARIANT[it.currentLoanStatus]}>
                        {t(`loans.status.${it.currentLoanStatus}`)}
                      </Badge>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="inline-flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        title={t('common.edit')}
                        onClick={() => {
                          onEdit(it);
                        }}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        title={t('common.delete')}
                        onClick={() => {
                          onDelete(it);
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

      <ConfirmDeleteDialog
        open={bulkAction !== null}
        onOpenChange={(o) => {
          if (!o) setBulkAction(null);
        }}
        title={
          bulkAction === 'delete'
            ? t('admin.instruments.bulk.confirm.delete_title')
            : bulkAction === 'enable_loanable'
              ? t('admin.instruments.bulk.confirm.enable_title')
              : t('admin.instruments.bulk.confirm.disable_title')
        }
        description={t('admin.instruments.bulk.confirm.description', {
          count: selected.size,
        })}
        confirmLabel={
          bulkAction === 'delete'
            ? t('admin.instruments.bulk.delete')
            : bulkAction === 'enable_loanable'
              ? t('admin.instruments.bulk.enable_loanable')
              : t('admin.instruments.bulk.disable_loanable')
        }
        variant={bulkAction === 'delete' ? 'destructive' : 'default'}
        loading={bulkDeleteMutation.isPending || bulkToggleMutation.isPending}
        onConfirm={() => {
          if (bulkAction === 'delete') bulkDeleteMutation.mutate();
          else if (bulkAction === 'enable_loanable') bulkToggleMutation.mutate(true);
          else if (bulkAction === 'disable_loanable') bulkToggleMutation.mutate(false);
        }}
      />
    </>
  );
}
