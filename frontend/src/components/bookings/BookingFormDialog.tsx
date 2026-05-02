import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bookmark, ListChecks, LoaderCircle } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { bookingsApi } from '@/api/bookings';
import { bookingTemplatesApi } from '@/api/bookingTemplates';
import { roomsApi } from '@/api/rooms';
import { usersApi } from '@/api/users';
import { waitlistApi } from '@/api/waitlist';
import { useAuth } from '@/contexts/AuthContext';
import { httpErrorMessage, HttpError } from '@/lib/api';
import { BOOKING_TYPE_OPTIONS } from '@/lib/bookings';
import { bookingTypesApi } from '@/api/bookingTypes';
import { fromLocalInput, toLocalDateTimeInput } from '@/lib/date';
import { sortRoomsCrossBuilding } from '@/lib/sortRooms';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { FieldError } from '@/components/ui/field-error';
import { Textarea } from '@/components/ui/textarea';
import { Alert, AlertDescription } from '@/components/ui/alert';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { Booking, BookingType } from '@/types';

// Floor specifico per le prenotazioni di tipo "studio individuale" (vedi
// STUDIO_MIN_DURATION_MINUTES in services/bookingValidator.js): 1 ora minima
// per evitare frammentazione delle aule in slot troppo brevi. Replicato qui
// per dare feedback immediato nel form prima del submit.
const STUDIO_MIN_DURATION_MINUTES = 60;

// I messaggi sono "chiavi" (es. 'room_required') tradotte runtime via i18n.
const schema = z
  .object({
    roomId: z.string().min(1, 'room_required'),
    startTime: z.string().min(1, 'start_required'),
    endTime: z.string().min(1, 'end_required'),
    type: z.enum(['studio_individuale', 'lezione', 'prova', 'concerto', 'altro']),
    purpose: z.string().max(255).optional(),
    notes: z.string().max(2000).optional(),
  })
  .refine(
    (data) => fromLocalInput(data.endTime).getTime() > fromLocalInput(data.startTime).getTime(),
    { path: ['endTime'], message: 'end_after_start' },
  )
  .refine(
    (data) => {
      if (data.type !== 'studio_individuale') return true;
      const startMs = fromLocalInput(data.startTime).getTime();
      const endMs = fromLocalInput(data.endTime).getTime();
      if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
        return true; // altre refine catturano già la finestra invalida
      }
      return (endMs - startMs) / 60000 >= STUDIO_MIN_DURATION_MINUTES;
    },
    { path: ['endTime'], message: 'studio_min_duration' },
  );

type FormValues = z.infer<typeof schema>;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultRoomId?: number;
  defaultStart?: Date;
  defaultEnd?: Date;
  /** Lock the room selector to a single room */
  lockRoom?: boolean;
  onCreated?: () => void;
  /** Edit mode: prenotazione esistente da modificare. Quando valorizzato, il
   *  dialog passa in modalità PATCH (PUT /api/bookings/:id) anziché POST.
   *  Nasconde le opzioni di ricorrenza (la booking esiste già). */
  booking?: Booking | null;
  /** Duplicate mode (gap #1 EasyRoom parity): copia i campi (room, type,
   *  purpose, notes) da una booking esistente, ma resetta startTime/endTime
   *  a +7 giorni di default. Il dialog resta in modalità "create" → POST
   *  /api/bookings normale, validator standard, eventuale waitlist su
   *  conflitto. Il campo `booking` non deve essere valorizzato insieme a
   *  `duplicateFrom`: prevale `booking` se entrambi presenti. */
  duplicateFrom?: Booking | null;
}

