import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Clock,
  FileSpreadsheet,
  CalendarRange,
  ListChecks,
  GitPullRequest,
  Briefcase,
  type LucideIcon,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { monteOreAdminApi, type MonteOreProposal } from '@/api/monteOre';
import { ContractTypesPanel } from '@/components/admin/ContractTypesPanel';
import { AdminAcademicYearSelector } from '@/components/monteOre/AcademicYearSelector';
import { ImportExcelDialog } from '@/components/monteOre/ImportExcelDialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { AmendmentsRequestsTab } from '@/components/monteOre/admin/AmendmentsRequestsTab';
import { ProposalsTab } from '@/components/monteOre/admin/ProposalsTab';

// Macro tab — stesso pattern di pages/admin/Rules.tsx (card con icona+colore).

type MacroTab = 'proposals' | 'amendments' | 'contract-types';

interface MacroTabDef {
  value: MacroTab;
  label: string;
  description: string;
  icon: LucideIcon;
  iconColor: string;
  iconBg: string;
}

const MACRO_TABS: MacroTabDef[] = [
  {
    value: 'proposals',
    label: 'Proposte',
    description: 'Lista delle proposte monte ore dei docenti, da approvare e generare.',
    icon: ListChecks,
    iconColor: 'text-blue-600 dark:text-blue-400',
    iconBg: 'bg-blue-100 dark:bg-blue-500/15',
  },
  {
    value: 'amendments',
    label: 'Richieste variazioni',
    description: 'Modifiche al piano post-approvazione che richiedono il tuo OK.',
    icon: GitPullRequest,
    iconColor: 'text-amber-600 dark:text-amber-400',
    iconBg: 'bg-amber-100 dark:bg-amber-500/15',
  },
  {
    value: 'contract-types',
    label: 'Tipologie docenti',
    description:
      'Anagrafica delle tipologie contrattuali (titolare, supplente, contratto orario, custom) con soglia ore di default per ciascuna.',
    icon: Briefcase,
    iconColor: 'text-indigo-600 dark:text-indigo-400',
    iconBg: 'bg-indigo-100 dark:bg-indigo-500/15',
  },
];

export default function AdminMonteOre() {
  const [macroTab, setMacroTab] = useState<MacroTab>('proposals');
  const [statusFilter, setStatusFilter] = useState<MonteOreProposal['status'] | 'all'>('submitted');
  // AA selezionato globalmente per la pagina admin (proposals, amendments,
  // ecc.). Risolto al primo render dal componente AdminAcademicYearSelector
  // (storage > default backend).
  const [selectedYear, setSelectedYear] = useState<string | undefined>(undefined);
  // Dialog import Excel monte ore (admin → POST /api/admin/monte-ore/import).
  // L'AA viene letto dal file, ma passiamo `selectedYear` come info display.
  const [importOpen, setImportOpen] = useState(false);

  // Counter per badge "richieste in attesa" sulla tab
  const pendingCountQuery = useQuery({
    queryKey: ['admin', 'monte-ore', 'amendments', 'pending-count'],
    queryFn: () => monteOreAdminApi.pendingAmendmentsCount(),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
  const pendingCount = pendingCountQuery.data?.count ?? 0;

  const activeTab = MACRO_TABS.find((t) => t.value === macroTab) ?? MACRO_TABS[0];
  const ActiveIcon = activeTab.icon;

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-display text-3xl font-medium inline-flex items-center gap-2">
            <Clock className="h-6 w-6 text-primary" />
            Gestione Monte Ore
          </h1>
          <p className="text-sm text-muted-foreground">
            Approva le proposte dei docenti, assegna le aule e genera le prenotazioni ricorrenti.
          </p>
        </div>
        <Button variant="outline" asChild>
          <Link to="/admin/monte-ore/settings">
            <CalendarRange className="h-4 w-4" />
            Calendario didattico
          </Link>
        </Button>
      </header>

      {/* Selettore AA: governa proposals, exam-sessions, settings, ecc.
       *  Affiancato a destra dal bottone "Importa Excel" che apre il dialog
       *  multipart upload per il monte ore di un singolo docente. */}
      <Card>
        <CardContent className="flex flex-col gap-3 p-4 sm:p-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 flex-1">
            <AdminAcademicYearSelector value={selectedYear} onChange={setSelectedYear} />
          </div>
          <Button
            variant="outline"
            onClick={() => setImportOpen(true)}
            title="Importa monte ore di un docente da file Excel pre-compilato"
          >
            <FileSpreadsheet className="h-4 w-4" />
            Importa Excel
          </Button>
        </CardContent>
      </Card>

      <ImportExcelDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        academicYear={selectedYear}
      />

      {/* Macro tab strip (stesso stile di Regole prenotazione) */}
      <div className="grid gap-2 rounded-xl border bg-muted/30 p-1.5 sm:grid-cols-2 lg:grid-cols-3">
        {MACRO_TABS.map((tdef) => {
          const Icon = tdef.icon;
          const isActive = tdef.value === macroTab;
          const showBadge = tdef.value === 'amendments' && pendingCount > 0;
          return (
            <button
              key={tdef.value}
              type="button"
              onClick={() => setMacroTab(tdef.value)}
              className={`flex items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-center transition-all ${
                isActive
                  ? 'bg-background shadow-xs ring-1 ring-border'
                  : 'text-muted-foreground hover:bg-background/60'
              }`}
            >
              <Icon className={`h-4 w-4 shrink-0 ${isActive ? tdef.iconColor : ''}`} />
              <span className={`text-sm font-medium ${isActive ? 'text-foreground' : ''}`}>
                {tdef.label}
              </span>
              {showBadge && (
                <Badge variant="secondary" className="ml-auto">
                  {pendingCount}
                </Badge>
              )}
            </button>
          );
        })}
      </div>

      {/* Header descrittivo della tab attiva */}
      <Card>
        <CardContent className="flex items-center gap-3 p-4 sm:p-6">
          <div className={`rounded-lg p-2 ${activeTab.iconBg}`}>
            <ActiveIcon className={`h-4 w-4 ${activeTab.iconColor}`} />
          </div>
          <div className="space-y-0.5">
            <h2 className="font-display text-lg font-medium leading-tight">{activeTab.label}</h2>
            <p className="text-xs text-muted-foreground">{activeTab.description}</p>
          </div>
        </CardContent>
      </Card>

      {/* Contenuto tab */}
      {macroTab === 'proposals' && (
        <ProposalsTab
          selectedYear={selectedYear}
          statusFilter={statusFilter}
          onStatusFilterChange={setStatusFilter}
        />
      )}

      {macroTab === 'amendments' && <AmendmentsRequestsTab />}
      {macroTab === 'contract-types' && <ContractTypesPanel />}
    </div>
  );
}
