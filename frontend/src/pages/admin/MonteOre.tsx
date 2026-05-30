import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  CheckCircle2,
  Clock,
  FileSpreadsheet,
  Pencil,
  Plus,
  RotateCcw,
  ShieldAlert,
  Trash2,
  Unlock,
  Upload,
  XCircle,
  Zap,
  CalendarRange,
  ListChecks,
  GitPullRequest,
  Briefcase,
  type LucideIcon,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import {
  monteOreAdminApi,
  amendmentSummary,
  type MonteOreProposal,
  type MonteOreSchedule,
  type SchedulePayload,
  type MonteOreAmendment,
} from '@/api/monteOre';
import { roomsApi } from '@/api/rooms';
import { httpErrorMessage } from '@/lib/api';
import { ContractTypesPanel } from '@/components/admin/ContractTypesPanel';
import { AdminAcademicYearSelector } from '@/components/monteOre/AcademicYearSelector';
import { ImportExcelDialog } from '@/components/monteOre/ImportExcelDialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
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
import { sortRoomsCrossBuilding } from '@/lib/sortRooms';
import type { BookingType } from '@/types';

const DAYS_IT = ['Domenica', 'Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato'];
const TYPE_OPTIONS: { value: BookingType; label: string }[] = [
  { value: 'lezione', label: 'Lezione' },
  { value: 'studio_individuale', label: 'Studio individuale' },
  { value: 'prova', label: 'Prova' },
  { value: 'concerto', label: 'Concerto' },
];

const STATUS_LABEL: Record<MonteOreProposal['status'], string> = {
  draft: 'Bozza',
  submitted: 'In attesa',
  approved: 'Approvata',
  rejected: 'Rifiutata',
  generated: 'Prenotazioni create',
};

const STATUS_VARIANT: Record<
  MonteOreProposal['status'],
  'success' | 'secondary' | 'destructive' | 'muted'
> = {
  draft: 'muted',
  submitted: 'secondary',
  approved: 'success',
  rejected: 'destructive',
  generated: 'success',
};

const CONTRACT_LABEL: Record<
  NonNullable<NonNullable<MonteOreProposal['user']>['contractType']>,
  string
> = {
  titolare: 'Titolare',
  contratto_orario: 'Contratto orario',
  supplente: 'Supplente',
  altro: 'Altro',
};

const CCNL_STANDARD_HOURS = 324;

/**
 * Risolve la soglia ore annue applicabile a un docente per la UI admin:
 *   1. snapshot della proposta (immutabile, fissato al submit) →
 *   2. override individuale corrente sul docente →
 *   3. fallback CCNL standard 324h.
 *
 * `isCustom` distingue una soglia diversa dal CCNL standard (e quindi
 * meritevole di evidenziazione), indipendentemente dalla fonte. Una proposta
 * con snapshot=324 NON è "personalizzata" anche se la fonte è snapshot —
 * è semplicemente la soglia istituzionale congelata al submit.
 */
