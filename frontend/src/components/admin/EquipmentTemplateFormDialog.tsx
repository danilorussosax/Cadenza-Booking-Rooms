import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { LoaderCircle } from 'lucide-react';
import { toast } from 'sonner';
import { EQUIPMENT_TYPE_OPTIONS, structureApi } from '@/api/structure';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { EquipmentTemplate, EquipmentType } from '@/types';

const schema = z.object({
  name: z.string().min(1, 'Inserisci il nome').max(200),
  type: z.enum([
    'pianoforte',
    'pianoforte_a_coda',
    'organo',
    'clavicembalo',
    'leggio',
    'amplificatore',
    'mixer',
    'microfono',
    'computer',
    'proiettore',
    'lavagna',
    'sedia',
    'altro',
  ]),
});
type FormValues = z.infer<typeof schema>;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  template?: EquipmentTemplate | null;
}

export function EquipmentTemplateFormDialog({ open, onOpenChange, template }: Props) {
  const qc = useQueryClient();
  const isEdit = !!template;
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { name: '', type: 'altro' },
  });

  useEffect(() => {
    if (open) {
      reset({ name: template?.name ?? '', type: template?.type ?? 'altro' });
      setServerError(null);
    }
  }, [open, template, reset]);

  const type = watch('type');

  const mutation = useMutation({
    mutationFn: (values: FormValues) => {
      const payload = { name: values.name.trim(), type: values.type };
      return isEdit
        ? structureApi.updateEquipmentTemplate(template.id, payload)
        : structureApi.createEquipmentTemplate(payload);
    },
    onSuccess: () => {
      toast.success(isEdit ? 'Dotazione aggiornata' : 'Dotazione creata');
      void qc.invalidateQueries({ queryKey: ['equipment-templates'] });
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
          <DialogTitle>{isEdit ? 'Modifica dotazione' : 'Nuova dotazione'}</DialogTitle>
          <DialogDescription>
            Inserisci una dotazione nel catalogo. Sarà disponibile per la selezione rapida quando
            aggiungi attrezzature alle aule.
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
          <div className="space-y-2">
            <Label htmlFor="t-name">Nome</Label>
            <Input
              id="t-name"
              placeholder="Pianoforte verticale"
              aria-invalid={!!errors.name}
              aria-describedby={errors.name ? 't-name-error' : undefined}
              {...register('name')}
            />
            <FieldError id="t-name-error">{errors.name?.message}</FieldError>
          </div>
          <div className="space-y-2">
            <Label>Tipologia (opzionale)</Label>
            <Select
              value={type}
              onValueChange={(v) => {
                setValue('type', v as EquipmentType, { shouldValidate: true });
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {EQUIPMENT_TYPE_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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
