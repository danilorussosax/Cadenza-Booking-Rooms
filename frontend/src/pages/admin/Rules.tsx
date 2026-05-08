import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import {
  Ban,
  BookMarked,
  CalendarRange,
  Clock,
  Gauge,
  GraduationCap,
  LoaderCircle,
  Package,
  Pencil,
  Plus,
  Save,
  ShieldCheck,
  Trash2,
  Users as UsersIcon,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { rulesApi, type OverlapBooking, type UpsertExceptionPayload } from '@/api/rules';
import { QuotasManager } from '@/components/admin/QuotasManager';
import { LoanQuotasManager } from '@/components/admin/LoanQuotasManager';
import { httpErrorMessage } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { FieldError } from '@/components/ui/field-error';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import type {
  BookingRule,
  BookingRuleException,
  BookingRuleExceptionKind,
  BookingRuleExceptionScope,
  Role,
} from '@/types';

const TIME_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;

const schema = z.object({
  maxActiveBookings: z.number().int().min(0),
  maxHoursPerWeek: z.number().int().min(0),
  maxHoursPerDay: z.number().int().min(0),
  maxBookingDurationMinutes: z.number().int().min(15),
  minBookingDurationMinutes: z.number().int().min(15),
  maxAdvanceDays: z.number().int().min(0),
  minAdvanceHours: z.number().int().min(0),
  cancellationDeadlineHours: z.number().int().min(0),
  minIntervalBetweenBookingsMinutes: z.number().int().min(0),
  allowRecurring: z.boolean(),
  allowNightHours: z.boolean(),
  allowedStartTime: z.string().regex(TIME_REGEX, 'Formato HH:mm'),
  allowedEndTime: z.string().regex(TIME_REGEX, 'Formato HH:mm'),
});

type FormValues = z.infer<typeof schema>;

const ROLES: {
  value: Role;
  label: string;
  help: string;
  icon: LucideIcon;
  iconColor: string;
}[] = [
  {
    value: 'studente',
    label: 'Studenti',
    help: 'Limiti applicati agli studenti.',
    icon: GraduationCap,
    iconColor: 'text-blue-600 dark:text-blue-400',
  },
  {
    value: 'docente',
    label: 'Docenti',
    help: 'Limiti applicati ai docenti.',
    icon: BookMarked,
    iconColor: 'text-amber-600 dark:text-amber-400',
  },
  {
    value: 'admin',
    label: 'Amministratori',
    help: 'Limiti opzionali per gli admin.',
    icon: ShieldCheck,
    iconColor: 'text-emerald-600 dark:text-emerald-400',
  },
];

type MacroTab = 'roles' | 'quotas' | 'loan-quotas' | 'exceptions';

interface MacroTabDef {
  value: MacroTab;
  labelKey: string;
  icon: LucideIcon;
  iconColor: string;
  iconBg: string;
  descriptionKey: string;
}

const MACRO_TABS: MacroTabDef[] = [
  {
    value: 'roles',
    labelKey: 'admin.rules.tabs.by_role',
    icon: UsersIcon,
    iconColor: 'text-blue-600 dark:text-blue-400',
    iconBg: 'bg-blue-100 dark:bg-blue-500/15',
    descriptionKey: 'admin.rules.tabs.by_role_description',
  },
  {
    value: 'quotas',
    labelKey: 'admin.rules.tabs.quotas',
    icon: Gauge,
    iconColor: 'text-amber-600 dark:text-amber-400',
    iconBg: 'bg-amber-100 dark:bg-amber-500/15',
    descriptionKey: 'admin.rules.tabs.quotas_description',
  },
  {
    value: 'loan-quotas',
    labelKey: 'admin.rules.tabs.loan_quotas',
    icon: Package,
    iconColor: 'text-purple-600 dark:text-purple-400',
    iconBg: 'bg-purple-100 dark:bg-purple-500/15',
    descriptionKey: 'admin.rules.tabs.loan_quotas_description',
  },
  {
    value: 'exceptions',
    labelKey: 'admin.rules.tabs.exceptions',
    icon: CalendarRange,
    iconColor: 'text-rose-600 dark:text-rose-400',
    iconBg: 'bg-rose-100 dark:bg-rose-500/15',
    descriptionKey: 'admin.rules.tabs.exceptions_description',
  },
];

export default function AdminRules() {
  const { t } = useTranslation();
  const [macroTab, setMacroTab] = useState<MacroTab>('roles');
  const [roleTab, setRoleTab] = useState<Role>('studente');

  const activeTab = MACRO_TABS.find((tdef) => tdef.value === macroTab) ?? MACRO_TABS[0];
  const ActiveIcon = activeTab.icon;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header className="space-y-1.5">
        <h1 className="font-display text-3xl font-medium">Regole di prenotazione</h1>
        <p className="text-sm text-muted-foreground">
          Imposta i limiti per ciascun ruolo e configura le quote dinamiche per aule e prestiti.
        </p>
      </header>

      {/* Strip macro a 4 tab — versione "tab principali con titolo dentro".
          Render manuale (no shadcn TabsList sottile): card grandi con
          icona+colore per dare prominenza a ciascuna macro-area. */}
      <div className="grid gap-2 rounded-xl border bg-muted/30 p-1.5 sm:grid-cols-2 lg:grid-cols-4">
        {MACRO_TABS.map((tdef) => {
          const Icon = tdef.icon;
          const isActive = tdef.value === macroTab;
          return (
            <button
              key={tdef.value}
              type="button"
              onClick={() => {
                setMacroTab(tdef.value);
              }}
              className={`flex flex-col items-start gap-1 rounded-lg px-3 py-2.5 text-left transition-all ${
                isActive
                  ? 'bg-background shadow-xs ring-1 ring-border'
                  : 'text-muted-foreground hover:bg-background/60'
              }`}
            >
              <Icon className={`h-4 w-4 ${isActive ? tdef.iconColor : ''}`} />
              <span className={`text-sm font-medium ${isActive ? 'text-foreground' : ''}`}>
                {t(tdef.labelKey)}
              </span>
            </button>
          );
        })}
      </div>

      {/* Header descrittivo della macro tab attiva (il "titolo dentro" che
          chiede l'utente: ogni tab ha la sua intestazione contestuale). */}
      <Card>
        <CardContent className="flex items-start gap-3 p-4">
          <div className={`mt-0.5 rounded-lg p-2 ${activeTab.iconBg}`}>
            <ActiveIcon className={`h-4 w-4 ${activeTab.iconColor}`} />
          </div>
          <div className="space-y-0.5">
            <h2 className="font-display text-lg font-medium leading-tight">
              {t(activeTab.labelKey)}
            </h2>
            <p className="text-xs text-muted-foreground">{t(activeTab.descriptionKey)}</p>
          </div>
        </CardContent>
      </Card>

      {/* Contenuti per macro tab */}
      {macroTab === 'roles' && (
        <div className="space-y-4">
          {/* Toggle ruolo prominente: 3 button affiancati grandi al posto
              della inner tabs sottile. Le tab "per ruolo" diventano
              chiaramente più visibili come da richiesta. */}
          <div className="grid gap-2 sm:grid-cols-3">
            {ROLES.map((r) => {
              const RIcon = r.icon;
              const isActive = r.value === roleTab;
              return (
                <button
                  key={r.value}
                  type="button"
                  onClick={() => {
                    setRoleTab(r.value);
                  }}
                  className={`flex items-center gap-2 rounded-lg border px-4 py-3 text-left transition-all ${
                    isActive
                      ? 'border-primary bg-primary/5 ring-1 ring-primary/20'
                      : 'bg-background hover:border-primary/40'
                  }`}
                >
                  <RIcon className={`h-4 w-4 ${r.iconColor}`} />
                  <span className="text-sm font-medium">{r.label}</span>
                </button>
              );
            })}
          </div>

          <RuleEditor role={roleTab} help={ROLES.find((r) => r.value === roleTab)?.help ?? ''} />
        </div>
      )}

      {macroTab === 'quotas' && <QuotasManager />}
      {macroTab === 'loan-quotas' && <LoanQuotasManager />}
      {macroTab === 'exceptions' && <ExceptionsTopLevel />}
    </div>
  );
}

