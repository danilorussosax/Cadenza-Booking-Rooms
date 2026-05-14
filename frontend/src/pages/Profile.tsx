import { useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Link } from 'react-router-dom';
import {
  Bell,
  CheckCircle2,
  Download,
  Eye,
  EyeOff,
  FileText,
  ImageUp,
  KeyRound,
  LoaderCircle,
  Lock,
  Mail,
  ShieldCheck,
  Trash2,
  UserRound,
} from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { authApi } from '@/api/auth';
import { TwoFaSection } from '@/components/profile/TwoFaSection';
import { BotBindingsSection } from '@/components/profile/BotBindingsSection';
import { coursesApi } from '@/api/courses';
import { gdprApi } from '@/api/gdpr';
import { PRIVACY_POLICY_VERSION, TERMS_VERSION } from '@/pages/legal/policyVersions';
import { useTranslation } from 'react-i18next';
import { httpErrorMessage, tokenStore } from '@/lib/api';
import { cn } from '@/lib/utils';
import { dayjs } from '@/lib/date';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { FieldError } from '@/components/ui/field-error';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
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

// =====================================================
// Personal info form
// =====================================================
const personalSchema = z.object({
  firstName: z.string().min(1, 'Inserisci il nome'),
  lastName: z.string().min(1, 'Inserisci il cognome'),
  matricola: z.string().optional(),
  courseId: z.string().optional(),
});
type PersonalValues = z.infer<typeof personalSchema>;

// =====================================================
// Password form
// =====================================================
const passwordSchema = z
  .object({
    currentPassword: z.string().optional(),
    newPassword: z.string().min(8, 'La password deve avere almeno 8 caratteri'),
    confirmPassword: z.string().min(1, 'Conferma la nuova password'),
  })
  .refine((d) => d.newPassword === d.confirmPassword, {
    path: ['confirmPassword'],
    message: 'Le password non coincidono',
  });
type PasswordValues = z.infer<typeof passwordSchema>;

export default function Profile() {
  const { user, updateUser } = useAuth();
  const { t } = useTranslation();

  if (!user) return null;

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <header className="space-y-1.5">
        <h1 className="font-display text-3xl font-medium">{t('profile.title')}</h1>
        <p className="text-sm text-muted-foreground">{t('profile.subtitle')}</p>
      </header>

      {/* Identity card */}
      <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
        <Card>
          <CardContent className="flex flex-col items-center gap-4 p-6 text-center sm:flex-row sm:items-center sm:gap-5 sm:text-left">
            <ProfilePhotoUploader user={user} updateUser={updateUser} />
            <div className="min-w-0 flex-1 space-y-1">
              <h2 className="font-display text-xl font-medium leading-tight">
                {user.firstName} {user.lastName}
              </h2>
              <p className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
                <Mail className="h-3.5 w-3.5" />
                {user.email}
              </p>
              <div className="flex flex-wrap items-center justify-center gap-1.5 sm:justify-start">
                <Badge variant="default">
                  {user.role === 'admin' && <ShieldCheck className="mr-1 h-3 w-3" />}
                  {t(`roles.${user.role}`)}
                </Badge>
                <Badge variant={user.isActive ? 'success' : 'muted'}>
                  {user.isActive ? t('common.active') : t('common.inactive')}
                </Badge>
                {user.googleId && <Badge variant="secondary">Google</Badge>}
                {user.microsoftId && <Badge variant="secondary">Microsoft</Badge>}
              </div>
            </div>
          </CardContent>
        </Card>
      </motion.div>

      <PersonalSection user={user} updateUser={updateUser} />
      <NotificationsSection user={user} updateUser={updateUser} />
      <PasswordSection isOAuthUser={!!(user.googleId ?? user.microsoftId)} />
      <TwoFaSection user={user} updateUser={updateUser} />
      <BotBindingsSection />
      <AccountSection user={user} />
      <PrivacySection user={user} />
    </div>
  );
}

