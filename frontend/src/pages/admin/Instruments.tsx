import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { LucideIcon } from 'lucide-react';
import { motion } from 'framer-motion';
import {
  AlertTriangle,
  ArrowLeftRight,
  Boxes,
  Check,
  CheckCircle2,
  Download,
  FileText,
  FileUp,
  Hourglass,
  Pencil,
  Plus,
  Search,
  ShieldCheck,
  Trash2,
  X,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { instrumentsApi, loansApi } from '@/api/instruments';
import { httpErrorMessage } from '@/lib/api';
import { formatDate } from '@/lib/date';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { InstrumentFormDialog } from '@/components/admin/InstrumentFormDialog';
import { InstrumentsCsvImportDialog } from '@/components/admin/InstrumentsCsvImportDialog';
import { ConfirmDeleteDialog } from '@/components/admin/ConfirmDeleteDialog';
import { InstrumentLoanRulesTab } from '@/components/admin/InstrumentLoanRulesTab';
import type {
  Instrument,
  InstrumentCondition,
  InstrumentFamily,
  InstrumentLoan,
  LoanStatus,
} from '@/types';

type Tab = 'inventory' | 'all_loans' | 'overdue' | 'expiring' | 'rules';

interface TabDef {
  value: Tab;
  labelKey: string;
  descriptionKey: string;
  icon: LucideIcon;
  iconColor: string;
  iconBg: string;
}

const TAB_DEFS: TabDef[] = [
  {
    value: 'inventory',
    labelKey: 'admin.instruments.tabs.inventory',
    descriptionKey: 'admin.instruments.tabs.inventory_description',
    icon: Boxes,
    iconColor: 'text-sky-600 dark:text-sky-400',
    iconBg: 'bg-sky-100 dark:bg-sky-500/15',
  },
  {
    value: 'all_loans',
    labelKey: 'admin.instruments.tabs.all_loans',
    descriptionKey: 'admin.instruments.tabs.all_loans_description',
    icon: ArrowLeftRight,
    iconColor: 'text-violet-600 dark:text-violet-400',
    iconBg: 'bg-violet-100 dark:bg-violet-500/15',
  },
  {
    value: 'overdue',
    labelKey: 'admin.instruments.tabs.overdue',
    descriptionKey: 'admin.instruments.tabs.overdue_description',
    icon: AlertTriangle,
    iconColor: 'text-rose-600 dark:text-rose-400',
    iconBg: 'bg-rose-100 dark:bg-rose-500/15',
  },
  {
    value: 'expiring',
    labelKey: 'admin.instruments.tabs.expiring',
    descriptionKey: 'admin.instruments.tabs.expiring_description',
    icon: Hourglass,
    iconColor: 'text-emerald-600 dark:text-emerald-400',
    iconBg: 'bg-emerald-100 dark:bg-emerald-500/15',
  },
  {
    value: 'rules',
    labelKey: 'admin.instruments.tabs.rules',
    descriptionKey: 'admin.instruments.tabs.rules_description',
    icon: ShieldCheck,
    iconColor: 'text-amber-600 dark:text-amber-400',
    iconBg: 'bg-amber-100 dark:bg-amber-500/15',
  },
];

const VALID_INSTR_TABS = TAB_DEFS.map((t) => t.value);

const FAMILY_KEYS: InstrumentFamily[] = [
  'archi',
  'fiati_legni',
  'fiati_ottoni',
  'tastiere',
  'percussioni',
  'corde',
  'voce',
  'elettronica',
  'altro',
];
const CONDITION_KEYS: InstrumentCondition[] = [
  'ottimo',
  'buono',
  'discreto',
  'da_riparare',
  'fuori_uso',
];

const STATUS_VARIANT: Record<LoanStatus, 'success' | 'secondary' | 'muted' | 'default'> = {
  requested: 'secondary',
  active: 'success',
  returned: 'muted',
  overdue: 'default',
  rejected: 'muted',
};

export default function AdminInstruments() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const initialTab = params.get('tab');
  const [tab, setTab] = useState<Tab>(
    initialTab && VALID_INSTR_TABS.includes(initialTab as Tab) ? (initialTab as Tab) : 'inventory',
  );
  const activeTab = TAB_DEFS.find((td) => td.value === tab) ?? TAB_DEFS[0];
  const ActiveIcon = activeTab.icon;
  const onSelectTab = (next: Tab) => {
    setTab(next);
    const np = new URLSearchParams(params);
    np.set('tab', next);
    setParams(np, { replace: true });
  };
  const [editTarget, setEditTarget] = useState<Instrument | null>(null);
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Instrument | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Export CSV: scarica via fetch+blob (Bearer non passabile via <a href>).
  const handleExport = async () => {
    try {
      const blob = await instrumentsApi.downloadCsv();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `instruments-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success(t('admin.instruments.exported'));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('admin.instruments.export_failed'));
    }
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1.5">
          <h1 className="font-display text-3xl font-medium">{t('admin.instruments.title')}</h1>
          <p className="text-sm text-muted-foreground">{t('admin.instruments.subtitle')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={handleExport}>
            <Download className="h-4 w-4" />
            {t('admin.instruments.export_csv')}
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              setImporting(true);
            }}
          >
            <FileUp className="h-4 w-4" />
            {t('admin.instruments.import_csv')}
          </Button>
          <Button
            onClick={() => {
              setCreating(true);
            }}
          >
            <Plus className="h-4 w-4" />
            {t('admin.instruments.new_instrument')}
          </Button>
        </div>
      </header>

      {/* Strip macro-tab in stile /admin/server-settings */}
      <div className="grid gap-2 rounded-xl border bg-muted/30 p-1.5 sm:grid-cols-2 lg:grid-cols-5">
        {TAB_DEFS.map((td) => {
          const Icon = td.icon;
          const isActive = td.value === tab;
          return (
            <button
              key={td.value}
              type="button"
              onClick={() => {
                onSelectTab(td.value);
              }}
              className={cn(
                'flex items-center gap-2 rounded-lg px-3 py-2.5 text-left transition-all',
                isActive
                  ? 'bg-background shadow-xs ring-1 ring-border'
                  : 'text-muted-foreground hover:bg-background/60',
              )}
            >
              <Icon className={cn('h-4 w-4', isActive ? td.iconColor : '')} />
              <span className={cn('text-sm font-medium', isActive && 'text-foreground')}>
                {t(td.labelKey)}
              </span>
            </button>
          );
        })}
      </div>

      {/* Header descrittivo della tab attiva */}
      <Card>
        <CardContent className="flex items-center gap-3 p-4">
          <div className={cn('rounded-lg p-2', activeTab.iconBg)}>
            <ActiveIcon className={cn('h-4 w-4', activeTab.iconColor)} />
          </div>
          <div className="space-y-0.5">
            <h2 className="font-display text-lg font-medium leading-tight">
              {t(activeTab.labelKey)}
            </h2>
            <p className="text-xs text-muted-foreground">{t(activeTab.descriptionKey)}</p>
          </div>
        </CardContent>
      </Card>

      {/* Contenuti per tab */}
      <div className="space-y-4">
        {tab === 'inventory' && (
          <InventoryTab
            onEdit={(it) => {
              setEditTarget(it);
            }}
            onDelete={(it) => {
              setDeleteError(null);
              setDeleteTarget(it);
            }}
          />
        )}
        {tab === 'all_loans' && <LoansTab kind="all" />}
        {tab === 'overdue' && <LoansTab kind="overdue" />}
        {tab === 'expiring' && <LoansTab kind="expiring" />}
        {tab === 'rules' && <InstrumentLoanRulesTab />}
      </div>

      <InstrumentFormDialog open={creating} onOpenChange={setCreating} />
      <InstrumentFormDialog
        open={!!editTarget}
        onOpenChange={(o) => !o && setEditTarget(null)}
        instrument={editTarget}
      />
      <InstrumentsCsvImportDialog open={importing} onOpenChange={setImporting} />
      <DeleteInstrumentDialog
        target={deleteTarget}
        error={deleteError}
        onError={setDeleteError}
        onClose={() => {
          setDeleteTarget(null);
          setDeleteError(null);
        }}
      />
    </div>
  );
}

// =====================================================
// Tab: Inventario
// =====================================================
function InventoryTab({
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
    queryKey: ['admin', 'instruments', { family, loanable }],
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
      void qc.invalidateQueries({ queryKey: ['admin', 'instruments'] });
      void qc.invalidateQueries({ queryKey: ['instruments'] });
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
      void qc.invalidateQueries({ queryKey: ['admin', 'instruments'] });
      void qc.invalidateQueries({ queryKey: ['instruments'] });
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
        <CardContent className="grid gap-3 p-4 md:grid-cols-[1fr_auto_auto_auto] md:items-center">
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
            <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
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

// =====================================================
// Tab: Prestiti (all/overdue/expiring)
// =====================================================
function LoansTab({ kind }: { kind: 'all' | 'overdue' | 'expiring' }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ['admin', 'loans', kind],
    queryFn: () =>
      kind === 'overdue'
        ? loansApi.overdue()
        : kind === 'expiring'
          ? loansApi.expiring(2)
          : loansApi.list(),
  });

  const approveMutation = useMutation({
    mutationFn: (id: number) => loansApi.approve(id),
    onSuccess: () => {
      toast.success(t('admin.instruments.toast.approved'));
      void qc.invalidateQueries({ queryKey: ['admin', 'loans'] });
      void qc.invalidateQueries({ queryKey: ['instruments'] });
    },
    onError: (err) => toast.error(httpErrorMessage(err)),
  });

  const rejectMutation = useMutation({
    mutationFn: (id: number) => loansApi.reject(id),
    onSuccess: () => {
      toast.success(t('admin.instruments.toast.rejected'));
      void qc.invalidateQueries({ queryKey: ['admin', 'loans'] });
      void qc.invalidateQueries({ queryKey: ['instruments'] });
    },
    onError: (err) => toast.error(httpErrorMessage(err)),
  });

  const returnMutation = useMutation({
    mutationFn: (id: number) => loansApi.returnLoan(id),
    onSuccess: () => {
      toast.success(t('admin.instruments.toast.returned'));
      void qc.invalidateQueries({ queryKey: ['admin', 'loans'] });
      void qc.invalidateQueries({ queryKey: ['instruments'] });
    },
    onError: (err) => toast.error(httpErrorMessage(err)),
  });

  const downloadPdf = async (loan: InstrumentLoan, type: 'delivery' | 'return') => {
    try {
      const blob = await loansApi.downloadPdf(loan.id, type);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `prestito-${loan.id}-${type}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'PDF');
    }
  };

  const loans = query.data?.loans ?? [];

  return (
    <Card>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/50 text-left text-xs uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-4 py-3 font-medium">{t('admin.instruments.loans_table.user')}</th>
              <th className="px-4 py-3 font-medium">
                {t('admin.instruments.loans_table.instrument')}
              </th>
              <th className="px-4 py-3 font-medium">{t('admin.instruments.loans_table.period')}</th>
              <th className="px-4 py-3 font-medium">{t('admin.instruments.loans_table.status')}</th>
              <th className="px-4 py-3 text-right font-medium">
                {t('admin.instruments.loans_table.actions')}
              </th>
            </tr>
          </thead>
          <tbody>
            {query.isLoading &&
              [0, 1, 2].map((i) => (
                <tr key={i} className="border-b last:border-0">
                  <td colSpan={5} className="px-4 py-3">
                    <Skeleton className="h-8 w-full" />
                  </td>
                </tr>
              ))}
            {!query.isLoading && loans.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-12 text-center text-sm text-muted-foreground">
                  —
                </td>
              </tr>
            )}
            {loans.map((loan) => (
              <tr key={loan.id} className="border-b last:border-0">
                <td className="px-4 py-3">
                  <p className="font-medium">
                    {loan.user?.firstName} {loan.user?.lastName}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {loan.user?.matricola ? `${loan.user.matricola} · ` : ''}
                    {loan.user?.email}
                  </p>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    {/* Stessa thumbnail dell'inventario: 10×16 (4:5) con
                        fallback SVG. Allineata visualmente alle altre tab. */}
                    <div className="relative h-10 w-16 shrink-0 overflow-hidden rounded-md bg-muted">
                      <img
                        src={loan.instrument?.photoUrl ?? '/assets/instrument-default.svg'}
                        alt=""
                        loading="lazy"
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
                      <p className="truncate font-medium">{loan.instrument?.name ?? '—'}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {loan.instrument?.code ?? ''}
                        {loan.instrument?.family
                          ? ` · ${t(`instrument_families.${loan.instrument.family}`)}`
                          : ''}
                      </p>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3 text-xs text-muted-foreground">
                  {formatDate(loan.fromDate)} → {formatDate(loan.toDate)}
                </td>
                <td className="px-4 py-3">
                  <Badge variant={STATUS_VARIANT[loan.status]}>
                    {t(`loans.status.${loan.status}`)}
                  </Badge>
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="inline-flex flex-wrap items-center justify-end gap-1">
                    {loan.status === 'requested' && (
                      <>
                        <Button
                          variant="ghost"
                          size="icon"
                          title={t('admin.instruments.loan_actions.approve')}
                          onClick={() => {
                            approveMutation.mutate(loan.id);
                          }}
                          disabled={approveMutation.isPending}
                          className="text-emerald-600 hover:bg-emerald-50 hover:text-emerald-700 dark:text-emerald-400 dark:hover:bg-emerald-500/10"
                        >
                          <Check className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          title={t('admin.instruments.loan_actions.reject')}
                          onClick={() => {
                            rejectMutation.mutate(loan.id);
                          }}
                          disabled={rejectMutation.isPending}
                          className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </>
                    )}
                    {(loan.status === 'active' || loan.status === 'overdue') && (
                      <>
                        <Button
                          variant="ghost"
                          size="icon"
                          title={t('admin.instruments.loan_actions.print_delivery')}
                          onClick={() => downloadPdf(loan, 'delivery')}
                        >
                          <FileText className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          title={t('admin.instruments.loan_actions.force_return')}
                          onClick={() => {
                            returnMutation.mutate(loan.id);
                          }}
                          disabled={returnMutation.isPending}
                        >
                          <CheckCircle2 className="h-4 w-4" />
                        </Button>
                      </>
                    )}
                    {loan.status === 'returned' && (
                      <Button
                        variant="ghost"
                        size="icon"
                        title={t('admin.instruments.loan_actions.print_return')}
                        onClick={() => downloadPdf(loan, 'return')}
                      >
                        <FileText className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

// =====================================================
// Confirm delete dialog (con mutation)
// =====================================================
function DeleteInstrumentDialog({
  target,
  error,
  onError,
  onClose,
}: {
  target: Instrument | null;
  error: string | null;
  onError: (s: string | null) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const mutation = useMutation({
    mutationFn: (id: number) => instrumentsApi.remove(id),
    onSuccess: () => {
      toast.success(t('admin.instruments.toast.deleted'));
      void qc.invalidateQueries({ queryKey: ['instruments'] });
      void qc.invalidateQueries({ queryKey: ['admin', 'instruments'] });
      onClose();
    },
    onError: (err) => {
      onError(httpErrorMessage(err));
    },
  });

  return (
    <ConfirmDeleteDialog
      open={!!target}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      title={target ? t('admin.instruments.delete_title', { name: target.name }) : ''}
      description={t('admin.instruments.delete_description')}
      loading={mutation.isPending}
      error={error}
      onConfirm={() => target && mutation.mutate(target.id)}
    />
  );
}