/**
 * Eccezioni promosse a tab top-level. Riusa ExceptionsSection (che resta
 * fonte unica per CRUD) ma con un selettore di filtro che permette anche
 * la vista "tutte le eccezioni" (admin only — l'API ritorna tutto se
 * `role` è omesso).
 */
function ExceptionsTopLevel() {
  const [scopeRole, setScopeRole] = useState<BookingRuleExceptionScope | 'every'>('every');

  const SCOPES: { value: BookingRuleExceptionScope | 'every'; label: string }[] = [
    { value: 'every', label: 'Tutte le eccezioni' },
    { value: 'all', label: 'Tutti i ruoli (eccezioni globali)' },
    { value: 'studente', label: 'Studenti' },
    { value: 'docente', label: 'Docenti' },
    { value: 'admin', label: 'Admin' },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Label className="text-xs text-muted-foreground">Filtro</Label>
        <Select
          value={scopeRole}
          onValueChange={(v) => {
            setScopeRole(v as BookingRuleExceptionScope | 'every');
          }}
        >
          <SelectTrigger className="w-[260px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SCOPES.map((s) => (
              <SelectItem key={s.value} value={s.value}>
                {s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <ExceptionsSection role={scopeRole === 'every' ? undefined : scopeRole} />
    </div>
  );
}

interface RuleEditorProps {
  role: Role;
  help: string;
}

function RuleEditor({ role, help }: RuleEditorProps) {
  const qc = useQueryClient();
  const [serverError, setServerError] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ['rules', role],
    queryFn: () => rulesApi.get(role),
  });

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    reset,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: defaultsFor(),
  });

  useEffect(() => {
    if (query.data?.rule) {
      reset(toFormValues(query.data.rule));
      setServerError(null);
    }
  }, [query.data, reset]);

  const allowRecurring = watch('allowRecurring');
  const allowNightHours = watch('allowNightHours');

  const mutation = useMutation({
    mutationFn: (values: FormValues) => rulesApi.upsert(role, values),
    onSuccess: ({ rule }) => {
      toast.success('Regole aggiornate');
      qc.setQueryData(['rules', role], { rule });
      reset(toFormValues(rule));
    },
    onError: (err) => {
      setServerError(httpErrorMessage(err));
    },
  });

  if (query.isLoading) {
    return <Skeleton className="h-96 w-full" />;
  }

  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
      <Card>
        <CardContent className="space-y-6 p-6">
          <p className="text-sm text-muted-foreground">{help}</p>

          {serverError && (
            <Alert variant="destructive">
              <AlertDescription>{serverError}</AlertDescription>
            </Alert>
          )}

          <form
            onSubmit={handleSubmit((values) => {
              setServerError(null);
              mutation.mutate(values);
            })}
            className="space-y-6"
            noValidate
          >
            <Section title="Volumi">
              <NumberField
                label="Prenotazioni attive contemporanee"
                helper="Massimo numero di prenotazioni future attive."
                name="maxActiveBookings"
                register={register}
                error={errors.maxActiveBookings?.message}
              />
              <NumberField
                label="Ore prenotabili per settimana"
                helper="Conteggio sull’ISO-week (lun → dom)."
                name="maxHoursPerWeek"
                register={register}
                error={errors.maxHoursPerWeek?.message}
              />
              <NumberField
                label="Ore prenotabili per giorno"
                name="maxHoursPerDay"
                register={register}
                error={errors.maxHoursPerDay?.message}
              />
            </Section>

            <Section title="Durata sessione">
              <NumberField
                label="Durata minima (minuti)"
                name="minBookingDurationMinutes"
                register={register}
                error={errors.minBookingDurationMinutes?.message}
              />
              <NumberField
                label="Durata massima (minuti)"
                name="maxBookingDurationMinutes"
                register={register}
                error={errors.maxBookingDurationMinutes?.message}
              />
              <NumberField
                label="Intervallo minimo tra prenotazioni (minuti)"
                helper="Cooldown obbligatorio tra una prenotazione e l’altra dello stesso utente. 0 = disattivato."
                name="minIntervalBetweenBookingsMinutes"
                register={register}
                error={errors.minIntervalBetweenBookingsMinutes?.message}
              />
            </Section>

            <Section title="Anticipo & cancellazione">
              <NumberField
                label="Anticipo massimo (giorni)"
                helper="Quanti giorni in anticipo si può prenotare."
                name="maxAdvanceDays"
                register={register}
                error={errors.maxAdvanceDays?.message}
              />
              <NumberField
                label="Anticipo minimo (ore)"
                helper="Tempo minimo prima dell’inizio."
                name="minAdvanceHours"
                register={register}
                error={errors.minAdvanceHours?.message}
              />
              <NumberField
                label="Limite cancellazione (ore)"
                helper="Ore prima dell’inizio entro cui si può cancellare."
                name="cancellationDeadlineHours"
                register={register}
                error={errors.cancellationDeadlineHours?.message}
              />
            </Section>

            <Section title="Fasce orarie consentite">
              <TimeField
                label="Inizio (HH:mm)"
                name="allowedStartTime"
                register={register}
                error={errors.allowedStartTime?.message}
              />
              <TimeField
                label="Fine (HH:mm)"
                name="allowedEndTime"
                register={register}
                error={errors.allowedEndTime?.message}
              />
            </Section>

            <Section title="Opzioni">
              <ToggleRow
                title="Permetti prenotazioni ricorrenti"
                description="Es. lezione settimanale per più settimane."
                checked={allowRecurring}
                onChange={(v) => {
                  setValue('allowRecurring', v, { shouldDirty: true });
                }}
              />
              <ToggleRow
                title="Permetti orario notturno"
                description="Disabilita per limitare alla fascia oraria sopra."
                checked={allowNightHours}
                onChange={(v) => {
                  setValue('allowNightHours', v, { shouldDirty: true });
                }}
              />
            </Section>

            <div className="flex items-center justify-end gap-2 border-t pt-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  if (query.data) reset(toFormValues(query.data.rule));
                }}
                disabled={!isDirty || isSubmitting}
              >
                Reimposta
              </Button>
              <Button type="submit" disabled={!isDirty || isSubmitting}>
                {isSubmitting ? (
                  <LoaderCircle className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    <Save className="h-4 w-4" />
                    Salva
                  </>
                )}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </motion.div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </p>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{children}</div>
    </div>
  );
}

