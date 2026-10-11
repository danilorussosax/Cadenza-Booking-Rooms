import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Bookmark, LoaderCircle } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { BOOKING_TYPE_OPTIONS } from '@/lib/bookings';
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
import { bookingFormSchema, type BookingFormValues as FormValues } from './bookingFormSchema';
import { useBookingSubmission } from './useBookingSubmission';
import { RecurrenceForm } from './RecurrenceForm';
import { SaveAsTemplateDialog } from './SaveAsTemplateDialog';
import { WaitlistOfferDialog } from './WaitlistOfferDialog';
import { BookingRuleHint } from './BookingRuleHint';
import { BookingSuggestionsPanel } from './BookingSuggestionsPanel';
import type { Booking, BookingSuggestion, BookingType } from '@/types';

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
  const { t } = useTranslation();
  const isEdit = !!booking;
  const {
    currentUser,
    roomsQuery,
    typesQuery,
    usersQuery,
    serverError,
    conflictPayload,
    dismissWaitlist,
    suggestions,
    conflictsWith,
    clearSuggestions,
    resetSubmission,
    onBehalfOfUserId,
    setOnBehalfOfUserId,
    recurrence,
    setRecurrence,
    waitlistMutation,
    onSubmit,
  } = useBookingSubmission({ open, booking, onOpenChange, onCreated });
  const isAdmin = currentUser?.role === 'admin';
  const tBookingError = (key?: string) => (key ? t(`booking.form_validation.${key}`) : undefined);

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
    resolver: zodResolver(bookingFormSchema),
    defaultValues: initialValues,
  });

  // Re-seed when the dialog opens with new defaults
  useEffect(() => {
    if (open) {
      reset(initialValues);
      resetSubmission(booking ? booking.userId : null);
    }
  }, [open, initialValues, reset, booking, resetSubmission]);

  const roomId = watch('roomId');
  const type = watch('type');

  const [saveAsTemplateOpen, setSaveAsTemplateOpen] = useState(false);

  // Data YYYY-MM-DD della prima occorrenza, derivata dal campo startTime del
  // form. Serve a `RecurrenceForm` per il preview live (espande in locale
  // la regola partendo da questa data) e a vincolare il `min` di endDate.
  const startTimeWatch = watch('startTime');
  const recurrenceStartDate = useMemo(() => {
    if (!startTimeWatch) return '';
    try {
      return fromLocalInput(startTimeWatch).toISOString().slice(0, 10);
    } catch {
      return '';
    }
  }, [startTimeWatch]);

  // Applica un suggerimento al form (pre-compila roomId/startTime/endTime,
  // mantenendo type/purpose già impostati dall'utente) e azzera la lista
  // di suggestion così la UI torna pulita. L'utente conferma con "Prenota".
  const applySuggestion = (s: BookingSuggestion) => {
    setValue('roomId', String(s.roomId), { shouldValidate: true, shouldDirty: true });
    setValue('startTime', toLocalDateTimeInput(new Date(s.startTime)), {
      shouldValidate: true,
      shouldDirty: true,
    });
    setValue('endTime', toLocalDateTimeInput(new Date(s.endTime)), {
      shouldValidate: true,
      shouldDirty: true,
    });
    clearSuggestions();
    toast.info(t('booking.suggestions.applied'));
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

            {suggestions.length > 0 && (
              <BookingSuggestionsPanel
                suggestions={suggestions}
                rooms={roomsQuery.data?.rooms ?? []}
                onPick={applySuggestion}
                disabled={isSubmitting}
                conflictOwner={conflictsWith?.ownerLabel ?? null}
              />
            )}

            {/* Hint sui limiti del ruolo (durata, anticipo, fascia oraria,
                quote): nascosto agli admin, fetcha la BookingRule del ruolo
                dell'utente corrente e la sintetizza in 4-6 bullet point. */}
            {currentUser && <BookingRuleHint role={currentUser.role} />}

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
                      .filter((u) => u.id !== currentUser.id)
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
              nuova creazione). Form completo con frequency, byWeekday,
              endDate, excludeDates, skipConflicts e preview live. */}
            {!isEdit && (
              <RecurrenceForm
                value={recurrence}
                onChange={setRecurrence}
                startDate={recurrenceStartDate}
              />
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
        onClose={dismissWaitlist}
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
