import { useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ImagePlus, LoaderCircle, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { bookingsApi } from '@/api/bookings';
import { httpErrorMessage, HttpError } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { FieldError } from '@/components/ui/field-error';
import { Textarea } from '@/components/ui/textarea';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ConfirmDeleteDialog } from '@/components/admin/ConfirmDeleteDialog';
import { useDirtyDialogClose } from '@/hooks/useDirtyDialogClose';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { ConcertInfo, ConcertEventType } from '@/types';

const EVENT_TYPES: ConcertEventType[] = [
  'concerto',
  'saggio',
  'masterclass',
  'conferenza',
  'lezione_aperta',
];

const LANGUAGE_OPTIONS = ['', 'it', 'en', 'fr', 'de', 'es'] as const;

const schema = z.object({
  title: z.string().min(1, 'title_required').max(255),
  performers: z.string().max(4000).optional(),
  program: z.string().max(4000).optional(),
  eventType: z.enum(EVENT_TYPES as [ConcertEventType, ...ConcertEventType[]]),
  description: z.string().max(500).optional(),
  language: z
    .string()
    .regex(/^([a-z]{2})?$/, 'lang_invalid')
    .optional(),
});

type FormValues = z.infer<typeof schema>;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  bookingId: number;
}

/**
 * Dialog di gestione della scheda concerto associata a una booking di tipo
 * 'concerto'. Il GET iniziale può ritornare 404 (scheda non ancora creata):
 * in quel caso la form parte vuota e il PUT crea la riga al primo salvataggio.
 * L'upload locandina è disponibile solo dopo che la scheda è stata salvata.
 */
