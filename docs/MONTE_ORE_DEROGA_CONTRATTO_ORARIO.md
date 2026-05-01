# Monte Ore — Deroga per docenti a contratto orario

> **Data analisi**: 30 aprile 2026
> **Stato**: progettato (non ancora implementato)
> **Issue**: oggi la soglia di 324 ore annue è globale per tutti i docenti dell'istituto. Non c'è modo di abbassarla per i docenti **a contratto orario** (precari, supplenti, contratti < tempo pieno) che hanno un monte ore concordato individualmente (es. 60h, 120h, 180h).

---

## 1. Stato attuale del sistema

### 1.1 Dove vive la soglia 324h

**Modello** (`backend/models/MonteOreSettings.js`):

```js
minRequiredHours: {
  type: DataTypes.FLOAT,
  allowNull: false,
  defaultValue: 324,
},
```

Singleton per istituto + anno accademico (vincolo unique `(instituteId, academicYear)`). Cambi qui ⇒ cambi per **tutti** i docenti.

**Validator submit** (`backend/routes/monteOre.js` riga 290-296):

```js
minRequired = settings.minRequiredHours ?? 324;
totalHours = await slotService.recomputeTotals(proposal.id);
if (totalHours < minRequired) {
  return res.status(400).json({
    error: `Il monte ore deve essere almeno di ${minRequired} ore …`,
    code: 'HOURS_BELOW_THRESHOLD',
  });
}
```

Il submit della proposta blocca chiunque sotto la soglia istituzionale, **senza eccezioni per ruolo/tipo contratto/utente**.

**Snapshot** (`MonteOreProposal.minRequiredHoursSnapshot`): la soglia viene "fotografata" alla submit così resta stabile anche se l'admin la modifica in futuro. Per il flusso a contratto orario, lo snapshot deve riflettere il valore **personalizzato** del docente, non quello globale.

### 1.2 Vincolo "2-4 giorni a settimana"

Stesso file, riga 284:

```js
if (distinctDays.size < 2 || distinctDays.size > 4) {
  return res.status(400).json({ ... code: 'WORKING_DAYS_OUT_OF_RANGE' });
}
```

Anche questo è hard-coded. **Per i contratti orari il vincolo dei 2-4 giorni può non avere senso** (un docente con 30h annue può fare tutto in 1 giorno alla settimana per 10 settimane).

### 1.3 Cosa NON c'è oggi

| Funzionalità mancante                                        | Effetto sull'admin                                              |
| ------------------------------------------------------------ | --------------------------------------------------------------- |
| Override soglia per singolo docente                          | Forzato a tenere la soglia istituzionale; o cambiarla per tutti |
| Tipo contratto sull'utente (`titolare` / `contratto orario`) | Nessun modo di distinguerli                                     |
| Bypass del vincolo 2-4 giorni per contrattisti               | Forzati a spalmare le ore su almeno 2 giorni                    |
| Audit log dell'override (chi ha autorizzato la deroga)       | Nessuna tracciabilità contrattuale                              |

---

## 2. Casistica reale del Conservatorio italiano

| Categoria docente                             | Monte ore tipico | Vincolo CCNL                                  |
| --------------------------------------------- | ---------------- | --------------------------------------------- |
| **Docente di ruolo (titolare)**               | 324h/anno        | 2-4 giorni/sett, finestra ottobre-giugno      |
| **Docente a contratto orario**                | 30h - 200h       | Variabile, definito dal contratto individuale |
| **Docente supplente annuale**                 | 162h - 324h      | A volte 50% del titolare (162h)               |
| **Docente di laboratorio / part-time**        | 100h - 200h      | Definito dal regolamento didattico            |
| **Coadiutore / accompagnatore al pianoforte** | 50h - 150h       | Spesso a contratto orario                     |

Stima: in un Conservatorio medio (200-600 studenti), i contratti orari sono **20-40% del corpo docente**. Ignorarli rende Monte Ore inutilizzabile per quella fetta.

---

## 3. Progettazione della deroga

### 3.1 Strategia: campo override sull'utente

