import { useCallback, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { bookingsApi } from '@/api/bookings';
import { waitlistApi } from '@/api/waitlist';
import { useAuth } from '@/contexts/AuthContext';
import { httpErrorMessage, HttpError } from '@/lib/api';
import { fromLocalInput } from '@/lib/date';
import { emptyRecurrence, type RecurrenceState } from '@/lib/recurrence';
import type { Booking, BookingConflictsWith, BookingSuggestion, BookingType } from '@/types';
import type { BookingFormValues as FormValues } from './bookingFormSchema';
import { useBookingFormData } from './useBookingFormData';

interface Options {
  open: boolean;
  booking?: Booking | null;
  onOpenChange: (open: boolean) => void;
  onCreated?: () => void;
}

/** API calls and their feedback; field values and rendering stay in the form. */
export function useBookingSubmission({ open, booking, onOpenChange, onCreated }: Options) {
  const qc = useQueryClient();
  const { t } = useTranslation();
  const { user: currentUser } = useAuth();
  const isAdmin = currentUser?.role === 'admin';
  const { roomsQuery, typesQuery, usersQuery } = useBookingFormData(open, isAdmin);
  const [recurrence, setRecurrence] = useState<RecurrenceState>(() => emptyRecurrence());
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
  // §2.11 Slot alternativi: se il backend invia `suggestions` nel 409 le
  // mostriamo INLINE sopra il form; il popup waitlist resta solo per il caso
  // suggestions vuoto (vedi onError).
  const [suggestions, setSuggestions] = useState<BookingSuggestion[]>([]);
  const [conflictsWith, setConflictsWith] = useState<BookingConflictsWith | null>(null);

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
        isAdmin && onBehalfOfUserId && onBehalfOfUserId !== currentUser.id
          ? { onBehalfOfUserId }
          : {};
      if (recurrence.enabled) {
        // startDate del payload = data della prima occorrenza (presa da
        // startTime locale). endDate è scelto dall'utente nel form.
        const startDate = fromLocalInput(values.startTime).toISOString().slice(0, 10);
        const res = await bookingsApi.createRecurring({
          ...payload,
          ...onBehalf,
          recurrence: {
            frequency: recurrence.frequency,
            interval: recurrence.interval,
            byWeekday:
              recurrence.frequency === 'weekly' && recurrence.byWeekday.length > 0
                ? recurrence.byWeekday
                : null,
            startDate,
            endDate: recurrence.endDate,
            excludeDates: recurrence.excludeDates,
          },
          skipConflicts: recurrence.skipConflicts,
        });
        return { kind: 'recurring', created: res.createdCount, skipped: res.skipped };
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
      // RECURRENCE_CONFLICTS (409): la serie aveva date in conflitto e
      // l'utente NON aveva attivato skipConflicts. Mostriamo un toast con
      // CTA che ri-sottomette automaticamente con skipConflicts=true.
      // (Se skipConflicts era già on, il backend ritorna 201 con conflicts[]
      // dentro la response normale, non un errore.)
      const code = err instanceof HttpError ? err.payload.code : undefined;
      if (code === 'RECURRENCE_CONFLICTS' && recurrence.enabled) {
        const payload = err instanceof HttpError ? err.payload : null;
        const conflicts = (payload as { conflicts?: unknown[] } | null)?.conflicts ?? [];
        const validCount = (payload as { validCount?: number } | null)?.validCount ?? 0;
        toast.error(
          t('booking.form.recurring_conflicts_title', {
            count: conflicts.length,
          }),
          {
            description: t('booking.form.recurring_conflicts_description', {
              valid: validCount,
            }),
            action: {
              label: t('booking.form.recurring_conflicts_action'),
              onClick: () => {
                setRecurrence((prev) => ({ ...prev, skipConflicts: true }));
                // Re-submit con il flag attivato
                createMutation.mutate(values);
              },
            },
            duration: 10000,
          },
        );
        return;
      }
      // Estraggo BOOKING_CONFLICT (anche EXCLUSION_VIOLATION lato DB-level)
      // per offrire l'opzione waitlist o, da §2.11, slot alternativi inline.
      // Considero solo le creazioni single (la ricorrente ha skipped[] separato).
      const isConflict = code === 'BOOKING_CONFLICT' || code === 'EXCLUSION_VIOLATION';
      if (isConflict && !recurrence.enabled && values.roomId) {
        const payload = err instanceof HttpError ? err.payload : null;
        const incomingSuggestions = payload?.suggestions ?? [];
        const incomingConflict = payload?.conflictsWith ?? null;

        if (incomingSuggestions.length > 0) {
          // §2.11: mostra le alternative INLINE; non chiudere il dialog,
          // non aprire il popup waitlist. L'utente clicca una chip e
          // ri-conferma il form. Il bottone waitlist resta accessibile in
          // fondo (popup) come fallback se nessuna alternativa convince.
          setSuggestions(incomingSuggestions);
          setConflictsWith(incomingConflict);
          setConflictPayload(null);
          setServerError(null);
          return;
        }

        // Nessuna alternativa: comportamento pre-§2.11 (popup waitlist).
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
        setSuggestions([]);
        setConflictsWith(null);
        setServerError(null);
        onOpenChange(false);
      } else {
        setConflictPayload(null);
        setSuggestions([]);
        setConflictsWith(null);
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
    setSuggestions([]);
    setConflictsWith(null);
    createMutation.mutate(values);
  };

  const clearSuggestions = useCallback(() => {
    setSuggestions([]);
    setConflictsWith(null);
  }, []);

  const resetSubmission = useCallback((ownerId: number | null) => {
    setServerError(null);
    setSuggestions([]);
    setConflictsWith(null);
    setOnBehalfOfUserId(ownerId);
    setRecurrence(emptyRecurrence());
  }, []);

  return {
    currentUser,
    roomsQuery,
    typesQuery,
    usersQuery,
    serverError,
    conflictPayload,
    dismissWaitlist: () => setConflictPayload(null),
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
  };
}
