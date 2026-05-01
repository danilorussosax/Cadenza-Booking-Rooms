import { useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ImagePlus, LoaderCircle, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { instrumentsApi, type UpsertInstrumentPayload } from '@/api/instruments';
import { httpErrorMessage } from '@/lib/api';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
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
import type { Instrument, InstrumentCondition, InstrumentFamily } from '@/types';

const FAMILIES: InstrumentFamily[] = [
  'archi',
  'fiati_legni',
  'fiati_ottoni',
  'tastiere',
  'percussioni',
  'corde',
  'voce',
  'elettronica',
  'altro',
];
const CONDITIONS: InstrumentCondition[] = [
  'ottimo',
  'buono',
  'discreto',
  'da_riparare',
  'fuori_uso',
];

const schema = z.object({
  name: z.string().min(1, 'name_required'),
  code: z.string().optional(),
  family: z.enum([
    'archi',
    'fiati_legni',
    'fiati_ottoni',
    'tastiere',
    'percussioni',
    'corde',
    'voce',
    'elettronica',
    'altro',
  ]),
  brand: z.string().optional(),
  model: z.string().optional(),
  serialNumber: z.string().optional(),
  condition: z.enum(['ottimo', 'buono', 'discreto', 'da_riparare', 'fuori_uso']),
  isLoanable: z.boolean(),
  notes: z.string().max(2000).optional(),
});
type FormValues = z.infer<typeof schema>;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  instrument?: Instrument | null;
}

