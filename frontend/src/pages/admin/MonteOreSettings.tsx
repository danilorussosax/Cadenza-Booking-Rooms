import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  CalendarRange,
  Save,
  Plus,
  Trash2,
  Pencil,
  ArrowLeft,
  AlertCircle,
  Download,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import {
  monteOreAdminApi,
  type MonteOreSettings,
  type MonteOreSuspension,
  type SuspensionKind,
} from '@/api/monteOre';
import { httpErrorMessage } from '@/lib/api';
import { AdminAcademicYearSelector } from '@/components/monteOre/AcademicYearSelector';
import { ExamSessionsEditor } from '@/components/monteOre/ExamSessionsEditor';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

export default function AdminMonteOreSettings() {
  const qc = useQueryClient();
  // AA selezionato — risolto dal selettore (storage > default).
  const [year, setYear] = useState<string | undefined>(undefined);
  const [downloading, setDownloading] = useState(false);

  const settingsQuery = useQuery({
    queryKey: ['admin', 'monte-ore', 'settings', year],
    queryFn: () => monteOreAdminApi.getSettings(year),
    enabled: !!year,
  });

  const suspensionsQuery = useQuery({
    queryKey: ['admin', 'monte-ore', 'suspensions', year],
    queryFn: () => monteOreAdminApi.listSuspensions(year),
    enabled: !!year,
  });

  const updateMutation = useMutation({
    mutationFn: (payload: Partial<MonteOreSettings>) =>
      monteOreAdminApi.updateSettings({ ...payload, academicYear: year }),
    onSuccess: () => {
      toast.success('Impostazioni salvate');
      void qc.invalidateQueries({ queryKey: ['admin', 'monte-ore', 'settings'] });
    },
    onError: (err) => toast.error(httpErrorMessage(err)),
  });

  const settings = settingsQuery.data?.settings;
  const suspensions = suspensionsQuery.data?.suspensions ?? [];

  /**
   * Scarica il template Excel pre-popolato per l'AA selezionato.
   * Usa il helper che gestisce il Bearer via fetch + blob (un <a download>
   * diretto non propagherebbe l'header Authorization).
   */
  const handleDownloadTemplate = async () => {
    if (!year) return;
    try {
      setDownloading(true);
      await monteOreAdminApi.downloadImportTemplate(year);
      toast.success('Template Excel scaricato');
    } catch (err) {
      toast.error(httpErrorMessage(err));
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-medium inline-flex items-center gap-2">
            <CalendarRange className="h-6 w-6 text-primary" />
            Calendario didattico Monte Ore
          </h1>
          <p className="text-sm text-muted-foreground">
            Configura periodo lezioni, finestra inserimento e festività per l'anno accademico.
          </p>
        </div>
        <Button variant="outline" asChild>
          <Link to="/admin/monte-ore">
            <ArrowLeft className="h-4 w-4" /> Torna alle proposte
          </Link>
        </Button>
      </header>

      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4 sm:p-6">
          <AdminAcademicYearSelector value={year} onChange={setYear} />
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleDownloadTemplate}
              disabled={!year || downloading}
            >
              <Download className="h-4 w-4" />
              {downloading ? 'Download…' : 'Scarica template Excel'}
            </Button>
            <span className="text-xs text-muted-foreground">
              Anno conservatorio: 1 nov → 31 ott
            </span>
          </div>
        </CardContent>
      </Card>

      {!year ? (
        <Skeleton className="h-72 w-full" />
      ) : settingsQuery.isLoading ? (
        <Skeleton className="h-72 w-full" />
      ) : settings ? (
        <SettingsForm
          settings={settings}
          onSave={(p) => updateMutation.mutate(p)}
          saving={updateMutation.isPending}
        />
      ) : (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>Impossibile caricare le impostazioni.</AlertDescription>
        </Alert>
      )}

      {year && (
        <SuspensionsCard
          academicYear={year}
          suspensions={suspensions}
          loading={suspensionsQuery.isLoading}
        />
      )}

      {year && <ExamSessionsEditor academicYear={year} />}
    </div>
  );
}

/**
 * I 2 campi dailyBreak* sono un'unità logica: configurati insieme o nessuno
 * dei due. Lo stato "uno solo valorizzato" è incoerente — il backend lo
 * rifiuta con 400, ma vogliamo bloccare il salvataggio in UI prima del fetch.
 */