export function BookingFormDialog({
  open,
  onOpenChange,
  defaultRoomId,
  defaultStart,
  defaultEnd,
  lockRoom,
  onCreated,
  booking,
  duplicateFrom,
}: Props) {
  const qc = useQueryClient();
  const { t } = useTranslation();
  const { user: currentUser } = useAuth();
  const isAdmin = currentUser?.role === 'admin';
  const isEdit = !!booking;
  const [serverError, setServerError] = useState<string | null>(null);
  // Owner della prenotazione: id dell'utente target (admin only). null = self.
  const [onBehalfOfUserId, setOnBehalfOfUserId] = useState<number | null>(null);
  // Quando il backend ritorna BOOKING_CONFLICT, mostriamo un popup separato
  // (chiudendo questo dialog) con offerta di iscrizione alla waitlist.
  // Il payload include anche `roomLabel` perché lo showtime del popup è
  // dopo la chiusura del Dialog principale: la roomsQuery non è più
  // garantita disponibile, quindi pre-calcoliamo l'etichetta umana qui.
  const [conflictPayload, setConflictPayload] = useState<{
    roomId: number;
    startTime: string;
    endTime: string;
    type: BookingType;
    purpose?: string;
    roomLabel: string | null;
  } | null>(null);

  const tBookingError = (key?: string) => (key ? t(`booking.form_validation.${key}`) : undefined);

  const roomsQuery = useQuery({
    queryKey: ['rooms', 'bookable'],
    queryFn: () => roomsApi.list({ bookable: true }),
    staleTime: 60_000,
    enabled: open,
  });

  // Catalog dinamico tipi prenotazione (gap #7 EasyRoom parity).
  // Restituisce SOLO i tipi attivi, già ordinati per sortOrder. Se la query
  // fallisce o è in caricamento, fallback a `BOOKING_TYPE_OPTIONS` statico.
  const typesQuery = useQuery({
    queryKey: ['booking-types', 'active'],
    queryFn: () => bookingTypesApi.list(),
    staleTime: 5 * 60_000, // catalog cambia raramente
    enabled: open,
  });

  // Lista utenti per il selettore "Prenota a nome di…" (admin only). Carico
  // solo utenti approved+active (gli unici che il backend accetta come owner).
  const usersQuery = useQuery({
    queryKey: ['users', 'approved-active'],
    queryFn: () => usersApi.list({ status: 'approved', active: true }),
    staleTime: 60_000,
    enabled: open && isAdmin,
  });

  const initialValues = useMemo<FormValues>(() => {
    if (booking) {
      return {
        roomId: String(booking.roomId),
        startTime: toLocalDateTimeInput(new Date(booking.startTime)),
        endTime: toLocalDateTimeInput(new Date(booking.endTime)),
        type: booking.type,
        purpose: booking.purpose ?? '',
        notes: booking.notes ?? '',
      };
    }
    if (duplicateFrom) {
      // Duplicate mode: copia campi semantici (room/type/purpose/notes)
      // dalla booking sorgente. Sposta start/end di +7 giorni così l'utente
      // vede subito una data plausibile (stesso giorno settimana successiva)
      // ma può modificarla nel form prima del submit.
      const SHIFT_MS = 7 * 24 * 60 * 60 * 1000;
      const newStart = new Date(new Date(duplicateFrom.startTime).getTime() + SHIFT_MS);
      const newEnd = new Date(new Date(duplicateFrom.endTime).getTime() + SHIFT_MS);
      return {
        roomId: String(duplicateFrom.roomId),
        startTime: toLocalDateTimeInput(newStart),
        endTime: toLocalDateTimeInput(newEnd),
        type: duplicateFrom.type,
        purpose: duplicateFrom.purpose ?? '',
        notes: duplicateFrom.notes ?? '',
      };
    }
    const start = defaultStart ?? new Date();
    const end = defaultEnd ?? new Date(start.getTime() + 60 * 60 * 1000);
    return {
      roomId: defaultRoomId ? String(defaultRoomId) : '',
      startTime: toLocalDateTimeInput(start),
      endTime: toLocalDateTimeInput(end),
      type: 'studio_individuale',
      purpose: '',
      notes: '',
    };
  }, [defaultRoomId, defaultStart, defaultEnd, booking, duplicateFrom]);

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    reset,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: initialValues,
  });

  // Re-seed when the dialog opens with new defaults
  useEffect(() => {
    if (open) {
      reset(initialValues);
      setServerError(null);
      // In edit mode pre-seleziono l'owner corrente; in create mode default = self.
      setOnBehalfOfUserId(booking ? booking.userId : null);
    }
  }, [open, initialValues, reset, booking]);

  const roomId = watch('roomId');
  const type = watch('type');

  const [recurringWeeks, setRecurringWeeks] = useState<number>(0); // 0 = disattivato
  const [saveAsTemplateOpen, setSaveAsTemplateOpen] = useState(false);

  type CreateResult =
    | { kind: 'single' }
    | { kind: 'recurring'; created: number; skipped: number }
    | { kind: 'updated' };

  const createMutation = useMutation<CreateResult, unknown, FormValues>({
    mutationFn: async (values) => {
      const payload = {
        roomId: Number(values.roomId),
        startTime: fromLocalInput(values.startTime).toISOString(),
        endTime: fromLocalInput(values.endTime).toISOString(),
        type: values.type,
        purpose: values.purpose?.trim() ?? undefined,
        notes: values.notes?.trim() ?? undefined,
      };
      // Edit mode: PUT /api/bookings/:id. Solo admin può cambiare userId
      // (riassegnazione owner): se non-admin, ignoriamo la selezione.
      if (booking) {
        await bookingsApi.update(booking.id, {
          ...payload,
          ...(isAdmin && onBehalfOfUserId && onBehalfOfUserId !== booking.userId
            ? { userId: onBehalfOfUserId }
            : {}),
        });
        return { kind: 'updated' };
      }
      // Create on-behalf-of: solo admin; il backend ignora il campo se non lo è.
      const onBehalf =
        isAdmin && onBehalfOfUserId && onBehalfOfUserId !== currentUser?.id
          ? { onBehalfOfUserId }
          : {};
      if (recurringWeeks >= 2) {
        const res = await bookingsApi.createRecurring({
          ...payload,
          ...onBehalf,
          recurrence: { weeks: recurringWeeks },
        });
        return { kind: 'recurring', created: res.created, skipped: res.skipped.length };
      }
      await bookingsApi.create({ ...payload, ...onBehalf });
      return { kind: 'single' };
    },
    onSuccess: (res) => {
      if (res.kind === 'recurring') {
        toast.success(
          res.skipped > 0
            ? t('booking.form.recurring_created_some_skipped', {
                created: res.created,
                skipped: res.skipped,
              })
            : t('booking.form.recurring_created', { count: res.created }),
        );
      } else if (res.kind === 'updated') {
        toast.success(t('booking.form.updated_success'));
      } else {
        toast.success(t('booking.form.created_success'));
      }
      void qc.invalidateQueries({ queryKey: ['bookings'] });
      void qc.invalidateQueries({ queryKey: ['availability'] });
      onCreated?.();
      onOpenChange(false);
    },
    onError: (err, values) => {
      // Estraggo BOOKING_CONFLICT (anche EXCLUSION_VIOLATION lato DB-level)
      // per offrire l'opzione waitlist. Considero solo le creazioni single
      // (la ricorrente ha skipped[] separato).
      const code = err instanceof HttpError ? err.payload.code : undefined;
      const isConflict = code === 'BOOKING_CONFLICT' || code === 'EXCLUSION_VIOLATION';
      if (isConflict && recurringWeeks < 2 && values.roomId) {
        const roomId = Number(values.roomId);
        const room = roomsQuery.data?.rooms.find((x) => x.id === roomId);
        const roomLabel = room
          ? [room.name, room.building?.name, room.floor].filter(Boolean).join(' · ')
          : null;
        setConflictPayload({
          roomId,
          startTime: fromLocalInput(values.startTime).toISOString(),
          endTime: fromLocalInput(values.endTime).toISOString(),
          type: values.type,
          purpose: values.purpose?.trim() ?? undefined,
          roomLabel,
        });
        // Niente serverError inline: chiudiamo questo dialog e lasciamo
        // che sia il popup waitlist (sibling) a comunicare il conflict.
        setServerError(null);
        onOpenChange(false);
      } else {
        setConflictPayload(null);
        setServerError(httpErrorMessage(err));
      }
    },
  });

  const waitlistMutation = useMutation({
    mutationFn: () => {
      if (!conflictPayload) throw new Error('no_conflict_payload');
      const { roomId, startTime, endTime, type, purpose } = conflictPayload;
      return waitlistApi.join({ roomId, startTime, endTime, type, purpose });
    },
    onSuccess: (res) => {
      toast.success(t('waitlist.joined', { position: res.entry.position + 1 }));
      void qc.invalidateQueries({ queryKey: ['waitlist', 'me'] });
      // Il dialog principale è già chiuso; chiudiamo anche il popup waitlist.
      setConflictPayload(null);
    },
    onError: (err) => toast.error(httpErrorMessage(err)),
  });

  const onSubmit = (values: FormValues) => {
    setServerError(null);
    setConflictPayload(null);
    createMutation.mutate(values);
  };

  const dirtyClose = useDirtyDialogClose({
    isDirty,
    onClose: () => onOpenChange(false),
  });

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(o) => {
          if (o) onOpenChange(true);
          else dirtyClose.handleOpenChange();
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {isEdit
                ? t('booking.form.title_edit')
                : duplicateFrom
                  ? t('booking.form.title_duplicate')
                  : t('booking.form.title_new')}
            </DialogTitle>
            <DialogDescription>
              {duplicateFrom
                ? t('booking.form.title_duplicate_description')
                : t('booking.form.title_description')}
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
            {serverError && (
              <Alert variant="destructive">
                <AlertDescription>{serverError}</AlertDescription>
              </Alert>
            )}

            <div className="space-y-2">
              <Label>{t('booking.form.room')}</Label>
              <Select
                value={roomId}
                onValueChange={(v) => {
                  setValue('roomId', v, { shouldValidate: true });
                }}
                disabled={lockRoom ?? roomsQuery.isLoading}
              >
                <SelectTrigger
                  aria-invalid={!!errors.roomId}
                  aria-describedby={errors.roomId ? 'roomId-error' : undefined}
                >
                  <SelectValue
                    placeholder={
                      roomsQuery.isLoading
                        ? t('booking.form.room_loading')
                        : t('common.select_placeholder')
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {sortRoomsCrossBuilding(roomsQuery.data?.rooms ?? []).map((r) => (
                    <SelectItem key={r.id} value={String(r.id)}>
                      {r.name}
                      {r.building?.name ? ` · ${r.building.name}` : ''}
                      {r.floor ? ` · ${r.floor}` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FieldError id="roomId-error">
                {errors.roomId && tBookingError(errors.roomId.message)}
              </FieldError>
            </div>

            {/* Selettore "a nome di…" — solo admin. In create mode il default è
              il proprio profilo (self); in edit mode mostra l'owner corrente
              della booking e permette di riassegnarla. */}
            {isAdmin && (
              <div className="space-y-2">
                <Label>{t('booking.form.on_behalf_of')}</Label>
                <Select
                  value={onBehalfOfUserId ? String(onBehalfOfUserId) : 'self'}
                  onValueChange={(v) => {
                    setOnBehalfOfUserId(v === 'self' ? null : Number(v));
                  }}
                  disabled={usersQuery.isLoading}
                >
                  <SelectTrigger>
                    <SelectValue
                      placeholder={
                        usersQuery.isLoading
                          ? t('common.loading')
                          : t('booking.form.on_behalf_self')
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="self">{t('booking.form.on_behalf_self')}</SelectItem>
                    {(usersQuery.data?.users ?? [])
                      .filter((u) => u.id !== currentUser?.id)
                      .map((u) => (
                        <SelectItem key={u.id} value={String(u.id)}>
                          {u.lastName} {u.firstName}
                          {u.role === 'docente' ? ' · Doc' : u.role === 'studente' ? ' · Stud' : ''}
                          {u.email ? ` · ${u.email}` : ''}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="startTime">{t('booking.form.start')}</Label>
                <Input
                  id="startTime"
                  type="datetime-local"
                  {...register('startTime')}
                  aria-invalid={!!errors.startTime}
                  aria-describedby={errors.startTime ? 'startTime-error' : undefined}
                />
                <FieldError id="startTime-error">
                  {errors.startTime && tBookingError(errors.startTime.message)}
                </FieldError>
              </div>
              <div className="space-y-2">
                <Label htmlFor="endTime">{t('booking.form.end')}</Label>
                <Input
                  id="endTime"
                  type="datetime-local"
                  {...register('endTime')}
                  aria-invalid={!!errors.endTime}
                  aria-describedby={errors.endTime ? 'endTime-error' : undefined}
                />
                <FieldError id="endTime-error">
                  {errors.endTime && tBookingError(errors.endTime.message)}
                </FieldError>
              </div>
            </div>

            <div className="space-y-2">
              <Label>{t('booking.form.type_activity')}</Label>
              <Select
                value={type}
                onValueChange={(v) => {
                  setValue('type', v as BookingType, { shouldValidate: true });
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {/* Catalog admin-personalizzato (gap #7): label/color/icon
                      vengono dal DB e sono ridenominabili. Fallback alle
                      label statiche i18n se il catalog non è ancora caricato. */}
                  {typesQuery.data?.types && typesQuery.data.types.length > 0
                    ? typesQuery.data.types.map((c) => (
                        <SelectItem key={c.code} value={c.code}>
                          <span className="inline-flex items-center gap-2">
                            <span
                              className="inline-block h-2.5 w-2.5 rounded-full"
                              style={{ backgroundColor: c.color }}
                              aria-hidden="true"
                            />
                            {c.label}
                          </span>
                        </SelectItem>
                      ))
                    : BOOKING_TYPE_OPTIONS.map((o) => (
                        <SelectItem key={o.value} value={o.value}>
                          {t(o.labelKey)}
                        </SelectItem>
                      ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="purpose">{t('booking.form.purpose_title')}</Label>
              <Input
                id="purpose"
                placeholder={t('booking.form.purpose_placeholder_short')}
                maxLength={255}
                {...register('purpose')}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="notes">{t('booking.form.notes')}</Label>
              <Textarea
                id="notes"
                rows={3}
                placeholder={t('booking.form.notes_placeholder')}
                {...register('notes')}
              />
            </div>

            {/* Recurring — nascosto in edit mode: la booking esiste già e non
              ha senso "rendere ricorrente" un singolo record (sarebbe una
              nuova creazione). */}
            {!isEdit && (
              <div className="space-y-2 rounded-lg border bg-muted/30 p-3">
                <label className="flex cursor-pointer items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-input text-primary focus:ring-2 focus:ring-ring"
                    checked={recurringWeeks > 0}
                    onChange={(e) => {
                      setRecurringWeeks(e.target.checked ? 4 : 0);
                    }}
                  />
                  <span className="font-medium">{t('booking.form.recurring')}</span>
                </label>
                {recurringWeeks > 0 && (
                  <div className="flex items-center gap-2 pl-6 text-sm">
                    <span className="text-muted-foreground">{t('booking.form.weeks_per')}</span>
                    <Input
                      type="number"
                      min={2}
                      max={52}
                      value={recurringWeeks}
                      onChange={(e) => {
                        setRecurringWeeks(Math.max(2, Math.min(52, Number(e.target.value) || 2)));
                      }}
                      className="w-20"
                    />
                    <span className="text-muted-foreground">{t('booking.form.weeks')}</span>
                  </div>
                )}
                {recurringWeeks > 0 && (
                  <p className="pl-6 text-[11px] text-muted-foreground">
                    {t('booking.form.skip_conflicts')}
                  </p>
                )}
              </div>
            )}

            <DialogFooter className="flex-col items-stretch gap-2 pt-2 sm:flex-row sm:items-center sm:justify-between">
              {/* "Salva come template" è un'azione SECONDARIA: non crea una booking,
                serializza solo la combinazione (aula + giorno-della-settimana +
                orario + tipo + scopo) per riusarla via Quick Book sul Dashboard.
                Disabilitata se i campi necessari non sono ancora valorizzati.
                In edit mode è nascosta: si tratta di una booking esistente. */}
              {!isEdit ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setSaveAsTemplateOpen(true);
                  }}
                  disabled={isSubmitting || !roomId || !watch('startTime') || !watch('endTime')}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <Bookmark className="h-4 w-4" />
                  {t('booking.form.save_as_template')}
                </Button>
              ) : (
                <span />
              )}
              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={dirtyClose.handleOpenChange}
                  disabled={isSubmitting}
                >
                  {t('common.cancel')}
                </Button>
                <Button type="submit" disabled={isSubmitting}>
                  {isSubmitting ? (
                    <LoaderCircle className="h-4 w-4 animate-spin" />
                  ) : isEdit ? (
                    t('booking.form.submit_update')
                  ) : (
                    t('booking.form.submit_book')
                  )}
                </Button>
              </div>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Sub-dialog "Salva come template": prende solo nome + favorito.
        Il resto (room, giorno-della-settimana, orario, tipo, scopo) viene
        derivato dai valori CORRENTI del form principale al momento del salvataggio. */}
      <SaveAsTemplateDialog
        open={saveAsTemplateOpen}
        onOpenChange={setSaveAsTemplateOpen}
        currentValues={{
          roomId: roomId ? Number(roomId) : null,
          startTime: watch('startTime'),
          endTime: watch('endTime'),
          type,
          purpose: watch('purpose') ?? '',
        }}
      />

      {/* Popup waitlist: dialog SIBLING del Dialog principale (non figlio).
        Si apre quando la creazione fallisce con BOOKING_CONFLICT — a quel
        punto chiudiamo il Dialog di prenotazione e mostriamo solo questo
        popup, così l'attenzione dell'utente è focalizzata sulla scelta. */}
      <WaitlistOfferDialog
        payload={conflictPayload}
        loading={waitlistMutation.isPending}
        onConfirm={() => {
          waitlistMutation.mutate();
        }}
        onClose={() => {
          setConflictPayload(null);
        }}
      />

      {/* Conferma scarto modifiche non salvate (skill rule
       * `sheet-dismiss-confirm`): evita la perdita di dati su tap
       * accidentale fuori dal dialog o gesture back su mobile. */}
      <ConfirmDeleteDialog
        open={dirtyClose.confirmOpen}
        onOpenChange={dirtyClose.setConfirmOpen}
        title={t('common.discard_changes_title')}
        description={t('common.discard_changes_description')}
        confirmLabel={t('common.discard_changes_confirm')}
        onConfirm={dirtyClose.confirm}
      />
    </>
  );
}

// =====================================================
// Dialog di offerta waitlist
// =====================================================
//
// Si apre automaticamente quando il backend rifiuta una booking con code
// 'BOOKING_CONFLICT'. Mostra il riepilogo (aula + orari) e chiede all'utente
// se vuole iscriversi alla coda. Se sì, parte la mutation; al completamento
// il dialog si chiude e l'utente vede toast + card waitlist sulla Dashboard.
function WaitlistOfferDialog({
  payload,
  loading,
  onConfirm,
  onClose,
}: {
  payload: {
    roomId: number;
    startTime: string;
    endTime: string;
    type: BookingType;
    roomLabel: string | null;
  } | null;
  loading: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const open = !!payload;
  const start = payload ? new Date(payload.startTime) : null;
  const end = payload ? new Date(payload.endTime) : null;
  const fmt = (d: Date) =>
    d.toLocaleString(undefined, {
      weekday: 'short',
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !loading && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="inline-flex items-center gap-2">
            <ListChecks className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
            {t('waitlist.offer_dialog_title')}
          </DialogTitle>
          <DialogDescription>{t('waitlist.offer_dialog_description')}</DialogDescription>
        </DialogHeader>

        {payload && start && end && (
          <div className="space-y-2 rounded-lg border bg-muted/40 p-3 text-sm">
            {payload.roomLabel && (
              <div className="flex items-center gap-2">
                <span className="text-xs uppercase tracking-wider text-muted-foreground">
                  {t('booking.form.room')}
                </span>
                <span className="font-medium">{payload.roomLabel}</span>
              </div>
            )}
            <div className="text-xs text-muted-foreground">
              {fmt(start)} → {fmt(end)}
            </div>
          </div>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={loading}>
            {t('waitlist.offer_dialog_decline')}
          </Button>
          <Button type="button" onClick={onConfirm} disabled={loading}>
            {loading ? (
              <LoaderCircle className="h-4 w-4 animate-spin" />
            ) : (
              <ListChecks className="h-4 w-4" />
            )}
            {t('waitlist.offer_dialog_confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// =====================================================
// Sub-dialog "Salva come template"
// =====================================================
//
// Aperto dal pulsante secondario nel footer del BookingFormDialog. Riusa
// i valori CORRENTI del form principale (aula, orario, tipo, scopo) e
// chiede solo il nome + flag favorito. Il backend deriverà:
//   - dayOfWeek      = startTime.getDay()
//   - startMinutes   = ore*60 + minuti di startTime
//   - durationMinutes = (endTime - startTime) in minuti
function SaveAsTemplateDialog({
  open,
  onOpenChange,
  currentValues,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentValues: {
    roomId: number | null;
    startTime: string;
    endTime: string;
    type: BookingType;
    purpose: string;
  };
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [isFavorite, setIsFavorite] = useState(false);

  useEffect(() => {
    if (open) {
      setName('');
      setIsFavorite(false);
    }
  }, [open]);

  const saveMutation = useMutation({
    mutationFn: () => {
      if (!currentValues.roomId) throw new Error('no_room');
      const start = fromLocalInput(currentValues.startTime);
      const end = fromLocalInput(currentValues.endTime);
      const durationMinutes = Math.max(1, Math.round((end.getTime() - start.getTime()) / 60000));
      return bookingTemplatesApi.create({
        name: name.trim(),
        roomId: currentValues.roomId,
        dayOfWeek: start.getDay(),
        startMinutes: start.getHours() * 60 + start.getMinutes(),
        durationMinutes,
        type: currentValues.type,
        purpose: currentValues.purpose.trim() || null,
        isFavorite,
      });
    },
    onSuccess: (res) => {
      toast.success(t('booking.template.saved_toast', { name: res.template.name }));
      void qc.invalidateQueries({ queryKey: ['booking-templates'] });
      onOpenChange(false);
    },
    onError: (err) => toast.error(httpErrorMessage(err)),
  });

  const canSave = name.trim().length > 0 && currentValues.roomId != null && !saveMutation.isPending;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!saveMutation.isPending) onOpenChange(o);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="inline-flex items-center gap-2">
            <Bookmark className="h-5 w-5 text-primary" />
            {t('booking.template.save_dialog_title')}
          </DialogTitle>
          <DialogDescription>{t('booking.template.save_dialog_description')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="tpl-name">{t('booking.template.name_label')}</Label>
            <Input
              id="tpl-name"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
              }}
              placeholder={t('booking.template.name_placeholder')}
              maxLength={100}
              autoFocus
            />
          </div>

          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-input text-primary focus:ring-2 focus:ring-ring"
              checked={isFavorite}
              onChange={(e) => {
                setIsFavorite(e.target.checked);
              }}
            />
            <span>{t('booking.template.favorite_label')}</span>
          </label>
          <p className="text-[11px] text-muted-foreground">{t('booking.template.favorite_hint')}</p>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              onOpenChange(false);
            }}
            disabled={saveMutation.isPending}
          >
            {t('common.cancel')}
          </Button>
          <Button
            type="button"
            onClick={() => {
              saveMutation.mutate();
            }}
            disabled={!canSave}
          >
            {saveMutation.isPending ? (
              <LoaderCircle className="h-4 w-4 animate-spin" />
            ) : (
              <Bookmark className="h-4 w-4" />
            )}
            {t('booking.template.save_button')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
