import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { LoaderCircle, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { EQUIPMENT_TYPE_OPTIONS, structureApi } from '@/api/structure';
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
import type { Equipment, EquipmentType } from '@/types';

const schema = z.object({
  name: z.string().min(1, 'Inserisci il nome'),
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
  brand: z.string().max(100).optional(),
  model: z.string().max(100).optional(),
  quantity: z.number().int().min(1),
  isWorking: z.boolean(),
});

type FormValues = z.infer<typeof schema>;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  roomId: number;
  equipment?: Equipment | null;
}

export function EquipmentFormDialog({ open, onOpenChange, roomId, equipment }: Props) {
  const qc = useQueryClient();
  const isEdit = !!equipment;
  const [serverError, setServerError] = useState<string | null>(null);

  const templatesQuery = useQuery({
    queryKey: ['equipment-templates'],
    queryFn: () => structureApi.listEquipmentTemplates(),
    enabled: open && !isEdit,
    staleTime: 60_000,
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
      name: '',
      type: 'altro',
      brand: '',
      model: '',
      quantity: 1,
      isWorking: true,
    },
  });

  useEffect(() => {
    if (open) {
      reset({
        name: equipment?.name ?? '',
        type: equipment?.type as EquipmentType,
        brand: equipment?.brand ?? '',
        model: equipment?.model ?? '',
        quantity: equipment?.quantity ?? 1,
        isWorking: equipment?.isWorking ?? true,
      });
      setServerError(null);
    }
  }, [open, equipment, reset]);

  const type = watch('type');
  const isWorking = watch('isWorking');

  const mutation = useMutation({
    mutationFn: (values: FormValues) => {
      const payload = {
        roomId,
        name: values.name.trim(),
        type: values.type,
        brand: values.brand?.trim() ?? null,
        model: values.model?.trim() ?? null,
        quantity: values.quantity,
        isWorking: values.isWorking,
      };
      return isEdit
        ? structureApi.updateEquipment(equipment.id, payload)
        : structureApi.createEquipment(payload);
    },
    onSuccess: () => {
      toast.success(isEdit ? 'Strumento aggiornato' : 'Strumento aggiunto');
      void qc.invalidateQueries({ queryKey: ['institutes'] });
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
          <DialogTitle>{isEdit ? 'Modifica strumento' : 'Aggiungi strumento'}</DialogTitle>
          <DialogDescription>
            Tipologia, marca e modello dell’attrezzatura presente in aula.
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

          {/* Quick pick from the equipment catalog */}
          {!isEdit && (templatesQuery.data?.templates.length ?? 0) > 0 && (
            <div className="space-y-2">
              <Label className="flex items-center gap-1.5">
                <Sparkles className="h-3.5 w-3.5 text-primary" />
                Scegli dal catalogo (opzionale)
              </Label>
              <Select
                value=""
                onValueChange={(id) => {
                  const tpl = templatesQuery.data?.templates.find((t) => String(t.id) === id);
                  if (tpl) {
                    setValue('name', tpl.name, { shouldValidate: true });
                    setValue('type', tpl.type, { shouldValidate: true });
                  }
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Pre-compila dal catalogo dotazioni…" />
                </SelectTrigger>
                <SelectContent>
                  {templatesQuery.data?.templates.map((t) => (
                    <SelectItem key={t.id} value={String(t.id)}>
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground">
                Selezionando un elemento, nome e tipologia vengono pre-compilati. Puoi comunque
                modificarli prima di salvare.
              </p>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="e-name">Nome</Label>
            <Input id="e-name" placeholder="Pianoforte verticale" {...register('name')} />
            {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Tipologia</Label>
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
            <div className="space-y-2">
              <Label htmlFor="e-quantity">Quantità</Label>
              <Input
                id="e-quantity"
                type="number"
                min={1}
                {...register('quantity', { valueAsNumber: true })}
              />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="e-brand">Marca</Label>
              <Input id="e-brand" placeholder="Yamaha" {...register('brand')} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="e-model">Modello</Label>
              <Input id="e-model" placeholder="U3" {...register('model')} />
            </div>
          </div>

          <div className="flex items-center justify-between rounded-lg border p-3">
            <div>
              <p className="text-sm font-medium">In funzione</p>
              <p className="text-xs text-muted-foreground">
                Disattiva se lo strumento è guasto o in manutenzione.
              </p>
            </div>
            <Switch
              checked={isWorking}
              onCheckedChange={(v) => {
                setValue('isWorking', v);
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
                'Salva'
              ) : (
                'Aggiungi'
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
