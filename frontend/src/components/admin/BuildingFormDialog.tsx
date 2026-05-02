import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { LoaderCircle } from 'lucide-react';
import { toast } from 'sonner';
import { structureApi } from '@/api/structure';
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
import type { Building } from '@/types';

const schema = z.object({
  name: z.string().min(1, 'Inserisci il nome'),
  code: z.string().max(50).optional(),
  address: z.string().max(300).optional(),
  floors: z.string().optional(),
});

type FormValues = z.infer<typeof schema>;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  instituteId: number;
  building?: Building | null;
}

export function BuildingFormDialog({ open, onOpenChange, instituteId, building }: Props) {
  const qc = useQueryClient();
  const isEdit = !!building;
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { name: '', code: '', address: '', floors: 'Piano Terra' },
  });

  useEffect(() => {
    if (open) {
      reset({
        name: building?.name ?? '',
        code: building?.code ?? '',
        address: building?.address ?? '',
        floors: building?.floors.join(', ') ?? 'Piano Terra',
      });
      setServerError(null);
    }
  }, [open, building, reset]);

  const mutation = useMutation({
    mutationFn: (values: FormValues) => {
      const floors = (values.floors ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      const payload = {
        instituteId,
        name: values.name.trim(),
        code: values.code?.trim() ?? null,
        address: values.address?.trim() ?? null,
        floors: floors.length ? floors : ['Piano Terra'],
      };
      return isEdit
        ? structureApi.updateBuilding(building.id, payload)
        : structureApi.createBuilding(payload);
    },
    onSuccess: () => {
      toast.success(isEdit ? 'Edificio aggiornato' : 'Edificio creato');
      void qc.invalidateQueries({ queryKey: ['institutes'] });
      onOpenChange(false);
    },
    onError: (err) => {
      setServerError(httpErrorMessage(err));
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Modifica edificio' : 'Nuovo edificio'}</DialogTitle>
          <DialogDescription>
            Indica il nome e i piani disponibili (separati da virgola).
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

          <div className="grid gap-4 sm:grid-cols-[1fr_140px]">
            <div className="space-y-2">
              <Label htmlFor="b-name">Nome</Label>
              <Input
                id="b-name"
                placeholder="Palazzo Storico"
                aria-invalid={!!errors.name}
                aria-describedby={errors.name ? 'b-name-error' : undefined}
                {...register('name')}
              />
              <FieldError id="b-name-error">{errors.name?.message}</FieldError>
            </div>
            <div className="space-y-2">
              <Label htmlFor="b-code">Codice</Label>
              <Input id="b-code" {...register('code')} />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="b-address">Indirizzo</Label>
            <Input id="b-address" {...register('address')} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="b-floors">Piani (separati da virgola)</Label>
            <Input
              id="b-floors"
              placeholder="Piano Terra, Primo Piano, Secondo Piano"
              {...register('floors')}
            />
            <p className="text-xs text-muted-foreground">
              I piani indicati saranno selezionabili durante la creazione delle aule.
            </p>
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
                'Crea edificio'
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
