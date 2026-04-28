# Vincoli a livello DB — rete di sicurezza per Aula Book

Questo documento descrive i vincoli (constraint) applicati direttamente al database, perché esistono e cosa fare quando uno di loro scatta.

> Filosofia: **il validator applicativo è la prima linea di difesa**, ma può avere bug. Le constraint a livello DB fanno da rete di sicurezza, perché lavorano sotto al livello dell'app e non possono essere bypassate da un `Booking.create()` distratto, da una migrazione di dati ad-hoc, o da un endpoint admin che dimentica un controllo.

---

## bookings_no_overlap (Postgres-only)

**Cosa**: due booking in stato `confirmed` sulla stessa aula non possono avere intervalli temporali sovrapposti.

**Definizione SQL** (gestita da `lib/preSyncMigrations.js`):

```sql
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE bookings
  ADD CONSTRAINT bookings_no_overlap
  EXCLUDE USING gist (
    "roomId" WITH =,
    tstzrange("startTime", "endTime", '[)') WITH &&
  ) WHERE (status = 'confirmed' AND "deletedAt" IS NULL);
```

**Significato dei pezzi**:

| Pezzo                       | Significato                                                                                                                                                       |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `EXCLUDE USING gist`        | Constraint che impedisce certe combinazioni di righe coesistenti. Implementata via indice GiST.                                                                   |
| `"roomId" WITH =`           | "Match esatto sulla stanza." Due righe sono in conflitto se hanno la **stessa** roomId.                                                                           |
| `tstzrange(...) WITH &&`    | "Sovrapposizione temporale." `&&` è l'operatore di intersezione di range.                                                                                         |
| `'[)'`                      | Bound inclusivo a sinistra, esclusivo a destra. Una booking 10:00-11:00 e una 11:00-12:00 NON si sovrappongono.                                                   |
| `WHERE (...)`               | Constraint **partial**: vale solo per le righe `confirmed` e non soft-deleted. Le `cancelled`, `pending`, ecc. sono escluse.                                      |
| `tstzrange` (non `tsrange`) | Le colonne timestamp di Sequelize su Postgres sono `TIMESTAMPTZ` (con timezone). `tstzrange` è la variante TZ-aware. `tsrange` darebbe `function does not exist`. |

**Estensione `btree_gist`**: serve per usare `=` con tipi non-range (in questo caso `roomId integer`) all'interno di un indice GiST. Su Postgres managed senza permessi SUPERUSER, l'estensione potrebbe già essere installata o richiedere un'azione manuale del provider.

---

## Quando scatta

Qualunque `INSERT` o `UPDATE` che renderebbe vere le condizioni sopra fallisce con:

- ERRCODE Postgres `23P01` (exclusion_violation)
- Sequelize: `SequelizeExclusionConstraintError`
- Mapper applicativo (`lib/dbErrors.js`): `{ status: 409, code: 'EXCLUSION_VIOLATION', constraint: 'bookings_no_overlap' }`

Lato client questo arriva come HTTP 409 con `code='EXCLUSION_VIOLATION'`. Il `BookingFormDialog` del frontend già intercetta sia `BOOKING_CONFLICT` (errore dal validator) sia `EXCLUSION_VIOLATION` (errore DB) e mostra l'offerta di iscrizione alla waitlist.

---

## Cosa fa il validator applicativo

`services/bookingValidator.js` esegue la stessa logica **prima** di provare l'INSERT:

- Verifica regole di ruolo, quote, orari permessi, anticipo massimo, ecc.
- Cerca booking confliggenti con `Booking.findAll({ where: { roomId, ...overlap } })` e ritorna l'errore in italiano localizzato per UX migliore.

In condizioni normali è il validator che produce il 400 `BOOKING_INVALID` con messaggio "L'aula è già prenotata per questo orario". L'utente non vede mai l'`EXCLUSION_VIOLATION`.

**Cosa cambia con la constraint DB**:

