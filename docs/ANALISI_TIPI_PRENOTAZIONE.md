# Analisi · Gestione tipi di prenotazione

> **Data**: 9 maggio 2026
> **Autore**: analisi tecnica codice Cadenza
> **Stato**: studio di fattibilità — nessuna implementazione ancora effettuata
> **Domanda**: qual è la soluzione **meno invasiva** per estendere/gestire i tipi di prenotazione?

Questo documento confronta tre approcci possibili (A · B · C) con valutazione di effort, rischio e rapporto costo/beneficio. La raccomandazione finale è in fondo (§ Raccomandazione).

---

## 1. Stato attuale

### 1.1 Architettura "due livelli"

Cadenza ha già implementato un'architettura su due strati:

| Strato                  | Cosa fa                                                                                                                                                         | Modificabile da admin?             |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| **"Duro"** (DB)         | `Booking.type` è un ENUM Postgres con 5 valori cablati: `studio_individuale`, `lezione`, `prova`, `concerto`, `altro`                                           | No (richiede migration)            |
| **"Morbido"** (catalog) | `BookingTypeCatalog` (modello Sequelize) tiene metadata: `label`, `color`, `icon`, `sortOrder`, `defaultDurationMinutes`, `description`, `isActive`, `isSystem` | **Sì** (UI `/admin/booking-types`) |

I 5 tipi sono seedati con `isSystem: true` → sono **protetti dalla cancellazione**, ma label/color/icon/sortOrder/visibilità sono editabili dalla UI senza ricompilare.

### 1.2 Cosa funziona già oggi

- Pagina admin `/admin/booking-types` con form di edit
- Endpoint pubblico `GET /api/booking-types` → ritorna i tipi attivi con metadata
- Endpoint admin `GET /api/admin/booking-types` (anche disattivati) + `PUT /api/admin/booking-types/:code`
- Bot Telegram `/book` legge la lista dal catalog (vedi `services/messaging/intent.js`)
- Test integration: `tests/integration/bookingTypes.test.js`
- Safety guard: non puoi disattivare l'ultimo tipo attivo (`LAST_ACTIVE_TYPE` HTTP 409)

### 1.3 Cosa NON si può fare oggi

1. **Aggiungere un tipo nuovo** (es. "masterclass", "esami", "seminario") — bloccato dall'ENUM Postgres
2. Eliminare un tipo `isSystem: true` (volutamente, è una protezione)

---

## 2. Mappa del codice "type-coupled"

Punti del codice che oggi conoscono i 5 valori:

| File / Posizione                                                  | Cosa fa                                         | Criticità                                                       |
| ----------------------------------------------------------------- | ----------------------------------------------- | --------------------------------------------------------------- |
| `backend/models/Booking.js:35` (ENUM)                             | Vincolo DB                                      | **Critico** — cambiarlo richiede migration formale              |
| `backend/models/BookingTemplate.js:49` (ENUM)                     | Vincolo DB analogo                              | Stessa migration di Booking                                     |
| `backend/routes/bookings.js:328` (validator `isIn`)               | Validazione body request                        | Da allineare automaticamente                                    |
| `backend/routes/bookingTemplates.js:14` (`TYPE_VALUES`)           | Validazione body request                        | Da allineare automaticamente                                    |
| `frontend/src/types/index.ts` (`type BookingType`)                | Tipo TS unione di stringhe                      | Da allargare (o sostituire con `string`)                        |
| `frontend/src/lib/bookings.ts` (`BOOKING_TYPE_OPTIONS/STYLES`)    | Mappa label + colori Tailwind                   | **Da rendere dinamica** (lettura da API)                        |
| `backend/routes/bookings.js:1469` (`booking.type !== 'concerto'`) | Logica scheda-concerto (concert info specifica) | Resta hardcoded — il "concerto" è speciale per design           |
| `backend/routes/public.js:381` (filter `type === 'concerto'`)     | Filtra concerti per il display kiosk            | Stesso ragionamento: "concerto" è una macro-categoria semantica |

**Conclusione**: il sistema ha già il 90% del lavoro fatto per ogni opzione discussa sotto. Il vero blocco è solo l'**ENUM Postgres** sulla colonna `Booking.type`.

---

## 3. Opzione A — Solo rinomina label (zero invasività)

### 3.1 Scenario d'uso

L'admin vuole **rinominare** i tipi esistenti:

- "lezione" → "lezione singola"
- "concerto" → "saggio pubblico"
- "prova" → "prova d'orchestra"

