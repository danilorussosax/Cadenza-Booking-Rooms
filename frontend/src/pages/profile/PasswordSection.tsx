import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { CheckCircle2, Eye, EyeOff, KeyRound, LoaderCircle } from 'lucide-react';
import { toast } from 'sonner';
import { authApi } from '@/api/auth';
import { httpErrorMessage, tokenStore } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { FieldError } from '@/components/ui/field-error';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { passwordSchema, type PasswordValues } from './schemas';

// =====================================================
// Password section
// =====================================================
export function PasswordSection({ isOAuthUser }: { isOAuthUser: boolean }) {
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
      <CardContent className="pt-0 sm:pt-0">
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
