import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { LoaderCircle } from 'lucide-react';
import { toast } from 'sonner';
import { coursesApi } from '@/api/courses';
import { courseLevelsApi } from '@/api/courseLevels';
import { httpErrorMessage } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { Course, CourseLevel } from '@/types';

const schema = z.object({
  code: z.string().min(1, 'Inserisci il codice').max(20, 'Massimo 20 caratteri'),
  name: z.string().min(1, 'Inserisci il nome').max(250),
  department: z.string().max(150).optional(),
  description: z.string().max(2000).optional(),
  isActive: z.boolean(),
  levels: z.array(z.string()),
});

type FormValues = z.infer<typeof schema>;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  course?: Course | null;
}

export function CourseFormDialog({ open, onOpenChange, course }: Props) {
  const qc = useQueryClient();
  const isEdit = !!course;
  const [serverError, setServerError] = useState<string | null>(null);

  const levelsQuery = useQuery({
    queryKey: ['course-levels'],
    queryFn: () => courseLevelsApi.list(),
    enabled: open,
    staleTime: 60_000,
  });
  const availableLevels = levelsQuery.data?.levels ?? [];

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
      code: '',
      name: '',
      department: '',
      description: '',
      isActive: true,
      levels: [],
    },
  });

  useEffect(() => {
    if (open) {
      reset({
        code: course?.code ?? '',
        name: course?.name ?? '',
        department: course?.department ?? '',
        description: course?.description ?? '',
        isActive: course?.isActive ?? true,
        levels: course?.levels ?? [],
      });
      setServerError(null);
    }
  }, [open, course, reset]);

  const isActive = watch('isActive');
  const levels = watch('levels');

  const toggleLevel = (lvl: CourseLevel) => {
    const set = new Set(levels);
    if (set.has(lvl)) set.delete(lvl);
    else set.add(lvl);
    setValue('levels', Array.from(set), { shouldValidate: true });
  };

  const mutation = useMutation({
    mutationFn: (values: FormValues) => {
      const payload = {
        code: values.code.trim(),
        name: values.name.trim(),
        department: values.department?.trim() ?? null,
        description: values.description?.trim() ?? null,
        isActive: values.isActive,
        levels: values.levels,
      };
      return isEdit ? coursesApi.update(course.id, payload) : coursesApi.create(payload);
    },
    onSuccess: () => {
      toast.success(isEdit ? 'Corso aggiornato' : 'Corso creato');
      void qc.invalidateQueries({ queryKey: ['courses'] });
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
          <DialogTitle>{isEdit ? 'Modifica corso' : 'Nuovo corso di studio'}</DialogTitle>
          <DialogDescription>
            Imposta codice, denominazione e i livelli (triennio, biennio…) supportati.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
          {serverError && (
            <Alert variant="destructive">
              <AlertDescription>{serverError}</AlertDescription>
            </Alert>
          )}

          <div className="grid gap-4 sm:grid-cols-[140px_1fr]">
            <div className="space-y-2">
              <Label htmlFor="code">Codice</Label>
              <Input id="code" placeholder="DCPL34" {...register('code')} />
              {errors.code && <p className="text-xs text-destructive">{errors.code.message}</p>}
            </div>
            <div className="space-y-2">
              <Label htmlFor="name">Denominazione</Label>
              <Input id="name" placeholder="Pianoforte" {...register('name')} />
              {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="department">Dipartimento (opzionale)</Label>
            <Input id="department" placeholder="Strumenti a tastiera" {...register('department')} />
          </div>

          <div className="space-y-2">
            <Label>Livelli supportati</Label>
            {levelsQuery.isLoading ? (
              <p className="text-xs text-muted-foreground">Caricamento livelli…</p>
            ) : availableLevels.length === 0 ? (
              <p className="rounded-md border border-dashed bg-muted/30 p-3 text-xs text-muted-foreground">
                Nessun livello configurato. Aggiungili dalla scheda <strong>Livelli</strong>.
              </p>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2">
                {availableLevels.map((opt) => {
                  const checked = levels.includes(opt.code);
                  return (
                    <label
                      key={opt.id}
                      className="flex cursor-pointer items-center gap-2 rounded-md border bg-background px-3 py-2 text-sm transition-colors hover:bg-accent"
                    >
                      <Checkbox
                        checked={checked}
                        onCheckedChange={() => {
                          toggleLevel(opt.code);
                        }}
                      />
                      {opt.name}
                    </label>
                  );
                })}
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Descrizione (opzionale)</Label>
            <Textarea id="description" rows={3} {...register('description')} />
          </div>

          <div className="flex items-center justify-between rounded-lg border p-3">
            <div>
              <p className="text-sm font-medium">Corso attivo</p>
              <p className="text-xs text-muted-foreground">
                Solo i corsi attivi compaiono nei moduli di registrazione.
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
                'Crea corso'
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
