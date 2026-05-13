import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, CheckCircle2, LoaderCircle, Mail } from 'lucide-react';
import { AuthLayout } from '@/components/layout/AuthLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { FieldError } from '@/components/ui/field-error';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { passwordResetApi } from '@/api/passwordReset';

const schema = z.object({
  email: z.email('email_required'),
});
type FormValues = z.infer<typeof schema>;

export default function ForgotPassword() {
  const { t } = useTranslation();
  const [submittedEmail, setSubmittedEmail] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  const mutation = useMutation({
    mutationFn: (email: string) => passwordResetApi.forgot(email),
    onSuccess: (_data, email) => {
      // Anti-enumeration: la risposta è SEMPRE 200, anche se l'email non
      // esiste. Mostriamo conferma generica indipendentemente dall'esito.
      setSubmittedEmail(email);
    },
  });

  const onSubmit = (values: FormValues) => mutation.mutate(values.email);

  if (submittedEmail) {
    return (
      <AuthLayout>
        <div className="space-y-4">
          <div className="flex justify-center pt-2">
            <div className="rounded-full bg-emerald-100 p-3 dark:bg-emerald-500/15">
              <CheckCircle2 className="h-6 w-6 text-emerald-600 dark:text-emerald-400" />
            </div>
          </div>
          <div className="text-center">
            <h2 className="font-display text-xl font-medium">{t('auth.forgot.sent_title')}</h2>
            <p className="text-sm text-muted-foreground mt-2">
              {t('auth.forgot.sent_description', { email: submittedEmail })}
            </p>
          </div>
          <Alert>
            <Mail className="h-4 w-4" />
            <AlertDescription className="text-xs">{t('auth.forgot.sent_hint')}</AlertDescription>
          </Alert>
          <Button asChild variant="outline" className="w-full">
            <Link to="/login">
              <ArrowLeft className="h-4 w-4" />
              {t('auth.forgot.back_to_login')}
            </Link>
          </Button>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      <form className="space-y-4" onSubmit={handleSubmit(onSubmit)} noValidate>
        <div className="text-center pt-2">
          <h2 className="font-display text-xl font-medium">{t('auth.forgot.title')}</h2>
          <p className="text-sm text-muted-foreground mt-1">{t('auth.forgot.description')}</p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="email">{t('auth.login.email_label')}</Label>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            placeholder="nome@conservatorio.it"
            aria-invalid={!!errors.email}
            aria-describedby={errors.email ? 'email-error' : undefined}
            {...register('email')}
          />
          <FieldError id="email-error">
            {errors.email && t(`auth.validation.${errors.email.message}`)}
          </FieldError>
        </div>

        <Button type="submit" size="lg" className="w-full" disabled={isSubmitting}>
          {isSubmitting ? (
            <LoaderCircle className="h-4 w-4 animate-spin" />
          ) : (
            <>
              <Mail className="h-4 w-4" />
              {t('auth.forgot.submit')}
            </>
          )}
        </Button>

        <Button asChild variant="ghost" className="w-full">
          <Link to="/login">
            <ArrowLeft className="h-4 w-4" />
            {t('auth.forgot.back_to_login')}
          </Link>
        </Button>
      </form>
    </AuthLayout>
  );
}
