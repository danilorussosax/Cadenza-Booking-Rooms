import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarPlus, UserCheck, UserX } from 'lucide-react';
import {
  monteOreAdminApi,
  monteOreApi,
  type AcademicYearOption,
  type AcademicYearPhase,
} from '@/api/monteOre';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { NewAcademicYearDialog } from './NewAcademicYearDialog';

const LS_KEY = 'monteOre.admin.selectedYear';

/** Sentinella usata come `value` per la voce "+ Crea nuovo anno accademico…". */
const CREATE_NEW_VALUE = '__create_new__';

/** Persistenza scelta AA admin in localStorage. */
function readStoredYear(): string | null {
  try {
    return localStorage.getItem(LS_KEY);
  } catch {
    return null;
  }
}

function writeStoredYear(y: string) {
  try {
    localStorage.setItem(LS_KEY, y);
  } catch {
    /* ignore */
  }
}

const PHASE_LABEL: Record<AcademicYearPhase, string> = {
  past: 'Passato',
  current: 'In corso',
  next: 'Prossimo',
  future: 'Futuro',
};

const PHASE_VARIANT: Record<AcademicYearPhase, 'muted' | 'success' | 'secondary' | 'outline'> = {
  past: 'muted',
  current: 'success',
  next: 'secondary',
  future: 'outline',
};

const startYear = (aa: string) => Number(aa.slice(0, 4));

/** Fase che ogni AA assumerebbe se `startedYear` diventasse l'anno in corso. */
function phaseIfStarted(academicYear: string, startedYear: string): AcademicYearPhase {
  const diff = startYear(academicYear) - startYear(startedYear);
  if (diff < 0) return 'past';
  if (diff === 0) return 'current';
  return diff === 1 ? 'next' : 'future';
}

interface Props {
  /** AA correntemente selezionato (`undefined` finché non risolto). */
  value: string | undefined;
  /** Notificato quando l'utente cambia AA o crea un nuovo AA. */
  onChange: (academicYear: string) => void;
}

/**
 * Selettore AA per il pannello admin Monte Ore.
 *
 * - Carica `GET /api/monte-ore/academic-years?scope=admin`.
 * - Mostra badge contestuali (in corso / prossimo / submission aperta) per
 *   l'AA selezionato.
 * - Voce finale `+ Crea nuovo anno accademico…` apre il dialog di bootstrap.
 * - Persiste la scelta in localStorage `monteOre.admin.selectedYear`; al
 *   primo render (value undefined) viene usato lo storage o il `default`.
 */
