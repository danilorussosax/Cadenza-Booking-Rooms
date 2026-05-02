import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { LoaderCircle } from 'lucide-react';
import { toast } from 'sonner';
import { courseLevelsApi } from '@/api/courseLevels';
import { httpErrorMessage } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { FieldError } from '@/components/ui/field-error';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { CourseLevelEntity } from '@/types';

const schema = z.object({
  code: z
    .string()
    .min(1, 'Codice obbligatorio')
    .max(50)
    .regex(/^[a-z0-9_-]+$/i, 'Solo lettere, numeri, _ e -'),
  name: z.string().min(1, 'Nome obbligatorio').max(150),
  sortOrder: z.number().int().min(0),
});

type FormValues = z.infer<typeof schema>;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  level?: CourseLevelEntity | null;
}

export function CourseLevelFormDialog({ open, onOpenChange, level }: Props) {
  const qc = useQueryClient();
  const isEdit = !!level;
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { code: '', name: '', sortOrder: 0 },
  });

  useEffect(() => {
    if (open) {
      reset({
        code: level?.code ?? '',
        name: level?.name ?? '',
        sortOrder: level?.sortOrder ?? 0,
      });
      setServerError(null);
    }
  }, [open, level, reset]);

  const mutation = useMutation({
    mutationFn: (values: FormValues) => {
      const payload = {
        code: values.code.trim().toLowerCase(),
        name: values.name.trim(),
        sortOrder: values.sortOrder,
      };
      return isEdit ? courseLevelsApi.update(level.id, payload) : courseLevelsApi.create(payload);
    },
    onSuccess: () => {
      toast.success(isEdit ? 'Livello aggiornato' : 'Livello creato');
      void qc.invalidateQueries({ queryKey: ['course-levels'] });
      onOpenChange(false);
    },
    onError: (err) => {
      setServerError(httpErrorMessage(err));
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Modifica livello' : 'Nuovo livello'}</DialogTitle>
          <DialogDescription>
            Il <strong>codice</strong> è l'identificativo interno (slug univoco), il{' '}
            <strong>nome</strong> è ciò che vedono gli utenti. L'ordine controlla la sequenza nei
            filtri.
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={handleSubmit((v) => {
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
              <Label htmlFor="lvl-code">Codice</Label>
              <Input
                id="lvl-code"
                placeholder="triennio"
                disabled={isEdit}
                aria-invalid={!!errors.code}
                aria-describedby={errors.code ? 'lvl-code-error' : undefined}
                {...register('code')}
              />
              <FieldError id="lvl-code-error">{errors.code?.message}</FieldError>
              {isEdit && (
                <p className="text-[11px] text-muted-foreground">
                  Il codice non si modifica per non rompere i corsi che lo riferiscono.
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="lvl-order">Ordine</Label>
              <Input
                id="lvl-order"
                type="number"
                min={0}
                {...register('sortOrder', { valueAsNumber: true })}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="lvl-name">Nome visualizzato</Label>
            <Input
              id="lvl-name"
              placeholder="Triennio"
              aria-invalid={!!errors.name}
              aria-describedby={errors.name ? 'lvl-name-error' : undefined}
              {...register('name')}
            />
            <FieldError id="lvl-name-error">{errors.name?.message}</FieldError>
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
                'Salva'
              ) : (
                'Crea'
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