Aggiungere un campo per-utente sull'`User` che, se presente, **sostituisce** la soglia istituzionale per quel docente.

**Pro**: per-utente, persistente, modificabile dalla pagina Utenti, audit-loggato come ogni altra modifica anagrafica.
**Contro**: serve aggiornare il campo ogni anno se il contratto cambia (ma l'AA cambia comunque, l'admin ha già il workflow di rinnovo).

### 3.2 Schema modifiche proposte

#### 3.2.1 Modello `User`

```js
// backend/models/User.js — aggiungere:

contractType: {
  type: DataTypes.ENUM('titolare', 'contratto_orario', 'supplente', 'altro'),
  allowNull: true,                  // null = default 'titolare' a livello validator
  comment: 'Tipo contrattuale rilevante per Monte Ore',
},

monteOreAnnualHoursOverride: {
  type: DataTypes.FLOAT,
  allowNull: true,                  // null = usa minRequiredHours globale
  validate: { min: 0, max: 1500 },
  comment:
    "Override annuo per docenti a contratto orario o casi individuali. " +
    "Se valorizzato, sostituisce MonteOreSettings.minRequiredHours per " +
    "questo docente. Modificabile solo da admin, audit-loggato.",
},

monteOreBypassDayConstraint: {
  type: DataTypes.BOOLEAN,
  allowNull: false,
  defaultValue: false,
  comment:
    "Se true, il docente è esente dal vincolo 2-4 giorni/settimana. " +
    "Tipico per contratti orari brevi (es. 30h) che possono concentrare " +
    "le lezioni in un solo giorno.",
},

monteOreOverrideReason: {
  type: DataTypes.STRING(500),
  allowNull: true,
  comment:
    "Motivazione obbligatoria quando si imposta un override: " +
    "es. 'Contratto orario 60h - prot. 2026/123 del 15/09/2026'. " +
    "Esposto nell'audit log.",
},

monteOreOverrideSetAt: {
  type: DataTypes.DATE,
  allowNull: true,
  comment: 'Data ultima modifica dei campi override Monte Ore.',
},

monteOreOverrideSetBy: {
  type: DataTypes.INTEGER,
  allowNull: true,
  references: { model: 'users', key: 'id' },
  comment: 'Admin che ha autorizzato l\'override.',
},
```

#### 3.2.2 Migrazione `lib/preSyncMigrations.js`

Aggiungere idempotente in `runPreSyncMigrations()`:

```js
if (await ensureNullableStringColumn('users', 'monteOreOverrideReason', 500)) {
  console.log('  ✓ users.monteOreOverrideReason aggiunta');
}
if (await ensureNullableFloatColumn('users', 'monteOreAnnualHoursOverride')) {
  console.log('  ✓ users.monteOreAnnualHoursOverride aggiunta');
}
if (await ensureBooleanColumn('users', 'monteOreBypassDayConstraint', false)) {
  console.log('  ✓ users.monteOreBypassDayConstraint aggiunta');
}
if (await ensureNullableDateColumn('users', 'monteOreOverrideSetAt')) {
  console.log('  ✓ users.monteOreOverrideSetAt aggiunta');
}
if (await ensureNullableIntColumn('users', 'monteOreOverrideSetBy')) {
  console.log('  ✓ users.monteOreOverrideSetBy aggiunta');
}
// contractType ENUM richiede gestione speciale postgres → fallback a STRING(40)
if (await ensureNullableStringColumn('users', 'contractType', 40)) {
  console.log('  ✓ users.contractType aggiunta');
}
```

Tutte additive, default sicuri (null/false), zero data loss.

### 3.3 Logica validator (servizio + route)

#### 3.3.1 Helper centralizzato

Nuovo file `backend/services/monteOreThresholdService.js`:

```js
'use strict';

const { MonteOreSettings, User } = require('../models');

/**
 * Restituisce la soglia minima di ore annue per un docente, considerando
 * eventuale override individuale.
 *
 * Priorità:
 *   1. user.monteOreAnnualHoursOverride (se non null) → override individuale
 *   2. settings.minRequiredHours per l'AA → soglia istituzionale
 *   3. 324 (default storico CCNL)
 */
async function resolveAnnualThreshold(userId, academicYear) {
  const user = await User.findByPk(userId, {
    attributes: [
      'id',
      'monteOreAnnualHoursOverride',
      'monteOreBypassDayConstraint',
      'contractType',
    ],
  });
  if (!user) throw new Error('Utente non trovato');

  if (user.monteOreAnnualHoursOverride != null) {
    return {
      minHours: Number(user.monteOreAnnualHoursOverride),
      bypassDayConstraint: !!user.monteOreBypassDayConstraint,
      source: 'user_override',
    };
  }

  const settings = await MonteOreSettings.findOne({ where: { academicYear } });
  return {
    minHours: settings?.minRequiredHours ?? 324,
    bypassDayConstraint: false,
    source: settings ? 'institute_settings' : 'default',
  };
}

module.exports = { resolveAnnualThreshold };
```

#### 3.3.2 Aggiornamento route submit

`backend/routes/monteOre.js` (riga 280-310 attuale):

```js
const {
  resolveAnnualThreshold,
} = require('../services/monteOreThresholdService');

// ... dentro POST /me/submit:
const { minHours, bypassDayConstraint, source } = await resolveAnnualThreshold(
  req.user.id,
  year,
);

if (settings) {
  // 2-4 giorni: bypass se l'utente è autorizzato
  if (
    !bypassDayConstraint &&
    (distinctDays.size < 2 || distinctDays.size > 4)
  ) {
    return res.status(400).json({
      error:
        `Il monte ore richiede da 2 a 4 giorni lavorativi a settimana ` +
        `(impostati: ${distinctDays.size}). ` +
        `Per docenti a contratto orario richiedi all'admin la deroga.`,
      code: 'WORKING_DAYS_OUT_OF_RANGE',
    });
  }
  totalHours = await slotService.recomputeTotals(proposal.id);
  if (totalHours < minHours) {
    return res.status(400).json({
      error:
        `Il monte ore deve essere almeno di ${minHours} ore ` +
        `(attuali: ${totalHours.toFixed(1)} h). ` +
        (source === 'user_override'
          ? 'Soglia personalizzata definita per il tuo contratto.'
          : 'Soglia istituzionale (CCNL).'),
      code: 'HOURS_BELOW_THRESHOLD',
    });
  }
}