Senza che cambi nient'altro nel sistema.

### 3.2 Cosa fare

**Niente di nuovo**: funziona oggi.

1. Vai su `/admin/booking-types`
2. Modifica il campo "Etichetta" del tipo che vuoi rinominare
3. Salva

Il `code` interno (es. `lezione`) resta invariato; cambia solo l'etichetta visualizzata in UI, email, PDF, bot.

### 3.3 Valutazione

| Criterio            | Valore                                                               |
| ------------------- | -------------------------------------------------------------------- |
| Effort sviluppo     | **0** giorni                                                         |
| Migration DB        | Nessuna                                                              |
| Rischio regressione | Nullo                                                                |
| Self-service admin  | ✅ (solo rename)                                                     |
| Limite              | I 5 codici interni sono fissati. Non si può aggiungere "masterclass" |

### 3.4 Quando sceglierla

Se l'esigenza reale è **solo rinominare** o disattivare uno dei 5 tipi esistenti, l'opzione A è già la risposta. Nessun lavoro di sviluppo necessario.

---

## 4. Opzione B — Aggiunta one-shot di N tipi via migration (poco invasiva)

### 4.1 Scenario d'uso

L'admin vuole **aggiungere 1-3 tipi nuovi** che decide oggi e che resteranno per anni. Esempi tipici per un Conservatorio:

- `masterclass` (workshop intensivo con docente esterno)
- `esami` (sessione esami strumentale)
- `seminario` (conferenza, lecture)

I nuovi tipi saranno "first-class" come gli altri 5: con il proprio colore, icona, validazione completa, supporto su `BookingTemplate`, ecc.

### 4.2 Cosa fare

#### Step 1 — Migration formale Postgres

`backend/migrations/<timestamp>-extend-booking-type-enum.js`:

```js
'use strict';
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      ALTER TYPE "enum_bookings_type" ADD VALUE IF NOT EXISTS 'masterclass';
      ALTER TYPE "enum_bookings_type" ADD VALUE IF NOT EXISTS 'esami';
      ALTER TYPE "enum_bookings_type" ADD VALUE IF NOT EXISTS 'seminario';
      ALTER TYPE "enum_booking_templates_type" ADD VALUE IF NOT EXISTS 'masterclass';
      ALTER TYPE "enum_booking_templates_type" ADD VALUE IF NOT EXISTS 'esami';
      ALTER TYPE "enum_booking_templates_type" ADD VALUE IF NOT EXISTS 'seminario';
    `);
  },
  async down() {
    // Postgres non supporta DROP VALUE FROM ENUM. Per il rollback completo
    // serve ricreare l'ENUM. Documentazione in MIGRATIONS.md §rollback-enum.
    throw new Error('Rollback manuale: vedi MIGRATIONS.md');
  },
};
```

> **Postgres-specific**: `ALTER TYPE ADD VALUE` è atomico e non blocca le tabelle. Su SQLite (sviluppo) Sequelize gestisce gli ENUM come `TEXT` con CHECK constraint: ricreare la colonna in `safe-sync` mode.

#### Step 2 — Estensione array in 4 file backend

```diff
// backend/models/Booking.js (riga 35)
- type: DataTypes.ENUM('studio_individuale', 'lezione', 'prova', 'concerto', 'altro'),
+ type: DataTypes.ENUM('studio_individuale', 'lezione', 'prova', 'concerto', 'altro',
+                     'masterclass', 'esami', 'seminario'),

// backend/models/BookingTemplate.js (riga 49) — stesso pattern

// backend/routes/bookings.js (riga 328)
- body('type').optional().isIn(['studio_individuale', 'lezione', 'prova', 'concerto', 'altro']),
+ body('type').optional().isIn(['studio_individuale', 'lezione', 'prova', 'concerto', 'altro',
+                              'masterclass', 'esami', 'seminario']),

// backend/routes/bookingTemplates.js (riga 14) — stesso pattern
```

#### Step 3 — Estensione tipo TS frontend

```diff
// frontend/src/types/index.ts
- export type BookingType = 'studio_individuale' | 'lezione' | 'prova' | 'concerto' | 'altro';
+ export type BookingType =
+   | 'studio_individuale' | 'lezione' | 'prova' | 'concerto' | 'altro'
+   | 'masterclass' | 'esami' | 'seminario';
```

#### Step 4 — Estensione mappe label + colori

```diff
// frontend/src/lib/bookings.ts (BOOKING_TYPE_OPTIONS)
+ { value: 'masterclass', labelKey: 'booking.form.type_masterclass' },
+ { value: 'esami', labelKey: 'booking.form.type_esami' },
+ { value: 'seminario', labelKey: 'booking.form.type_seminario' },

