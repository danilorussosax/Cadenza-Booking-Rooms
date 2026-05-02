import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Clock, LoaderCircle } from 'lucide-react';
import { toast } from 'sonner';
import { usersApi } from '@/api/users';
import { coursesApi } from '@/api/courses';
import { contractTypesApi } from '@/api/contractTypes';
import { httpErrorMessage } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { FieldError } from '@/components/ui/field-error';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Alert, AlertDescription } from '@/components/ui/alert';
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
import type { Role, User } from '@/types';

const baseSchema = z.object({
  firstName: z.string().min(1, 'Inserisci il nome'),
  lastName: z.string().min(1, 'Inserisci il cognome'),
  email: z.email('Email non valida'),
  role: z.enum(['admin', 'docente', 'studente']),
  matricola: z.string().optional(),
  courseId: z.string().optional(),
  isActive: z.boolean(),
  password: z.string().optional(),
  // Monte Ore — campi solo per docenti, validati a livello applicativo (sotto).
  contractType: z.string().optional(),
  monteOreUseHoursOverride: z.boolean().optional(),
  monteOreAnnualHoursOverride: z.string().optional(),
  monteOreBypassDayConstraint: z.boolean().optional(),
  monteOreOverrideReason: z.string().optional(),
});

type FormValues = z.infer<typeof baseSchema>;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user?: User | null;
}