- Se domani un PR introduce un bug che bypassa il validator (es. nuovo endpoint che chiama `Booking.create()` senza passare dal validator), il DB rifiuta comunque.
- Le race condition fra due request concorrenti che passano il validator nello stesso momento vengono rilevate dal DB (Postgres applica la constraint atomicamente).
- Le migrazioni di dati ad-hoc che girano fuori dall'app (es. seed manuale, restore parziale) non possono creare overlap silenziosi.

---

## Quando la migration FALLISCE all'avvio

Lo startup logga:

```
⚠ Impossibile aggiungere bookings_no_overlap: <messaggio Postgres>
⚠ Lo startup prosegue. La validazione overlap resta gestita solo dal validator applicativo.
⚠ Per riprovare in seguito: ripulisci i duplicati overlapping e rilancia lo startup.
```

Il server **continua a partire**. Le cause comuni:

### A) Esistono già booking confermate sovrapposte

Postgres rifiuta l'`ALTER TABLE ... ADD CONSTRAINT` se anche **una sola** coppia di righe esistenti viola la regola.

Per trovare i duplicati:

```sql
SELECT a.id AS booking_a, b.id AS booking_b, a."roomId",
       a."startTime", a."endTime",
       b."startTime", b."endTime"
FROM bookings a
JOIN bookings b ON a.id < b.id
              AND a."roomId" = b."roomId"
              AND a.status = 'confirmed' AND b.status = 'confirmed'
              AND a."deletedAt" IS NULL  AND b."deletedAt" IS NULL
              AND tstzrange(a."startTime", a."endTime", '[)')
               && tstzrange(b."startTime", b."endTime", '[)');
```

Decidi caso per caso quale conservare (es. la più vecchia per `createdAt`) e marca le altre `cancelled` o `deletedAt = now()`. Poi riavvia il server.

### B) Estensione `btree_gist` non installabile

Su alcuni provider managed (es. Supabase free, alcuni RDS) non hai i permessi per `CREATE EXTENSION`. Soluzioni:

- Chiedi al provider di abilitare `btree_gist` (è un'estensione contrib standard di Postgres).
- Workaround senza btree_gist: usare `gist_index_ops` su un range che incorpora anche roomId (più complicato e meno performante). Non implementato qui.

### C) Permessi insufficienti

L'utente DB con cui Aula Book si connette deve essere **owner della tabella `bookings`** per poter aggiungere constraint. Se hai usato `CREATE DATABASE aulabook OWNER aulabook` come da `install.sh`/`install.md`, sei già a posto.

---

## Disattivazione (in caso di emergenza)

Se la constraint diventa un problema (es. dati legacy che non riesci a ripulire e bloccano deploy):

```sql
ALTER TABLE bookings DROP CONSTRAINT bookings_no_overlap;
```

La migration al prossimo avvio prova a rimetterla. Per disabilitare permanentemente, commenta la chiamata a `ensureBookingsNoOverlapConstraint()` in `runPreSyncMigrations()` di `lib/preSyncMigrations.js`.

> Senza la constraint, gli overlap sono prevenuti dal solo validator applicativo. Possibile, ma perdi il backstop.

---

## Test

`tests/integration/excludeConstraint.test.js` contiene 4 test:

1. INSERT di una booking sovrapposta → 409 `EXCLUSION_VIOLATION`
2. Stesso slot su room diverse → ammesso
3. Slot già occupato ma da una booking `cancelled` → ammesso
4. Slot già occupato ma soft-deleted → ammesso

I test sono **skippati** quando `DB_DIALECT !== 'postgres'` (la suite di default usa SQLite in-memory, che non supporta `EXCLUDE`). Per eseguirli serve un Postgres dedicato:

```bash
DB_DIALECT=postgres \
DB_HOST=localhost DB_PORT=5432 \
DB_NAME=aulabook_test DB_USER=aulabook DB_PASSWORD=... \
DB_SSL=false \
npx vitest run tests/integration/excludeConstraint.test.js
```

In CI, questo richiederebbe un `service: postgres` nel workflow GitHub Actions (non incluso al momento — vedi `docs/TESTING.md` § "Cosa NON copriamo").