function resolveProposalThreshold(p: MonteOreProposal): {
  hours: number;
  source: 'snapshot' | 'override' | 'ccnl';
  isCustom: boolean;
  contractType: NonNullable<MonteOreProposal['user']>['contractType'] | null;
} {
  const ct = p.user?.contractType ?? null;
  // Lo snapshot è la "fotografia contrattuale" del momento del submit:
  // resta valido anche se l'admin rimuove o modifica l'override in seguito.
  if (p.minRequiredHoursSnapshot != null) {
    const hours = p.minRequiredHoursSnapshot;
    return {
      hours,
      source: 'snapshot',
      isCustom: hours !== CCNL_STANDARD_HOURS,
      contractType: ct,
    };
  }
  // Proposta non ancora submitted: applichiamo l'override corrente del docente
  // (se presente). Il valore mostrato è "previsionale" — diventerà snapshot al submit.
  if (p.user?.monteOreAnnualHoursOverride != null) {
    return {
      hours: p.user.monteOreAnnualHoursOverride,
      source: 'override',
      isCustom: true,
      contractType: ct,
    };
  }
  return { hours: CCNL_STANDARD_HOURS, source: 'ccnl', isCustom: false, contractType: ct };
}

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
  const qc = useQueryClient();
  const [macroTab, setMacroTab] = useState<MacroTab>('proposals');
  const [statusFilter, setStatusFilter] = useState<MonteOreProposal['status'] | 'all'>('submitted');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  // AA selezionato globalmente per la pagina admin (proposals, amendments,
  // ecc.). Risolto al primo render dal componente AdminAcademicYearSelector
  // (storage > default backend).
  const [selectedYear, setSelectedYear] = useState<string | undefined>(undefined);
  // Dialog import Excel monte ore (admin → POST /api/admin/monte-ore/import).
  // L'AA viene letto dal file, ma passiamo `selectedYear` come info display.
  const [importOpen, setImportOpen] = useState(false);

  const listQuery = useQuery({
    queryKey: ['admin', 'monte-ore', 'list', statusFilter, selectedYear],
    queryFn: () =>
      monteOreAdminApi.list({
        ...(statusFilter === 'all' ? {} : { status: statusFilter }),
        ...(selectedYear ? { academicYear: selectedYear } : {}),
      }),
    enabled: macroTab === 'proposals' && !!selectedYear,
  });

  // Counter per badge "richieste in attesa" sulla tab
  const pendingCountQuery = useQuery({
    queryKey: ['admin', 'monte-ore', 'amendments', 'pending-count'],
    queryFn: () => monteOreAdminApi.pendingAmendmentsCount(),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
  const pendingCount = pendingCountQuery.data?.count ?? 0;

  const proposals = listQuery.data?.proposals ?? [];
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
        <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
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
              className={`flex items-center gap-2 rounded-lg px-3 py-2.5 text-left transition-all ${
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
        <CardContent className="flex items-start gap-3 p-4">
          <div className={`mt-0.5 rounded-lg p-2 ${activeTab.iconBg}`}>
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
        <>
          <Card>
            <CardContent className="flex flex-wrap items-center gap-3 p-4">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                Filtra:
              </Label>
              {(['submitted', 'approved', 'generated', 'rejected', 'draft', 'all'] as const).map(
                (s) => (
                  <Button
                    key={s}
                    variant={statusFilter === s ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setStatusFilter(s)}
                  >
                    {s === 'all' ? 'Tutte' : STATUS_LABEL[s]}
                  </Button>
                ),
              )}
              <span className="ml-auto text-xs text-muted-foreground">
                {proposals.length} proposte
              </span>
            </CardContent>
          </Card>

          {listQuery.isLoading ? (
            <Skeleton className="h-64 w-full" />
          ) : proposals.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center text-sm text-muted-foreground">
                Nessuna proposta in questo stato.
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-3">
              {proposals.map((p) => {
                const threshold = resolveProposalThreshold(p);
                const meetsThreshold = p.totalHoursRequested >= threshold.hours;
                return (
                  <Card
                    key={p.id}
                    className="cursor-pointer transition hover:shadow-md"
                    onClick={() => setSelectedId(p.id)}
                  >
                    <CardContent className="grid gap-3 p-4 sm:grid-cols-[1fr_auto_auto_auto] sm:items-center">
                      <div>
                        <p className="font-medium flex items-center gap-2 flex-wrap">
                          {p.user ? `${p.user.lastName} ${p.user.firstName}` : `User #${p.userId}`}
                          {threshold.contractType && threshold.contractType !== 'titolare' && (
                            <Badge variant="secondary" className="text-[10px]">
                              {CONTRACT_LABEL[threshold.contractType]}
                            </Badge>
                          )}
                          {p.source === 'admin_import' && (
                            <Badge
                              variant="outline"
                              className="text-[10px] gap-1"
                              title={
                                p.importedAt
                                  ? `Importata da Excel il ${new Date(p.importedAt).toLocaleString('it-IT')}`
                                  : 'Proposta importata da Excel'
                              }
                            >
                              <Upload className="h-3 w-3" />
                              importata
                            </Badge>
                          )}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          AA {p.academicYear} · {p.schedules.length} fasce ·{' '}
                          <span
                            className={
                              meetsThreshold
                                ? 'text-emerald-600 dark:text-emerald-400 font-medium'
                                : 'text-amber-600 dark:text-amber-400 font-medium'
                            }
                          >
                            {p.totalHoursRequested.toFixed(1)} / {threshold.hours} h
                          </span>
                          {threshold.isCustom && (
                            <span className="ml-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                              (
                              {threshold.source === 'override'
                                ? 'override · non ancora submitted'
                                : 'soglia personalizzata'}
                              )
                            </span>
                          )}
                        </p>
                      </div>
                      <Badge variant={STATUS_VARIANT[p.status]}>{STATUS_LABEL[p.status]}</Badge>
                      <p className="text-xs text-muted-foreground">
                        Inviata:{' '}
                        {p.submittedAt ? new Date(p.submittedAt).toLocaleDateString('it-IT') : '—'}
                      </p>
                      <Button variant="outline" size="sm">
                        Apri
                      </Button>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </>
      )}

      {macroTab === 'amendments' && <AmendmentsRequestsTab />}
      {macroTab === 'contract-types' && <ContractTypesPanel />}

      {/* Detail dialog */}
      {selectedId !== null && (
        <DetailDialog
          id={selectedId}
          onClose={() => setSelectedId(null)}
          onChanged={() => {
            void qc.invalidateQueries({ queryKey: ['admin', 'monte-ore'] });
          }}
        />
      )}
    </div>
  );
}

// ============================================================
// Tab "Richieste variazioni" — lista globale degli amendments pending
// (cross-proposta) con approva/rifiuta inline.
// ============================================================

const AMENDMENT_KIND_LABEL_LOCAL: Record<MonteOreAmendment['kind'], string> = {
  toggle_off: 'Disattivazione',
  toggle_on: 'Riattivazione',
  change_time: 'Cambio orario',
  add_new_day: 'Nuovo giorno',
  change_room: 'Cambio aula',
  move_to: 'Spostamento',
};

/**
 * Bottoni di azione su un amendment pending (Approva / Rifiuta).
 * Per `add_new_day` apre un dialog che permette di assegnare/sovrascrivere
 * l'aula prima di approvare.
 */
