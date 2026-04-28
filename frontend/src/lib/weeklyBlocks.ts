import type { PublicBooking } from '@/api/public';
import type { Booking } from '@/types';
import type { WeeklyBlock } from '@/components/bookings/WeeklyRoomTimetable';

// ============================================================================
// Helpers per derivare i blocchi della WeeklyRoomTimetable da:
//   - Booking auth (Dashboard) → ha user e (talvolta) concertInfo
//   - PublicBooking kiosk → ha bookedBy (anonimizzato) e concertTitle
//
// Etichette dei blocchi seguono le regole concordate (in ordine di priorità):
//   - concerto              → titolo concerto (fallback purpose)
//   - admin (qualsiasi tipo) → "Direzione"   ← priorità sulla regola lezione,
//                                              così prenotazioni di sistema
//                                              (es. utente "Sistema") non si
//                                              presentano come "Prof. Sistema"
//   - lezione + docente     → "Prof. {cognome}" (se cognome univoco nella
//                              vista corrente) oppure "Prof. {iniziale}. {cognome}"
//                              quando più docenti condividono lo stesso cognome
//                              ("Prof. M. Rossi" vs "Prof. L. Rossi"). Se anche
//                              le iniziali coincidono (Mario Rossi + Marco Rossi)
//                              fallback al nome completo: "Prof. Mario Rossi".
//   - lezione (altro ruolo) → "Prof." (fallback senza cognome)
//   - altre attività docente  → "Doc"
//   - altre attività studente → "Stud"
// ============================================================================

/**
 * Calcola, per un set di docenti potenzialmente omonimi sul cognome, il
 * **prefisso minimo univoco** del nome da anteporre al cognome. Algoritmo:
 *
 *  1. Raggruppa i docenti per cognome (case-insensitive trim).
 *  2. Per ciascun gruppo:
 *     - se contiene un solo nome distinto → nessun prefisso (chiave non in mappa)
 *     - prova prefisso 1 lettera (iniziale): se tutti i nomi del gruppo hanno
 *       inizial diversa → usa "X." come prefisso
 *     - se ≥ 2 nomi condividono la stessa iniziale (es. Mario, Marco) →
 *       fallback al nome COMPLETO per quei nomi (es. "Mario", "Marco")
 *
 * La chiave della mappa di output è `${lastName.trim().toLowerCase()}::${firstName.trim()}`
 * per evitare collisioni tra cognomi simili e supportare lookup deterministico.
 *
 * @returns Map vuota se non c'è alcun cognome ambiguo (caso comune).
 */
export function buildTeacherDisambiguation(
  teachers: { firstName: string | null | undefined; lastName: string | null | undefined }[],
): Map<string, string> {
  const result = new Map<string, string>();
  if (teachers.length === 0) return result;

  // Raggruppa nomi per cognome normalizzato.
  const byLastName = new Map<string, Set<string>>();
  for (const t of teachers) {
    const ln = t.lastName?.trim();
    const fn = t.firstName?.trim();
    if (!ln || !fn) continue;
    const key = ln.toLowerCase();
    if (!byLastName.has(key)) byLastName.set(key, new Set());
    byLastName.get(key)?.add(fn);
  }

  for (const [lnKey, firstNames] of byLastName) {
    if (firstNames.size <= 1) continue; // un solo docente con questo cognome → niente prefisso
    // Prova iniziali (1 lettera).
    const byInitial = new Map<string, string[]>();
    for (const fn of firstNames) {
      // fn is guaranteed non-empty (filtered above): fn[0] is defined.
      const init = fn.charAt(0).toUpperCase();
      if (!byInitial.has(init)) byInitial.set(init, []);
      byInitial.get(init)?.push(fn);
    }
    for (const [initial, names] of byInitial) {
      if (names.length === 1) {
        // Iniziale univoca → usa "M."
        result.set(`${lnKey}::${names[0]}`, `${initial}.`);
      } else {
        // Più nomi con stessa iniziale (es. Mario+Marco) → usa nome completo.
        for (const fn of names) {
          result.set(`${lnKey}::${fn}`, fn);
        }
      }
    }
  }
  return result;
}

function buildTeacherLabel(
  firstName: string | null | undefined,
  lastName: string | null | undefined,
  disambiguation: Map<string, string>,
): string {
  const ln = lastName?.trim();
  if (!ln) return 'Prof.';
  const fn = firstName?.trim();
  if (!fn) return `Prof. ${ln}`;
  const key = `${ln.toLowerCase()}::${fn}`;
  const prefix = disambiguation.get(key);
  return prefix ? `Prof. ${prefix} ${ln}` : `Prof. ${ln}`;
}

function labelFromRole(
  role: 'docente' | 'studente' | 'admin' | undefined,
  type: Booking['type'],
  firstName: string | null | undefined,
  lastName: string | null | undefined,
  disambiguation: Map<string, string>,
): string {
  // Admin: sempre "Direzione" (anche per type=lezione). L'admin che prenota
  // un'aula non è un docente individuale ma un atto istituzionale.
  if (role === 'admin') return 'Direzione';
  // Lezione (non-admin): "Prof. {cognome}" o "Prof. M. {cognome}" se ambiguo.
  if (type === 'lezione') {
    return buildTeacherLabel(firstName, lastName, disambiguation);
  }
  if (role === 'docente') return 'Doc';
  if (role === 'studente') return 'Stud';
  return '';
}

function nonEmpty(s: string | null | undefined): string | null {
  const t = s?.trim();
  return t && t.length > 0 ? t : null;
}

