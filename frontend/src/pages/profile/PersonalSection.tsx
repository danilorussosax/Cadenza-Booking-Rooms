import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery } from '@tanstack/react-query';
import { LoaderCircle, UserRound } from 'lucide-react';
import { toast } from 'sonner';
import { authApi } from '@/api/auth';
import { coursesApi } from '@/api/courses';
import { httpErrorMessage } from '@/lib/api';
import { qk } from '@/lib/queryKeys';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
import { personalSchema, type PersonalValues } from './schemas';
import type { ProfileUser, UpdateUserFn } from './types';
import { useTranslation } from 'react-i18next';

// =====================================================
// Personal section
// =====================================================
export function PersonalSection({
  user,
  updateUser,
}: {
  user: ProfileUser;
  updateUser: UpdateUserFn;
}) {
  const { t } = useTranslation();
  const [serverError, setServerError] = useState<string | null>(null);

  const coursesQuery = useQuery({
    queryKey: qk.courses.active(),
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
      toast.success(t('profile.personal.saved'));
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

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="p-firstName">Nome</Label>
              <Input
                id="p-firstName"
                autoComplete="given-name"
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
                autoComplete="family-name"
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
              <Input
                id="p-matricola"
                inputMode="numeric"
                autoComplete="off"
                {...register('matricola')}
              />
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