function AmendmentActions({
  amendment,
  onApprove,
  onReject,
  isApproving,
  isRejecting,
}: {
  amendment: MonteOreAmendment;
  onApprove: (opts: { roomId?: number }) => void;
  onReject: (reason: string) => void;
  isApproving: boolean;
  isRejecting: boolean;
}) {
  const [approveOpen, setApproveOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const isAddNewDay = amendment.kind === 'add_new_day';

  const handleApprove = () => {
    if (isAddNewDay) setApproveOpen(true);
    else onApprove({});
  };

  return (
    <>
      <div className="inline-flex gap-1">
        <Button size="sm" variant="outline" onClick={handleApprove} disabled={isApproving}>
          <CheckCircle2 className="h-3.5 w-3.5" />
          Approva
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="text-destructive hover:bg-destructive/10"
          onClick={() => setRejectOpen(true)}
          disabled={isRejecting}
        >
          <XCircle className="h-3.5 w-3.5" />
          Rifiuta
        </Button>
      </div>
      {isAddNewDay && approveOpen && (
        <ApproveNewDayDialog
          amendment={amendment}
          onClose={() => setApproveOpen(false)}
          onSubmit={(roomId) => {
            onApprove({ roomId });
            setApproveOpen(false);
          }}
          isPending={isApproving}
        />
      )}
      {rejectOpen && (
        <RejectAmendmentDialog
          onClose={() => setRejectOpen(false)}
          onSubmit={(reason) => {
            onReject(reason);
            setRejectOpen(false);
          }}
          isPending={isRejecting}
        />
      )}
    </>
  );
}

function RejectAmendmentDialog({
  onClose,
  onSubmit,
  isPending,
}: {
  onClose: () => void;
  onSubmit: (reason: string) => void;
  isPending: boolean;
}) {
  const [reason, setReason] = useState('');
  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Rifiuta variazione</DialogTitle>
          <DialogDescription>
            Inserisci una motivazione (opzionale): verrà mostrata al docente.
          </DialogDescription>
        </DialogHeader>
        <Textarea
          rows={3}
          maxLength={1024}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Es. aula non disponibile per lavori"
        />
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isPending}>
            Annulla
          </Button>
          <Button
            variant="destructive"
            onClick={() => onSubmit(reason.trim())}
            disabled={isPending}
          >
            Rifiuta
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ApproveNewDayDialog({
  amendment,
  onClose,
  onSubmit,
  isPending,
}: {
  amendment: MonteOreAmendment;
  onClose: () => void;
  onSubmit: (roomId: number) => void;
  isPending: boolean;
}) {
  const payload = amendment.payload as {
    date?: string;
    startTime?: string;
    endTime?: string;
    roomId?: number | null;
    bookingType?: string;
  };
  const [roomId, setRoomId] = useState<number | null>(payload.roomId ?? null);

  const roomsQuery = useQuery({
    queryKey: ['rooms', 'bookable'],
    queryFn: () => roomsApi.list({ bookable: true }),
    staleTime: 60_000,
  });
  const sortedRooms = sortRoomsCrossBuilding(roomsQuery.data?.rooms ?? []);

  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Approva richiesta nuovo giorno</DialogTitle>
          <DialogDescription>
            {payload.date && payload.startTime && payload.endTime
              ? `${payload.date} · ${payload.startTime}–${payload.endTime}`
              : 'Richiesta giorno fuori pattern'}
            {payload.bookingType ? ` · ${payload.bookingType}` : ''}
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (roomId) onSubmit(roomId);
          }}
        >
          {amendment.requestNotes && (
            <div className="rounded-md border bg-muted/20 p-2 text-xs">
              <div className="text-muted-foreground">Note del docente:</div>
              <div className="mt-1">{amendment.requestNotes}</div>
            </div>
          )}
          <div className="space-y-2">
            <Label>Aula assegnata</Label>
            <Select
              value={roomId ? String(roomId) : ''}
              onValueChange={(v) => setRoomId(v ? Number(v) : null)}
            >
              <SelectTrigger>
                <SelectValue placeholder="— scegli aula —" />
              </SelectTrigger>
              <SelectContent>
                {sortedRooms.map((r) => (
                  <SelectItem key={r.id} value={String(r.id)}>
                    {r.name}
                    {r.building?.name ? ` · ${r.building.name}` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {payload.roomId ? (
              <p className="text-[11px] text-muted-foreground">
                Aula proposta dal docente preselezionata. Puoi sovrascriverla.
              </p>
            ) : (
              <p className="text-[11px] text-muted-foreground">
                Il docente non ha indicato l'aula: scegline una.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Annulla
            </Button>
            <Button type="submit" disabled={!roomId || isPending}>
              Approva
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function AmendmentsRequestsTab() {
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<'pending' | 'all'>('pending');
  const listQuery = useQuery({
    queryKey: ['admin', 'monte-ore', 'amendments', 'list', statusFilter],
    queryFn: () =>
      monteOreAdminApi.listAmendments(statusFilter === 'all' ? {} : { status: statusFilter }),
  });

  const approve = useMutation({
    mutationFn: ({ pid, aid, roomId }: { pid: number; aid: number; roomId?: number }) =>
      monteOreAdminApi.approveAmendment(pid, aid, roomId ? { roomId } : {}),
    onSuccess: () => {
      toast.success('Variazione approvata');
      void qc.invalidateQueries({ queryKey: ['admin', 'monte-ore', 'amendments'] });
    },
    onError: (err) => toast.error(httpErrorMessage(err)),
  });

  const reject = useMutation({
    mutationFn: ({ pid, aid, reason }: { pid: number; aid: number; reason: string }) =>
      monteOreAdminApi.rejectAmendment(pid, aid, reason),
    onSuccess: () => {
      toast.success('Variazione rifiutata');
      void qc.invalidateQueries({ queryKey: ['admin', 'monte-ore', 'amendments'] });
    },
    onError: (err) => toast.error(httpErrorMessage(err)),
  });

  const items = listQuery.data?.amendments ?? [];

  return (
    <>
      <Card>
        <CardContent className="flex flex-wrap items-center gap-3 p-4">
          <Label className="text-xs uppercase tracking-wider text-muted-foreground">Filtra:</Label>
          {(['pending', 'all'] as const).map((s) => (
            <Button
              key={s}
              variant={statusFilter === s ? 'default' : 'outline'}
              size="sm"
              onClick={() => setStatusFilter(s)}
            >
              {s === 'pending' ? 'In attesa' : 'Tutte'}
            </Button>
          ))}
          <span className="ml-auto text-xs text-muted-foreground">{items.length} richieste</span>
        </CardContent>
      </Card>

      {listQuery.isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : items.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            Nessuna richiesta di variazione{statusFilter === 'pending' ? ' in attesa' : ''}.
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/30 text-left text-xs uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2">Docente</th>
                    <th className="px-3 py-2">Tipo</th>
                    <th className="px-3 py-2">Cella</th>
                    <th className="px-3 py-2">Note</th>
                    <th className="px-3 py-2">Stato</th>
                    <th className="px-3 py-2 text-right">Azioni</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((a) => (
                    <tr key={a.id} className="border-b last:border-0 align-top">
                      <td className="px-3 py-2">
                        <div className="font-medium">
                          {a.requester
                            ? `${a.requester.lastName} ${a.requester.firstName}`
                            : `User #${a.requesterId}`}
                        </div>
                        {a.proposal && (
                          <div className="text-xs text-muted-foreground">
                            AA {a.proposal.academicYear}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2">{AMENDMENT_KIND_LABEL_LOCAL[a.kind]}</td>
                      <td className="px-3 py-2 tabular-nums text-xs text-muted-foreground">
                        {amendmentSummary(a)}
                      </td>
                      <td className="px-3 py-2 text-xs text-muted-foreground max-w-[260px]">
                        {a.requestNotes ?? (
                          <span className="italic text-muted-foreground/60">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <Badge
                          variant={
                            a.status === 'auto_approved' || a.status === 'approved'
                              ? 'success'
                              : a.status === 'rejected'
                                ? 'destructive'
                                : 'secondary'
                          }
                        >
                          {a.status === 'pending' && 'In attesa'}
                          {a.status === 'auto_approved' && 'Auto-approvata'}
                          {a.status === 'approved' && 'Approvata'}
                          {a.status === 'rejected' && 'Rifiutata'}
                        </Badge>
                      </td>
                      <td className="px-3 py-2 text-right">
                        {a.status === 'pending' && (
                          <AmendmentActions
                            amendment={a}
                            onApprove={(opts) =>
                              approve.mutate({ pid: a.proposalId, aid: a.id, roomId: opts.roomId })
                            }
                            onReject={(reason) =>
                              reject.mutate({ pid: a.proposalId, aid: a.id, reason })
                            }
                            isApproving={approve.isPending}
                            isRejecting={reject.isPending}
                          />
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </>
  );
}

// ============================================================
// Dettaglio proposta — modale grande con tutto il workflow
// ============================================================

function DetailDialog({
  id,
  onClose,
  onChanged,
}: {
  id: number;
  onClose: () => void;
  onChanged: () => void;
}) {
  const qc = useQueryClient();
  const detailQuery = useQuery({
    queryKey: ['admin', 'monte-ore', id],
    queryFn: () => monteOreAdminApi.get(id),
  });
  const proposal = detailQuery.data?.proposal;

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['admin', 'monte-ore', id] });
    onChanged();
  };

  const approveMutation = useMutation({
    mutationFn: () => monteOreAdminApi.approve(id),
    onSuccess: () => {
      toast.success('Proposta approvata');
      refresh();
    },
    onError: (err) => toast.error(httpErrorMessage(err)),
  });
  const rejectMutation = useMutation({
    mutationFn: (reason: string) => monteOreAdminApi.reject(id, reason),
    onSuccess: () => {
      toast.success('Proposta rifiutata');
      refresh();
    },
    onError: (err) => toast.error(httpErrorMessage(err)),
  });
  const generateMutation = useMutation({
    mutationFn: (includePast: boolean) => monteOreAdminApi.generate(id, { includePast }),
    onSuccess: (data) => {
      toast.success(
        `Prenotazioni create: ${data.result.created}` +
          (data.result.skipped.length ? ` (${data.result.skipped.length} saltate)` : ''),
      );
      refresh();
    },
    onError: (err) => toast.error(httpErrorMessage(err)),
  });
  const unlockMutation = useMutation({
    mutationFn: () => monteOreAdminApi.unlock(id),
    onSuccess: (data) => {
      toast.success(`Prenotazioni cancellate: ${data.cleared.cleared}`);
      refresh();
    },
    onError: (err) => toast.error(httpErrorMessage(err)),
  });
  // Fase 6.4 — riporta la proposta in 'draft' chiedendo al docente di modificarla.
  // Per 'generated' va prima eseguito unlock (che cancella i Booking generati).
  const revertMutation = useMutation({
    mutationFn: (reason: string) => monteOreAdminApi.revertToDraft(id, reason),
    onSuccess: () => {
      toast.success('Proposta riportata in bozza: il docente è stato avvisato');
      refresh();
    },
    onError: (err) => toast.error(httpErrorMessage(err)),
  });

  const [editingSchedule, setEditingSchedule] = useState<MonteOreSchedule | null>(null);
  const [adding, setAdding] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [confirmReject, setConfirmReject] = useState(false);
  const [confirmGenerate, setConfirmGenerate] = useState(false);
  const [includePast, setIncludePast] = useState(false);
  const [confirmRevert, setConfirmRevert] = useState(false);
  const [revertReason, setRevertReason] = useState('');

  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        {detailQuery.isLoading || !proposal ? (
          <div className="space-y-3 py-8">
            <Skeleton className="h-6 w-48" />
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-64 w-full" />
          </div>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-2 flex-wrap">
                  {proposal.user
                    ? `${proposal.user.lastName} ${proposal.user.firstName}`
                    : 'Proposta'}
                  {(() => {
                    const ct = proposal.user?.contractType;
                    return ct && ct !== 'titolare' ? (
                      <Badge variant="secondary" className="text-[10px]">
                        {CONTRACT_LABEL[ct]}
                      </Badge>
                    ) : null;
                  })()}
                </span>
                <Badge variant={STATUS_VARIANT[proposal.status]}>
                  {STATUS_LABEL[proposal.status]}
                </Badge>
              </DialogTitle>
              <DialogDescription>
                AA {proposal.academicYear} · validità {proposal.validFrom} → {proposal.validTo}
              </DialogDescription>
            </DialogHeader>

            {/* Riepilogo soglia ore: prominente, con confronto vs threshold. */}
            {(() => {
              const threshold = resolveProposalThreshold(proposal);
              const meets = proposal.totalHoursRequested >= threshold.hours;
              return (
                <div
                  className={`rounded-lg border p-3 text-sm ${
                    meets
                      ? 'border-emerald-200 bg-emerald-50/50 dark:border-emerald-900 dark:bg-emerald-950/20'
                      : 'border-amber-200 bg-amber-50/50 dark:border-amber-900 dark:bg-amber-950/20'
                  }`}
                >
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div>
                      <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
                        Ore proposte / soglia annua
                      </Label>
                      <p className="font-display text-2xl font-medium tabular-nums leading-tight">
                        <span
                          className={
                            meets
                              ? 'text-emerald-700 dark:text-emerald-400'
                              : 'text-amber-700 dark:text-amber-400'
                          }
                        >
                          {proposal.totalHoursRequested.toFixed(1)}
                        </span>
                        <span className="text-muted-foreground"> / {threshold.hours} h</span>
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
                        Origine soglia
                      </p>
                      <p className="text-sm font-medium">
                        {threshold.source === 'snapshot' &&
                          (threshold.isCustom
                            ? 'Snapshot al submit · soglia personalizzata'
                            : 'Snapshot al submit · CCNL 324h')}
                        {threshold.source === 'override' &&
                          'Deroga individuale (proposta non ancora submitted)'}
                        {threshold.source === 'ccnl' && 'CCNL standard 324h'}
                      </p>
                      {threshold.isCustom && proposal.user?.monteOreOverrideReason && (
                        <p className="mt-1 text-[11px] text-muted-foreground max-w-xs">
                          {proposal.user.monteOreOverrideReason}
                        </p>
                      )}
                    </div>
                  </div>
                  {!meets && (
                    <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">
                      Mancano {(threshold.hours - proposal.totalHoursRequested).toFixed(1)} h al
                      raggiungimento della soglia.
                    </p>
                  )}
                  {proposal.user?.monteOreBypassDayConstraint && (
                    <p className="mt-2 text-xs text-muted-foreground">
                      ⓘ Esente dal vincolo 2-4 giorni/settimana.
                    </p>
                  )}
                </div>
              );
            })()}

            {proposal.notes && (
              <div className="rounded-lg border bg-muted/30 p-3 text-sm">
                <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
                  Note del docente
                </Label>
                <p className="mt-1 whitespace-pre-wrap">{proposal.notes}</p>
              </div>
            )}

            {proposal.source === 'admin_import' && (
              <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm">
                <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
                  Origine
                </Label>
                <p className="mt-1 flex items-center gap-2">
                  <Upload className="h-4 w-4 text-primary" />
                  Importata da Excel
                  {proposal.importedAt && (
                    <span className="text-muted-foreground">
                      · il {new Date(proposal.importedAt).toLocaleString('it-IT')}
                    </span>
                  )}
                </p>
                {proposal.importSourceRef && (
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    File: <span className="font-mono">{proposal.importSourceRef}</span>
                  </p>
                )}
              </div>
            )}

            {proposal.status === 'rejected' && proposal.rejectionReason && (
              <div className="rounded-lg border border-destructive/50 bg-destructive/5 p-3 text-sm">
                <Label className="text-[11px] uppercase tracking-wider text-destructive">
                  Motivo del rifiuto
                </Label>
                <p className="mt-1 whitespace-pre-wrap">{proposal.rejectionReason}</p>
              </div>
            )}

            {proposal.generationSummary && (
              <div className="rounded-lg border bg-muted/30 p-3 text-sm">
                <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
                  Esito generazione
                </Label>
                <p className="mt-1">
                  <strong>{proposal.generationSummary.created}</strong> prenotazioni create
                  {proposal.generationSummary.skipped > 0 && (
                    <>
                      , <strong>{proposal.generationSummary.skipped}</strong> saltate per conflitto
                    </>
                  )}
                  {proposal.generationSummary.errors > 0 && (
                    <>
                      , <strong>{proposal.generationSummary.errors}</strong> errori
                    </>
                  )}
                  .
                </p>
              </div>
            )}

            {/* Tabella fasce */}
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-3">
                <CardTitle className="text-base">Fasce orarie</CardTitle>
                {proposal.status !== 'generated' && (
                  <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
                    <Plus className="h-4 w-4" />
                    Aggiungi
                  </Button>
                )}
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="border-b text-left text-xs uppercase tracking-wider text-muted-foreground">
                      <tr>
                        <th className="px-3 py-2">Giorno</th>
                        <th className="px-3 py-2">Orario</th>
                        <th className="px-3 py-2">Aula</th>
                        <th className="px-3 py-2">Tipo</th>
                        <th className="px-3 py-2">Attività</th>
                        {proposal.status !== 'generated' && (
                          <th className="px-3 py-2 text-right">Azioni</th>
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {proposal.schedules.map((s) => (
                        <tr key={s.id} className="border-b last:border-0">
                          <td className="px-3 py-2 font-medium">{DAYS_IT[s.dayOfWeek]}</td>
                          <td className="px-3 py-2 tabular-nums">
                            {s.startTime}–{s.endTime}
                          </td>
                          <td
                            className={`px-3 py-2 ${s.room ? '' : 'text-amber-600 dark:text-amber-400'}`}
                          >
                            {s.room
                              ? `${s.room.name}${s.room.building ? ' · ' + s.room.building.name : ''}`
                              : '— DA ASSEGNARE —'}
                          </td>
                          <td className="px-3 py-2">
                            {TYPE_OPTIONS.find((o) => o.value === s.bookingType)?.label ??
                              s.bookingType}
                          </td>
                          <td className="px-3 py-2 text-muted-foreground">{s.purpose ?? ''}</td>
                          {proposal.status !== 'generated' && (
                            <td className="px-3 py-2 text-right">
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => setEditingSchedule(s)}
                              >
                                <Pencil className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="text-destructive"
                                onClick={async () => {
                                  await monteOreAdminApi.removeSchedule(id, s.id);
                                  refresh();
                                }}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>

            {/* Sezione amendments (solo se la proposta è approved/generated) */}
            {['approved', 'generated'].includes(proposal.status) && (
              <AmendmentsSection proposalId={proposal.id} onAfterDecision={refresh} />
            )}

            {/* Footer azioni stato-dipendenti */}
            <DialogFooter className="flex flex-wrap gap-2 sm:justify-between">
              <Button variant="outline" onClick={onClose}>
                Chiudi
              </Button>
              <div className="flex flex-wrap gap-2">
                {proposal.status === 'submitted' && (
                  <>
                    <Button
                      variant="outline"
                      onClick={() => setConfirmRevert(true)}
                      title="Riporta la proposta in bozza al docente"
                    >
                      <RotateCcw className="h-4 w-4" />
                      Richiedi modifica
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => setConfirmReject(true)}
                      className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                    >
                      <XCircle className="h-4 w-4" />
                      Rifiuta
                    </Button>
                    <Button
                      onClick={() => approveMutation.mutate()}
                      disabled={approveMutation.isPending}
                    >
                      <CheckCircle2 className="h-4 w-4" />
                      Approva
                    </Button>
                  </>
                )}
                {proposal.status === 'approved' && (
                  <>
                    <Button
                      variant="outline"
                      onClick={() => setConfirmRevert(true)}
                      title="Riporta la proposta in bozza al docente"
                    >
                      <RotateCcw className="h-4 w-4" />
                      Richiedi modifica
                    </Button>
                    <Button
                      onClick={() => {
                        setIncludePast(false);
                        setConfirmGenerate(true);
                      }}
                      disabled={
                        generateMutation.isPending ||
                        proposal.schedules.length === 0 ||
                        proposal.schedules.some((s) => !s.roomId)
                      }
                    >
                      <Zap className="h-4 w-4" />
                      Crea prenotazioni dal monte ore
                    </Button>
                  </>
                )}
                {proposal.status === 'generated' && (
                  <Button
                    variant="outline"
                    onClick={() => unlockMutation.mutate()}
                    disabled={unlockMutation.isPending}
                    title="Cancella i Booking generati e riporta la proposta a 'approved'. Per chiedere modifica al docente, esegui poi 'Richiedi modifica'."
                  >
                    <Unlock className="h-4 w-4" />
                    Annulla generazione
                  </Button>
                )}
              </div>
            </DialogFooter>

            {/* Edit/add schedule */}
            <ScheduleEditDialog
              open={adding || editingSchedule !== null}
              onClose={() => {
                setAdding(false);
                setEditingSchedule(null);
              }}
              proposalId={id}
              existing={editingSchedule}
              onSaved={refresh}
            />

            {/* Generate confirmation dialog (con opzione "includi date passate") */}
            <Dialog open={confirmGenerate} onOpenChange={setConfirmGenerate}>
              <DialogContent className="sm:max-w-md">
                <DialogHeader>
                  <DialogTitle>Crea prenotazioni dal monte ore</DialogTitle>
                  <DialogDescription>
                    Verranno create prenotazioni ricorrenti per ogni occorrenza del pattern nel
                    range di validità della proposta.
                  </DialogDescription>
                </DialogHeader>
                <label className="flex items-start gap-3 rounded-lg border p-3 cursor-pointer hover:bg-muted/30">
                  <input
                    type="checkbox"
                    className="mt-0.5 h-4 w-4"
                    checked={includePast}
                    onChange={(e) => setIncludePast(e.target.checked)}
                  />
                  <div className="text-sm">
                    <div className="font-medium">Includi anche le date già trascorse</div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      Materializza in Booking anche le occorrenze del pattern che cadono prima di
                      oggi (utile per ricostruire monte ore arretrato a metà AA, o per registrazione
                      contabile dell'attività già svolta).
                    </div>
                  </div>
                </label>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setConfirmGenerate(false)}>
                    Annulla
                  </Button>
                  <Button
                    onClick={() => {
                      generateMutation.mutate(includePast);
                      setConfirmGenerate(false);
                    }}
                    disabled={generateMutation.isPending}
                  >
                    <Zap className="h-4 w-4" />
                    Genera
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            {/* Revert-to-draft dialog (Fase 6.4) */}
            <Dialog open={confirmRevert} onOpenChange={setConfirmRevert}>
              <DialogContent className="sm:max-w-md">
                <DialogHeader>
                  <DialogTitle>Richiedi modifica al docente</DialogTitle>
                  <DialogDescription>
                    La proposta torna in <strong>bozza</strong>: il docente vedrà un banner con il
                    motivo, potrà modificare le fasce e re-inviare. La cronologia delle variazioni
                    resta tracciata.
                  </DialogDescription>
                </DialogHeader>
                <Textarea
                  rows={3}
                  maxLength={500}
                  value={revertReason}
                  onChange={(e) => setRevertReason(e.target.value)}
                  placeholder="Es. variazione contratto: rivedi le ore totali. Oppure: aula assegnata non più disponibile, scegline un'altra."
                />
                <DialogFooter>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setConfirmRevert(false);
                      setRevertReason('');
                    }}
                  >
                    Annulla
                  </Button>
                  <Button
                    onClick={() => {
                      revertMutation.mutate(revertReason.trim());
                      setConfirmRevert(false);
                      setRevertReason('');
                    }}
                    disabled={revertMutation.isPending}
                  >
                    <RotateCcw className="h-4 w-4" />
                    Riporta in bozza
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            {/* Reject reason dialog */}
            <Dialog open={confirmReject} onOpenChange={setConfirmReject}>
              <DialogContent className="sm:max-w-md">
                <DialogHeader>
                  <DialogTitle>Rifiuta proposta</DialogTitle>
                  <DialogDescription>
                    Indica un motivo (sarà visibile al docente).
                  </DialogDescription>
                </DialogHeader>
                <Textarea
                  rows={3}
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  placeholder="Es. monte ore eccessivo, conflitto con altro docente…"
                />
                <DialogFooter>
                  <Button variant="outline" onClick={() => setConfirmReject(false)}>
                    Annulla
                  </Button>
                  <Button
                    variant="destructive"
                    onClick={() => {
                      rejectMutation.mutate(rejectReason);
                      setConfirmReject(false);
                    }}
                    disabled={rejectMutation.isPending}
                  >
                    Conferma rifiuto
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ============================================================
// Schedule edit dialog (admin variant — riusa l'API admin)
// ============================================================

function ScheduleEditDialog({
  open,
  onClose,
  proposalId,
  existing,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  proposalId: number;
  existing: MonteOreSchedule | null;
  onSaved: () => void;
}) {
  const isEdit = existing !== null;
  const roomsQuery = useQuery({
    queryKey: ['rooms', 'bookable'],
    queryFn: () => roomsApi.list({ bookable: true }),
    staleTime: 60_000,
  });

  const [form, setForm] = useState<SchedulePayload>(() => ({
    roomId: existing?.roomId ?? null,
    dayOfWeek: existing?.dayOfWeek ?? 1,
    startTime: existing?.startTime ?? '14:00',
    endTime: existing?.endTime ?? '16:00',
    bookingType: existing?.bookingType ?? 'lezione',
    purpose: existing?.purpose ?? '',
  }));

  useEffect(() => {
    if (!open) return;
    setForm({
      roomId: existing?.roomId ?? null,
      dayOfWeek: existing?.dayOfWeek ?? 1,
      startTime: existing?.startTime ?? '14:00',
      endTime: existing?.endTime ?? '16:00',
      bookingType: existing?.bookingType ?? 'lezione',
      purpose: existing?.purpose ?? '',
    });
  }, [open, existing]);

  const saveMutation = useMutation({
    mutationFn: () =>
      isEdit
        ? monteOreAdminApi.updateSchedule(proposalId, existing.id, form)
        : monteOreAdminApi.addSchedule(proposalId, form),
    onSuccess: () => {
      toast.success(isEdit ? 'Fascia aggiornata' : 'Fascia aggiunta');
      onSaved();
      onClose();
    },
    onError: (err) => toast.error(httpErrorMessage(err)),
  });

  const sortedRooms = sortRoomsCrossBuilding(roomsQuery.data?.rooms ?? []);

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Modifica fascia' : 'Nuova fascia'}</DialogTitle>
          {!form.roomId && (
            <DialogDescription className="text-amber-600 dark:text-amber-400">
              <ShieldAlert className="mr-1 inline h-4 w-4" />
              Per generare le prenotazioni l'aula è obbligatoria.
            </DialogDescription>
          )}
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            saveMutation.mutate();
          }}
        >
          <div className="space-y-2">
            <Label>Giorno</Label>
            <Select
              value={String(form.dayOfWeek)}
              onValueChange={(v) => setForm((f) => ({ ...f, dayOfWeek: Number(v) }))}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[1, 2, 3, 4, 5, 6, 0].map((d) => (
                  <SelectItem key={d} value={String(d)}>
                    {DAYS_IT[d]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Inizio</Label>
              <Input
                type="time"
                value={form.startTime}
                onChange={(e) => setForm((f) => ({ ...f, startTime: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label>Fine</Label>
              <Input
                type="time"
                value={form.endTime}
                onChange={(e) => setForm((f) => ({ ...f, endTime: e.target.value }))}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Aula assegnata</Label>
            <Select
              value={form.roomId ? String(form.roomId) : 'any'}
              onValueChange={(v) =>
                setForm((f) => ({ ...f, roomId: v === 'any' ? null : Number(v) }))
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="any">— da assegnare —</SelectItem>
                {sortedRooms.map((r) => (
                  <SelectItem key={r.id} value={String(r.id)}>
                    {r.name}
                    {r.building?.name ? ` · ${r.building.name}` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Tipo</Label>
            <Select
              value={form.bookingType}
              onValueChange={(v) => setForm((f) => ({ ...f, bookingType: v as BookingType }))}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TYPE_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Etichetta</Label>
            <Input
              value={form.purpose ?? ''}
              maxLength={255}
              onChange={(e) => setForm((f) => ({ ...f, purpose: e.target.value }))}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Annulla
            </Button>
            <Button type="submit" disabled={saveMutation.isPending}>
              {isEdit ? 'Salva' : 'Aggiungi'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================
// Sezione richieste di variazione (post-approvazione)
// ============================================================

const AMENDMENT_KIND_LABEL: Record<MonteOreAmendment['kind'], string> = {
  toggle_off: 'Disattivazione',
  toggle_on: 'Riattivazione',
  change_time: 'Cambio orario',
  add_new_day: 'Nuovo giorno',
  change_room: 'Cambio aula',
  move_to: 'Spostamento',
};

function AmendmentsSection({
  proposalId,
  onAfterDecision,
}: {
  proposalId: number;
  onAfterDecision: () => void;
}) {
  const qc = useQueryClient();
  const amendmentsQuery = useQuery({
    queryKey: ['admin', 'monte-ore', 'amendments', proposalId],
    queryFn: () => monteOreAdminApi.listProposalAmendments(proposalId),
  });

  const approveMutation = useMutation({
    mutationFn: ({ aid, roomId }: { aid: number; roomId?: number }) =>
      monteOreAdminApi.approveAmendment(proposalId, aid, roomId ? { roomId } : {}),
    onSuccess: () => {
      toast.success('Variazione approvata');
      void qc.invalidateQueries({ queryKey: ['admin', 'monte-ore', 'amendments', proposalId] });
      onAfterDecision();
    },
    onError: (err) => toast.error(httpErrorMessage(err)),
  });

  const rejectMutation = useMutation({
    mutationFn: ({ aid, reason }: { aid: number; reason: string }) =>
      monteOreAdminApi.rejectAmendment(proposalId, aid, reason),
    onSuccess: () => {
      toast.success('Variazione rifiutata');
      void qc.invalidateQueries({ queryKey: ['admin', 'monte-ore', 'amendments', proposalId] });
      onAfterDecision();
    },
    onError: (err) => toast.error(httpErrorMessage(err)),
  });

  const items = amendmentsQuery.data?.amendments ?? [];
  const pending = items.filter((a) => a.status === 'pending');
  const decided = items.filter((a) => a.status !== 'pending');

  if (amendmentsQuery.isLoading) return <Skeleton className="h-24 w-full" />;
  if (items.length === 0) return null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">
          Richieste di variazione
          {pending.length > 0 && (
            <Badge variant="secondary" className="ml-2">
              {pending.length} in attesa
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b text-left text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Tipo</th>
                <th className="px-3 py-2">Cella</th>
                <th className="px-3 py-2">Stato</th>
                <th className="px-3 py-2 text-right">Azioni</th>
              </tr>
            </thead>
            <tbody>
              {[...pending, ...decided].map((a) => (
                <tr key={a.id} className="border-b last:border-0">
                  <td className="px-3 py-2">{AMENDMENT_KIND_LABEL[a.kind]}</td>
                  <td className="px-3 py-2 tabular-nums text-xs text-muted-foreground">
                    {amendmentSummary(a)}
                  </td>
                  <td className="px-3 py-2">
                    <Badge
                      variant={
                        a.status === 'auto_approved' || a.status === 'approved'
                          ? 'success'
                          : a.status === 'rejected'
                            ? 'destructive'
                            : 'secondary'
                      }
                    >
                      {a.status === 'pending' && 'In attesa'}
                      {a.status === 'auto_approved' && 'Auto-approvata'}
                      {a.status === 'approved' && 'Approvata'}
                      {a.status === 'rejected' && 'Rifiutata'}
                    </Badge>
                  </td>
                  <td className="px-3 py-2 text-right">
                    {a.status === 'pending' && (
                      <AmendmentActions
                        amendment={a}
                        onApprove={(opts) =>
                          approveMutation.mutate({ aid: a.id, roomId: opts.roomId })
                        }
                        onReject={(reason) => rejectMutation.mutate({ aid: a.id, reason })}
                        isApproving={approveMutation.isPending}
                        isRejecting={rejectMutation.isPending}
                      />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