export function AdminAcademicYearSelector({ value, onChange }: Props) {
  const queryClient = useQueryClient();
  const yearsQuery = useQuery({
    queryKey: ['monte-ore', 'academic-years', 'admin'],
    queryFn: () => monteOreApi.listAcademicYears('admin'),
    staleTime: 60_000,
  });

  const [creating, setCreating] = useState(false);
  const [confirmStart, setConfirmStart] = useState<{ year: string; active: boolean } | null>(null);
  const [suggestedYear, setSuggestedYear] = useState<string | undefined>(undefined);

  const items = yearsQuery.data?.items ?? [];
  const defaultYear = yearsQuery.data?.default;

  const activateMut = useMutation({
    mutationFn: ({ year, active }: { year: string; active: boolean }) =>
      monteOreAdminApi.activateAcademicYearForTeachers(year, active),
    onSuccess: (res, vars) => {
      void queryClient.invalidateQueries({ queryKey: ['monte-ore'] });
      if (vars.active) {
        toast.success(`AA ${vars.year} avviato`);
      } else {
        toast.success('Avvio rimosso: ripristinata logica automatica');
      }
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const statusMut = useMutation({
    mutationFn: ({ year, status }: { year: string; status: 'published' | 'archived' }) =>
      monteOreAdminApi.setAcademicYearStatus(year, status),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['monte-ore'] });
      void queryClient.invalidateQueries({ queryKey: ['admin', 'monte-ore'] });
      toast.success('Stato anno aggiornato');
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // Risoluzione del primo valore quando i dati arrivano: storage > default.
  useEffect(() => {
    if (value !== undefined) return;
    if (items.length === 0 && !defaultYear) return;
    const stored = readStoredYear();
    const candidates = items.map((i) => i.academicYear);
    let resolved: string | undefined;
    if (stored && candidates.includes(stored)) resolved = stored;
    else if (defaultYear && candidates.includes(defaultYear)) resolved = defaultYear;
    else resolved = candidates[0];
    if (resolved) onChange(resolved);
    // `onChange` è considerato stabile: non rientrare quando viene ricreato
    // (il componente caller userebbe useCallback se servisse).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, items.length, defaultYear]);

  const selected: AcademicYearOption | undefined = items.find((i) => i.academicYear === value);

  const handleSelectChange = (v: string) => {
    if (v === CREATE_NEW_VALUE) {
      // Pre-compila con il primo AA "futuro" candidato (canCreateNew=true);
      // se non c'è, lascia vuoto e l'utente digiterà a mano.
      const candidate = items.find((i) => i.canCreateNew);
      const latest = items.reduce(
        (max, item) => Math.max(max, Number(item.academicYear.slice(0, 4))),
        0,
      );
      setSuggestedYear(candidate?.academicYear ?? `${latest + 1}/${latest + 2}`);
      setCreating(true);
      return;
    }
    writeStoredYear(v);
    onChange(v);
  };

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Label className="text-xs uppercase tracking-wider text-muted-foreground" htmlFor="aa-select">
        Anno accademico
      </Label>
      <Select value={value ?? ''} onValueChange={handleSelectChange}>
        <SelectTrigger id="aa-select" className="w-64">
          <SelectValue placeholder={yearsQuery.isLoading ? 'Caricamento…' : '— scegli AA —'} />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {items.map((i) => (
              <SelectItem key={i.academicYear} value={i.academicYear}>
                AA {i.academicYear} · {PHASE_LABEL[i.phase]}
                {i.canCreateNew && !i.hasSettings ? ' · non creato' : ''}
              </SelectItem>
            ))}
            {items.length === 0 && !yearsQuery.isLoading && (
              <SelectItem value="__none__" disabled>
                Nessun AA disponibile
              </SelectItem>
            )}
          </SelectGroup>
          <SelectSeparator />
          <SelectItem value={CREATE_NEW_VALUE} className="text-primary font-medium">
            <span className="inline-flex items-center gap-1.5">
              <CalendarPlus className="h-3.5 w-3.5" />
              Crea nuovo anno accademico…
            </span>
          </SelectItem>
        </SelectContent>
      </Select>

      {/* Badge contestuali per l'AA selezionato */}
      {selected && (
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant={PHASE_VARIANT[selected.phase]}>{PHASE_LABEL[selected.phase]}</Badge>
          <Badge variant="secondary">
            {selected.submissionOpen ? 'Invio aperto' : 'Invio chiuso'}
          </Badge>
          {selected.status && (
            <Badge variant="outline">
              {{ draft: 'Bozza', published: 'Pubblicato', archived: 'Archiviato' }[selected.status]}
            </Badge>
          )}
          {!selected.hasSettings && (
            <Badge variant="muted" className="text-amber-700 dark:text-amber-400">
              non ancora creato
            </Badge>
          )}
        </div>
      )}

      {/* Toggle "attivo per i docenti" — solo se l'AA esiste */}
      {selected &&
        selected.hasSettings &&
        (!selected.status || selected.status === 'published') && (
          <Button
            type="button"
            variant={selected.adminActivated ? 'outline' : 'default'}
            size="sm"
            disabled={activateMut.isPending}
            onClick={() =>
              setConfirmStart({ year: selected.academicYear, active: !selected.adminActivated })
            }
            className="gap-1.5"
            title={
              selected.adminActivated
                ? "Rimuovi l'avvio: torna alla logica automatica del calendario"
                : "Avvia questo AA: diventa 'In corso' e gli altri si riallineano (precedenti Passato, successivo Prossimo)"
            }
          >
            {selected.adminActivated ? (
              <>
                <UserX className="h-3.5 w-3.5" />
                Ripristina automatico
              </>
            ) : (
              <>
                <UserCheck className="h-3.5 w-3.5" />
                Avvia
              </>
            )}
          </Button>
        )}

      {selected?.hasSettings && selected.status !== 'published' && selected.status && (
        <Button
          size="sm"
          disabled={statusMut.isPending}
          onClick={() => statusMut.mutate({ year: selected.academicYear, status: 'published' })}
        >
          {selected.status === 'archived' ? 'Ripubblica anno' : 'Pubblica anno'}
        </Button>
      )}
      {selected?.status === 'published' && selected.phase === 'past' && (
        <Button
          variant="outline"
          size="sm"
          disabled={statusMut.isPending}
          onClick={() => statusMut.mutate({ year: selected.academicYear, status: 'archived' })}
        >
          Archivia anno
        </Button>
      )}
      {selected?.hasSettings && (
        <p className="basis-full text-xs text-muted-foreground">
          «Avvia» imposta l’anno «In corso»: i precedenti diventano «Passato», il successivo
          «Prossimo» e i docenti vedono questo anno. Le date nel calendario regolano l’apertura
          della compilazione.
        </p>
      )}

      {confirmStart && (
        <Dialog open onOpenChange={(o) => !o && setConfirmStart(null)}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>
                {confirmStart.active
                  ? `Avviare l'AA ${confirmStart.year}?`
                  : 'Ripristinare la selezione automatica?'}
              </DialogTitle>
              <DialogDescription>
                {confirmStart.active
                  ? "L'anno diventa «In corso» e i docenti vedranno questo anno. Le altre fasce si riallineano:"
                  : "L'anno in corso tornerà a seguire il calendario. Le fasce si riallineano:"}
              </DialogDescription>
            </DialogHeader>
            <ul className="space-y-1 text-sm">
              {items
                .filter((i) => i.hasSettings)
                .map((i) => {
                  const calendarCurrent = items.find((x) => x.isCurrent)?.academicYear;
                  const after = confirmStart.active
                    ? phaseIfStarted(i.academicYear, confirmStart.year)
                    : phaseIfStarted(i.academicYear, calendarCurrent ?? confirmStart.year);
                  return (
                    <li key={i.academicYear} className="flex items-center justify-between gap-2">
                      <span>AA {i.academicYear}</span>
                      <span className="text-muted-foreground">
                        {PHASE_LABEL[i.phase]}
                        {after !== i.phase && (
                          <>
                            {' → '}
                            <strong className="text-foreground">{PHASE_LABEL[after]}</strong>
                          </>
                        )}
                      </span>
                    </li>
                  );
                })}
            </ul>
            <DialogFooter>
              <Button variant="outline" onClick={() => setConfirmStart(null)}>
                Annulla
              </Button>
              <Button
                disabled={activateMut.isPending}
                onClick={() => {
                  activateMut.mutate(confirmStart);
                  setConfirmStart(null);
                }}
              >
                {confirmStart.active ? 'Avvia' : 'Ripristina'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      <NewAcademicYearDialog
        open={creating}
        onClose={() => setCreating(false)}
        existingYears={items}
        suggestedYear={suggestedYear}
        onCreated={(aa) => {
          writeStoredYear(aa);
          onChange(aa);
        }}
      />
    </div>
  );
}

export default AdminAcademicYearSelector;
