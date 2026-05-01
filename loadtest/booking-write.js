// =============================================================================
// SCENARIO 3 — Scrittura prenotazioni (CREATE + DELETE).
//
// Cosa simula:
//   Utenti che prenotano un'aula libera e poi annullano. Stressa la
//   transazione di POST /api/bookings (validateBooking + audit log +
//   email reminder hook) — il path più costoso dell'app.
//
// Strategia anti-collisione (senza dirty data):
//   ogni VU si attribuisce uno SLOT logico unico = (vuId, iter):
//     startTime = nextSundayMidnight + (vuId * 30min) + (iter * 15min)
//   Sundays + slot di 15 min molto avanti nel futuro = niente
//   intersezione coi dati reali.
//   Subito dopo il POST viene cancellato (DELETE /api/bookings/:id) per
//   non lasciare residuo nel DB.
//
// Run:
//   ROOM_ID=... USER_EMAIL=... USER_PASSWORD=... \
//     k6 run --env BASE_URL=http://82.165.110.193:3000 --env TIER=low \
//            --env USER_EMAIL=$USER_EMAIL --env USER_PASSWORD=$USER_PASSWORD \
//            --env ROOM_ID=$ROOM_ID loadtest/booking-write.js
//
// PREREQUISITI:
//   - utente di test SENZA 2FA, status=approved
//   - ROOM_ID = id di un'aula bookable, NON requiresApproval (altrimenti
//     ogni POST nasce in pending_approval)
//   - tier=low di default: la scrittura è 1 ordine di grandezza più
//     costosa della lettura, non spingere oltre se non in finestra
//     dedicata
//   - domeniche future libere nei prossimi 6 mesi (lo sono per default)
//
// SOFT FAIL ATTESI: 400 BOOKING_INVALID se due VU finiscono sullo stesso
// slot per timing sfortunato. Sono trattati come fallimento "atteso" e
// non rompono la threshold http_req_failed{expected:true}.
// =============================================================================

import http from 'k6/http';
import { check, group, fail } from 'k6';
import { Counter } from 'k6/metrics';
import { tier } from './lib/tiers.js';
import { thresholdsFor } from './lib/thresholds.js';
import { login, authHeaders } from './lib/auth.js';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
const ROOM_ID = Number(__ENV.ROOM_ID || 0);
const T = tier();

if (!ROOM_ID) {
  // Validato qui per evitare 100% fallimenti silenziosi.
  throw new Error('Imposta --env ROOM_ID=<id-aula> (intero, aula bookable senza requiresApproval)');
}

const collisions = new Counter('booking_collisions');
const created = new Counter('booking_created');
const deleted = new Counter('booking_deleted');

export const options = {
  scenarios: {
    booking_write: {
      executor: 'constant-arrival-rate',
      rate: T.write.rate,
      timeUnit: '1s',
      duration: T.write.duration,
      preAllocatedVUs: T.write.preAllocatedVUs,
      maxVUs: T.write.maxVUs,
    },
  },
  thresholds: {
    ...thresholdsFor(),
    booking_collisions: ['count<50'],   // collisioni di slot tra VU concorrenti
  },
  tags: { tier: T.label, scenario: 'booking-write' },
};

export function setup() {
  return login(BASE_URL, __ENV.USER_EMAIL, __ENV.USER_PASSWORD);
}

// Trova la prossima domenica >= oggi+7 (margine per evitare regole
// "anticipo minimo" presenti in bookingValidator).
function nextFreeSundayPlus(daysAhead) {
  const base = new Date(Date.now() + daysAhead * 86400_000);
  const dow = base.getUTCDay();
  const offset = (7 - dow) % 7 || 7;
  base.setUTCDate(base.getUTCDate() + offset);
  base.setUTCHours(8, 0, 0, 0);  // domenica mattina, fascia di solito libera
  return base;
}

// Slot unico (VU, iter): salta di 15 min, parte dalla prossima domenica
// + (settimane = floor(iter / 32)). Con 32 slot/giorno × 1 domenica = 32
// scritture per VU prima di passare alla domenica successiva.
function slotFor(vuId, iter) {
  const week = Math.floor(iter / 32);
  const minuteOffset = ((vuId * 17) % 32 + (iter % 32)) * 15;  // *17 per spread non-correlato tra VU
  const start = nextFreeSundayPlus(7 + week * 7);
  start.setUTCMinutes(start.getUTCMinutes() + minuteOffset);
  const end = new Date(start.getTime() + 15 * 60_000);
  return { startTime: start.toISOString(), endTime: end.toISOString() };
}

export default function (data) {
  const headers = authHeaders(data.token);
  const slot = slotFor(__VU, __ITER);

  let bookingId = null;

  group('write', () => {
    const create = http.post(
      `${BASE_URL}/api/bookings`,
      JSON.stringify({
        roomId: ROOM_ID,
        startTime: slot.startTime,
        endTime: slot.endTime,
        type: 'studio_individuale',
        purpose: `loadtest k6 vu=${__VU} iter=${__ITER}`,
      }),
      { headers, tags: { name: 'booking_create', expected: 'true' } },
    );

    const ok = check(create, {
      'create 200/201 OR 400 atteso': (r) =>
        r.status === 200 || r.status === 201 ||
        (r.status === 400 && /BOOKING_INVALID|QUOTA_EXCEEDED|ROOM_/.test(r.body || '')),
    });
    if (!ok) {
      // 5xx, 401, 429 inattesi — il check fallirà la threshold globale.
      return;
    }
    if (create.status >= 400) {
      collisions.add(1);
      return;
    }
    try {
      bookingId = create.json('booking.id') || create.json('id');
    } catch (_) { /* shape diverso o body vuoto */ }
    created.add(1);
  });

  // Pulizia: cancella subito la prenotazione creata. Non lasciare dati
  // residui significa che il test è ripetibile all'infinito senza
  // saturare il DB e senza inquinare il calendario reale.
  if (bookingId) {
    group('write', () => {
      const del = http.del(
        `${BASE_URL}/api/bookings/${bookingId}`,
        null,
        { headers, tags: { name: 'booking_delete', expected: 'true' } },
      );
      check(del, { 'delete 200/204': (r) => r.status === 200 || r.status === 204 });
      if (del.status === 200 || del.status === 204) deleted.add(1);
    });
  }
}

export function teardown(data) {
  // Best-effort: se per qualunque motivo restano residui, l'utente di
  // test li può ripulire manualmente filtrando su `purpose LIKE 'loadtest k6%'`.
  console.log(`[teardown] Verifica residui: SELECT id FROM bookings WHERE purpose LIKE 'loadtest k6%' AND user_id=${data.userId};`);
}
