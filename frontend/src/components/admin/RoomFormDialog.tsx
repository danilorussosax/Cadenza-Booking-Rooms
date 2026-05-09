import { useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ImagePlus, LoaderCircle, QrCode, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { ROOM_TYPE_OPTIONS, structureApi } from '@/api/structure';
import { coursesApi } from '@/api/courses';
import { httpErrorMessage } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { FieldError } from '@/components/ui/field-error';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
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
import type { Building, Role, Room, RoomType } from '@/types';

const ROLES: { value: Role; label: string }[] = [
  { value: 'admin', label: 'Amministratori' },
  { value: 'docente', label: 'Docenti' },
  { value: 'studente', label: 'Studenti' },
];

const schema = z.object({
  name: z.string().min(1, 'Inserisci il nome'),
  code: z.string().max(50).optional(),
  floor: z.string().min(1, 'Indica il piano'),
  capacity: z.number().int().min(1, 'Capienza minima 1'),
  type: z.enum(['studio', 'sala_prove', 'aula_concerti', 'classe', 'aula_didattica', 'altro']),
  isBookable: z.boolean(),
  requireCheckIn: z.boolean(),
  requiresApproval: z.boolean(),
  notes: z.string().max(2000).optional(),
  allowedRoles: z.array(z.enum(['admin', 'docente', 'studente'])),
  allowedCourseIds: z.array(z.number()),
});

type FormValues = z.infer<typeof schema>;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  building: Building;
  room?: Room | null;
}