// BOOKING_TYPE_STYLES (Tailwind classes per ognuno)
+ masterclass: { soft: 'bg-indigo-100 …', solid: 'bg-indigo-500 …', dot: 'bg-indigo-500', ring: 'ring-indigo-300' },
+ esami:       { soft: 'bg-orange-100 …', solid: 'bg-orange-500 …', dot: 'bg-orange-500', ring: 'ring-orange-300' },
+ seminario:   { soft: 'bg-teal-100 …', solid: 'bg-teal-500 …', dot: 'bg-teal-500', ring: 'ring-teal-300' },
```

#### Step 5 — i18n IT/EN/ES

`frontend/src/i18n/locales/{it,en,es}.json`:

```json
"booking.form.type_masterclass": "Masterclass",
"booking.form.type_esami": "Esami",
"booking.form.type_seminario": "Seminario"
```

#### Step 6 — Estensione del seeder

`backend/seeders/initial.js` — aggiungere i nuovi entries a `BOOKING_TYPE_SEED`:

```js
{
  code: 'masterclass',
  label: 'Masterclass',
  color: '#6366f1',
  icon: 'GraduationCap',
  sortOrder: 5,
  defaultDurationMinutes: 180,
  description: 'Workshop intensivo con docente ospite.',
},
// ...altri 2 entries per esami + seminario
```

> Idempotente: il seeder usa `findOrCreate` su `code`, quindi rigirarlo su un DB esistente è no-op.

#### Step 7 — Test regression

Aggiornare i test che hanno la lista hardcoded:

- `tests/integration/bookingTypes.test.js:207` — array `['studio_individuale', 'prova', …]`
- Eventuali test e2e che fanno snapshot della dropdown

### 4.3 Effort stimato

| Sub-task                                                 | Tempo                                                                                   |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Migration formale                                        | ~30 min                                                                                 |
| Estensione 4 file backend                                | ~30 min                                                                                 |
| Estensione frontend (TS + bookings.ts + i18n × 3 lingue) | ~1 ora                                                                                  |
| Seeder                                                   | ~15 min                                                                                 |
| Test (regression)                                        | ~30 min                                                                                 |
| Verifica + commit + PR                                   | ~30 min                                                                                 |
| **Totale**                                               | **~3-4 ore** per 3 tipi nuovi (di cui ~½ ora overhead fisso, il resto scala con N tipi) |

### 4.4 Valutazione

| Criterio                  | Valore                                                                                                         |
| ------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Effort sviluppo           | ~½ giornata                                                                                                    |
| Migration DB              | 1 (`ALTER TYPE ADD VALUE`)                                                                                     |
| Rischio regressione       | **Basso** (estensioni puntuali, ENUM additivo)                                                                 |
| Self-service admin        | ❌ richiede deploy del codice                                                                                  |
| Effort futuro per +1 tipo | ~½ giornata (stesso processo)                                                                                  |
| Pro                       | I nuovi tipi sono "first-class" come gli altri 5; UI customization già funziona; test suite esistente li copre |
| Contro                    | Ogni nuovo tipo richiede un deploy; il colore va scelto a code-time (poi modificabile da UI)                   |

### 4.5 Quando sceglierla

Se la realtà operativa è "**ogni 6-12 mesi mi serve aggiungere un tipo**", questa è la **soluzione meno invasiva che davvero risolve il bisogno**, senza overengineering.

---

## 5. Opzione C — Tipi dinamici self-service via "alias virtuali" (invasivo medio)

### 5.1 Scenario d'uso

L'admin vuole **creare nuovi tipi senza migration, dalla UI, in autonomia**. Frequenza prevista: ≥ 1 nuovo tipo / mese / istituto.

### 5.2 Trick architetturale

Invece di toccare l'ENUM `Booking.type` per ogni tipo nuovo, sfruttiamo `BookingTypeCatalog` come **dimensione separata** e mappiamo ogni tipo a uno dei 5 ENUM esistenti come "categoria padre" (`parentEnum`).

Esempio:

- Admin crea `Masterclass` → `parentEnum='lezione'`
- Admin crea `Esami` → `parentEnum='concerto'` (per ereditare workflow approvazione + display kiosk se serve)
- Admin crea `Workshop esterno` → `parentEnum='altro'`

Il `code` del catalogo diventa il vero discriminante user-facing; `Booking.type` resta come **macro-categoria** usata solo dalla logica core (validazione, kiosk filter, scheda concerto).

### 5.3 Modifiche necessarie

#### A. Schema DB

```sql
-- nuova migration
ALTER TABLE bookings ADD COLUMN "typeCatalogCode" VARCHAR(40);
ALTER TABLE bookings ADD CONSTRAINT bookings_type_catalog_fk
  FOREIGN KEY ("typeCatalogCode") REFERENCES booking_type_catalog(code) ON UPDATE CASCADE;