/**
 * Soglia di durata (minuti) sotto la quale l'etichetta di tipologia viene
 * abbreviata a un singolo carattere per evitare clipping/truncation visivo
 * sul calendario kiosk.
 *
 * Razionale: a 30/60/90 min (1-3 slot da 30') la cella diventa stretta
 * (~12-36px sul kiosk FHD a 6 colonne giorno) e parole come "Concerto" o
 * "Studio" non ci stanno, finiscono troncate ad ellissi → illeggibili.
 *
 * **Le lezioni sono escluse** dalla regola: il vincolo del seed (≥ 5h)
 * garantisce sempre spazio sufficiente per "Prof. M. Rossi".
 */
const SHORT_LABEL_MIN_MINUTES = 120;

function durationMinutes(start: string, end: string): number {
  return Math.max(0, (new Date(end).getTime() - new Date(start).getTime()) / 60000);
}

function shortLabelFor(
  type: Booking['type'],
  durMin: number,
  role: 'docente' | 'studente' | 'admin' | undefined,
): string | null {
  // Lezioni: mai abbreviato (regola esplicita del prodotto).
  if (type === 'lezione') return null;
  // Admin "Direzione" = etichetta canonica corta, ma sempre informativa →
  // non sostituiamo con un singolo carattere.
  if (role === 'admin') return null;
  // Larghezza sufficiente → label completa.
  if (durMin >= SHORT_LABEL_MIN_MINUTES) return null;
  if (type === 'studio_individuale') return 'S';
  if (type === 'prova') return 'P';
  if (type === 'concerto') return 'C';
  return null;
}

// ============================================================================
// Single-booking transformers — accettano una mappa di disambiguazione che
// può essere vuota se non si conoscono altri docenti (caso 1 booking isolato).
// ============================================================================

export function bookingToBlock(
  b: Booking,
  disambiguation = new Map<string, string>(),
): WeeklyBlock {
  const dur = durationMinutes(b.startTime, b.endTime);
  const short = shortLabelFor(b.type, dur, b.user?.role);
  let label: string;
  if (short) {
    label = short;
  } else if (b.type === 'concerto') {
    label = nonEmpty(b.concertInfo?.title) ?? nonEmpty(b.purpose) ?? 'Concerto';
  } else {
    label = labelFromRole(
      b.user?.role,
      b.type,
      b.user?.firstName ?? null,
      b.user?.lastName ?? null,
      disambiguation,
    );
  }
  return {
    id: b.id,
    roomId: b.roomId,
    startTime: b.startTime,
    endTime: b.endTime,
    type: b.type,
    label,
    tooltip: b.user
      ? `${b.user.firstName} ${b.user.lastName}${b.purpose ? ` · ${b.purpose}` : ''}`
      : (b.purpose ?? undefined),
  };
}

export function publicBookingToBlock(
  b: PublicBooking,
  roomId: number,
  disambiguation = new Map<string, string>(),
): WeeklyBlock {
  // Display kiosk: per le tipologie non-lezione mostriamo SEMPRE l'abbreviazione
  // a singolo carattere (S/P/C), indipendentemente dalla durata. Le lezioni
  // mantengono la label "Prof. {Cognome}" (o "Direzione" per admin) perché
  // l'identità del docente è informazione utile per chi consulta il tabellone.
  let label: string;
  if (b.type === 'studio_individuale') {
    label = 'S';
  } else if (b.type === 'prova') {
    label = 'P';
  } else if (b.type === 'concerto') {
    label = 'C';
  } else {
    label = labelFromRole(
      b.bookedBy?.role,
      b.type,
      b.bookedBy?.firstName ?? null,
      b.bookedBy?.lastName ?? null,
      disambiguation,
    );
  }
  return {
    id: b.id,
    roomId,
    startTime: b.startTime,
    endTime: b.endTime,
    type: b.type,
    label,
    tooltip: b.bookedBy
      ? `${b.bookedBy.displayName}${b.purpose ? ` · ${b.purpose}` : ''}`
      : (b.purpose ?? undefined),
  };
}

// ============================================================================
// Bulk transformers — wrapper "intelligenti" che calcolano la mappa di
// disambiguazione dall'intero set di prenotazioni e poi mappano ogni booking.
// È il punto d'ingresso da preferire per Dashboard e Display kiosk: garantisce
// che i cognomi omonimi vengano risolti coerentemente in tutta la vista.
// ============================================================================

export function bookingsToBlocks(bookings: Booking[]): WeeklyBlock[] {
  const teachers = bookings
    .filter((b) => b.type === 'lezione' && b.user?.role === 'docente')
    .map((b) => ({
      firstName: b.user?.firstName ?? null,
      lastName: b.user?.lastName ?? null,
    }));
  const map = buildTeacherDisambiguation(teachers);
  return bookings.map((b) => bookingToBlock(b, map));
}

export function publicBookingsToBlocks(
  pairs: { booking: PublicBooking; roomId: number }[],
): WeeklyBlock[] {
  const teachers = pairs
    .filter(({ booking }) => booking.type === 'lezione' && booking.bookedBy?.role === 'docente')
    .map(({ booking }) => ({
      firstName: booking.bookedBy?.firstName ?? null,
      lastName: booking.bookedBy?.lastName ?? null,
    }));
  const map = buildTeacherDisambiguation(teachers);
  return pairs.map(({ booking, roomId }) => publicBookingToBlock(booking, roomId, map));
}