function NumberField({
  label,
  helper,
  name,
  register,
  error,
}: {
  label: string;
  helper?: string;
  name: keyof FormValues;
  register: ReturnType<typeof useForm<FormValues>>['register'];
  error?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={name}>{label}</Label>
      <Input
        id={name}
        type="number"
        min={0}
        aria-invalid={!!error}
        aria-describedby={error ? `${name}-error` : undefined}
        {...register(name, { valueAsNumber: true })}
      />
      {helper && <p className="text-[11px] text-muted-foreground">{helper}</p>}
      <FieldError id={`${name}-error`}>{error}</FieldError>
    </div>
  );
}

function TimeField({
  label,
  name,
  register,
  error,
}: {
  label: string;
  name: keyof FormValues;
  register: ReturnType<typeof useForm<FormValues>>['register'];
  error?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={name}>{label}</Label>
      <Input
        id={name}
        type="time"
        aria-invalid={!!error}
        aria-describedby={error ? `${name}-error` : undefined}
        {...register(name)}
      />
      <FieldError id={`${name}-error`}>{error}</FieldError>
    </div>
  );
}

function ToggleRow({
  title,
  description,
  checked,
  onChange,
}: {
  title: string;
  description: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border bg-background p-3 sm:col-span-3">
      <div>
        <p className="text-sm font-medium">{title}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

function defaultsFor(): FormValues {
  return {
    maxActiveBookings: 5,
    maxHoursPerWeek: 10,
    maxHoursPerDay: 4,
    maxBookingDurationMinutes: 120,
    minBookingDurationMinutes: 30,
    maxAdvanceDays: 14,
    minAdvanceHours: 0,
    cancellationDeadlineHours: 2,
    minIntervalBetweenBookingsMinutes: 0,
    allowRecurring: false,
    allowNightHours: false,
    allowedStartTime: '08:00',
    allowedEndTime: '22:00',
  };
}

function toFormValues(rule: BookingRule): FormValues {
  return {
    maxActiveBookings: rule.maxActiveBookings,
    maxHoursPerWeek: rule.maxHoursPerWeek,
    maxHoursPerDay: rule.maxHoursPerDay,
    maxBookingDurationMinutes: rule.maxBookingDurationMinutes,
    minBookingDurationMinutes: rule.minBookingDurationMinutes,
    maxAdvanceDays: rule.maxAdvanceDays,
    minAdvanceHours: rule.minAdvanceHours,
    cancellationDeadlineHours: rule.cancellationDeadlineHours,
    minIntervalBetweenBookingsMinutes: rule.minIntervalBetweenBookingsMinutes,
    allowRecurring: rule.allowRecurring,
    allowNightHours: rule.allowNightHours,
    allowedStartTime: rule.allowedStartTime,
    allowedEndTime: rule.allowedEndTime,
  };
}

// =====================================================
// Eccezioni alla regola del ruolo
// =====================================================
const DAYS_LABELS = ['Dom', 'Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab'];

/**
 * `role` opzionale: se omesso, mostra TUTTE le eccezioni (admin only —
 * comportamento gestito da rulesApi.listExceptions / route backend).
 * Il default per il dialog di creazione è 'all' quando si è in vista globale.
 */
function ExceptionsSection({ role }: { role?: BookingRuleExceptionScope }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<BookingRuleException | null>(null);
  const [creating, setCreating] = useState(false);
  // Stato del dialog "sovrapposizioni storiche": mostrato dopo il salvataggio
  // di un'eccezione kind='block' che intercetta prenotazioni preesistenti.
  const [overlapState, setOverlapState] = useState<{
    exception: BookingRuleException;
    overlapping: OverlapBooking[];
  } | null>(null);

  const query = useQuery({
    queryKey: ['rules', 'exceptions', role ?? 'every'],
    queryFn: () => rulesApi.listExceptions(role),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => rulesApi.deleteException(id),
    onSuccess: () => {
      toast.success('Eccezione eliminata');
      void qc.invalidateQueries({ queryKey: ['rules', 'exceptions'] });
    },
    onError: (err) => toast.error(httpErrorMessage(err)),
  });

  const exceptions = query.data?.exceptions ?? [];

  return (
    <div className="space-y-3 border-t pt-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Eccezioni
          </p>
          <p className="text-xs text-muted-foreground">
            Blocchi e limitazioni aggiuntive su giorni o fasce orarie specifici. Si applicano in
            aggiunta alle regole sopra.
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          onClick={() => {
            setCreating(true);
          }}
        >
          <Plus className="h-4 w-4" />
          Aggiungi eccezione
        </Button>
      </div>

      {query.isLoading ? (
        <Skeleton className="h-24 w-full" />
      ) : exceptions.length === 0 ? (
        <div className="rounded-lg border border-dashed bg-muted/30 px-4 py-6 text-center text-sm text-muted-foreground">
          Nessuna eccezione configurata.
        </div>
      ) : (
        <ul className="space-y-2">
          {exceptions.map((exc) => (
            <li
              key={exc.id}
              className="flex flex-col gap-2 rounded-lg border bg-background p-3 sm:flex-row sm:items-start sm:justify-between"
            >
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  {exc.kind === 'block' ? (
                    <Badge variant="destructive" className="gap-1">
                      <Ban className="h-3 w-3" />
                      Blocco
                    </Badge>
                  ) : (
                    <Badge variant="secondary" className="gap-1">
                      <Clock className="h-3 w-3" />
                      Max {exc.maxHoursInWindow}h
                    </Badge>
                  )}
                  <Badge variant={exc.role === 'all' ? 'default' : 'muted'} className="gap-1">
                    <UsersIcon className="h-3 w-3" />
                    {exc.role === 'all' ? 'Tutti' : roleLabel(exc.role)}
                  </Badge>
                  {!exc.isActive && <Badge variant="muted">Disattivata</Badge>}
                  <p className="text-sm font-medium">{exc.name}</p>
                </div>
                <p className="text-xs text-muted-foreground">{exceptionSummary(exc)}</p>
                {exc.notes && <p className="text-xs text-muted-foreground italic">{exc.notes}</p>}
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  title="Modifica"
                  onClick={() => {
                    setEditing(exc);
                  }}
                  className="text-blue-600 hover:bg-blue-50 hover:text-blue-700 dark:text-blue-400 dark:hover:bg-blue-500/10"
                >
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  title="Elimina"
                  className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                  onClick={() => {
                    if (window.confirm(`Eliminare l'eccezione "${exc.name}"?`)) {
                      deleteMutation.mutate(exc.id);
                    }
                  }}
                  disabled={deleteMutation.isPending}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <ExceptionDialog
        open={creating || !!editing}
        existing={editing}
        defaultRole={role ?? 'all'}
        onClose={() => {
          setCreating(false);
          setEditing(null);
        }}
        onSaved={(saved, overlapping) => {
          if (saved.kind === 'block' && overlapping.length > 0) {
            setOverlapState({ exception: saved, overlapping });
          }
        }}
      />

      <OverlapDialog
        state={overlapState}
        onClose={() => {
          setOverlapState(null);
        }}
        onCancelled={() => {
          void qc.invalidateQueries({ queryKey: ['rules', 'exceptions'] });
        }}
      />
    </div>
  );
}

function exceptionSummary(exc: BookingRuleException): string {
  const parts: string[] = [];
  if (exc.dateFrom && exc.dateTo) {
    parts.push(
      exc.dateFrom === exc.dateTo ? `Il ${exc.dateFrom}` : `Dal ${exc.dateFrom} al ${exc.dateTo}`,
    );
  } else if (exc.dateFrom) {
    parts.push(`Dal ${exc.dateFrom}`);
  } else if (exc.dateTo) {
    parts.push(`Fino al ${exc.dateTo}`);
  }
  if (exc.daysOfWeek && exc.daysOfWeek.length > 0) {
    parts.push(exc.daysOfWeek.map((d) => DAYS_LABELS[d]).join(', '));
  }
  if (exc.startTime || exc.endTime) {
    parts.push(`${exc.startTime ?? '00:00'}–${exc.endTime ?? '23:59'}`);
  }
  if (parts.length === 0) parts.push('Sempre attiva');
  return parts.join(' · ');
}

function roleLabel(r: Role): string {
  return r === 'admin' ? 'Admin' : r === 'docente' ? 'Docenti' : 'Studenti';
}

// =====================================================
// Dialog: crea/modifica eccezione
// =====================================================
interface ExceptionFormState {
  role: BookingRuleExceptionScope;
  name: string;
  kind: BookingRuleExceptionKind;
  daysOfWeek: number[];
  dateFrom: string;
  dateTo: string;
  singleDate: boolean;
  startTime: string;
  endTime: string;
  maxHoursInWindow: string;
  isActive: boolean;
  notes: string;
}

function blankException(defaultRole: BookingRuleExceptionScope): ExceptionFormState {
  return {
    role: defaultRole,
    name: '',
    kind: 'block',
    daysOfWeek: [],
    dateFrom: '',
    dateTo: '',
    singleDate: false,
    startTime: '',
    endTime: '',
    maxHoursInWindow: '1',
    isActive: true,
    notes: '',
  };
}

function fromException(exc: BookingRuleException): ExceptionFormState {
  return {
    role: exc.role,
    name: exc.name,
    kind: exc.kind,
    daysOfWeek: exc.daysOfWeek ?? [],
    dateFrom: exc.dateFrom ?? '',
    dateTo: exc.dateTo ?? '',
    singleDate: !!(exc.dateFrom && exc.dateTo && exc.dateFrom === exc.dateTo),
    startTime: exc.startTime ?? '',
    endTime: exc.endTime ?? '',
    maxHoursInWindow: exc.maxHoursInWindow != null ? String(exc.maxHoursInWindow) : '1',
    isActive: exc.isActive,
    notes: exc.notes ?? '',
  };
}

function ExceptionDialog({
  open,
  existing,
  defaultRole,
  onClose,
  onSaved,
}: {
  open: boolean;
  existing: BookingRuleException | null;
  defaultRole: BookingRuleExceptionScope;
  onClose: () => void;
  onSaved?: (saved: BookingRuleException, overlapping: OverlapBooking[]) => void;
}) {
  const qc = useQueryClient();
  const [form, setForm] = useState<ExceptionFormState>(() =>
    existing ? fromException(existing) : blankException(defaultRole),
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setForm(existing ? fromException(existing) : blankException(defaultRole));
      setError(null);
    }
  }, [open, existing, defaultRole]);

  const mutation = useMutation({
    mutationFn: async (payload: UpsertExceptionPayload) => {
      const saved = existing
        ? await rulesApi.updateException(existing.id, payload)
        : await rulesApi.createException(payload);
      // Per i block carichiamo subito l'overlap così mostriamo il dialog
      // di follow-up senza un round-trip aggiuntivo lato chiamante.
      let overlapping: OverlapBooking[] = [];
      if (payload.kind === 'block') {
        try {
          const r = await rulesApi.previewOverlaps(payload);
          overlapping = r.overlapping;
        } catch {
          // Il preview è best-effort: se fallisce, salvo senza follow-up.
        }
      }
      return { saved: saved.exception, overlapping };
    },
    onSuccess: ({ saved, overlapping }) => {
      toast.success(existing ? 'Eccezione aggiornata' : 'Eccezione creata');
      void qc.invalidateQueries({ queryKey: ['rules', 'exceptions'] });
      onClose();
      onSaved?.(saved, overlapping);
    },
    onError: (err) => {
      setError(httpErrorMessage(err));
    },
  });

  const dayToggle = (d: number) => {
    setForm((f) => ({
      ...f,
      daysOfWeek: f.daysOfWeek.includes(d)
        ? f.daysOfWeek.filter((x) => x !== d)
        : [...f.daysOfWeek, d].sort(),
    }));
  };

  // Avviso "range tutto nel passato": un block con dateTo < oggi non
  // intercetterà mai prenotazioni future. Lo segnaliamo inline (non
  // bloccante: l'admin potrebbe avere un motivo storico/audit).
  const isPastOnlyRange = (() => {
    if (form.kind !== 'block') return false;
    const today = new Date().toISOString().slice(0, 10);
    const effectiveDateTo = form.singleDate ? form.dateFrom : form.dateTo;
    return !!effectiveDateTo && effectiveDateTo < today;
  })();

  const submit = () => {
    setError(null);
    if (!form.name.trim()) {
      setError('Nome obbligatorio');
      return;
    }
    if (form.kind === 'time_window') {
      const h = Number(form.maxHoursInWindow);
      if (!Number.isFinite(h) || h <= 0) {
        setError('Ore massime nella finestra: valore positivo richiesto');
        return;
      }
    }
    if (form.startTime && form.endTime && form.startTime >= form.endTime) {
      setError("L'orario di fine deve essere successivo a quello di inizio");
      return;
    }

    const dateFrom = form.dateFrom || null;
    const dateTo = form.singleDate ? form.dateFrom || null : form.dateTo || null;
    if (dateFrom && dateTo && dateFrom > dateTo) {
      setError('La data di inizio deve precedere quella di fine');
      return;
    }

    const payload: UpsertExceptionPayload = {
      role: form.role,
      name: form.name.trim(),
      kind: form.kind,
      daysOfWeek: form.daysOfWeek.length > 0 ? form.daysOfWeek : null,
      dateFrom,
      dateTo,
      startTime: form.startTime || null,
      endTime: form.endTime || null,
      maxHoursInWindow: form.kind === 'time_window' ? Number(form.maxHoursInWindow) : null,
      isActive: form.isActive,
      notes: form.notes.trim() || null,
    };
    mutation.mutate(payload);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{existing ? 'Modifica eccezione' : 'Nuova eccezione'}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="exc-name">Nome</Label>
            <Input
              id="exc-name"
              placeholder='Es. "Pausa pranzo", "Sospensione didattica"'
              value={form.name}
              onChange={(e) => {
                setForm((f) => ({ ...f, name: e.target.value }));
              }}
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Tipo</Label>
              <Select
                value={form.kind}
                onValueChange={(v) => {
                  setForm((f) => ({ ...f, kind: v as BookingRuleExceptionKind }));
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="block">Blocco totale</SelectItem>
                  <SelectItem value="time_window">Limite ore in finestra</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Si applica a</Label>
              <Select
                value={form.role}
                onValueChange={(v) => {
                  setForm((f) => ({ ...f, role: v as BookingRuleExceptionScope }));
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tutti i ruoli</SelectItem>
                  <SelectItem value="studente">Solo studenti</SelectItem>
                  <SelectItem value="docente">Solo docenti</SelectItem>
                  <SelectItem value="admin">Solo amministratori</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {form.kind === 'time_window' && (
            <div className="space-y-1.5">
              <Label htmlFor="exc-max">Ore massime nella finestra</Label>
              <Input
                id="exc-max"
                type="number"
                step="0.5"
                min="0.25"
                value={form.maxHoursInWindow}
                onChange={(e) => {
                  setForm((f) => ({ ...f, maxHoursInWindow: e.target.value }));
                }}
              />
              <p className="text-[11px] text-muted-foreground">
                Es. 1 = max 1h prenotabile complessivamente nella finestra oraria.
              </p>
            </div>
          )}

          <div className="space-y-2">
            <Label className="flex items-center gap-1.5">
              <CalendarRange className="h-3.5 w-3.5 text-indigo-600 dark:text-indigo-400" />
              Giorni della settimana
            </Label>
            <div className="flex flex-wrap gap-1">
              {DAYS_LABELS.map((label, idx) => {
                const isOn = form.daysOfWeek.includes(idx);
                return (
                  <button
                    type="button"
                    key={idx}
                    onClick={() => {
                      dayToggle(idx);
                    }}
                    className={`rounded-md border px-3 py-1 text-xs transition-colors ${
                      isOn
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'bg-background hover:bg-muted'
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
            <p className="text-[11px] text-muted-foreground">
              Lascia tutti i giorni deselezionati per applicare ogni giorno.
            </p>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Data specifica</Label>
              <label className="inline-flex items-center gap-2 text-xs text-muted-foreground">
                <Switch
                  checked={form.singleDate}
                  onCheckedChange={(v) => {
                    setForm((f) => ({
                      ...f,
                      singleDate: v,
                      dateTo: v ? '' : f.dateTo,
                    }));
                  }}
                />
                Data singola
              </label>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Input
                type="date"
                value={form.dateFrom}
                onChange={(e) => {
                  setForm((f) => ({ ...f, dateFrom: e.target.value }));
                }}
                placeholder="Data inizio"
              />
              {!form.singleDate && (
                <Input
                  type="date"
                  value={form.dateTo}
                  onChange={(e) => {
                    setForm((f) => ({ ...f, dateTo: e.target.value }));
                  }}
                  placeholder="Data fine"
                />
              )}
            </div>
            {isPastOnlyRange && (
              <Alert variant="destructive" className="text-xs">
                <AlertDescription>
                  Il periodo selezionato è già passato: questa eccezione non bloccherà nessuna
                  prenotazione futura. Se vuoi annullare prenotazioni programmate, scegli un
                  intervallo che includa date a partire da oggi.
                </AlertDescription>
              </Alert>
            )}
          </div>

          <div className="space-y-2">
            <Label className="flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
              Fascia oraria
            </Label>
            <div className="grid gap-3 sm:grid-cols-2">
              <Input
                type="time"
                value={form.startTime}
                onChange={(e) => {
                  setForm((f) => ({ ...f, startTime: e.target.value }));
                }}
              />
              <Input
                type="time"
                value={form.endTime}
                onChange={(e) => {
                  setForm((f) => ({ ...f, endTime: e.target.value }));
                }}
              />
            </div>
            <p className="text-[11px] text-muted-foreground">
              Lascia vuoto per applicare l'eccezione all'intero giorno.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="exc-notes">Note (opzionale)</Label>
            <Textarea
              id="exc-notes"
              rows={2}
              value={form.notes}
              onChange={(e) => {
                setForm((f) => ({ ...f, notes: e.target.value }));
              }}
            />
          </div>

          <div className="flex items-center justify-between rounded-lg border bg-muted/30 p-3">
            <div>
              <p className="text-sm font-medium">Eccezione attiva</p>
              <p className="text-[11px] text-muted-foreground">
                Disattivala per disabilitarla senza eliminarla.
              </p>
            </div>
            <Switch
              checked={form.isActive}
              onCheckedChange={(v) => {
                setForm((f) => ({ ...f, isActive: v }));
              }}
            />
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Annulla
          </Button>
          <Button type="button" onClick={submit} disabled={mutation.isPending}>
            {mutation.isPending ? (
              <LoaderCircle className="h-4 w-4 animate-spin" />
            ) : existing ? (
              'Salva'
            ) : (
              'Crea eccezione'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Dialog di follow-up dopo il salvataggio di un'eccezione kind='block':
 * elenca le prenotazioni preesistenti che cadono nello scope appena
 * dichiarato e propone di cancellarle in batch (con motivazione = nome
 * dell'eccezione). Coerente con il pattern EasyRoom "sovrapposizioni" al
 * setup di una chiusura.
 */
function OverlapDialog({
  state,
  onClose,
  onCancelled,
}: {
  state: { exception: BookingRuleException; overlapping: OverlapBooking[] } | null;
  onClose: () => void;
  onCancelled: () => void;
}) {
  const cancelMutation = useMutation({
    mutationFn: (id: number) => rulesApi.cancelOverlapping(id),
    onSuccess: (res) => {
      const moPart =
        res.monteOreSlotsSynced > 0
          ? ` (${res.monteOreSlotsSynced} slot Monte Ore disattivati)`
          : '';
      toast.success(`${res.cancelled} prenotazioni cancellate${moPart}`);
      onCancelled();
      onClose();
    },
    onError: (err) => toast.error(httpErrorMessage(err)),
  });

  if (!state) return null;
  const { exception, overlapping } = state;
  const fmt = (iso: string) =>
    new Date(iso).toLocaleString('it-IT', {
      weekday: 'short',
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Ban className="h-5 w-5 text-destructive" />
            Sovrapposizioni rilevate
          </DialogTitle>
        </DialogHeader>

        <Alert variant="destructive">
          <AlertDescription>
            <strong>{overlapping.length}</strong> prenotazione/i futura/e cadono nello scope del
            blocco "{exception.name}". Restano nell'agenda finché non vengono cancellate.
          </AlertDescription>
        </Alert>

        <div className="max-h-72 overflow-y-auto rounded-lg border">
          <ul className="divide-y">
            {overlapping.map((b) => (
              <li key={b.id} className="space-y-0.5 px-3 py-2 text-xs">
                <div className="flex items-center gap-2">
                  <p className="font-medium">
                    {fmt(b.startTime)} → {fmt(b.endTime)}
                  </p>
                  {b.fromMonteOre && (
                    <Badge variant="secondary" className="h-4 px-1 text-[10px]">
                      Monte Ore
                    </Badge>
                  )}
                </div>
                <p className="text-muted-foreground">
                  {b.user
                    ? `${b.user.lastName} ${b.user.firstName} (${roleLabel(b.user.role as Role)})`
                    : 'Utente sconosciuto'}
                  {' • '}
                  {b.room
                    ? `${b.room.name}${b.room.building ? ` (${b.room.building.name})` : ''}`
                    : 'Aula sconosciuta'}
                </p>
                {b.purpose && <p className="italic text-muted-foreground">{b.purpose}</p>}
              </li>
            ))}
          </ul>
        </div>

        <p className="text-[11px] text-muted-foreground">
          La cancellazione tocca solo prenotazioni future non ancora effettuate (no check-in). Le
          prenotazioni passate restano per integrità storica. Per le prenotazioni Monte Ore
          disattiviamo anche lo slot collegato così la rigenerazione non le ricrea.
        </p>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Lascia stare
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={() => cancelMutation.mutate(exception.id)}
            disabled={cancelMutation.isPending}
          >
            {cancelMutation.isPending ? (
              <LoaderCircle className="h-4 w-4 animate-spin" />
            ) : (
              `Cancella ${overlapping.length} prenotazion${overlapping.length === 1 ? 'e' : 'i'}`
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
