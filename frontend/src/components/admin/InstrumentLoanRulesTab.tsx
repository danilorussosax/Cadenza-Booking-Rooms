import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { LoaderCircle, Search, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { instrumentsApi } from '@/api/instruments';
import { coursesApi } from '@/api/courses';
import { httpErrorMessage } from '@/lib/api';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import type { Course, Instrument, InstrumentFamily } from '@/types';

const FAMILY_LABELS: Record<InstrumentFamily, string> = {
  archi: 'instrument_families.archi',
  fiati_legni: 'instrument_families.fiati_legni',
  fiati_ottoni: 'instrument_families.fiati_ottoni',
  tastiere: 'instrument_families.tastiere',
  percussioni: 'instrument_families.percussioni',
  corde: 'instrument_families.corde',
  voce: 'instrument_families.voce',
  elettronica: 'instrument_families.elettronica',
  altro: 'instrument_families.altro',
};

/**
 * Tab "Regole prestito" all'interno di /admin/instruments.
 *
 * Visualizza tutti gli strumenti con il numero di corsi abilitati. Cliccando
 * su uno strumento si apre un dialog con la lista dei corsi (Course) e
 * checkbox per selezionare quali codici SAD possono richiedere il prestito.
 *
 * Convenzione (coerente con Room.allowedCourseIds):
 *   - lista vuota = comportamento permissivo (chiunque non admin con
 *     courseId valorizzato può richiedere)
 *   - lista con elementi = solo gli utenti con quel courseId possono
 *     richiedere; gli admin sono sempre autorizzati
 */
export function InstrumentLoanRulesTab() {
  const { t } = useTranslation();
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<Instrument | null>(null);

  const instrumentsQuery = useQuery({
    queryKey: ['admin', 'instruments', 'all'],
    queryFn: () => instrumentsApi.list({}),
    staleTime: 30_000,
  });

  // Lista corsi caricata anche fuori dal dialog: serve per renderizzare i
  // codici SAD nelle chip della colonna "Corsi abilitati" (oltre che per il
  // dialog di edit). TanStack Query deduplica la query in cache.
  const coursesQuery = useQuery({
    queryKey: ['courses', 'all'],
    queryFn: () => coursesApi.listAll(),
    staleTime: 60_000,
  });

  // Map id → code per lookup O(1) in tabella.
  const courseCodeById = useMemo(() => {
    const map = new Map<number, string>();
    for (const c of coursesQuery.data?.courses ?? []) map.set(c.id, c.code);
    return map;
  }, [coursesQuery.data]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    const list = instrumentsQuery.data?.instruments ?? [];
    const items = term
      ? list.filter((i) => {
          return (
            i.name.toLowerCase().includes(term) ||
            (i.code ?? '').toLowerCase().includes(term) ||
            (i.brand ?? '').toLowerCase().includes(term) ||
            (i.model ?? '').toLowerCase().includes(term)
          );
        })
      : list;
    // Ordina per famiglia → nome (collator numeric per "Violino 10" dopo "Violino 9")
    const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
    return [...items].sort((a, b) => {
      const f = collator.compare(a.family, b.family);
      if (f !== 0) return f;
      return collator.compare(a.name, b.name);
    });
  }, [instrumentsQuery.data, search]);

  return (
    <div className="space-y-4">
      <Alert variant="info">
        <AlertDescription className="text-xs">{t('admin.instrument_rules.help')}</AlertDescription>
      </Alert>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
            }}
            placeholder={t('admin.instrument_rules.search_placeholder')}
            className="pl-9"
          />
        </div>
        <span className="text-xs text-muted-foreground">
          {t('admin.instrument_rules.count', { count: filtered.length })}
        </span>
      </div>

      {instrumentsQuery.isLoading && (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      )}

      {!instrumentsQuery.isLoading && filtered.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
            <ShieldCheck className="h-10 w-10 text-muted-foreground" />
            <p className="font-medium">{t('admin.instrument_rules.empty_title')}</p>
            <p className="text-sm text-muted-foreground">
              {t('admin.instrument_rules.empty_subtitle')}
            </p>
          </CardContent>
        </Card>
      )}

      {/* Mobile (<sm): card stack — un riquadro per strumento con
       * foto miniature, nome+code, family badge, lista chip corsi. */}
      {!instrumentsQuery.isLoading && filtered.length > 0 && (
        <div className="space-y-2 sm:hidden">
          {filtered.map((inst) => {
            const allowedCount = inst.allowedCourseIds?.length ?? 0;
            return (
              <Card key={inst.id}>
                <CardContent className="space-y-3 p-3">
                  <div className="flex items-start gap-3">
                    <div className="relative h-12 w-16 shrink-0 overflow-hidden rounded bg-muted">
                      <img
                        src={inst.photoUrl ?? '/assets/instrument-default.svg'}
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
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium leading-snug">{inst.name}</p>
                      {inst.code && (
                        <p className="truncate text-[11px] text-muted-foreground">{inst.code}</p>
                      )}
                      <Badge variant="secondary" className="mt-1">
                        {t(FAMILY_LABELS[inst.family])}
                      </Badge>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setEditing(inst);
                      }}
                    >
                      {t('admin.instrument_rules.edit')}
                    </Button>
                  </div>
                  <div>
                    <p className="mb-1 text-[11px] uppercase tracking-wider text-muted-foreground">
                      {t('admin.instrument_rules.col_courses')}
                    </p>
                    {allowedCount === 0 ? (
                      <Badge variant="muted" className="font-normal">
                        {t('admin.instrument_rules.all_allowed')}
                      </Badge>
                    ) : (
                      <CourseCodeChips
                        ids={inst.allowedCourseIds ?? []}
                        codeById={courseCodeById}
                        loading={coursesQuery.isLoading}
                      />
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Desktop (≥sm): tabella classica */}
      {!instrumentsQuery.isLoading && filtered.length > 0 && (
        <Card className="hidden sm:block">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/50 text-left text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 font-medium">
                    {t('admin.instrument_rules.col_instrument')}
                  </th>
                  <th className="px-4 py-3 font-medium">
                    {t('admin.instrument_rules.col_family')}
                  </th>
                  <th className="px-4 py-3 text-center font-medium">
                    {t('admin.instrument_rules.col_courses')}
                  </th>
                  <th className="px-4 py-3 text-right font-medium">
                    {t('admin.instrument_rules.col_actions')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((inst) => {
                  const allowedCount = inst.allowedCourseIds?.length ?? 0;
                  return (
                    <motion.tr
                      key={inst.id}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="border-b last:border-0"
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          {/* Coerente con InventoryTab + LoansTab: thumbnail
                              16:9 con object-cover + fallback SVG default
                              + onError per file mancanti su disco. */}
                          <div className="relative h-8 w-12 shrink-0 overflow-hidden rounded bg-muted">
                            <img
                              src={inst.photoUrl ?? '/assets/instrument-default.svg'}
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
                            <p className="truncate font-medium">{inst.name}</p>
                            {inst.code && (
                              <p className="truncate text-[11px] text-muted-foreground">
                                {inst.code}
                              </p>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-xs">
                        <Badge variant="secondary">{t(FAMILY_LABELS[inst.family])}</Badge>
                      </td>
                      <td className="px-4 py-3">
                        {allowedCount === 0 ? (
                          <div className="text-center">
                            <Badge variant="muted" className="font-normal">
                              {t('admin.instrument_rules.all_allowed')}
                            </Badge>
                          </div>
                        ) : (
                          // Lista codici SAD come chips success (stesso colore
                          // dell'ex badge "N corsi"). Wrap su più righe se
                          // tanti; mostra max 8 + "+N" per evitare overflow.
                          <CourseCodeChips
                            ids={inst.allowedCourseIds ?? []}
                            codeById={courseCodeById}
                            loading={coursesQuery.isLoading}
                          />
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setEditing(inst);
                          }}
                        >
                          {t('admin.instrument_rules.edit')}
                        </Button>
                      </td>
                    </motion.tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <CoursesEditDialog
        instrument={editing}
        onClose={() => {
          setEditing(null);
        }}
      />
    </div>
  );
}

function CoursesEditDialog({
  instrument,
  onClose,
}: {
  instrument: Instrument | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const open = !!instrument;

  // Stato locale dei corsi selezionati: inizializzato dall'instrument quando
  // si apre il dialog. Usato come "draft" finché non si clicca Salva.
  const [selected, setSelected] = useState<number[]>([]);
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (instrument) {
      setSelected(instrument.allowedCourseIds ?? []);
      setSearch('');
    }
  }, [instrument]);

  const coursesQuery = useQuery({
    queryKey: ['courses', 'all'],
    queryFn: () => coursesApi.listAll(),
    enabled: open,
    staleTime: 60_000,
  });

  const filteredCourses = useMemo<Course[]>(() => {
    const all = coursesQuery.data?.courses ?? [];
    const term = search.trim().toLowerCase();
    if (!term) return all;
    return all.filter(
      (c) => c.code.toLowerCase().includes(term) || c.name.toLowerCase().includes(term),
    );
  }, [coursesQuery.data, search]);

  const saveMutation = useMutation({
    mutationFn: () => {
      if (!instrument) throw new Error('no_instrument');
      return instrumentsApi.update(instrument.id, { allowedCourseIds: selected });
    },
    onSuccess: () => {
      toast.success(t('admin.instrument_rules.saved'));
      void qc.invalidateQueries({ queryKey: ['admin', 'instruments'] });
      void qc.invalidateQueries({ queryKey: ['instruments'] });
      onClose();
    },
    onError: (err) => toast.error(httpErrorMessage(err)),
  });

  const toggleCourse = (id: number) => {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const selectAll = () => {
    setSelected(filteredCourses.map((c) => c.id));
  };
  const deselectAll = () => {
    setSelected([]);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('admin.instrument_rules.dialog_title')}</DialogTitle>
          <DialogDescription>
            {instrument?.name}
            {instrument?.code ? ` · ${instrument.code}` : ''}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <Alert variant={selected.length === 0 ? 'info' : undefined}>
            <AlertDescription className="text-xs">
              {selected.length === 0
                ? t('admin.instrument_rules.dialog_help_empty')
                : t('admin.instrument_rules.dialog_help_filtered', { count: selected.length })}
            </AlertDescription>
          </Alert>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                }}
                placeholder={t('admin.instrument_rules.search_courses')}
                className="pl-9"
              />
            </div>
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={selectAll}
                disabled={!filteredCourses.length}
              >
                {t('admin.instrument_rules.select_all')}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={deselectAll}
                disabled={!selected.length}
              >
                {t('admin.instrument_rules.deselect_all')}
              </Button>
            </div>
          </div>

          <div className="max-h-[40vh] overflow-y-auto rounded-md border bg-background p-2">
            {coursesQuery.isLoading && (
              <p className="px-2 py-2 text-xs text-muted-foreground">
                {t('admin.instrument_rules.loading_courses')}
              </p>
            )}
            {!coursesQuery.isLoading && filteredCourses.length === 0 && (
              <p className="px-2 py-2 text-xs text-muted-foreground">
                {t('admin.instrument_rules.no_courses_found')}
              </p>
            )}
            <div className="grid gap-1.5 sm:grid-cols-2">
              {filteredCourses.map((c) => {
                const checked = selected.includes(c.id);
                return (
                  <label
                    key={c.id}
                    className={cn(
                      'flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-xs hover:bg-accent',
                      checked && 'bg-accent',
                    )}
                  >
                    <Checkbox
                      checked={checked}
                      onCheckedChange={() => {
                        toggleCourse(c.id);
                      }}
                    />
                    <span className="truncate">
                      <span className="font-medium">{c.code}</span> — {c.name}
                    </span>
                  </label>
                );
              })}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            disabled={saveMutation.isPending}
          >
            {t('common.cancel')}
          </Button>
          <Button
            type="button"
            onClick={() => {
              saveMutation.mutate();
            }}
            disabled={saveMutation.isPending}
          >
            {saveMutation.isPending ? (
              <LoaderCircle className="h-4 w-4 animate-spin" />
            ) : (
              t('common.save')
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Chip dei codici SAD abilitati per uno strumento. Lo stile (success
 * verde) è coerente col badge "N corsi" che era qui prima: usiamo lo
 * stesso variant del Badge per dare continuità visiva.
 *
 * Per evitare overflow su molti corsi, mostra MAX_CHIPS chip + "+N" se la
 * lista è più lunga. La stringa visualizzata è il `course.code`; se la
 * mappa codici non è ancora caricata (loading) o non contiene un id, ricade
 * sull'id stesso (placeholder transitorio).
 */
const MAX_CHIPS = 8;
function CourseCodeChips({
  ids,
  codeById,
  loading,
}: {
  ids: number[];
  codeById: Map<number, string>;
  loading: boolean;
}) {
  if (ids.length === 0) return null;
  const sorted = [...ids].sort((a, b) => {
    const ca = codeById.get(a) ?? String(a);
    const cb = codeById.get(b) ?? String(b);
    return ca.localeCompare(cb, undefined, { numeric: true });
  });
  const visible = sorted.slice(0, MAX_CHIPS);
  const overflow = sorted.length - visible.length;
  return (
    <div className="flex flex-wrap gap-1">
      {visible.map((id) => (
        <Badge key={id} variant="success" className="font-mono text-[11px] font-semibold">
          {codeById.get(id) ?? (loading ? '…' : `#${id}`)}
        </Badge>
      ))}
      {overflow > 0 && (
        <Badge variant="muted" className="text-[11px] font-normal">
          +{overflow}
        </Badge>
      )}
    </div>
  );
}