function hasBreakCoherenceError(form: Partial<MonteOreSettings>): boolean {
  const a = form.dailyBreakAfterHours;
  const b = form.dailyBreakMinutes;
  const aSet = a !== null && a !== undefined;
  const bSet = b !== null && b !== undefined;
  return aSet !== bSet;
}

/** Trasforma il valore di un input number (eventualmente vuoto) in number|null. */
function emptyToNull(v: string): number | null {
  const trimmed = v.trim();
  if (trimmed === '') return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

function DailyConstraintsSection({
  form,
  update,
}: {
  form: Partial<MonteOreSettings>;
  update: <K extends keyof MonteOreSettings>(k: K, v: MonteOreSettings[K]) => void;
}) {
  const breakError = hasBreakCoherenceError(form);
  return (
    <div className="rounded-md border border-border/60 bg-muted/30 p-4 space-y-4">
      <div>
        <h3 className="text-sm font-medium">Vincoli giornalieri (opzionali)</h3>
        <p className="text-xs text-muted-foreground mt-1">
          Limiti sul singolo giorno di lezione. Esempio: il Regolamento Tchaikovsky 2019 prevede max
          9h/giorno e pausa di 30 min dopo 7h consecutive. Adatta i valori al regolamento del tuo
          istituto. Lascia vuoti i campi per non applicare il vincolo.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <Label htmlFor="maxHoursPerDay">Max ore consecutive in un giorno</Label>
          <Input
            id="maxHoursPerDay"
            type="number"
            min={1}
            max={24}
            step={0.5}
            placeholder="es. 9"
            value={form.maxHoursPerDay ?? ''}
            onChange={(e) => update('maxHoursPerDay', emptyToNull(e.target.value))}
          />
          <p className="text-[11px] text-muted-foreground mt-1">vuoto = nessun limite</p>
        </div>
        <div>
          <Label htmlFor="dailyBreakAfterHours">Pausa obbligatoria dopo (ore)</Label>
          <Input
            id="dailyBreakAfterHours"
            type="number"
            min={1}
            max={24}
            step={0.5}
            placeholder="es. 7"
            value={form.dailyBreakAfterHours ?? ''}
            onChange={(e) => update('dailyBreakAfterHours', emptyToNull(e.target.value))}
            aria-invalid={breakError}
          />
        </div>
        <div>
          <Label htmlFor="dailyBreakMinutes">Durata pausa (minuti)</Label>
          <Input
            id="dailyBreakMinutes"
            type="number"
            min={1}
            max={480}
            step={1}
            placeholder="es. 30"
            value={form.dailyBreakMinutes ?? ''}
            onChange={(e) => update('dailyBreakMinutes', emptyToNull(e.target.value))}
            aria-invalid={breakError}
          />
        </div>
      </div>
      {breakError && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            Compila entrambi i campi della pausa (ore + minuti), oppure lasciali entrambi vuoti.
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}

function SettingsForm({
  settings,
  onSave,
  saving,
}: {
  settings: MonteOreSettings;
  onSave: (p: Partial<MonteOreSettings>) => void;
  saving: boolean;
}) {
  const [form, setForm] = useState<Partial<MonteOreSettings>>(settings);
  const update = <K extends keyof MonteOreSettings>(k: K, v: MonteOreSettings[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Periodo lezioni e finestra inserimento</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 pt-0 sm:pt-0">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label>Inizio anno accademico</Label>
            <Input
              type="date"
              value={form.academicYearStart ?? ''}
              onChange={(e) => update('academicYearStart', e.target.value)}
            />
          </div>
          <div>
            <Label>Fine anno accademico</Label>
            <Input
              type="date"
              value={form.academicYearEnd ?? ''}
              onChange={(e) => update('academicYearEnd', e.target.value)}
            />
          </div>
          <div>
            <Label>Inizio lezioni</Label>
            <Input
              type="date"
              value={form.lessonsStartDate ?? ''}
              onChange={(e) => update('lessonsStartDate', e.target.value)}
            />
          </div>
          <div>
            <Label>Fine lezioni</Label>
            <Input
              type="date"
              value={form.lessonsEndDate ?? ''}
              onChange={(e) => update('lessonsEndDate', e.target.value)}
            />
          </div>
          <div>
            <Label>Apertura inserimento docenti</Label>
            <Input
              type="date"
              value={form.submissionWindowStart ?? ''}
              onChange={(e) => update('submissionWindowStart', e.target.value)}
            />
          </div>
          <div>
            <Label>Chiusura inserimento docenti</Label>
            <Input
              type="date"
              value={form.submissionWindowEnd ?? ''}
              onChange={(e) => update('submissionWindowEnd', e.target.value)}
            />
          </div>
          <div>
            <Label>Soglia minima ore</Label>
            <Input
              type="number"
              min={0}
              step={0.5}
              value={form.minRequiredHours ?? 324}
              onChange={(e) => update('minRequiredHours', Number(e.target.value))}
            />
          </div>
          <div>
            <Label>Max richieste variazione / anno</Label>
            <Input
              type="number"
              min={0}
              step={1}
              value={form.maxAmendmentsPerYear ?? 3}
              onChange={(e) => update('maxAmendmentsPerYear', Number(e.target.value))}
            />
          </div>
        </div>

        <DailyConstraintsSection form={form} update={update} />

        <div className="flex justify-end">
          <Button onClick={() => onSave(form)} disabled={saving || hasBreakCoherenceError(form)}>
            <Save className="h-4 w-4" />
            Salva impostazioni
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function SuspensionsCard({
  academicYear,
  suspensions,
  loading,
}: {
  academicYear: string;
  suspensions: MonteOreSuspension[];
  loading: boolean;
}) {
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<MonteOreSuspension | null>(null);

  const removeMutation = useMutation({
    mutationFn: (id: number) => monteOreAdminApi.removeSuspension(id),
    onSuccess: () => {
      toast.success('Sospensione eliminata');
      void qc.invalidateQueries({ queryKey: ['admin', 'monte-ore', 'suspensions'] });
    },
    onError: (err) => toast.error(httpErrorMessage(err)),
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle className="text-lg">Sospensioni / festività</CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">
            <strong>Settimana intera</strong>: la riga sparisce dalla griglia docenti.
            <strong> Parziale</strong>: i giorni inclusi diventano celle rosse non cliccabili.
          </p>
        </div>
        <Button size="sm" onClick={() => setAdding(true)}>
          <Plus className="h-4 w-4" /> Aggiungi
        </Button>
      </CardHeader>
      <CardContent className="pt-0 sm:pt-0">
        {loading ? (
          <Skeleton className="h-32 w-full" />
        ) : suspensions.length === 0 ? (
          <div className="rounded-lg border border-dashed bg-muted/20 px-4 py-8 text-center text-sm text-muted-foreground">
            Nessuna sospensione configurata.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b text-left text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-3 py-2">Nome</th>
                  <th className="px-3 py-2">Dal</th>
                  <th className="px-3 py-2">Al</th>
                  <th className="px-3 py-2">Tipo</th>
                  <th className="px-3 py-2 text-right">Azioni</th>
                </tr>
              </thead>
              <tbody>
                {suspensions.map((s) => (
                  <tr key={s.id} className="border-b last:border-0">
                    <td className="px-3 py-2 font-medium">{s.name}</td>
                    <td className="px-3 py-2 tabular-nums">{s.dateFrom}</td>
                    <td className="px-3 py-2 tabular-nums">{s.dateTo}</td>
                    <td className="px-3 py-2">
                      <Badge variant={s.kind === 'full_week' ? 'destructive' : 'secondary'}>
                        {s.kind === 'full_week' ? 'Settimana intera' : 'Parziale'}
                      </Badge>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setEditing(s)}
                          title="Modifica sospensione"
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => {
                            if (confirm(`Eliminare "${s.name}"?`)) removeMutation.mutate(s.id);
                          }}
                          className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                          title="Elimina sospensione"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {adding && <SuspensionForm academicYear={academicYear} onClose={() => setAdding(false)} />}
        {editing && (
          <SuspensionForm
            academicYear={academicYear}
            existing={editing}
            onClose={() => setEditing(null)}
          />
        )}
      </CardContent>
    </Card>
  );
}

function SuspensionForm({
  academicYear,
  existing,
  onClose,
}: {
  academicYear: string;
  existing?: MonteOreSuspension;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const isEdit = !!existing;
  const [form, setForm] = useState({
    name: existing?.name ?? '',
    dateFrom: existing?.dateFrom ?? '',
    dateTo: existing?.dateTo ?? '',
    kind: existing?.kind ?? 'partial',
    notes: existing?.notes ?? '',
    // applyToAllBookings ha senso solo in creazione: in edit non lo
    // proponiamo perché toccherebbe anche la BookingRuleException linkata
    // con logica più complessa (delete+recreate).
    applyToAllBookings: false,
  });

  const createMutation = useMutation({
    mutationFn: () =>
      monteOreAdminApi.createSuspension({
        academicYear,
        name: form.name,
        dateFrom: form.dateFrom,
        dateTo: form.dateTo,
        kind: form.kind,
        applyToAllBookings: form.applyToAllBookings,
      }),
    onSuccess: () => {
      toast.success('Sospensione creata');
      void qc.invalidateQueries({ queryKey: ['admin', 'monte-ore', 'suspensions'] });
      onClose();
    },
    onError: (err) => toast.error(httpErrorMessage(err)),
  });

  const updateMutation = useMutation({
    mutationFn: () => {
      if (!existing) throw new Error('Sospensione non trovata');
      return monteOreAdminApi.updateSuspension(existing.id, {
        name: form.name,
        dateFrom: form.dateFrom,
        dateTo: form.dateTo,
        kind: form.kind,
        notes: form.notes || null,
      });
    },
    onSuccess: () => {
      toast.success('Sospensione aggiornata');
      void qc.invalidateQueries({ queryKey: ['admin', 'monte-ore', 'suspensions'] });
      onClose();
    },
    onError: (err) => toast.error(httpErrorMessage(err)),
  });

  const pending = isEdit ? updateMutation.isPending : createMutation.isPending;

  return (
    <form
      className="mt-4 grid gap-3 rounded-lg border bg-muted/10 p-4 sm:grid-cols-5"
      onSubmit={(e) => {
        e.preventDefault();
        if (isEdit) updateMutation.mutate();
        else createMutation.mutate();
      }}
    >
      <div className="sm:col-span-2">
        <Label>Nome</Label>
        <Input
          value={form.name}
          placeholder="Vacanze di Natale"
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          required
        />
      </div>
      <div>
        <Label>Dal</Label>
        <Input
          type="date"
          value={form.dateFrom}
          onChange={(e) => setForm((f) => ({ ...f, dateFrom: e.target.value }))}
          required
        />
      </div>
      <div>
        <Label>Al</Label>
        <Input
          type="date"
          value={form.dateTo}
          onChange={(e) => setForm((f) => ({ ...f, dateTo: e.target.value }))}
          required
        />
      </div>
      <div>
        <Label>Tipo</Label>
        <Select
          value={form.kind}
          onValueChange={(v) =>
            setForm((f) => ({
              ...f,
              kind: v as SuspensionKind,
              // Se passa a full_week il flag perde senso (la settimana
              // sparisce dalla griglia comunque, e il blocco prenotazioni
              // andrebbe applicato all'intera settimana — caso raro che
              // l'admin gestirà a mano).
              applyToAllBookings: v === 'partial' ? f.applyToAllBookings : false,
            }))
          }
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="partial">Parziale (giorni rossi)</SelectItem>
            <SelectItem value="full_week">Settimana intera (riga nascosta)</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {!isEdit && form.kind === 'partial' && (
        <label className="sm:col-span-5 flex items-start gap-2 rounded-lg border border-dashed bg-background p-3 cursor-pointer hover:bg-muted/30">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4"
            checked={form.applyToAllBookings}
            onChange={(e) => setForm((f) => ({ ...f, applyToAllBookings: e.target.checked }))}
          />
          <div className="text-sm">
            <div className="font-medium">
              Applica anche alle prenotazioni regolari di tutti gli utenti
            </div>
            <div className="mt-0.5 text-xs text-muted-foreground">
              Crea automaticamente una eccezione "blocco" nelle Regole di prenotazione (Regole →
              Eccezioni) per il range di date scelto. Cancellando questa sospensione anche
              l'eccezione viene rimossa.
            </div>
          </div>
        </label>
      )}
      <div className="sm:col-span-5 flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onClose}>
          Annulla
        </Button>
        <Button type="submit" disabled={pending}>
          {isEdit ? 'Salva modifiche' : 'Crea'}
        </Button>
      </div>
    </form>
  );
}
