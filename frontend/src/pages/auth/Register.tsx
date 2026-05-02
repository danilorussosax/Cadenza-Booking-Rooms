import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { ArrowRight, Eye, EyeOff, LoaderCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/contexts/AuthContext';
import { coursesApi } from '@/api/courses';
import { gdprApi } from '@/api/gdpr';
import { httpErrorMessage } from '@/lib/api';
import { AuthLayout } from '@/components/layout/AuthLayout';
import { OAuthButtons } from '@/components/auth/OAuthButtons';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { FieldError } from '@/components/ui/field-error';
import { Checkbox } from '@/components/ui/checkbox';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { PRIVACY_POLICY_VERSION, TERMS_VERSION } from '@/pages/legal/policyVersions';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

// Le validazioni usano "chiavi" (es. 'first_name_required') che vengono
// tradotte runtime via i18n in `auth.validation.<key>`.
const schema = z.object({
  firstName: z.string().min(1, 'first_name_required'),
  lastName: z.string().min(1, 'last_name_required'),
  email: z.email('email_invalid'),
  password: z.string().min(8, 'password_min'),
  role: z.enum(['studente', 'docente']),
  matricola: z.string().optional(),
  courseId: z.string().optional(),
  // Consensi obbligatori (privacy + termini). Marketing è facoltativo.
  acceptPrivacy: z.boolean().refine((v) => v, { message: 'consent_required' }),
  acceptTerms: z.boolean().refine((v) => v, { message: 'consent_required' }),
  acceptMarketing: z.boolean().optional(),
});

type FormValues = z.infer<typeof schema>;

function tValidation(t: (k: string) => string, key?: string) {
  if (!key) return undefined;
  return t(`auth.validation.${key}`);
}

export default function Register() {
  const navigate = useNavigate();
  const { registerAccount } = useAuth();
  const { t } = useTranslation();
  const [showPassword, setShowPassword] = useState(false);
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
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      firstName: '',
      lastName: '',
      email: '',
      password: '',
      role: 'studente',
      matricola: '',
      courseId: '',
      acceptPrivacy: false,
      acceptTerms: false,
      acceptMarketing: false,
    },
  });

  const role = watch('role');
  const courseId = watch('courseId');
  const acceptPrivacy = watch('acceptPrivacy');
  const acceptTerms = watch('acceptTerms');
  const acceptMarketing = watch('acceptMarketing');

  const onSubmit = async (values: FormValues) => {
    setServerError(null);
    try {
      const user = await registerAccount({
        email: values.email,
        password: values.password,
        firstName: values.firstName,
        lastName: values.lastName,
        role: values.role,
        matricola: values.matricola?.trim() ?? undefined,
        courseId: values.courseId ? Number(values.courseId) : undefined,
      });

      // Registra i consensi prestati. Best-effort: un errore qui non deve
      // bloccare l'utente che ha già completato il signup; viene loggato
      // a console per follow-up.
      try {
        await Promise.all([
          gdprApi.setConsent({
            consentType: 'privacy_policy',
            granted: true,
            policyVersion: PRIVACY_POLICY_VERSION,
          }),
          gdprApi.setConsent({
            consentType: 'terms',
            granted: true,
            policyVersion: TERMS_VERSION,
          }),
          gdprApi.setConsent({
            consentType: 'marketing',
            granted: !!values.acceptMarketing,
            policyVersion: PRIVACY_POLICY_VERSION,
          }),
        ]);
      } catch (err) {
        console.warn('[gdpr] consent recording failed:', err);
      }
      // Dopo la registrazione, indirizziamo sempre al completamento profilo:
      //   - lo studente potrebbe non aver inserito la matricola (obbligatoria)
      //   - il docente verrà comunque indirizzato alla schermata di attesa approvazione
      const profileComplete =
        user.role === 'admin' ||
        (Boolean(user.courseId) && (user.role !== 'studente' || Boolean(user.matricola)));
      const approved = user.role === 'admin' || user.status === 'approved';
      let dest = '/complete-profile';
      if (profileComplete && approved) dest = '/dashboard';
      else if (profileComplete && !approved) dest = '/pending-approval';
      navigate(dest, { replace: true });
    } catch (err) {
      setServerError(httpErrorMessage(err));
    }
  };

  return (
    <AuthLayout>
      <div className="space-y-2">
        <h2 className="font-display text-3xl font-medium tracking-tight">
          {t('auth.register.title')}
        </h2>
        <p className="text-sm text-muted-foreground">{t('auth.register.subtitle')}</p>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="mt-7 space-y-5" noValidate>
        {serverError && (
          <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }}>
            <Alert variant="destructive">
              <AlertDescription>{serverError}</AlertDescription>
            </Alert>
          </motion.div>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="firstName">{t('auth.fields.first_name')}</Label>
            <Input
              id="firstName"
              autoComplete="given-name"
              aria-invalid={!!errors.firstName}
              aria-describedby={errors.firstName ? 'firstName-error' : undefined}
              {...register('firstName')}
            />
            <FieldError id="firstName-error">
              {errors.firstName && tValidation(t, errors.firstName.message)}
            </FieldError>
          </div>
          <div className="space-y-2">
            <Label htmlFor="lastName">{t('auth.fields.last_name')}</Label>
            <Input
              id="lastName"
              autoComplete="family-name"
              aria-invalid={!!errors.lastName}
              aria-describedby={errors.lastName ? 'lastName-error' : undefined}
              {...register('lastName')}
            />
            <FieldError id="lastName-error">
              {errors.lastName && tValidation(t, errors.lastName.message)}
            </FieldError>
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="email">{t('auth.fields.email_institutional')}</Label>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            placeholder={t('auth.fields.email_placeholder')}
            aria-invalid={!!errors.email}
            aria-describedby={errors.email ? 'email-error' : undefined}
            {...register('email')}
          />
          <FieldError id="email-error">
            {errors.email && tValidation(t, errors.email.message)}
          </FieldError>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="password">{t('auth.fields.password')}</Label>
            <button
              type="button"
              tabIndex={-1}
              className="text-xs text-muted-foreground transition-colors hover:text-foreground"
              onClick={() => {
                setShowPassword((s) => !s);
              }}
            >
              {showPassword ? (
                <span className="inline-flex items-center gap-1">
                  <EyeOff className="h-3.5 w-3.5" /> {t('common.hide')}
                </span>
              ) : (
                <span className="inline-flex items-center gap-1">
                  <Eye className="h-3.5 w-3.5" /> {t('common.show')}
                </span>
              )}
            </button>
          </div>
          <Input
            id="password"
            type={showPassword ? 'text' : 'password'}
            autoComplete="new-password"
            placeholder={t('auth.fields.password_placeholder_min')}
            aria-invalid={!!errors.password}
            aria-describedby={errors.password ? 'password-error' : undefined}
            {...register('password')}
          />
          <FieldError id="password-error">
            {errors.password && tValidation(t, errors.password.message)}
          </FieldError>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>{t('auth.fields.role')}</Label>
            <Select
              value={role}
              onValueChange={(v) => {
                setValue('role', v as FormValues['role']);
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="studente">{t('roles.studente')}</SelectItem>
                <SelectItem value="docente">{t('roles.docente')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="matricola">{t('auth.fields.matricola')}</Label>
            <Input
              id="matricola"
              placeholder={t('auth.register.matricola_hint')}
              autoComplete="off"
              {...register('matricola')}
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label>{t('auth.fields.course')}</Label>
          <Select
            value={courseId ?? ''}
            onValueChange={(v) => {
              setValue('courseId', v);
            }}
            disabled={coursesQuery.isLoading}
          >
            <SelectTrigger>
              <SelectValue
                placeholder={
                  coursesQuery.isLoading
                    ? t('common.loading')
                    : t('auth.fields.course_placeholder_optional')
                }
              />
            </SelectTrigger>
            <SelectContent>
              {coursesQuery.data?.courses.map((c) => (
                <SelectItem key={c.id} value={String(c.id)}>
                  {c.code} — {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">{t('auth.register.complete_later')}</p>
        </div>

        {/* Consensi GDPR */}
        <div className="space-y-2 rounded-md border bg-muted/30 p-3 text-xs">
          <label className="flex items-start gap-2">
            <Checkbox
              checked={acceptPrivacy}
              onCheckedChange={(v) => {
                setValue('acceptPrivacy', v === true, {
                  shouldValidate: true,
                });
              }}
              aria-invalid={!!errors.acceptPrivacy}
              aria-describedby={errors.acceptPrivacy ? 'acceptPrivacy-error' : undefined}
            />
            <span className="leading-snug">
              Ho letto l'
              <Link to="/privacy-policy" target="_blank" rel="noreferrer" className="underline">
                Informativa sulla privacy
              </Link>{' '}
              (v. {PRIVACY_POLICY_VERSION}). <span className="text-destructive">*</span>
            </span>
          </label>
          <FieldError id="acceptPrivacy-error" className="ml-6 text-xs">
            {errors.acceptPrivacy && 'È necessario accettare l’informativa per registrarsi.'}
          </FieldError>

          <label className="flex items-start gap-2">
            <Checkbox
              checked={acceptTerms}
              onCheckedChange={(v) => {
                setValue('acceptTerms', v === true, {
                  shouldValidate: true,
                });
              }}
              aria-invalid={!!errors.acceptTerms}
              aria-describedby={errors.acceptTerms ? 'acceptTerms-error' : undefined}
            />
            <span className="leading-snug">
              Accetto i{' '}
              <Link to="/terms" target="_blank" rel="noreferrer" className="underline">
                Termini di servizio
              </Link>{' '}
              (v. {TERMS_VERSION}). <span className="text-destructive">*</span>
            </span>
          </label>
          <FieldError id="acceptTerms-error" className="ml-6 text-xs">
            {errors.acceptTerms && 'È necessario accettare i termini per registrarsi.'}
          </FieldError>

          <label className="flex items-start gap-2">
            <Checkbox
              checked={!!acceptMarketing}
              onCheckedChange={(v) => {
                setValue('acceptMarketing', v === true);
              }}
            />
            <span className="leading-snug text-muted-foreground">
              Acconsento a ricevere comunicazioni promozionali sulle iniziative dell'Istituto
              (facoltativo, revocabile in ogni momento).
            </span>
          </label>
        </div>

        <Button type="submit" size="lg" className="w-full" disabled={isSubmitting}>
          {isSubmitting ? (
            <LoaderCircle className="h-4 w-4 animate-spin" />
          ) : (
            <>
              {t('auth.register.submit')}
              <ArrowRight className="h-4 w-4" />
            </>
          )}
        </Button>

        <div className="relative py-1 text-center">
          <span className="absolute inset-x-0 top-1/2 -z-10 h-px bg-border" />
          <span className="bg-background px-3 text-xs uppercase tracking-wider text-muted-foreground">
            {t('common.or')}
          </span>
        </div>

        <OAuthButtons disabled={isSubmitting} />

        <p className="pt-2 text-center text-sm text-muted-foreground">
          {t('auth.register.have_account')}{' '}
          <Link to="/login" className="font-medium text-primary underline-offset-4 hover:underline">
            {t('auth.register.login')}
          </Link>
        </p>
      </form>
    </AuthLayout>
  );
}
