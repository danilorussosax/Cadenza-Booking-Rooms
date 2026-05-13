import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { AlertCircle, CheckCircle2, Eye, EyeOff, LoaderCircle, Lock, LogIn } from 'lucide-react';
import { AuthLayout } from '@/components/layout/AuthLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { FieldError } from '@/components/ui/field-error';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { passwordResetApi } from '@/api/passwordReset';
import { httpErrorMessage } from '@/lib/api';

const PASSWORD_REGEX = /^(?=.*[A-Z])(?=.*\d).{10,}$/;

const schema = z
  .object({
    newPassword: z
      .string()
      .min(10, 'password_min_length')
      .regex(PASSWORD_REGEX, 'password_complexity'),
    confirmPassword: z.string(),
  })
  .refine((d) => d.newPassword === d.confirmPassword, {
    path: ['confirmPassword'],
    message: 'password_mismatch',
  });
type FormValues = z.infer<typeof schema>;

export default function ResetPassword() {
  const { token } = useParams<{ token: string }>();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [showPassword, setShowPassword] = useState(false);

  const tokenStr = token ?? '';

  // Validazione preventiva del token: se invalido (scaduto/usato/non
  // esistente) mostriamo subito un messaggio + CTA "richiedi nuovo link",
  // senza far compilare un form inutile.
  const validate = useQuery({
    queryKey: ['password-reset', 'validate', tokenStr],
    queryFn: () => passwordResetApi.validateToken(tokenStr),
    retry: false,
    enabled: !!tokenStr,
  });

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  const mutation = useMutation({
    mutationFn: (newPassword: string) => passwordResetApi.reset(tokenStr, newPassword),
    onSuccess: () => {
      toast.success(t('auth.reset.success_toast'));
      // 2 secondi per leggere il toast, poi al login
      setTimeout(() => navigate('/login'), 1500);
    },
    onError: (err) => toast.error(httpErrorMessage(err)),
  });

  const isInvalid = !tokenStr || validate.isError || (validate.data && !validate.data.valid);

  if (validate.isLoading) {
    return (
      <AuthLayout>
        <div className="space-y-3 pt-2">
          <Skeleton className="h-6 w-3/4" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      </AuthLayout>
    );
  }

  if (isInvalid) {
    const reason =
      (validate.data && 'reason' in validate.data ? validate.data.reason : null) ?? 'invalid';
    return (
      <AuthLayout>
        <div className="space-y-4">
          <div className="flex justify-center pt-2">
            <div className="rounded-full bg-rose-100 p-3 dark:bg-rose-500/15">
              <AlertCircle className="h-6 w-6 text-rose-600 dark:text-rose-400" />
            </div>
          </div>
          <div className="text-center">
            <h2 className="font-display text-xl font-medium">{t('auth.reset.invalid_title')}</h2>
            <p className="text-sm text-muted-foreground mt-2">
              {t(`auth.reset.invalid_reason_${reason}`)}
            </p>
          </div>
          <Button asChild className="w-full">
            <Link to="/forgot-password">{t('auth.reset.request_new_link')}</Link>
          </Button>
          <Button asChild variant="ghost" className="w-full">
            <Link to="/login">{t('auth.forgot.back_to_login')}</Link>
          </Button>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      <form
        className="space-y-4"
        onSubmit={handleSubmit((v) => mutation.mutate(v.newPassword))}
        noValidate
      >
        <div className="text-center pt-2">
          <h2 className="font-display text-xl font-medium">{t('auth.reset.title')}</h2>
          <p className="text-sm text-muted-foreground mt-1">{t('auth.reset.description')}</p>
        </div>

        <Alert>
          <CheckCircle2 className="h-4 w-4" />
          <AlertDescription className="text-xs">{t('auth.reset.security_note')}</AlertDescription>
        </Alert>

        <div className="space-y-2">
          <Label htmlFor="newPassword">{t('auth.reset.new_password_label')}</Label>
          <div className="relative">
            <Input
              id="newPassword"
              type={showPassword ? 'text' : 'password'}
              autoComplete="new-password"
              aria-invalid={!!errors.newPassword}
              {...register('newPassword')}
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground"
              tabIndex={-1}
              aria-label={showPassword ? t('common.hide') : t('common.show')}
            >
              {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          <FieldError>
            {errors.newPassword && t(`auth.validation.${errors.newPassword.message}`)}
          </FieldError>
        </div>

        <div className="space-y-2">
          <Label htmlFor="confirmPassword">{t('auth.reset.confirm_password_label')}</Label>
          <Input
            id="confirmPassword"
            type={showPassword ? 'text' : 'password'}
            autoComplete="new-password"
            aria-invalid={!!errors.confirmPassword}
            {...register('confirmPassword')}
          />
          <FieldError>
            {errors.confirmPassword && t(`auth.validation.${errors.confirmPassword.message}`)}
          </FieldError>
        </div>

        <Button type="submit" size="lg" className="w-full" disabled={isSubmitting}>
          {isSubmitting ? (
            <LoaderCircle className="h-4 w-4 animate-spin" />
          ) : (
            <>
              <Lock className="h-4 w-4" />
              {t('auth.reset.submit')}
            </>
          )}
        </Button>

        <Button asChild variant="ghost" className="w-full">
          <Link to="/login">
            <LogIn className="h-4 w-4" />
            {t('auth.forgot.back_to_login')}
          </Link>
        </Button>
      </form>
    </AuthLayout>
  );
}
