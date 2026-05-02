import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { ArrowRight, LoaderCircle, LogOut } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/contexts/AuthContext';
import { authApi } from '@/api/auth';
import { coursesApi } from '@/api/courses';
import { httpErrorMessage } from '@/lib/api';
import { AuthLayout } from '@/components/layout/AuthLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { FieldError } from '@/components/ui/field-error';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { Role } from '@/types';

// matricola: obbligatoria solo per gli studenti — la validazione finale è server-side.
// I messaggi sono "chiavi" tradotte runtime via i18n.
const schema = z
  .object({
    role: z.enum(['studente', 'docente']),
    matricola: z.string().optional(),
    courseId: z.string().min(1, 'course_required'),
  })
  .refine((v) => v.role !== 'studente' || (v.matricola && v.matricola.trim().length > 0), {
    message: 'matricola_required_student',
    path: ['matricola'],
  });

type FormValues = z.infer<typeof schema>;

function tValidation(t: (k: string) => string, key?: string) {
  if (!key) return undefined;
  return t(`auth.validation.${key}`);
}

export default function CompleteProfile() {
  const { user, updateUser, logout } = useAuth();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [serverError, setServerError] = useState<string | null>(null);

  const coursesQuery = useQuery({
    queryKey: ['courses', 'active'],
    queryFn: () => coursesApi.list({ active: true }),
    staleTime: 5 * 60 * 1000,
  });

  const initialRole: Role = user?.role === 'docente' ? 'docente' : 'studente';

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      role: initialRole,
      matricola: user?.matricola ?? '',
      courseId: user?.courseId ? String(user.courseId) : '',
    },
  });

  const role = watch('role');
  const courseId = watch('courseId');

  const onSubmit = async (values: FormValues) => {
    setServerError(null);
    try {
      const { user: updated } = await authApi.updateMe({
        role: values.role,
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        matricola: values.role === 'studente' ? values.matricola!.trim() : null,
        courseId: Number(values.courseId),
      });
      updateUser(updated);
      // I docenti restano in attesa dell'admin → pagina dedicata.
      if (updated.role === 'docente' && updated.status === 'pending') {
        navigate('/pending-approval', { replace: true });
      } else {
        navigate('/dashboard', { replace: true });
      }
    } catch (err) {
      setServerError(httpErrorMessage(err));
    }
  };

  const handleLogout = () => {
    logout();
    navigate('/login', { replace: true });
  };

  return (
    <AuthLayout
      quote={t('auth.auth_layout.complete_quote')}
      attribution={t('auth.auth_layout.complete_attribution')}
    >
      <div className="space-y-2">
        <h2 className="font-display text-3xl font-medium tracking-tight">
          {t('auth.complete_profile.title')}
        </h2>
        <p className="text-sm text-muted-foreground">{t('auth.complete_profile.subtitle')}</p>
      </div>

      {user && (
        <div className="mt-6 flex items-center justify-between rounded-lg border bg-muted/40 px-4 py-3 text-sm">
          <div>
            <p className="font-medium text-foreground">
              {user.firstName} {user.lastName}
            </p>
            <p className="text-xs text-muted-foreground">{user.email}</p>
          </div>
          <span className="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">
            {t(`roles.${role}`)}
          </span>
        </div>
      )}

      <form onSubmit={handleSubmit(onSubmit)} className="mt-6 space-y-5" noValidate>
        {serverError && (
          <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }}>
            <Alert variant="destructive">
              <AlertDescription>{serverError}</AlertDescription>
            </Alert>
          </motion.div>
        )}

        <div className="space-y-2">
          <Label>{t('auth.complete_profile.role_question')}</Label>
          <Select
            value={role}
            onValueChange={(v) => {
              setValue('role', v as FormValues['role'], { shouldValidate: true });
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
          {role === 'docente' && (
            <p className="text-xs text-amber-700 dark:text-amber-400">
              {t('auth.complete_profile.teacher_warning')}
            </p>
          )}
        </div>

        {role === 'studente' && (
          <div className="space-y-2">
            <Label htmlFor="matricola">
              {t('auth.fields.matricola')} <span className="text-destructive">*</span>
            </Label>
            <Input
              id="matricola"
              placeholder={t('auth.fields.matricola_placeholder')}
              autoComplete="off"
              inputMode="numeric"
              pattern="[0-9]*"
              aria-invalid={!!errors.matricola}
              aria-describedby={errors.matricola ? 'matricola-error' : undefined}
              {...register('matricola')}
            />
            <FieldError id="matricola-error">
              {errors.matricola && tValidation(t, errors.matricola.message)}
            </FieldError>
          </div>
        )}

        <div className="space-y-2">
          <Label>{t('auth.fields.course')}</Label>
          <Select
            value={courseId}
            onValueChange={(v) => {
              setValue('courseId', v, { shouldValidate: true });
            }}
            disabled={coursesQuery.isLoading}
          >
            <SelectTrigger
              aria-invalid={!!errors.courseId}
              aria-describedby={errors.courseId ? 'courseId-error' : undefined}
            >
              <SelectValue
                placeholder={
                  coursesQuery.isLoading
                    ? t('auth.fields.course_loading')
                    : t('auth.fields.course_placeholder')
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
          <FieldError id="courseId-error">
            {errors.courseId && tValidation(t, errors.courseId.message)}
          </FieldError>
        </div>

        <Button type="submit" size="lg" className="w-full" disabled={isSubmitting}>
          {isSubmitting ? (
            <LoaderCircle className="h-4 w-4 animate-spin" />
          ) : (
            <>
              {t('common.save_continue')}
              <ArrowRight className="h-4 w-4" />
            </>
          )}
        </Button>

        <button
          type="button"
          onClick={handleLogout}
          className="mx-auto flex items-center gap-1.5 pt-2 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          <LogOut className="h-3.5 w-3.5" />
          {t('common.logout_switch_account')}
        </button>
      </form>
    </AuthLayout>
  );
}
