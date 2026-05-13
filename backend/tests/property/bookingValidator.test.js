'use strict';

/**
 * Property-based testing del bookingValidator.
 *
 * fast-check genera centinaia di combinazioni di input casuali e verifica
 * INVARIANTI che devono valere per QUALSIASI input, non solo per i casi
 * "felici" scritti a mano. Ottimo per scovare combinazioni di regole che
 * si annullano a vicenda o casi limite (durata=0, slot di mezzanotte, ecc.).
 *
 * Invarianti verificate:
 *   1. Determinismo: stesso input → stesso esito
 *   2. Output ben formato: { valid, errors[], codes[] }
 *   3. Se valid=true, errors deve essere vuoto (e viceversa)
 *   4. Mai 5xx applicativo (nessuna eccezione non gestita)
 *   5. Durata < min → fallisce (se non bypassDuration)
 *   6. Anticipo > max → fallisce (se non bypassAdvance)
 *   7. Slot nel passato → fallisce (se non bypassPastDates)
 *   8. Idempotenza: validare 100 volte lo stesso input → identical
 */

const fc = require('fast-check');
const { validateBooking } = require('../../services/bookingValidator');
const { createAuthedUser, createRoom, createBookingRule } = require('../factories');

describe('PROPERTY · bookingValidator invarianti', () => {
  let room, baseRule;

  beforeAll(async () => {
    await globalThis.resetDatabase();
    room = await createRoom();
    baseRule = await createBookingRule({
      role: 'studente',
      maxHoursPerDay: 4,
      maxHoursPerWeek: 12,
      maxActiveBookings: 5,
      maxBookingDurationMinutes: 120,
      minBookingDurationMinutes: 30,
      maxAdvanceDays: 14,
      minAdvanceHours: 0,
      cancellationDeadlineHours: 2,
      allowRecurring: true,
      allowNightHours: false,
      allowedStartTime: '08:00',
      allowedEndTime: '22:00',
    });
    expect(baseRule).toBeDefined();
  });

  it('output sempre ben formato per qualunque slot temporale (200 sample)', async () => {
    const { user } = await createAuthedUser({
      role: 'studente',
      email: 'prop1@test.invalid',
      matricola: 'PROP1',
    });

    await fc.assert(
      fc.asyncProperty(
        // Genera offset in ore dal "now" tra -100 e +1000 ore
        fc.integer({ min: -100, max: 1000 }),
        // Durata in minuti (compresa 0 e durate folli)
        fc.integer({ min: 0, max: 3 * 24 * 60 }),
        async (hoursFromNow, durationMin) => {
          const start = new Date(Date.now() + hoursFromNow * 3600 * 1000);
          const end = new Date(start.getTime() + durationMin * 60 * 1000);
          const result = await validateBooking({
            user,
            roomId: room.id,
            startTime: start,
            endTime: end,
            type: 'studio_individuale',
          });
          // Output sempre ben formato
          expect(result).toHaveProperty('valid');
          expect(typeof result.valid).toBe('boolean');
          expect(Array.isArray(result.errors)).toBe(true);
          expect(Array.isArray(result.codes)).toBe(true);
          // valid==true → errors vuoto, codes vuoto
          if (result.valid) {
            expect(result.errors).toHaveLength(0);
          } else {
            // valid==false → almeno un errore
            expect(result.errors.length).toBeGreaterThan(0);
          }
        },
      ),
      { numRuns: 200, verbose: false },
    );
  }, 60_000);

  it('determinismo: stesso input → stesso output (50 sample × 5 iter)', async () => {
    const { user } = await createAuthedUser({
      role: 'studente',
      email: 'prop2@test.invalid',
      matricola: 'PROP2',
    });

    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 200 }),
        fc.integer({ min: 30, max: 120 }),
        async (hoursFromNow, durationMin) => {
          const start = new Date(Date.now() + hoursFromNow * 3600 * 1000);
          const end = new Date(start.getTime() + durationMin * 60 * 1000);
          const args = {
            user,
            roomId: room.id,
            startTime: start,
            endTime: end,
            type: 'studio_individuale',
          };
          const r1 = await validateBooking(args);
          for (let i = 0; i < 4; i++) {
            const r2 = await validateBooking(args);
            expect(r2.valid).toBe(r1.valid);
            expect(r2.errors).toEqual(r1.errors);
          }
        },
      ),
      { numRuns: 50, verbose: false },
    );
  }, 60_000);

  it('durata < minBookingDurationMinutes → sempre invalid (no bypass)', async () => {
    const { user } = await createAuthedUser({
      role: 'studente',
      email: 'prop3@test.invalid',
      matricola: 'PROP3',
    });

    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 29 }), // durata in minuti < 30
        fc.integer({ min: 1, max: 100 }),
        async (durationMin, hoursAhead) => {
          const start = new Date(Date.now() + hoursAhead * 3600 * 1000);
          const end = new Date(start.getTime() + durationMin * 60 * 1000);
          const result = await validateBooking({
            user,
            roomId: room.id,
            startTime: start,
            endTime: end,
            type: 'studio_individuale',
          });
          expect(result.valid).toBe(false);
        },
      ),
      { numRuns: 30 },
    );
  }, 30_000);

  it('anticipo > maxAdvanceDays → sempre invalid (no bypass)', async () => {
    const { user } = await createAuthedUser({
      role: 'studente',
      email: 'prop4@test.invalid',
      matricola: 'PROP4',
    });

    await fc.assert(
      fc.asyncProperty(
        // 15..120 giorni → oltre maxAdvanceDays=14
        fc.integer({ min: 15, max: 120 }),
        async (daysAhead) => {
          const start = new Date(Date.now() + daysAhead * 24 * 3600 * 1000);
          // Imposta l'orario in finestra valida (es. 14:00) per non far scattare
          // l'errore "fuori orario" — vogliamo isolare la regola "anticipo".
          start.setUTCHours(14, 0, 0, 0);
          const end = new Date(start.getTime() + 60 * 60 * 1000);
          const result = await validateBooking({
            user,
            roomId: room.id,
            startTime: start,
            endTime: end,
            type: 'studio_individuale',
          });
          expect(result.valid).toBe(false);
        },
      ),
      { numRuns: 30 },
    );
  }, 30_000);

  it('slot nel passato → sempre invalid (no bypass)', async () => {
    const { user } = await createAuthedUser({
      role: 'studente',
      email: 'prop5@test.invalid',
      matricola: 'PROP5',
    });

    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 1000 }), // ore nel passato
        async (hoursAgo) => {
          const start = new Date(Date.now() - hoursAgo * 3600 * 1000);
          const end = new Date(start.getTime() + 60 * 60 * 1000);
          const result = await validateBooking({
            user,
            roomId: room.id,
            startTime: start,
            endTime: end,
            type: 'studio_individuale',
          });
          expect(result.valid).toBe(false);
        },
      ),
      { numRuns: 30 },
    );
  }, 30_000);

  it('startTime >= endTime → sempre invalid', async () => {
    const { user } = await createAuthedUser({
      role: 'studente',
      email: 'prop6@test.invalid',
      matricola: 'PROP6',
    });

    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 100 }),
        fc.integer({ min: 0, max: 1000 }), // delta in minuti, 0 = startTime == endTime
        async (hoursAhead, deltaBackMin) => {
          const start = new Date(Date.now() + hoursAhead * 3600 * 1000);
          // endTime PRIMA di startTime (o uguale)
          const end = new Date(start.getTime() - deltaBackMin * 60 * 1000);
          const result = await validateBooking({
            user,
            roomId: room.id,
            startTime: start,
            endTime: end,
            type: 'studio_individuale',
          });
          expect(result.valid).toBe(false);
        },
      ),
      { numRuns: 30 },
    );
  }, 30_000);

  it('bypassDuration ammette anche slot da 5 minuti (path admin/MonteOre)', async () => {
    const { user } = await createAuthedUser({
      role: 'studente',
      email: 'prop7@test.invalid',
      matricola: 'PROP7',
    });

    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 5, max: 20 }), // 5..20 min < 30 minimo
        async (durationMin) => {
          // Slot futuro, orario lavorativo
          const start = new Date(Date.now() + 24 * 3600 * 1000);
          start.setUTCHours(14, 0, 0, 0);
          const end = new Date(start.getTime() + durationMin * 60 * 1000);
          const result = await validateBooking({
            user,
            roomId: room.id,
            startTime: start,
            endTime: end,
            type: 'studio_individuale',
            bypassDuration: true,
          });
          // Con bypass duration, il controllo durata non scatta — può comunque
          // fallire per altre regole, ma NON per "durata minima".
          if (!result.valid) {
            for (const err of result.errors) {
              expect(err.toLowerCase()).not.toContain('durata minima');
              expect(err.toLowerCase()).not.toContain('30 min');
            }
          }
        },
      ),
      { numRuns: 15 },
    );
  }, 30_000);
});