export function ConcertInfoDialog({ open, onOpenChange, bookingId }: Props) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [serverError, setServerError] = useState<string | null>(null);
  const [posterUrl, setPosterUrl] = useState<string | null>(null);
  const [hasInfo, setHasInfo] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const concertQuery = useQuery({
    queryKey: ['concert', bookingId],
    queryFn: async () => {
      try {
        return await bookingsApi.getConcert(bookingId);
      } catch (err: unknown) {
        // 404 con code=CONCERT_NOT_FOUND è l'happy path "scheda non ancora creata"
        if (err instanceof HttpError && err.payload.code === 'CONCERT_NOT_FOUND') {
          return { concertInfo: null as ConcertInfo | null };
        }
        throw err;
      }
    },
    enabled: open,
    staleTime: 30_000,
  });

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      title: '',
      performers: '',
      program: '',
      eventType: 'concerto',
      description: '',
      language: '',
    },
  });

  useEffect(() => {
    if (!open) return;
    const info = concertQuery.data?.concertInfo;
    reset({
      title: info?.title ?? '',
      performers: info?.performers ?? '',
      program: info?.program ?? '',
      eventType: info?.eventType ?? 'concerto',
      description: info?.description ?? '',
      language: info?.language ?? '',
    });
    setPosterUrl(info?.posterUrl ?? null);
    setHasInfo(!!info);
    setServerError(null);
  }, [open, concertQuery.data, reset]);

  const saveMutation = useMutation({
    mutationFn: (values: FormValues) =>
      bookingsApi.saveConcert(bookingId, {
        title: values.title.trim(),
        performers: values.performers?.trim() ?? '',
        program: values.program?.trim() ?? '',
        eventType: values.eventType,
        // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- stringa vuota (anche dopo trim) deve diventare null, non ''
        description: values.description?.trim() || null,
        // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- idem: '' → null
        language: values.language?.trim() || null,
      }),
    onSuccess: ({ concertInfo }) => {
      toast.success(t('concert.saved'));
      setHasInfo(true);
      setPosterUrl(concertInfo.posterUrl ?? null);
      void qc.invalidateQueries({ queryKey: ['concert', bookingId] });
      void qc.invalidateQueries({ queryKey: ['public', 'concerts'] });
      void qc.invalidateQueries({ queryKey: ['bookings'] });
    },
    onError: (err) => {
      setServerError(httpErrorMessage(err));
    },
  });

  const posterUploadMutation = useMutation({
    mutationFn: (file: File) => bookingsApi.uploadConcertPoster(bookingId, file),
    onSuccess: ({ posterUrl: url }) => {
      setPosterUrl(url);
      toast.success(t('concert.poster_uploaded'));
      void qc.invalidateQueries({ queryKey: ['concert', bookingId] });
      void qc.invalidateQueries({ queryKey: ['public', 'concerts'] });
    },
    onError: (err) => toast.error(httpErrorMessage(err)),
  });

  const posterDeleteMutation = useMutation({
    mutationFn: () => bookingsApi.deleteConcertPoster(bookingId),
    onSuccess: () => {
      setPosterUrl(null);
      toast.success(t('concert.poster_removed'));
      void qc.invalidateQueries({ queryKey: ['concert', bookingId] });
      void qc.invalidateQueries({ queryKey: ['public', 'concerts'] });
    },
    onError: (err) => toast.error(httpErrorMessage(err)),
  });

  const onPickFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) posterUploadMutation.mutate(f);
    e.target.value = '';
  };

  const tFieldError = (key?: string) => (key ? t(`concert.errors.${key}`) : undefined);

  const dirtyClose = useDirtyDialogClose({
    isDirty,
    onClose: () => onOpenChange(false),
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (o) onOpenChange(true);
        else dirtyClose.handleOpenChange();
      }}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('concert.dialog_title')}</DialogTitle>
          <DialogDescription>{t('concert.dialog_description')}</DialogDescription>
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

          <div className="space-y-2">
            <Label htmlFor="c-title">{t('concert.field.title')}</Label>
            <Input
              id="c-title"
              placeholder={t('concert.field.title_placeholder')}
              maxLength={255}
              aria-invalid={!!errors.title}
              aria-describedby={errors.title ? 'c-title-error' : undefined}
              {...register('title')}
            />
            <FieldError id="c-title-error">
              {errors.title && tFieldError(errors.title.message)}
            </FieldError>
          </div>

          <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
            <div className="space-y-2">
              <Label htmlFor="c-event-type">{t('concert.field.event_type')}</Label>
              <Select
                value={watch('eventType')}
                onValueChange={(v) =>
                  setValue('eventType', v as ConcertEventType, { shouldDirty: true })
                }
              >
                <SelectTrigger id="c-event-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {EVENT_TYPES.map((et) => (
                    <SelectItem key={et} value={et}>
                      {t(`concert.event_type.${et}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="c-language">{t('concert.field.language')}</Label>
              <Select
                value={watch('language') ?? ''}
                onValueChange={(v) =>
                  setValue('language', v === '_none' ? '' : v, { shouldDirty: true })
                }
              >
                <SelectTrigger id="c-language" className="w-32">
                  <SelectValue placeholder="—" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="_none">— {t('concert.field.language_none')}</SelectItem>
                  {LANGUAGE_OPTIONS.filter((l) => l !== '').map((lang) => (
                    <SelectItem key={lang} value={lang}>
                      {lang.toUpperCase()}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="c-description">{t('concert.field.description')}</Label>
            <Textarea
              id="c-description"
              rows={2}
              maxLength={500}
              placeholder={t('concert.field.description_placeholder')}
              {...register('description')}
            />
            <p className="text-[11px] text-muted-foreground">
              {t('concert.field.description_help')}
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="c-performers">{t('concert.field.performers')}</Label>
            <Textarea
              id="c-performers"
              rows={4}
              placeholder={t('concert.field.performers_placeholder')}
              {...register('performers')}
            />
            <p className="text-[11px] text-muted-foreground">
              {t('concert.field.performers_help')}
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="c-program">{t('concert.field.program')}</Label>
            <Textarea
              id="c-program"
              rows={5}
              placeholder={t('concert.field.program_placeholder')}
              {...register('program')}
            />
            <p className="text-[11px] text-muted-foreground">{t('concert.field.program_help')}</p>
          </div>

          {/* Locandina — disponibile solo dopo aver salvato la scheda */}
          <div className="space-y-2 rounded-lg border p-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium">{t('concert.poster')}</p>
                <p className="text-xs text-muted-foreground">{t('concert.poster_help')}</p>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/heic,image/heif"
                className="hidden"
                onChange={onPickFile}
              />
            </div>

            <div className="relative aspect-3/4 w-full max-w-[260px] overflow-hidden rounded-md border bg-muted/30">
              <img
                src={posterUrl ?? '/assets/concerto.png'}
                alt=""
                className="absolute inset-0 h-full w-full object-cover"
              />
              {posterUploadMutation.isPending && (
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
                  if (!hasInfo) {
                    toast.error(t('concert.save_first'));
                    return;
                  }
                  fileInputRef.current?.click();
                }}
                disabled={posterUploadMutation.isPending || posterDeleteMutation.isPending}
              >
                <ImagePlus className="h-4 w-4" />
                {posterUrl ? t('concert.poster_replace') : t('concert.poster_upload')}
              </Button>
              {posterUrl && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    if (window.confirm(t('concert.poster_remove_confirm'))) {
                      posterDeleteMutation.mutate();
                    }
                  }}
                  disabled={posterDeleteMutation.isPending}
                  className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                >
                  <Trash2 className="h-4 w-4" />
                  {t('concert.poster_remove')}
                </Button>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={dirtyClose.handleOpenChange}
              disabled={isSubmitting}
            >
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={isSubmitting || saveMutation.isPending}>
              {isSubmitting || saveMutation.isPending ? (
                <LoaderCircle className="h-4 w-4 animate-spin" />
              ) : (
                t('common.save')
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
      <ConfirmDeleteDialog
        open={dirtyClose.confirmOpen}
        onOpenChange={dirtyClose.setConfirmOpen}
        title={t('common.discard_changes_title')}
        description={t('common.discard_changes_description')}
        confirmLabel={t('common.discard_changes_confirm')}
        onConfirm={dirtyClose.confirm}
      />
    </Dialog>
  );
}