export function UserFormDialog({ open, onOpenChange, user }: Props) {
  const qc = useQueryClient();
  const isEdit = !!user;
  const [serverError, setServerError] = useState<string | null>(null);

  const coursesQuery = useQuery({
    queryKey: ['courses', 'all'],
    queryFn: () => coursesApi.listAll(),
    enabled: open,
    staleTime: 60_000,
  });

  // Tipologie contrattuali (anagrafica admin) — sempre includiamo le inattive
  // per visualizzare correttamente l'eventuale tipo legacy già assegnato a
  // un utente esistente.
  const contractTypesQuery = useQuery({
    queryKey: ['contract-types', { includeInactive: true }],
    queryFn: () => contractTypesApi.list({ includeInactive: true }),
    enabled: open,
    staleTime: 60_000,
  });
  const contractTypes = contractTypesQuery.data?.contractTypes ?? [];

  const schema = baseSchema.refine((v) => isEdit || (v.password && v.password.length >= 8), {
    path: ['password'],
    message: 'La password deve avere almeno 8 caratteri.',
  });

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      firstName: '',
      lastName: '',
      email: '',
      role: 'studente',
      matricola: '',
      courseId: '',
      isActive: true,
      password: '',
      contractType: '__none__',
      monteOreUseHoursOverride: false,
      monteOreAnnualHoursOverride: '',
      monteOreBypassDayConstraint: false,
      monteOreOverrideReason: '',
    },
  });

  useEffect(() => {
    if (open) {
      const overrideValue = user?.monteOreAnnualHoursOverride;
      const hasHoursOverride = overrideValue != null;
      reset({
        firstName: user?.firstName ?? '',
        lastName: user?.lastName ?? '',
        email: user?.email ?? '',
        role: user?.role ?? 'studente',
        matricola: user?.matricola ?? '',
        courseId: user?.courseId ? String(user.courseId) : '',
        isActive: user?.isActive ?? true,
        password: '',
        contractType: user?.contractType ?? '__none__',
        monteOreUseHoursOverride: hasHoursOverride,
        monteOreAnnualHoursOverride: hasHoursOverride ? String(overrideValue) : '',
        monteOreBypassDayConstraint: !!user?.monteOreBypassDayConstraint,
        monteOreOverrideReason: user?.monteOreOverrideReason ?? '',
      });
      setServerError(null);
    }
  }, [open, user, reset]);

  const role = watch('role');
  const courseId = watch('courseId');
  const isActive = watch('isActive');
  const contractType = watch('contractType');
  const useHoursOverride = !!watch('monteOreUseHoursOverride');
  const bypassDay = !!watch('monteOreBypassDayConstraint');
  const isMonteOreOverrideOn = useHoursOverride || bypassDay;

  const mutation = useMutation({
    mutationFn: async (values: FormValues) => {
      const payload = {
        firstName: values.firstName,
        lastName: values.lastName,
        email: values.email,
        role: values.role,
        matricola: values.matricola?.trim() ?? null,
        courseId: values.courseId ? Number(values.courseId) : null,
        isActive: values.isActive,
      };
      const result = isEdit
        ? await usersApi.update(user.id, {
            ...payload,
            newPassword: values.password?.trim() ?? undefined,
          })
        : await usersApi.create({
            ...payload,
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            password: values.password!,
          });

      // Salva la deroga Monte Ore in una chiamata separata. Si applica solo a
      // docenti (sia in update che dopo create), e solo se almeno un campo
      // della sezione differisce dallo stato corrente del DB (best-effort).
      if (result.user.role === 'docente') {
        const ct =
          !values.contractType || values.contractType === '__none__' ? null : values.contractType;
        const hours = values.monteOreUseHoursOverride
          ? Number(values.monteOreAnnualHoursOverride ?? 0)
          : null;
        const bypass = !!values.monteOreBypassDayConstraint;
        const reason = values.monteOreOverrideReason?.trim() ?? null;
        await usersApi.setMonteOreOverride(result.user.id, {
          contractType: ct,
          monteOreAnnualHoursOverride: hours,
          monteOreBypassDayConstraint: bypass,
          monteOreOverrideReason: reason,
        });
      }
      return result;
    },
    onSuccess: () => {
      toast.success(isEdit ? 'Utente aggiornato' : 'Utente creato');
      void qc.invalidateQueries({ queryKey: ['users'] });
      onOpenChange(false);
    },
    onError: (err) => {
      setServerError(httpErrorMessage(err));
    },
  });

  const onSubmit = (values: FormValues) => {
    setServerError(null);
    // Validazione client: motivazione obbligatoria se override attivo
    if (
      values.role === 'docente' &&
      (values.monteOreUseHoursOverride === true || values.monteOreBypassDayConstraint === true) &&
      !values.monteOreOverrideReason?.trim()
    ) {
      setServerError('Inserisci la motivazione della deroga Monte Ore.');
      return;
    }
    if (
      values.role === 'docente' &&
      values.monteOreUseHoursOverride === true &&
      (!values.monteOreAnnualHoursOverride ||
        Number.isNaN(Number(values.monteOreAnnualHoursOverride)) ||
        Number(values.monteOreAnnualHoursOverride) < 0 ||
        Number(values.monteOreAnnualHoursOverride) > 1500)
    ) {
      setServerError('Soglia ore personalizzata non valida (0-1500).');
      return;
    }
    mutation.mutate(values);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Modifica utente' : 'Nuovo utente'}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? 'Aggiorna i dati o reimposta la password lasciando il campo vuoto per non cambiarla.'
              : 'Crea un account manualmente. La password iniziale può essere modificata in seguito dall’utente.'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
          {serverError && (
            <Alert variant="destructive">
              <AlertDescription>{serverError}</AlertDescription>
            </Alert>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="firstName">Nome</Label>
              <Input
                id="firstName"
                aria-invalid={!!errors.firstName}
                aria-describedby={errors.firstName ? 'firstName-error' : undefined}
                {...register('firstName')}
              />
              <FieldError id="firstName-error">
                {errors.firstName?.message}
              </FieldError>
            </div>
            <div className="space-y-2">
              <Label htmlFor="lastName">Cognome</Label>
              <Input
                id="lastName"
                aria-invalid={!!errors.lastName}
                aria-describedby={errors.lastName ? 'lastName-error' : undefined}
                {...register('lastName')}
              />
              <FieldError id="lastName-error">
                {errors.lastName?.message}
              </FieldError>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              aria-invalid={!!errors.email}
              aria-describedby={errors.email ? 'email-error' : undefined}
              {...register('email')}
            />
            <FieldError id="email-error">{errors.email?.message}</FieldError>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Ruolo</Label>
              <Select
                value={role}
                onValueChange={(v) => {
                  setValue('role', v as Role);
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="admin">Amministratore</SelectItem>
                  <SelectItem value="docente">Docente</SelectItem>
                  <SelectItem value="studente">Studente</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="matricola">Matricola</Label>
              <Input id="matricola" {...register('matricola')} />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Corso di studio</Label>
            <Select
              value={courseId ?? '__none__'}
              onValueChange={(v) => {
                setValue('courseId', v === '__none__' ? '' : v, { shouldValidate: true });
              }}
              disabled={coursesQuery.isLoading}
            >
              <SelectTrigger>
                <SelectValue placeholder="Nessun corso" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">Nessun corso</SelectItem>
                {coursesQuery.data?.courses.map((c) => (
                  <SelectItem key={c.id} value={String(c.id)}>
                    {c.code} — {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="password">
              {isEdit ? 'Nuova password (lascia vuoto per non cambiarla)' : 'Password iniziale'}
            </Label>
            <Input
              id="password"
              type="password"
              autoComplete="new-password"
              placeholder={isEdit ? '••••••••' : 'Almeno 8 caratteri'}
              aria-invalid={!!errors.password}
              aria-describedby={errors.password ? 'password-error' : undefined}
              {...register('password')}
            />
            <FieldError id="password-error">
              {errors.password?.message}
            </FieldError>
          </div>

          <div className="flex items-center justify-between rounded-lg border p-3">
            <div>
              <p className="text-sm font-medium">Account attivo</p>
              <p className="text-xs text-muted-foreground">
                Disattivando l’utente non potrà più accedere.
              </p>
            </div>
            <Switch
              checked={isActive}
              onCheckedChange={(v) => {
                setValue('isActive', v);
              }}
            />
          </div>

          {role === 'docente' && (
            <div className="rounded-lg border bg-muted/20 p-3 space-y-3">
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-primary" />
                <p className="text-sm font-medium">
                  Monte Ore — Tipo contratto e override individuale
                </p>
              </div>
              <p className="text-xs text-muted-foreground">
                Il <strong>tipo contratto</strong> determina la soglia annua di default. L'
                <strong>override individuale</strong> consente di assegnare ore specifiche a questo
                docente — funziona per <em>qualsiasi</em> tipo contratto, anche per i titolari (es.
                coordinatore di dipartimento con +36h aggiuntive), e ha priorità sul default del
                tipo.
              </p>

              <div className="space-y-2">
                <Label>Tipo contratto</Label>
                <Select
                  value={contractType ?? '__none__'}
                  onValueChange={(v) => {
                    setValue('contractType', v);
                  }}
                  disabled={contractTypesQuery.isLoading}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Non specificato</SelectItem>
                    {contractTypes.map((ct) => {
                      const hoursLabel =
                        ct.defaultHours != null ? ` · default ${ct.defaultHours}h` : '';
                      const inactiveLabel = ct.isActive ? '' : ' (disattivato)';
                      return (
                        <SelectItem key={ct.id} value={ct.code} disabled={!ct.isActive}>
                          {ct.label}
                          {hoursLabel}
                          {inactiveLabel}
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
                {contractType &&
                  contractType !== '__none__' &&
                  (() => {
                    const ct = contractTypes.find((c) => c.code === contractType);
                    if (ct?.defaultHours == null) return null;
                    return (
                      <p className="text-xs text-muted-foreground">
                        Soglia di default per "{ct.label}": <strong>{ct.defaultHours}h/anno</strong>
                        . Sovrascrivibile con l'override individuale qui sotto.
                      </p>
                    );
                  })()}
              </div>

              <div className="flex items-center justify-between rounded-md border bg-background p-3">
                <div className="flex-1">
                  <p className="text-sm font-medium">Override Monte Ore individuale</p>
                  <p className="text-xs text-muted-foreground">
                    Se attivo, sostituisce sia le ore default del tipo sia la soglia istituzionale,
                    solo per questo docente.
                  </p>
                </div>
                <Switch
                  checked={useHoursOverride}
                  onCheckedChange={(v) => {
                    setValue('monteOreUseHoursOverride', v);
                  }}
                />
              </div>

              {useHoursOverride && (
                <div className="space-y-2 pl-3 border-l-2 border-primary/40">
                  <Label htmlFor="monteOreAnnualHoursOverride">Ore annue</Label>
                  <Input
                    id="monteOreAnnualHoursOverride"
                    type="number"
                    min={0}
                    max={1500}
                    step={0.5}
                    placeholder="es. 60"
                    {...register('monteOreAnnualHoursOverride')}
                  />
                  <p className="text-xs text-muted-foreground">
                    Range valido: 0-1500 h. Tipici contratti orari: 30, 60, 120, 180 h.
                  </p>
                </div>
              )}

              <div className="flex items-center justify-between rounded-md border bg-background p-3">
                <div className="flex-1">
                  <p className="text-sm font-medium">Esente dal vincolo 2-4 giorni/settimana</p>
                  <p className="text-xs text-muted-foreground">
                    Per contratti brevi che possono concentrare le lezioni in 1 giorno.
                  </p>
                </div>
                <Switch
                  checked={bypassDay}
                  onCheckedChange={(v) => {
                    setValue('monteOreBypassDayConstraint', v);
                  }}
                />
              </div>

              {isMonteOreOverrideOn && (
                <div className="space-y-2">
                  <Label htmlFor="monteOreOverrideReason">
                    Motivazione <span className="text-destructive">*</span>
                  </Label>
                  <Textarea
                    id="monteOreOverrideReason"
                    rows={2}
                    placeholder="es. Contratto orario 60h - prot. 2026/123 del 15/09/2026"
                    {...register('monteOreOverrideReason')}
                  />
                  <p className="text-xs text-muted-foreground">
                    Obbligatoria — verrà tracciata nell'audit log.
                  </p>
                </div>
              )}

              {user?.monteOreOverrideSetAt && isMonteOreOverrideOn && (
                <p className="text-[11px] text-muted-foreground">
                  Ultima modifica: {new Date(user.monteOreOverrideSetAt).toLocaleString('it-IT')}
                </p>
              )}
            </div>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                onOpenChange(false);
              }}
              disabled={isSubmitting}
            >
              Annulla
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? (
                <LoaderCircle className="h-4 w-4 animate-spin" />
              ) : isEdit ? (
                'Salva modifiche'
              ) : (
                'Crea utente'
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