export function RoomFormDialog({ open, onOpenChange, building, room }: Props) {
  const qc = useQueryClient();
  const { t } = useTranslation();
  const isEdit = !!room;
  const [serverError, setServerError] = useState<string | null>(null);
  const [currentPhotoUrl, setCurrentPhotoUrl] = useState<string | null>(room?.photoUrl ?? null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const coursesQuery = useQuery({
    queryKey: ['courses', 'all'],
    queryFn: () => coursesApi.listAll(),
    enabled: open,
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
      code: '',
      floor: building.floors[0] ?? 'Piano Terra',
      capacity: 1,
      type: 'studio',
      isBookable: true,
      requireCheckIn: true,
      requiresApproval: false,
      notes: '',
      allowedRoles: ['admin', 'docente', 'studente'],
      allowedCourseIds: [],
    },
  });

  useEffect(() => {
    if (open) {
      reset({
        name: room?.name ?? '',
        code: room?.code ?? '',
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        floor: room?.floor ?? building.floors[0] ?? 'Piano Terra',
        capacity: room?.capacity ?? 1,
        type: room?.type ?? 'studio',
        isBookable: room?.isBookable ?? true,
        requireCheckIn: room?.requireCheckIn ?? true,
        requiresApproval: room?.requiresApproval ?? false,
        notes: room?.notes ?? '',
        allowedRoles: room?.allowedRoles ?? ['admin', 'docente', 'studente'],
        allowedCourseIds: room?.allowedCourseIds ?? [],
      });
      setCurrentPhotoUrl(room?.photoUrl ?? null);
      setServerError(null);
    }
  }, [open, room, building, reset]);

  const type = watch('type');
  const isBookable = watch('isBookable');
  const requireCheckIn = watch('requireCheckIn');
  const requiresApproval = watch('requiresApproval');
  const floor = watch('floor');
  const allowedRoles = watch('allowedRoles');
  const allowedCourseIds = watch('allowedCourseIds');

  const toggleRole = (r: Role) => {
    const next = new Set(allowedRoles);
    if (next.has(r)) next.delete(r);
    else next.add(r);
    setValue('allowedRoles', Array.from(next), { shouldValidate: true });
  };

  const toggleCourse = (id: number) => {
    const next = new Set(allowedCourseIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setValue('allowedCourseIds', Array.from(next), { shouldValidate: true });
  };

  const photoUploadMutation = useMutation({
    mutationFn: (file: File) => {
      if (!room) throw new Error('save_first');
      return structureApi.uploadRoomPhoto(room.id, file);
    },
    onSuccess: ({ photoUrl }) => {
      setCurrentPhotoUrl(photoUrl);
      toast.success(t('admin.structure.room_photo_uploaded'));
      void qc.invalidateQueries({ queryKey: ['institutes'] });
      void qc.invalidateQueries({ queryKey: ['rooms'] });
      // Display kiosk legge da /api/public/agenda → forziamo il refresh per
      // far apparire subito codice/foto aggiornati senza attendere il poll 60s.
      void qc.invalidateQueries({ queryKey: ['public'] });
    },
    onError: (err) => {
      if (err instanceof Error && err.message === 'save_first') {
        toast.error(t('admin.structure.room_photo_save_first'));
      } else {
        toast.error(httpErrorMessage(err));
      }
    },
  });

  const photoDeleteMutation = useMutation({
    mutationFn: () => {
      if (!room) throw new Error('save_first');
      return structureApi.deleteRoomPhoto(room.id);
    },
    onSuccess: () => {
      setCurrentPhotoUrl(null);
      toast.success(t('admin.structure.room_photo_removed'));
      void qc.invalidateQueries({ queryKey: ['institutes'] });
      void qc.invalidateQueries({ queryKey: ['rooms'] });
      void qc.invalidateQueries({ queryKey: ['public'] });
    },
    onError: (err) => toast.error(httpErrorMessage(err)),
  });

  const onPickFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) photoUploadMutation.mutate(f);
    // reset input per permettere ri-selezione dello stesso file
    e.target.value = '';
  };

  const mutation = useMutation({
    mutationFn: (values: FormValues) => {
      const payload = {
        buildingId: building.id,
        name: values.name.trim(),
        code: values.code?.trim() ?? null,
        floor: values.floor,
        capacity: values.capacity,
        type: values.type,
        isBookable: values.isBookable,
        requireCheckIn: values.requireCheckIn,
        requiresApproval: values.requiresApproval,
        notes: values.notes?.trim() ?? null,
        allowedRoles: values.allowedRoles,
        allowedCourseIds: values.allowedCourseIds,
      };
      return isEdit ? structureApi.updateRoom(room.id, payload) : structureApi.createRoom(payload);
    },
    onSuccess: () => {
      toast.success(isEdit ? 'Aula aggiornata' : 'Aula creata');
      void qc.invalidateQueries({ queryKey: ['institutes'] });
      void qc.invalidateQueries({ queryKey: ['rooms'] });
      // Cambio di code/name/floor si riflette anche sul Display kiosk
      // (legge da /api/public/agenda) e sulla home pubblica → invalidiamo.
      void qc.invalidateQueries({ queryKey: ['public'] });
      onOpenChange(false);
    },
    onError: (err) => {
      setServerError(httpErrorMessage(err));
    },
  });

  const floors = building.floors.length ? building.floors : ['Piano Terra'];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Modifica aula' : 'Nuova aula'}</DialogTitle>
          <DialogDescription>
            {building.name} · Configura tipologia, capienza e regole di accesso.
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
              <Label htmlFor="r-name">Nome</Label>
              <Input
                id="r-name"
                placeholder="Aula Verdi"
                aria-invalid={!!errors.name}
                aria-describedby={errors.name ? 'r-name-error' : undefined}
                {...register('name')}
              />
              <FieldError id="r-name-error">{errors.name?.message}</FieldError>
            </div>
            <div className="space-y-2">
              <Label htmlFor="r-code">Codice</Label>
              <Input id="r-code" {...register('code')} />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <Label>Piano</Label>
              <Select
                value={floor}
                onValueChange={(v) => {
                  setValue('floor', v, { shouldValidate: true });
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {floors.map((f) => (
                    <SelectItem key={f} value={f}>
                      {f}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="r-capacity">Capienza</Label>
              <Input
                id="r-capacity"
                type="number"
                min={1}
                aria-invalid={!!errors.capacity}
                aria-describedby={errors.capacity ? 'r-capacity-error' : undefined}
                {...register('capacity', { valueAsNumber: true })}
              />
              <FieldError id="r-capacity-error">{errors.capacity?.message}</FieldError>
            </div>
            <div className="space-y-2">
              <Label>Tipologia</Label>
              <Select
                value={type}
                onValueChange={(v) => {
                  setValue('type', v as RoomType);
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ROOM_TYPE_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Ruoli ammessi alla prenotazione</Label>
            <div className="grid gap-2 sm:grid-cols-3">
              {ROLES.map((r) => (
                <label
                  key={r.value}
                  className="flex cursor-pointer items-center gap-2 rounded-md border bg-background px-3 py-2 text-sm hover:bg-accent"
                >
                  <Checkbox
                    checked={allowedRoles.includes(r.value)}
                    onCheckedChange={() => {
                      toggleRole(r.value);
                    }}
                  />
                  {r.label}
                </label>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label>Corsi autorizzati (vuoto = tutti)</Label>
            <div className="max-h-44 overflow-y-auto rounded-md border bg-background p-2">
              {coursesQuery.isLoading && (
                <p className="px-2 py-2 text-xs text-muted-foreground">Caricamento corsi…</p>
              )}
              <div className="grid gap-1.5 sm:grid-cols-2">
                {coursesQuery.data?.courses.map((c) => (
                  <label
                    key={c.id}
                    className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-xs hover:bg-accent"
                  >
                    <Checkbox
                      checked={allowedCourseIds.includes(c.id)}
                      onCheckedChange={() => {
                        toggleCourse(c.id);
                      }}
                    />
                    <span className="truncate">
                      {c.code} — {c.name}
                    </span>
                  </label>
                ))}
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="r-notes">Note</Label>
            <Textarea id="r-notes" rows={2} {...register('notes')} />
          </div>

          {/* Foto aula — disponibile solo dopo aver creato l'aula (serve un id) */}
          <div className="space-y-2 rounded-lg border p-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium">{t('admin.structure.room_photo')}</p>
                <p className="text-xs text-muted-foreground">
                  {t('admin.structure.room_photo_help')}
                </p>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/heic,image/heif"
                className="hidden"
                onChange={onPickFile}
              />
            </div>

            {/* Anteprima 16:9 (matches il rendering in /rooms) */}
            <div className="relative aspect-video w-full overflow-hidden rounded-md border bg-muted/30">
              <img
                src={currentPhotoUrl ?? '/assets/room-default.svg'}
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
                    toast.error(t('admin.structure.room_photo_save_first'));
                    return;
                  }
                  fileInputRef.current?.click();
                }}
                disabled={photoUploadMutation.isPending || photoDeleteMutation.isPending}
              >
                <ImagePlus className="h-4 w-4" />
                {currentPhotoUrl
                  ? t('admin.structure.room_photo_replace')
                  : t('admin.structure.room_photo_upload')}
              </Button>
              {currentPhotoUrl && isEdit && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    if (window.confirm(t('admin.structure.room_photo_remove_confirm'))) {
                      photoDeleteMutation.mutate();
                    }
                  }}
                  disabled={photoDeleteMutation.isPending}
                  className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                >
                  <Trash2 className="h-4 w-4" />
                  {t('admin.structure.room_photo_remove')}
                </Button>
              )}
            </div>
          </div>

          <div className="flex items-center justify-between rounded-lg border p-3">
            <div>
              <p className="text-sm font-medium">Aula prenotabile</p>
              <p className="text-xs text-muted-foreground">
                Disattiva per nascondere l’aula dai moduli di prenotazione.
              </p>
            </div>
            <Switch
              checked={isBookable}
              onCheckedChange={(v) => {
                setValue('isBookable', v);
              }}
            />
          </div>

          <div className="flex items-center justify-between rounded-lg border p-3">
            <div>
              <p className="text-sm font-medium">{t('admin.structure.require_checkin')}</p>
              <p className="text-xs text-muted-foreground">
                {t('admin.structure.require_checkin_help')}
              </p>
            </div>
            <Switch
              checked={requireCheckIn}
              onCheckedChange={(v) => {
                setValue('requireCheckIn', v);
              }}
            />
          </div>

          <div className="flex items-center justify-between rounded-lg border p-3">
            <div>
              <p className="text-sm font-medium">{t('admin.structure.requires_approval')}</p>
              <p className="text-xs text-muted-foreground">
                {t('admin.structure.requires_approval_help')}
              </p>
            </div>
            <Switch
              checked={requiresApproval}
              onCheckedChange={(v) => {
                setValue('requiresApproval', v);
              }}
            />
          </div>

          {/* QR check-in: disponibile solo dopo aver creato l'aula e con check-in attivo */}
          {isEdit && requireCheckIn && (
            <div className="flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-medium">{t('admin_structure_qr.print_qr')}</p>
                <p className="text-xs text-muted-foreground">{t('admin_structure_qr.qr_help')}</p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={async () => {
                  try {
                    const blob = await structureApi.downloadRoomQr(room.id);
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `qr-room-${room.id}.png`;
                    document.body.appendChild(a);
                    a.click();
                    a.remove();
                    URL.revokeObjectURL(url);
                  } catch (err) {
                    toast.error(
                      err instanceof Error ? err.message : t('admin_structure_qr.qr_failed'),
                    );
                  }
                }}
              >
                <QrCode className="h-4 w-4" />
                {t('admin_structure_qr.print_qr')}
              </Button>
            </div>
          )}

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
                'Crea aula'
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
