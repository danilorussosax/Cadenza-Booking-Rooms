import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { LoaderCircle } from 'lucide-react';
import { toast } from 'sonner';
import { usersApi } from '@/api/users';
import { coursesApi } from '@/api/courses';
import { httpErrorMessage } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
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
  email: z.string().email('Email non valida'),
  role: z.enum(['admin', 'docente', 'studente']),
  matricola: z.string().optional(),
  courseId: z.string().optional(),
  isActive: z.boolean(),
  password: z.string().optional(),
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
    },
  });

  useEffect(() => {
    if (open) {
      reset({
        firstName: user?.firstName ?? '',
        lastName: user?.lastName ?? '',
        email: user?.email ?? '',
        role: user?.role ?? 'studente',
        matricola: user?.matricola ?? '',
        courseId: user?.courseId ? String(user.courseId) : '',
        isActive: user?.isActive ?? true,
        password: '',
      });
      setServerError(null);
    }
  }, [open, user, reset]);

  const role = watch('role');
  const courseId = watch('courseId');
  const isActive = watch('isActive');

  const mutation = useMutation({
    mutationFn: (values: FormValues) => {
      const payload = {
        firstName: values.firstName,
        lastName: values.lastName,
        email: values.email,
        role: values.role,
        matricola: values.matricola?.trim() ?? null,
        courseId: values.courseId ? Number(values.courseId) : null,
        isActive: values.isActive,
      };
      if (isEdit) {
        return usersApi.update(user.id, {
          ...payload,
          newPassword: values.password?.trim() ?? undefined,
        });
      }
      return usersApi.create({
        ...payload,
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        password: values.password!,
      });
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
              <Input id="firstName" {...register('firstName')} />
              {errors.firstName && (
                <p className="text-xs text-destructive">{errors.firstName.message}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="lastName">Cognome</Label>
              <Input id="lastName" {...register('lastName')} />
              {errors.lastName && (
                <p className="text-xs text-destructive">{errors.lastName.message}</p>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" {...register('email')} />
            {errors.email && <p className="text-xs text-destructive">{errors.email.message}</p>}
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
              {...register('password')}
            />
            {errors.password && (
              <p className="text-xs text-destructive">{errors.password.message}</p>
            )}
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