const updates = {
  status: 'submitted',
  submittedAt: new Date(),
  workingDaysCount: bypassDayConstraint ? null : distinctDays.size,
  totalHoursRequested: totalHours,
  minRequiredHoursSnapshot: minHours, // ← snapshot del valore RISOLTO,
  //   non del settings globale
};
```

Lo `snapshot` è cruciale: se domani il docente diventa di ruolo (override rimosso), la **proposta già approvata** deve restare valida con la soglia originale.

### 3.4 API admin per gestire l'override

Nuovo endpoint `PUT /api/admin/users/:id/monte-ore-override`:

```js
// backend/routes/users.js
router.put(
  '/:id/monte-ore-override',
  authenticate,
  requireRole('admin'),
  async (req, res, next) => {
    try {
      const { id } = req.params;
      const {
        contractType,
        monteOreAnnualHoursOverride,
        monteOreBypassDayConstraint,
        monteOreOverrideReason,
      } = req.body;

      // Validazione: motivo obbligatorio se si imposta override
      const settingOverride =
        monteOreAnnualHoursOverride != null ||
        monteOreBypassDayConstraint === true;
      if (settingOverride && !monteOreOverrideReason?.trim()) {
        return res.status(400).json({
          error: 'Motivazione obbligatoria quando si imposta una deroga',
          code: 'OVERRIDE_REASON_REQUIRED',
        });
      }
      if (
        monteOreAnnualHoursOverride != null &&
        (monteOreAnnualHoursOverride < 0 || monteOreAnnualHoursOverride > 1500)
      ) {
        return res.status(400).json({
          error: 'Override ore deve essere tra 0 e 1500',
          code: 'OVERRIDE_OUT_OF_RANGE',
        });
      }

      const user = await User.findByPk(id);
      if (!user) return res.status(404).json({ error: 'Utente non trovato' });
      if (user.role !== 'docente') {
        return res.status(400).json({
          error: 'Override Monte Ore valido solo per ruolo docente',
          code: 'WRONG_ROLE',
        });
      }

      await user.update({
        contractType: contractType ?? user.contractType,
        monteOreAnnualHoursOverride: monteOreAnnualHoursOverride ?? null,
        monteOreBypassDayConstraint: !!monteOreBypassDayConstraint,
        monteOreOverrideReason: monteOreOverrideReason ?? null,
        monteOreOverrideSetAt: settingOverride ? new Date() : null,
        monteOreOverrideSetBy: settingOverride ? req.user.id : null,
      });

      // Audit log
      await audit.log({
        userId: req.user.id,
        targetUserId: user.id,
        action: 'monte_ore.override.set',
        details: {
          contractType,
          monteOreAnnualHoursOverride,
          monteOreBypassDayConstraint,
          reason: monteOreOverrideReason,
        },
      });

      res.json({ user: user.toJSON() });
    } catch (err) {
      next(err);
    }
  },
);
```

### 3.5 UI admin

#### 3.5.1 Sezione nella scheda utente

In `frontend/src/pages/admin/Users.tsx`, aggiungere alla `UserFormDialog` un blocco condizionale visibile **solo se `user.role === 'docente'`**:

```
┌─ Monte Ore — Tipo contratto ─────────────────────────────┐
│  ⦿ Titolare (default 324h, vincolo 2-4 gg/sett)         │
│  ⦾ Contratto orario                                       │
│  ⦾ Supplente                                              │
│  ⦾ Altro                                                  │
│                                                           │
│  ☐ Soglia ore personalizzata: [   60 ] h/anno            │
│  ☐ Esente dal vincolo 2-4 giorni/settimana                │
│                                                           │
│  Motivazione (obbligatoria se override): *                │
│  [_______________________________________________]        │
│  es. "Contratto orario 60h - prot. 2026/123/2026"         │
│                                                           │
│  Ultima modifica: 15/09/2026 da admin@conservatorio.it    │
└───────────────────────────────────────────────────────────┘
```

Il toggle "Soglia ore personalizzata" abilita il numerico. Il toggle "Esente dal vincolo 2-4 gg" abilita il bypass. Almeno uno dei due richiede `monteOreOverrideReason`.

#### 3.5.2 Vista dell'admin in `Gestione Monte Ore`

Nella tab "Proposte" admin, **mostrare la soglia applicata accanto al docente**:

| Docente | Corso      | Soglia                 | Ore proposte | Stato    |
| ------- | ---------- | ---------------------- | ------------ | -------- |
| Bianchi | Pianoforte | **324 h** (CCNL)       | 320 h ✗      | rejected |
| Verdi   | Violino    | **162 h** (override) ⓘ | 168 h ✓      | approved |
| Rossi   | Canto      | **60 h** (orario) ⓘ    | 60 h ✓       | approved |

Click su ⓘ → tooltip con "Override fissato il GG/MM/AAAA da NomeAdmin. Motivo: …".

#### 3.5.3 Filtro nella lista

Filtri aggiuntivi nella lista Utenti:

- "Tipo contratto" (titolare / orario / supplente / altro / -)
- "Con override Monte Ore" (sì / no)

### 3.6 UI docente — pagina `/monte-ore`

Quando un docente con override apre la pagina, in alto compare un banner informativo:

```
ⓘ  Soglia Monte Ore personalizzata: 60 ore/anno
   Tipo contratto: contratto orario
   Vincolo 2-4 giorni/settimana: NON applicato
   Per modifiche contattare la Direzione.