// =====================================================
// Profile photo uploader (avatar + carica/cambia/rimuovi)
// =====================================================
function ProfilePhotoUploader({
  user,
  updateUser,
}: {
  user: NonNullable<ReturnType<typeof useAuth>['user']>;
  updateUser: ReturnType<typeof useAuth>['updateUser'];
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const initials = `${user.firstName[0]}${user.lastName[0]}`;
  const hasPhoto = !!user.profilePhotoUrl;

  const uploadMutation = useMutation({
    mutationFn: (file: File) => authApi.uploadPhoto(file),
    onSuccess: ({ user: updated }) => {
      toast.success('Foto profilo aggiornata');
      updateUser(updated);
    },
    onError: (err) => toast.error(httpErrorMessage(err)),
  });

  const deleteMutation = useMutation({
    mutationFn: () => authApi.deletePhoto(),
    onSuccess: ({ user: updated }) => {
      toast.success('Foto profilo rimossa');
      updateUser(updated);
    },
    onError: (err) => toast.error(httpErrorMessage(err)),
  });

  const busy = uploadMutation.isPending || deleteMutation.isPending;

  return (
    <div className="flex flex-col items-center gap-2">
      <Avatar className="h-20 w-20 ring-1 ring-border">
        {hasPhoto && <AvatarImage src={user.profilePhotoUrl ?? ''} alt="Foto profilo" />}
        <AvatarFallback className="bg-primary/10 text-lg text-primary">{initials}</AvatarFallback>
      </Avatar>
      <div className="flex items-center gap-1">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => fileRef.current?.click()}
          disabled={busy}
        >
          {uploadMutation.isPending ? (
            <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <ImageUp className="h-3.5 w-3.5" />
          )}
          {hasPhoto ? 'Cambia' : 'Carica foto'}
        </Button>
        {hasPhoto && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            title="Rimuovi foto"
            onClick={() => {
              deleteMutation.mutate();
            }}
            disabled={busy}
            className="h-8 w-8 text-destructive hover:bg-destructive/10 hover:text-destructive"
          >
            {deleteMutation.isPending ? (
              <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Trash2 className="h-3.5 w-3.5" />
            )}
          </Button>
        )}
      </div>
      <p className="text-[11px] text-muted-foreground">PNG · JPG · WEBP · max 2 MB</p>
      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) uploadMutation.mutate(f);
          e.target.value = '';
        }}
      />
    </div>
  );
}

