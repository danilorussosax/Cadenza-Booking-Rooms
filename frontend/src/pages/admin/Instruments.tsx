import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Download, FileUp, Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { instrumentsApi } from '@/api/instruments';
import { todayLocalIso } from '@/lib/date';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { InstrumentFormDialog } from '@/components/admin/InstrumentFormDialog';
import { InstrumentsCsvImportDialog } from '@/components/admin/InstrumentsCsvImportDialog';
import { InstrumentLoanRulesTab } from '@/components/admin/InstrumentLoanRulesTab';
import type { Instrument } from '@/types';
import { saveBlob } from '@/lib/download';
import { TAB_DEFS, VALID_INSTR_TABS, type Tab } from './instruments/constants';
import { InventoryTab } from './instruments/InventoryTab';
import { LoansTab } from './instruments/LoansTab';
import { DeleteInstrumentDialog } from './instruments/DeleteInstrumentDialog';

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
      saveBlob(blob, `instruments-${todayLocalIso()}.csv`);
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
                'flex items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-center transition-all',
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
        <CardContent className="flex items-center gap-3 p-4 sm:p-6">
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