CREATE INDEX bookings_type_catalog_idx ON bookings("typeCatalogCode");

ALTER TABLE booking_type_catalog ADD COLUMN "parentEnum" VARCHAR(40) NOT NULL DEFAULT 'altro';
-- backfill: il code originale è anche il parentEnum (i 5 system types)
UPDATE booking_type_catalog SET "parentEnum" = code WHERE "isSystem" = true;
```

#### B. Logica di sync

A ogni `Booking.create`/`update`:

```js
// nuovo hook beforeValidate
if (booking.typeCatalogCode) {
  const catalog = await BookingTypeCatalog.findOne({
    where: { code: booking.typeCatalogCode },
  });
  if (!catalog) throw new Error('TYPE_CATALOG_NOT_FOUND');
  booking.type = catalog.parentEnum; // sync auto su `type` per la logica core
}
```

#### C. Frontend

- `BookingFormDialog`: dropdown ora elenca tutti i tipi catalog (no più solo i 5)
- I valori salvati hanno sia `type` (auto, dal parentEnum) sia `typeCatalogCode` (lo scelto)
- Display: badge usa `typeCatalogCode` per label/color (granulare)
- Report: raggruppa per `typeCatalogCode` (granulare) o `type` (5 macro)

#### D. API admin estesa

- `POST /api/admin/booking-types` — l'admin sceglie `code`, `parentEnum` (1 dei 5), label, color, icon
- `DELETE /api/admin/booking-types/:code` — solo se non `isSystem` e nessuna booking lo riferisce

#### E. Test estesi

Regressione su:

- Validazione booking validator (rules/quotas)
- Scheda concerto (filtro `type === 'concerto'` resta valido perché `parentEnum` lo riflette)
- Display kiosk (idem)
- Bot Telegram (la lista catalog viene già usata come è)

### 5.4 Effort stimato

| Sub-task                                                         | Tempo                |
| ---------------------------------------------------------------- | -------------------- |
| Migration `ADD COLUMN typeCatalogCode + FK + parentEnum`         | ~½ giornata          |
| Hook backend di sync + estensione validator                      | ~½ giornata          |
| Endpoint admin POST/DELETE + safety guards (FK references count) | ~½ giornata          |
| Frontend (dropdown dinamica, form catalog esteso, color picker)  | ~1 giornata          |
| Test (15-20 nuovi test per regression cross-cutting)             | ~½ giornata          |
| Verifica end-to-end + docs                                       | ~½ giornata          |
| **Totale**                                                       | **~3 giornate uomo** |

### 5.5 Valutazione

| Criterio                  | Valore                                                                                                                                                                     |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Effort sviluppo           | 2-3 giornate                                                                                                                                                               |
| Migration DB              | 1 (`ADD COLUMN` su `bookings`, tabella più calda del sistema)                                                                                                              |
| Rischio regressione       | **Medio** (tocca cross-cutting: validator, hooks, kiosk, bot)                                                                                                              |
| Self-service admin        | ✅ (creazione/edit/delete da UI)                                                                                                                                           |
| Effort futuro per +1 tipo | 30 secondi via UI                                                                                                                                                          |
| Pro                       | Autonomia totale dell'admin; le booking storiche restano valide (`type` ENUM è sempre uno dei 5)                                                                           |
| Contro                    | Aggiunta colonna su tabella calda; logica di derivazione = punto di rottura potenziale; report che oggi raggruppano per `type` mostrano solo le 5 macro a meno di refactor |

### 5.6 Quando sceglierla

Solo se prevedi che gli admin (uno per Conservatorio) vogliano **frequentemente** (≥ 1 volta al mese, in media) creare tipi diversi a piacere. In un mercato di 79 conservatori statali con esigenze didattiche molto simili, tipicamente **non è il caso**.

---

## 6. Confronto sintetico

| Criterio                      | A · status quo   | B · migration one-shot | C · alias virtuali         |
| ----------------------------- | ---------------- | ---------------------- | -------------------------- |
| **Invasività codice**         | 0                | Bassa                  | Medio-alta                 |
| **Migration DB**              | Nessuna          | 1 ADD VALUE all'ENUM   | 1 ADD COLUMN + FK          |
| **Self-service admin**        | ❌ (solo rename) | ❌ (richiede deploy)   | ✅                         |
| **Tempo dev**                 | 0                | ~½ giornata            | 2-3 giornate               |
| **Rischio regressione**       | Nullo            | Basso                  | Medio (cross-cutting)      |
| **Effort futuro per +1 tipo** | Impossibile      | ~½ giornata            | 30 secondi via UI          |
| **Quando ha senso**           | Solo rinomine    | 1-3 tipi rari          | ≥ 1 tipo/mese self-service |

---

## 7. Raccomandazione

### 7.1 Opzione consigliata

**Opzione B** è la "soluzione meno invasiva" che davvero **risolve il bisogno** senza overengineering, nella maggior parte degli scenari realistici per un Conservatorio italiano.

### 7.2 Procedura raccomandata

1. **Migration formale** (`backend/migrations/<ts>-extend-booking-type-enum.js`) idempotente con `IF NOT EXISTS`
2. **Aggiornamento array** nei 4 file backend
3. **Estensione tipo TS + mappe** nei 2 file frontend
4. **Estensione i18n** (3 lingue × N nuovi tipi)
5. **Estensione seeder** con i nuovi entries `BookingTypeCatalog`
6. **Documentare** in `MIGRATIONS.md` la procedura "Aggiungere un nuovo tipo prenotazione" così che chi viene dopo replica in 30 minuti
7. **Smoke test** della UI: dropdown del BookingFormDialog mostra il nuovo tipo, badge ha il colore giusto, kiosk display non si rompe

Risultato: il Conservatorio ha tutti i tipi che gli servono, l'admin può comunque personalizzarli (label/color/icon dalla UI esistente), zero overhead architetturale, deploy lineare con le altre migrazioni.

### 7.3 Quando rivalutare verso C

Se in 12-24 mesi noti che:

- Più di 3 conservatori chiedono tipi diversi tra loro
- Lo stesso conservatorio chiede ≥ 2 tipi nuovi all'anno
- Il flusso "richiesta → deploy → verifica" diventa ricorrente

→ allora vale la pena promuovere a **Opzione C** (3 giornate ben spese).

Fino ad allora, l'overhead di mantenere il sistema dei "alias virtuali" non è giustificato dai casi d'uso reali.

---

## 8. Prossimi passi

Quando sarai pronto a procedere, indica:

- **Quali tipi vuoi aggiungere** (codici + label suggerite + colore di base preferito)
- Eventuali **comportamenti speciali** (es. "esami" deve sempre passare per approvazione → mappa al `requireApproval=true` lato regola/aula? oppure è il tipo stesso a forzarlo?)

Sulla base di queste due informazioni, l'implementazione segue il template Opzione B in ~3-4 ore di lavoro.

---

## 9. Appendice: come l'admin può già personalizzare oggi

A scanso di equivoci, ecco cosa funziona **adesso** senza alcuno sviluppo:

| Voglio …                                            | Si può? | Come                                                               |
| --------------------------------------------------- | ------- | ------------------------------------------------------------------ |
| Rinominare "lezione" in "lezione singola"           | ✅      | `/admin/booking-types` → modifica label                            |
| Cambiare il colore di "concerto" da rosa a bordeaux | ✅      | `/admin/booking-types` → campo color                               |
| Cambiare l'icona di "studio_individuale"            | ✅      | `/admin/booking-types` → dropdown icone                            |
| Riordinare la dropdown                              | ✅      | `/admin/booking-types` → campo `sortOrder`                         |
| Disattivare temporaneamente "altro"                 | ✅      | `/admin/booking-types` → toggle isActive                           |
| Pre-compilare la durata di "concerto" a 120 min     | ✅      | `/admin/booking-types` → `defaultDurationMinutes`                  |
| Aggiungere il tipo "masterclass"                    | ❌      | Richiede Opzione B (~½ giornata di sviluppo + deploy)              |
| Eliminare definitivamente "prova"                   | ❌      | Disabilitazione sì (`isActive=false`); cancellazione no per design |

> Il documento attuale è uno **studio di fattibilità**, non un'implementazione. Conferma quale opzione scegliere e procediamo di conseguenza.