export function InstrumentFormDialog({ open, onOpenChange, instrument }: Props) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const isEdit = !!instrument;
  const [serverError, setServerError] = useState<string | null>(null);
  const [currentPhotoUrl, setCurrentPhotoUrl] = useState<string | null>(
    instrument?.photoUrl ?? null,
  );
  const fileInputRef = useRef<HTMLInputElement | null>(null);

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
      code: '',
      family: 'altro',
      brand: '',
      model: '',
      serialNumber: '',
      condition: 'buono',
      isLoanable: true,
      notes: '',
    },
  });

  useEffect(() => {
    if (open) {
      reset({
        name: instrument?.name ?? '',
        code: instrument?.code ?? '',
        family: instrument?.family ?? 'altro',
        brand: instrument?.brand ?? '',
        model: instrument?.model ?? '',
        serialNumber: instrument?.serialNumber ?? '',
        condition: instrument?.condition ?? 'buono',
        isLoanable: instrument?.isLoanable ?? true,
        notes: instrument?.notes ?? '',
      });
      setCurrentPhotoUrl(instrument?.photoUrl ?? null);
      setServerError(null);
    }
  }, [open, instrument, reset]);

  const family = watch('family');
  const condition = watch('condition');
  const isLoanable = watch('isLoanable');

  const saveMutation = useMutation({
    mutationFn: (values: FormValues) => {
      const payload: UpsertInstrumentPayload = {
        name: values.name.trim(),
        code: values.code?.trim() ?? null,
        family: values.family,
        brand: values.brand?.trim() ?? null,
        model: values.model?.trim() ?? null,
        serialNumber: values.serialNumber?.trim() ?? null,
        condition: values.condition,
        isLoanable: values.isLoanable,
        notes: values.notes?.trim() ?? null,
      };
      return isEdit
        ? instrumentsApi.update(instrument.id, payload)
        : instrumentsApi.create(payload);
    },
    onSuccess: () => {
      toast.success(t('admin.instruments.toast.saved'));
      void qc.invalidateQueries({ queryKey: ['instruments'] });
      void qc.invalidateQueries({ queryKey: ['admin', 'instruments'] });
      onOpenChange(false);
    },
    onError: (err) => {
      setServerError(httpErrorMessage(err));
    },
  });

  const photoUploadMutation = useMutation({
    mutationFn: (file: File) => {
      if (!instrument) throw new Error('save_first');
      return instrumentsApi.uploadPhoto(instrument.id, file);
    },
    onSuccess: ({ photoUrl }) => {
      setCurrentPhotoUrl(photoUrl);
      toast.success(t('admin.instruments.photo.uploaded'));
      void qc.invalidateQueries({ queryKey: ['instruments'] });
      void qc.invalidateQueries({ queryKey: ['admin', 'instruments'] });
    },
    onError: (err) => {
      if (err instanceof Error && err.message === 'save_first') {
        toast.error(t('admin.instruments.photo.save_first'));
      } else {
        toast.error(httpErrorMessage(err));
      }
    },
  });

  const photoDeleteMutation = useMutation({
    mutationFn: () => {
      if (!instrument) throw new Error('save_first');
      return instrumentsApi.removePhoto(instrument.id);
    },
    onSuccess: () => {
      setCurrentPhotoUrl(null);
      toast.success(t('admin.instruments.photo.removed'));
      void qc.invalidateQueries({ queryKey: ['instruments'] });
      void qc.invalidateQueries({ queryKey: ['admin', 'instruments'] });
    },
    onError: (err) => toast.error(httpErrorMessage(err)),
  });

  const onPickFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) photoUploadMutation.mutate(f);
    e.target.value = '';
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {isEdit
              ? t('admin.instruments.form.title_edit')
              : t('admin.instruments.form.title_new')}
          </DialogTitle>
          <DialogDescription />
        </DialogHeader>

        <form
          onSubmit={handleSubmit((v) => {
            saveMutation.mutate(v);
          })}
          className="space-y-4"
          noValidate
        >
          {serverError && (
            <Alert variant="destructive">
              <AlertDescription>{serverError}</AlertDescription>
            </Alert>
          )}

          <div className="grid gap-4 sm:grid-cols-[1fr_160px]">
            <div className="space-y-2">
              <Label htmlFor="i-name">{t('admin.instruments.form.name')}</Label>
              <Input id="i-name" placeholder="Violino, Pianoforte…" {...register('name')} />
              {errors.name && (
                <p className="text-xs text-destructive">{t('admin.users.empty.title')}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="i-code">{t('admin.instruments.form.code')}</Label>
              <Input id="i-code" placeholder="INV-0042" {...register('code')} />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>{t('admin.instruments.form.family')}</Label>
              <Select
                value={family}
                onValueChange={(v) => {
                  setValue('family', v as InstrumentFamily, { shouldValidate: true });
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FAMILIES.map((f) => (
                    <SelectItem key={f} value={f}>
                      {t(`instrument_families.${f}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>{t('admin.instruments.form.condition')}</Label>
              <Select
                value={condition}
                onValueChange={(v) => {
                  setValue('condition', v as InstrumentCondition, { shouldValidate: true });
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CONDITIONS.map((c) => (
                    <SelectItem key={c} value={c}>
                      {t(`instrument_conditions.${c}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="i-brand">{t('admin.instruments.form.brand')}</Label>
              <Input id="i-brand" {...register('brand')} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="i-model">{t('admin.instruments.form.model')}</Label>
              <Input id="i-model" {...register('model')} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="i-serial">{t('admin.instruments.form.serial_number')}</Label>
              <Input id="i-serial" {...register('serialNumber')} />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="i-notes">{t('admin.instruments.form.notes')}</Label>
            <Textarea id="i-notes" rows={2} {...register('notes')} />
          </div>

          {/* Foto strumento — abilitata solo dopo aver creato lo strumento */}
          <div className="space-y-2 rounded-lg border p-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium">{t('admin.instruments.photo.label')}</p>
                <p className="text-xs text-muted-foreground">{t('admin.instruments.photo.help')}</p>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/heic,image/heif"
                className="hidden"
                onChange={onPickFile}
              />
            </div>

            <div className="relative aspect-video w-full overflow-hidden rounded-md border bg-muted/30">
              <img
                src={currentPhotoUrl ?? '/assets/instrument-default.svg'}
                alt=""
                className="absolute inset-0 h-full w-full object-cover"
              />
              {photoUploadMutation.isPending && (
                <div className="absolute inset-0 flex items-center justify-center bg-background/60 backdrop-blur-xs">
                  <LoaderCircle className="h-6 w-6 animate-spin text-primary" />
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  if (!isEdit) {
                    toast.error(t('admin.instruments.photo.save_first'));
                    return;
                  }
                  fileInputRef.current?.click();
                }}
                disabled={photoUploadMutation.isPending || photoDeleteMutation.isPending}
              >
                <ImagePlus className="h-4 w-4" />
                {currentPhotoUrl
                  ? t('admin.instruments.photo.replace')
                  : t('admin.instruments.photo.upload')}
              </Button>
              {currentPhotoUrl && isEdit && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    if (window.confirm(t('admin.instruments.photo.remove_confirm'))) {
                      photoDeleteMutation.mutate();
                    }
                  }}
                  disabled={photoDeleteMutation.isPending}
                  className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                >
                  <Trash2 className="h-4 w-4" />
                  {t('admin.instruments.photo.remove')}
                </Button>
              )}
            </div>
          </div>

          <div className="flex items-center justify-between rounded-lg border p-3">
            <div>
              <p className="text-sm font-medium">{t('admin.instruments.form.is_loanable')}</p>
              <p className="text-xs text-muted-foreground">
                {t('admin.instruments.form.is_loanable_help')}
              </p>
            </div>
            <Switch
              checked={isLoanable}
              onCheckedChange={(v) => {
                setValue('isLoanable', v);
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
              disabled={isSubmitting || saveMutation.isPending}
            >
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={isSubmitting || saveMutation.isPending}>
              {(isSubmitting || saveMutation.isPending) && (
                <LoaderCircle className="h-4 w-4 animate-spin" />
              )}
              {isEdit
                ? t('admin.instruments.form.submit_update')
                : t('admin.instruments.form.submit_create')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
