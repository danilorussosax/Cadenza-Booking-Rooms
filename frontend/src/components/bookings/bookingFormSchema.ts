import { z } from 'zod';
import { fromLocalInput } from '@/lib/date';

// Floor specifico per le prenotazioni di tipo "studio individuale" (vedi
// STUDIO_MIN_DURATION_MINUTES in services/bookingValidator.js): 1 ora minima
// per evitare frammentazione delle aule in slot troppo brevi. Replicato qui
// per dare feedback immediato nel form prima del submit.
const STUDIO_MIN_DURATION_MINUTES = 60;

// I messaggi sono "chiavi" (es. 'room_required') tradotte runtime via i18n.
export const bookingFormSchema = z
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

export type BookingFormValues = z.infer<typeof bookingFormSchema>;