// =====================================================
// Personal section
// =====================================================
function PersonalSection({
  user,
  updateUser,
}: {
  user: NonNullable<ReturnType<typeof useAuth>['user']>;
  updateUser: ReturnType<typeof useAuth>['updateUser'];
}) {
  const [serverError, setServerError] = useState<string | null>(null);

  const coursesQuery = useQuery({
    queryKey: ['courses', 'active'],
    queryFn: () => coursesApi.list({ active: true }),
    staleTime: 5 * 60 * 1000,
  });

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    reset,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<PersonalValues>({
    resolver: zodResolver(personalSchema),
    defaultValues: {
      firstName: user.firstName,
      lastName: user.lastName,
      matricola: user.matricola ?? '',
      courseId: user.courseId ? String(user.courseId) : '',
    },
  });

  useEffect(() => {
    reset({
      firstName: user.firstName,
      lastName: user.lastName,
      matricola: user.matricola ?? '',
      courseId: user.courseId ? String(user.courseId) : '',
    });
  }, [user, reset]);

  const courseId = watch('courseId');

  const mutation = useMutation({
    mutationFn: (values: PersonalValues) =>
      authApi.updateMe({
        firstName: values.firstName.trim(),
        lastName: values.lastName.trim(),
        matricola: values.matricola?.trim() ?? null,
        courseId: values.courseId ? Number(values.courseId) : null,
      }),
    onSuccess: ({ user: updated }) => {
      toast.success('Profilo aggiornato');
      updateUser(updated);
      reset({
        firstName: updated.firstName,
        lastName: updated.lastName,
        matricola: updated.matricola ?? '',
        courseId: updated.courseId ? String(updated.courseId) : '',
      });
    },
    onError: (err) => {
      setServerError(httpErrorMessage(err));
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 font-display text-xl">
          <UserRound className="h-5 w-5 text-muted-foreground" />
          Informazioni personali
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form
          onSubmit={handleSubmit((v) => {
            setServerError(null);
            mutation.mutate(v);
          })}
          className="space-y-4"
          noValidate
        >
          {serverError && (
            <Alert variant="destructive">
              <AlertDescription>{serverError}</AlertDescription>
            </Alert>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="p-firstName">Nome</Label>
              <Input
                id="p-firstName"
                aria-invalid={!!errors.firstName}
                aria-describedby={errors.firstName ? 'p-firstName-error' : undefined}
                {...register('firstName')}
              />
              <FieldError id="p-firstName-error">{errors.firstName?.message}</FieldError>
            </div>
            <div className="space-y-2">
              <Label htmlFor="p-lastName">Cognome</Label>
              <Input
                id="p-lastName"
                aria-invalid={!!errors.lastName}
                aria-describedby={errors.lastName ? 'p-lastName-error' : undefined}
                {...register('lastName')}
              />
              <FieldError id="p-lastName-error">{errors.lastName?.message}</FieldError>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Email</Label>
            <Input value={user.email} disabled readOnly />
            <p className="text-[11px] text-muted-foreground">
              L’email non è modificabile. Contatta un amministratore per cambiarla.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="p-matricola">Matricola</Label>
              <Input id="p-matricola" {...register('matricola')} />
            </div>
            <div className="space-y-2">
              <Label>Corso di studio</Label>
              <Select
                value={courseId ?? '__none__'}
                onValueChange={(v) => {
                  setValue('courseId', v === '__none__' ? '' : v, { shouldDirty: true });
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
          </div>

          <div className="flex items-center justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                reset();
              }}
              disabled={!isDirty || isSubmitting}
            >
              Reimposta
            </Button>
            <Button type="submit" disabled={!isDirty || isSubmitting}>
              {isSubmitting ? <LoaderCircle className="h-4 w-4 animate-spin" /> : 'Salva modifiche'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

// =====================================================
// Password section
// =====================================================
function PasswordSection({ isOAuthUser }: { isOAuthUser: boolean }) {
  const [serverError, setServerError] = useState<string | null>(null);
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<PasswordValues>({
    resolver: zodResolver(passwordSchema),
    defaultValues: { currentPassword: '', newPassword: '', confirmPassword: '' },
  });

  const mutation = useMutation({
    mutationFn: (values: PasswordValues) =>
      authApi.changePassword(values.currentPassword?.trim() ?? undefined, values.newPassword),
    onSuccess: ({ token }) => {
      // Il backend bumpa tokenVersion sul cambio password e riemette un
      // nuovo JWT: senza salvarlo, la prossima richiesta riceverebbe
      // TOKEN_REVOKED e l'utente verrebbe sloggato spuriamente.
      if (token) tokenStore.set(token);
      toast.success('Password aggiornata');
      reset({ currentPassword: '', newPassword: '', confirmPassword: '' });
    },
    onError: (err) => {
      setServerError(httpErrorMessage(err));
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 font-display text-xl">
          <KeyRound className="h-5 w-5 text-muted-foreground" />
          Sicurezza · Cambio password
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form
          onSubmit={handleSubmit((v) => {
            setServerError(null);
            mutation.mutate(v);
          })}
          className="space-y-4"
          noValidate
        >
          {serverError && (
            <Alert variant="destructive">
              <AlertDescription>{serverError}</AlertDescription>
            </Alert>
          )}

          {isOAuthUser && (
            <Alert variant="info">
              <CheckCircle2 className="h-4 w-4" />
              <AlertDescription>
                Hai effettuato l’accesso tramite un provider esterno (Google/Microsoft). Imposta una
                password se vuoi accedere anche con email e password — la password attuale può
                essere lasciata vuota se non ne hai mai impostata una.
              </AlertDescription>
            </Alert>
          )}

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="cur-pw">Password attuale</Label>
              <button
                type="button"
                tabIndex={-1}
                onClick={() => {
                  setShowCurrent((s) => !s);
                }}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                {showCurrent ? (
                  <EyeOff className="inline h-3.5 w-3.5" />
                ) : (
                  <Eye className="inline h-3.5 w-3.5" />
                )}
              </button>
            </div>
            <Input
              id="cur-pw"
              type={showCurrent ? 'text' : 'password'}
              autoComplete="current-password"
              placeholder={
                isOAuthUser ? 'Lascia vuoto se non ne hai mai impostata una' : '••••••••'
              }
              {...register('currentPassword')}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="new-pw">Nuova password</Label>
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={() => {
                    setShowNew((s) => !s);
                  }}
                  className="text-xs text-muted-foreground hover:text-foreground"
                >
                  {showNew ? (
                    <EyeOff className="inline h-3.5 w-3.5" />
                  ) : (
                    <Eye className="inline h-3.5 w-3.5" />
                  )}
                </button>
              </div>
              <Input
                id="new-pw"
                type={showNew ? 'text' : 'password'}
                autoComplete="new-password"
                placeholder="Almeno 8 caratteri"
                aria-invalid={!!errors.newPassword}
                aria-describedby={errors.newPassword ? 'new-pw-error' : undefined}
                {...register('newPassword')}
              />
              <FieldError id="new-pw-error">{errors.newPassword?.message}</FieldError>
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm-pw">Conferma nuova password</Label>
              <Input
                id="confirm-pw"
                type={showNew ? 'text' : 'password'}
                autoComplete="new-password"
                placeholder="Ripeti la nuova password"
                aria-invalid={!!errors.confirmPassword}
                aria-describedby={errors.confirmPassword ? 'confirm-pw-error' : undefined}
                {...register('confirmPassword')}
              />
              <FieldError id="confirm-pw-error">{errors.confirmPassword?.message}</FieldError>
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 pt-2">
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? (
                <LoaderCircle className="h-4 w-4 animate-spin" />
              ) : (
                'Aggiorna password'
              )}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

// =====================================================
// Account meta info
// =====================================================
// =====================================================
// Notifications section — opt-in / opt-out email per tipologia
// =====================================================
function NotificationsSection({
  user,
  updateUser,
}: {
  user: NonNullable<ReturnType<typeof useAuth>['user']>;
  updateUser: ReturnType<typeof useAuth>['updateUser'];
}) {
  const { t } = useTranslation();

  // Master switch: se false blocca tutti gli invii (anche se i singoli sono ON).
  const enabled = user.emailNotifications ?? true;
  // Granulari: default true se il backend non li ha ancora restituiti.
  const onConfirmation = user.notifyOnConfirmation ?? true;
  const onReminder = user.notifyOnReminder ?? true;
  const onCancellation = user.notifyOnCancellation ?? true;

  type Patch = Parameters<typeof authApi.updateMe>[0];

  const mutation = useMutation({
    mutationFn: (patch: Patch) => authApi.updateMe(patch),
    onSuccess: ({ user: updated }, patch) => {
      // Determina il valore booleano cambiato per il toast (l'unico cambio per chiamata).
      const changedKey = Object.keys(patch)[0] as keyof Patch | undefined;
      const newVal = changedKey ? (patch as Record<string, unknown>)[changedKey] : undefined;
      if (typeof newVal === 'boolean') {
        toast.success(
          t(newVal ? 'profile.notifications.saved_on' : 'profile.notifications.saved_off'),
        );
      }
      updateUser(updated);
    },
    onError: (err) => toast.error(httpErrorMessage(err)),
  });

  const set = (patch: Patch) => {
    mutation.mutate(patch);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 font-display text-xl">
          <Bell className="h-5 w-5 text-muted-foreground" />
          {t('profile.notifications.title')}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">{t('profile.notifications.description')}</p>

        {/* Master switch */}
        <div className="flex items-center justify-between rounded-lg border bg-muted/30 p-4">
          <div className="space-y-1 pr-3">
            <p className="text-sm font-medium">{t('profile.notifications.master_title')}</p>
            <p className="text-xs text-muted-foreground">
              {t('profile.notifications.master_help')}
            </p>
          </div>
          <Switch
            checked={enabled}
            disabled={mutation.isPending}
            onCheckedChange={(v) => {
              set({ emailNotifications: v });
            }}
            aria-label={t('profile.notifications.master_title')}
          />
        </div>

        {/* Toggle granulari (disabilitati visivamente se il master è OFF) */}
        <div
          className={cn('space-y-2 transition-opacity', !enabled && 'opacity-60')}
          aria-disabled={!enabled}
        >
          <NotificationToggleRow
            title={t('profile.notifications.confirmation_title')}
            help={t('profile.notifications.confirmation_help')}
            checked={onConfirmation}
            disabled={!enabled || mutation.isPending}
            onChange={(v) => {
              set({ notifyOnConfirmation: v });
            }}
          />
          <NotificationToggleRow
            title={t('profile.notifications.reminder_title')}
            help={t('profile.notifications.reminder_help')}
            checked={onReminder}
            disabled={!enabled || mutation.isPending}
            onChange={(v) => {
              set({ notifyOnReminder: v });
            }}
          />
          <NotificationToggleRow
            title={t('profile.notifications.cancellation_title')}
            help={t('profile.notifications.cancellation_help')}
            checked={onCancellation}
            disabled={!enabled || mutation.isPending}
            onChange={(v) => {
              set({ notifyOnCancellation: v });
            }}
          />
        </div>
      </CardContent>
    </Card>
  );
}

function NotificationToggleRow({
  title,
  help,
  checked,
  disabled,
  onChange,
}: {
  title: string;
  help: string;
  checked: boolean;
  disabled: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between rounded-lg border p-4">
      <div className="space-y-0.5 pr-3">
        <p className="text-sm font-medium">{title}</p>
        <p className="text-xs text-muted-foreground">{help}</p>
      </div>
      <Switch checked={checked} disabled={disabled} onCheckedChange={onChange} aria-label={title} />
    </div>
  );
}

// =====================================================
// Privacy & GDPR section
// Espone i diritti dell'interessato (artt. 15, 17, 20):
//   - stato consensi correnti (privacy_policy / terms / marketing)
//   - download dei propri dati (portabilità)
//   - cancellazione account (con conferma testuale: l'utente deve digitare
//     la propria email per confermare un'operazione irreversibile)
// =====================================================
function PrivacySection({ user }: { user: NonNullable<ReturnType<typeof useAuth>['user']> }) {
  const qc = useQueryClient();
  const { logout } = useAuth();
  const [deleteOpen, setDeleteOpen] = useState(false);

  const consentsQuery = useQuery({
    queryKey: ['gdpr', 'consents'],
    queryFn: () => gdprApi.getConsents(),
  });

  const exportMutation = useMutation({
    mutationFn: () => gdprApi.exportData(),
    onSuccess: ({ filename }) => toast.success(`Export scaricato: ${filename}`),
    onError: (err: Error) => toast.error(err.message),
  });

  const marketingMutation = useMutation({
    mutationFn: (granted: boolean) =>
      gdprApi.setConsent({
        consentType: 'marketing',
        granted,
        policyVersion: PRIVACY_POLICY_VERSION,
      }),
    onSuccess: (_, granted) => {
      void qc.invalidateQueries({ queryKey: ['gdpr', 'consents'] });
      toast.success(granted ? 'Consenso marketing attivato' : 'Consenso marketing revocato');
    },
    onError: (err) => toast.error(httpErrorMessage(err)),
  });

  const consents = consentsQuery.data?.consents ?? {};
  const marketingGranted = consents.marketing?.granted ?? false;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 font-display text-xl">
          <Lock className="h-5 w-5 text-muted-foreground" />
          Privacy e dati personali
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Documenti legali */}
        <div className="space-y-2">
          <p className="text-sm font-medium">Documenti</p>
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline" size="sm">
              <Link to="/privacy-policy">
                <FileText className="h-3.5 w-3.5" />
                Privacy Policy (v. {PRIVACY_POLICY_VERSION})
              </Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link to="/terms">
                <FileText className="h-3.5 w-3.5" />
                Termini di servizio (v. {TERMS_VERSION})
              </Link>
            </Button>
          </div>
        </div>

        <Separator />

        {/* Stato consensi */}
        <div className="space-y-2">
          <p className="text-sm font-medium">I tuoi consensi</p>
          {consentsQuery.isLoading ? (
            <p className="text-xs text-muted-foreground">
              <LoaderCircle className="inline h-3 w-3 animate-spin" /> Caricamento…
            </p>
          ) : (
            <ul className="space-y-1 text-xs text-muted-foreground">
              <ConsentRow label="Informativa privacy" record={consents.privacy_policy} />
              <ConsentRow label="Termini di servizio" record={consents.terms} />
              <ConsentRow
                label="Comunicazioni promozionali (marketing)"
                record={consents.marketing}
              />
            </ul>
          )}

          <div className="flex items-center justify-between rounded-lg border bg-muted/30 p-3">
            <div className="pr-3">
              <p className="text-sm font-medium">Comunicazioni promozionali</p>
              <p className="text-xs text-muted-foreground">
                Newsletter su iniziative dell'Istituto. Revocabile in qualsiasi momento.
              </p>
            </div>
            <Switch
              checked={marketingGranted}
              disabled={marketingMutation.isPending}
              onCheckedChange={(v) => {
                marketingMutation.mutate(v);
              }}
              aria-label="Consenso marketing"
            />
          </div>
        </div>

        <Separator />

        {/* Diritti GDPR */}
        <div className="space-y-2">
          <p className="text-sm font-medium">Diritti GDPR</p>
          <p className="text-xs text-muted-foreground">
            Puoi scaricare una copia dei tuoi dati o richiedere la cancellazione del tuo account in
            qualsiasi momento.
          </p>

          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                exportMutation.mutate();
              }}
              disabled={exportMutation.isPending}
            >
              {exportMutation.isPending ? (
                <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Download className="h-3.5 w-3.5" />
              )}
              Scarica i miei dati (JSON)
            </Button>

            {user.role !== 'admin' && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                onClick={() => {
                  setDeleteOpen(true);
                }}
              >
                <Trash2 className="h-3.5 w-3.5" />
                Elimina il mio account
              </Button>
            )}
          </div>
          {user.role === 'admin' && (
            <p className="text-[11px] text-muted-foreground">
              Gli account amministratore non possono auto-eliminarsi: contatta un altro
              amministratore per la cancellazione.
            </p>
          )}
        </div>
      </CardContent>

      <DeleteAccountDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        userEmail={user.email}
        onDeleted={() => {
          setDeleteOpen(false);
          toast.success('Account eliminato. A presto.');
          logout();
        }}
      />
    </Card>
  );
}

function ConsentRow({
  label,
  record,
}: {
  label: string;
  record: { granted: boolean; policyVersion: string; decidedAt: string } | undefined;
}) {
  if (!record) {
    return (
      <li className="flex items-center justify-between gap-3">
        <span>{label}</span>
        <span className="text-muted-foreground">— nessuna scelta registrata</span>
      </li>
    );
  }
  return (
    <li className="flex items-center justify-between gap-3">
      <span>{label}</span>
      <span className={cn(record.granted ? 'text-emerald-600' : 'text-muted-foreground')}>
        {record.granted ? 'accettato' : 'rifiutato'} · v. {record.policyVersion} ·{' '}
        {dayjs(record.decidedAt).format('DD MMM YYYY')}
      </span>
    </li>
  );
}

function DeleteAccountDialog({
  open,
  onOpenChange,
  userEmail,
  onDeleted,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  userEmail: string;
  onDeleted: () => void;
}) {
  const [confirmText, setConfirmText] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setConfirmText('');
      setError(null);
    }
  }, [open]);

  const mutation = useMutation({
    mutationFn: () => gdprApi.deleteAccount(),
    onSuccess: () => {
      onDeleted();
    },
    onError: (err) => {
      setError(httpErrorMessage(err));
    },
  });

  const matches = confirmText.trim().toLowerCase() === userEmail.toLowerCase();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Eliminare definitivamente l'account?</DialogTitle>
          <DialogDescription>
            L'operazione è irreversibile. I tuoi dati anagrafici saranno anonimizzati, le
            prenotazioni future cancellate, e la sessione corrente verrà chiusa. Le prenotazioni
            storiche e gli audit log saranno conservati in forma non riconducibile a te per i
            periodi previsti dalla legge.
          </DialogDescription>
        </DialogHeader>

        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <div className="space-y-2">
          <Label htmlFor="confirm-email">
            Per confermare, digita la tua email: <strong>{userEmail}</strong>
          </Label>
          <Input
            id="confirm-email"
            value={confirmText}
            onChange={(e) => {
              setConfirmText(e.target.value);
            }}
            autoComplete="off"
            placeholder={userEmail}
          />
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              onOpenChange(false);
            }}
            disabled={mutation.isPending}
          >
            Annulla
          </Button>
          <Button
            variant="destructive"
            onClick={() => {
              mutation.mutate();
            }}
            disabled={!matches || mutation.isPending}
          >
            {mutation.isPending ? (
              <LoaderCircle className="h-4 w-4 animate-spin" />
            ) : (
              'Elimina definitivamente'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AccountSection({ user }: { user: NonNullable<ReturnType<typeof useAuth>['user']> }) {
  const { refreshUser } = useAuth();
  const { t } = useTranslation();
  const refreshMutation = useMutation({
    mutationFn: () => refreshUser(),
    onSuccess: () => toast.success(t('profile.personal.saved')),
  });

  const items: { label: string; value: React.ReactNode }[] = [
    { label: 'ID', value: <span className="font-mono text-xs">{user.id}</span> },
    { label: t('profile.account.role'), value: t(`roles.${user.role}`) },
    { label: t('profile.account.matricola'), value: user.matricola ?? '—' },
    {
      label: t('profile.personal.course'),
      value: user.course ? `${user.course.code} — ${user.course.name}` : '—',
    },
    {
      label: t('profile.account.last_login'),
      value: user.lastLogin ? dayjs(user.lastLogin).format('DD MMM YYYY · HH:mm') : '—',
    },
    {
      label: 'Provider esterni',
      value: (
        <span className="flex flex-wrap gap-1">
          {!user.googleId && !user.microsoftId && '—'}
          {user.googleId && <Badge variant="secondary">Google</Badge>}
          {user.microsoftId && <Badge variant="secondary">Microsoft</Badge>}
        </span>
      ),
    },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 font-display text-xl">
          <ShieldCheck className="h-5 w-5 text-muted-foreground" />
          Informazioni account
        </CardTitle>
      </CardHeader>
      <CardContent>
        <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
          {items.map((item, i) => (
            <div
              key={i}
              className="flex justify-between gap-4 border-b py-2 last:border-0 sm:border-0 sm:py-1"
            >
              <dt className="text-sm text-muted-foreground">{item.label}</dt>
              <dd className="text-right text-sm font-medium">{item.value}</dd>
            </div>
          ))}
        </dl>
        <Separator className="my-4" />
        <div className="flex items-center justify-end">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              refreshMutation.mutate();
            }}
            disabled={refreshMutation.isPending}
          >
            {refreshMutation.isPending ? (
              <LoaderCircle className="h-4 w-4 animate-spin" />
            ) : (
              'Ricarica dati'
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