```

La validazione lato client (anteprima ore prima del submit) usa lo stesso `resolveAnnualThreshold()` esposto via API.

### 3.7 Generazione slot

Il flusso `proposalsService.generate()` usa `minRequiredHoursSnapshot` come ground truth. Nessuna modifica necessaria, ma serve una verifica:

- Per `bypassDayConstraint=true`, il `workingDaysCount` può essere `null` → la generation non deve assumere un valore di default
- I report di generazione mostrano "soglia: 60h (override)" invece di "324h (CCNL)"

### 3.8 Import da Isidata

Quando l'admin importa anagrafica da Isidata, il diff dovrebbe **proporre automaticamente** `contractType=contratto_orario` se Isidata espone l'attributo `tipoContratto` con valore `co.co.co` o `contratto orario`. La soglia ore può essere desunta dall'attributo `oreSettimanali × 36` (settimane di lezione).

Nuovo flag in import: "Auto-set contract type from Isidata" (default ON, sotto la responsabilità admin).

---

## 4. Test di regressione richiesti

Nuovo file `tests/integration/monteOreContractOverride.test.js`:

```js
describe('Monte Ore — deroga docenti a contratto orario', () => {
  it('docente titolare senza override: soglia = 324, vincolo 2-4 gg attivo', ...);
  it('docente con override 60h: submit accetta proposta da 60h, rifiuta 50h', ...);
  it('docente con bypass day: submit accetta pattern monoday', ...);
  it('senza motivazione: PUT /override rifiuta', ...);
  it('admin imposta override: audit log popolato', ...);
  it('rimozione override: snapshot proposta esistente NON cambia', ...);
  it('docente non-docente (studente/admin): PUT /override 400', ...);
  it('range valido: 0 ≤ override ≤ 1500', ...);
});
```

8 test minimi. Tempo stimato: 2 ore.

---

## 5. Effort e priorità

| Fase                                  | Effort                       | Dipendenze |
| ------------------------------------- | ---------------------------- | ---------- |
| **Schema + migration**                | S (½ gg)                     | nessuna    |
| **Service + route admin**             | M (1 gg)                     | schema     |
| **UI admin Utenti (form override)**   | M (1 gg)                     | route      |
| **UI admin Monte Ore (badge soglia)** | S (½ gg)                     | service    |
| **UI docente (banner)**               | S (½ gg)                     | service    |
| **Test integration (8 test)**         | M (½ gg)                     | tutto      |
| **Documentazione manuale admin**      | S (½ gg)                     | nessuna    |
| **Totale**                            | **~4 giornate sviluppatore** |            |

Priorità suggerita: **P1** se il Conservatorio ha contratti orari (~20-40% dei casi reali). Senza questa deroga il modulo Monte Ore è inutilizzabile per quella categoria, e l'admin dovrebbe disattivare il toggle modulo Monte Ore solo per loro — soluzione brutta.

---

## 6. Decisione richiesta alla Direzione

Prima di implementare, l'autore chiede alla Direzione:

1. **Categorie contratto da supportare**: solo `titolare` + `contratto_orario` o anche `supplente_annuale` + `altro`?
2. **Range valido per override**: i 0-1500h proposti coprono tutti i casi reali del vostro Conservatorio?
3. **Workflow approvazione**: l'admin imposta direttamente l'override o deve passare per un'approvazione del Direttore (workflow simile alle prenotazioni con `requiresApproval`)?
4. **Visibilità docente**: il docente deve poter vedere il proprio override in chiaro, o solo l'effetto (la nuova soglia) senza la motivazione?
5. **Audit retention**: per quanto tempo conservare la storia degli override (default suggerito: tutta la durata del rapporto di lavoro + 10 anni per fini contrattuali)?

Una volta ricevute le risposte, l'implementazione richiede ~4 giornate.

---

## 7. Riferimenti

- File toccati: `models/User.js`, `models/MonteOreSettings.js` (nessuna modifica), `models/MonteOreProposal.js` (nessuna modifica), `routes/monteOre.js`, `routes/users.js`, `services/monteOreThresholdService.js` (nuovo), `lib/preSyncMigrations.js`.
- Frontend: `pages/admin/Users.tsx` (form override), `pages/admin/MonteOre.tsx` (badge soglia), `pages/MonteOre.tsx` (banner docente).
- Manuale admin: §8.9 "Casi limite" → aggiungere paragrafo "Docenti a contratto orario" che rimanda a questo documento.

---

_Cadenza · Analisi deroga Monte Ore contratto orario · 30 aprile 2026 · Danilo Russo_
