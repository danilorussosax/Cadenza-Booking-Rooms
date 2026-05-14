'use strict';

/**
 * Diff engine: confronta gli ExternalUser provenienti dal sistema sorgente
 * con gli User locali e calcola tre liste:
 *
 *   - toCreate:  nuovi utenti del sorgente, da inserire in Cadenza
 *   - toUpdate:  utenti già presenti, con campi divergenti tra sorgente e DB
 *   - toOrphan:  utenti locali con `externalSource = source` MA non presenti
 *                nel batch corrente del sorgente. Verranno disabilitati
 *                (isActive=false) — mai cancellati.
 *
 * Strategia di matching (priorità):
 *   1. matchBy='externalId': accoppia su (externalSource, externalId).
 *      È il più sicuro: l'externalId è stabile nel sistema sorgente.
 *   2. matchBy='matricola':  accoppia su matricola normalizzata.
 *      Utile quando l'export non porta un externalId esplicito ma la
 *      matricola è autoritativa.
 *   3. matchBy='email':      accoppia su email lowercase.
 *      Fallback "best effort": email può cambiare e creare false-positive.
 *
 * I match già fatti escludono il record dalla pool successiva: matchBy
 * indica solo la STRATEGIA primaria, ma in pratica si combinano (es. prima
 * proviamo externalId, se nullo l'email).
 *
 * Ai fini del campo `fieldsChanged`, confrontiamo dopo normalizzazione
 * (lowercase per email, trim per stringhe). Solo i campi della "snapshot
 * sincronizzabile" vengono comparati: ignoriamo password, 2FA, lastLogin
 * e altri attributi locali a Cadenza.
 */

// Campi che il diff confronta tra utente locale e snapshot esterno. `contractType`
// è incluso ma con semantica "opt-in": viene proposto come `update` solo se il
// record esterno lo specifica esplicitamente (non-null). Vedi `diffFields`.
const SYNCED_FIELDS = [
  'email',
  'firstName',
  'lastName',
  'role',
  'matricola',
  'isActive',
  'contractType',
];

// Soglie hardcoded per i warning di sicurezza pre-apply (Miglioria 1).
// Niente Settings — questi numeri proteggono dalle situazioni più ovvie
// (file di import troncato/filtrato dalla segreteria) senza richiedere
// configurazione lato admin.
const SAFETY_THRESHOLDS = {
  // Frazione del totale utenti attivi: oltre questa percentuale di
  // disattivazioni in un singolo import scatta il livello critical/warning.
  DEACTIVATE_RATIO_CRITICAL: 0.2, // >20% del totale → critical
  DEACTIVATE_RATIO_WARNING: 0.1, // >10% → warning
  // Conteggio assoluto: utile per istituzioni piccole dove anche il 20% è
  // un numero gestibile ma 50 utenti rimangono molti in valore assoluto.
  DEACTIVATE_COUNT_CRITICAL: 50,
  DEACTIVATE_COUNT_WARNING: 20,
  // Creazione di massa: spesso indica un import "verso fine anno" con
  // tutta la nuova coorte di matricole. Solo warning (non blocchiamo) —
  // un istituto medio ha 200-300 nuovi iscritti l'anno.
  CREATE_COUNT_WARNING: 100,
};

function normEmail(s) {
  return s ? String(s).trim().toLowerCase() : null;
}
function normString(s) {
  return s == null ? null : String(s).trim();
}
function normMatricola(s) {
  if (s == null) return null;
  return String(s).trim().replace(/^0+/, ''); // ignora leading-zero (caso classico Excel)
}

function externalToSnapshot(ext) {
  const snap = {
    externalSource: 'isidata',
    externalId: ext.externalId ?? null,
    email: normEmail(ext.email),
    firstName: normString(ext.firstName),
    lastName: normString(ext.lastName),
    role: ext.role,
    matricola: normString(ext.matricola),
    courseCode: ext.courseCode ?? null,
    courseName: ext.courseName ?? null,
    isActive: ext.status === 'active',
  };
  // contractType: presente solo se applyMapping l'ha valorizzato (docente con
  // valore riconosciuto). Lasciamo `undefined` quando l'origine non lo fornisce
  // così `diffFields` può saltare il confronto e non generare update spurio.
  if (Object.prototype.hasOwnProperty.call(ext, 'contractType') && ext.contractType != null) {
    snap.contractType = ext.contractType;
  }
  return snap;
}

function localToSnapshot(u) {
  return {
    externalSource: u.externalSource ?? null,
    externalId: u.externalId ?? null,
    email: normEmail(u.email),
    firstName: normString(u.firstName),
    lastName: normString(u.lastName),
    role: u.role,
    matricola: normString(u.matricola),
    isActive: !!u.isActive,
    contractType: u.contractType ?? null,
  };
}

/**
 * Confronta i campi sincronizzabili e restituisce l'array dei campi divergenti.
 * Esclude `externalSource`/`externalId` perché sono "metadata" del legame e
 * non valori di profilo (vengono valorizzati lato local in modo idempotente).
 */
function diffFields(local, ext) {
  const changed = [];
  for (const f of SYNCED_FIELDS) {
    const a = local[f];
    const b = ext[f];
    // contractType è opt-in: se l'esterno non lo fornisce (undefined/null)
    // NON proponiamo update — l'utente locale può avere un contractType
    // settato manualmente e non vogliamo sovrascriverlo con un import che
    // non porta quel dato.
    if (f === 'contractType') {
      if (b == null) continue;
      if (a !== b) changed.push(f);
      continue;
    }
    // Per matricola: confrontiamo dopo normalizzazione leading-zero.
    if (f === 'matricola') {
      if (normMatricola(a) !== normMatricola(b)) changed.push(f);
      continue;
    }
    // Email: case-insensitive.
    if (f === 'email') {
      if (normEmail(a) !== normEmail(b)) changed.push(f);
      continue;
    }
    if (a !== b) changed.push(f);
  }
  return changed;
}

/**
 * Calcola i warning di sicurezza pre-apply (Miglioria 1).
 *
 * @param {object} diff — risultato di computeDiff
 * @param {number} totalActiveUsers — count totale di utenti del provider
 *        (es. `User.count({where:{externalSource:source}})`). Serve per
 *        calcolare la "frazione" di disattivazioni.
 * @returns {{totalActiveUsers, deactivateCount, createCount, deactivateRatio, warnings}}
 *
 * `warnings` è un array di `{level, code, message}` dove:
 *   - level='critical' richiede una conferma esplicita aggiuntiva dell'admin
 *     (vedi route `/apply` `confirmCriticalWarnings`);
 *   - level='warning' è informativo (UI lo mostra ma non blocca).
 */
function computeSafetyChecks(diff, totalActiveUsers) {
  const total = Math.max(0, Number(totalActiveUsers) || 0);
  const deactivateCount = diff.toOrphan.length;
  const createCount = diff.toCreate.length;
  // Evitiamo divisione per zero quando il provider non ha ancora utenti:
  // in quel caso ratio=0, niente warning di mass-deactivation (e infatti
  // deactivateCount sarà 0 perché non c'è nulla da disattivare).
  const deactivateRatio = total > 0 ? deactivateCount / total : 0;
  const warnings = [];

  // Mass deactivation: combinazione ratio + soglia assoluta.
  // Critical batte warning — usiamo SOLO la voce critical se entrambe matchano.
  const ratioPct = Math.round(deactivateRatio * 100);
  if (
    deactivateRatio > SAFETY_THRESHOLDS.DEACTIVATE_RATIO_CRITICAL ||
    deactivateCount >= SAFETY_THRESHOLDS.DEACTIVATE_COUNT_CRITICAL
  ) {
    warnings.push({
      level: 'critical',
      code: 'MASS_DEACTIVATION',
      message: `Saranno disattivati ${deactivateCount} utenti${
        total > 0 ? ` (${ratioPct}% del totale, ${deactivateCount}/${total})` : ''
      }. Verifica che il file di import sia completo prima di proseguire.`,
    });
  } else if (
    deactivateRatio > SAFETY_THRESHOLDS.DEACTIVATE_RATIO_WARNING ||
    deactivateCount >= SAFETY_THRESHOLDS.DEACTIVATE_COUNT_WARNING
  ) {
    warnings.push({
      level: 'warning',
      code: 'MASS_DEACTIVATION',
      message: `Saranno disattivati ${deactivateCount} utenti${
        total > 0 ? ` (${ratioPct}% del totale)` : ''
      }. Controlla che corrispondano agli utenti effettivamente non più presenti.`,
    });
  }

  // Mass creation: solo warning (mai critical: aggiungere utenti è meno
  // rischioso che disattivarli; al peggio l'admin "pulisce" dopo).
  if (createCount >= SAFETY_THRESHOLDS.CREATE_COUNT_WARNING) {
    warnings.push({
      level: 'warning',
      code: 'MASS_CREATION',
      message: `Saranno creati ${createCount} nuovi utenti. Controlla che non siano duplicati di utenti esistenti con matricola/email leggermente diversa.`,
    });
  }

  return {
    totalActiveUsers: total,
    deactivateCount,
    createCount,
    deactivateRatio,
    warnings,
  };
}

/**
 * @param {ExternalUser[]} externalUsers
 * @param {User[]} localUsers — solo gli utenti che hanno externalSource=source
 *                              OPPURE quelli con email/matricola che potrebbe
 *                              fare match. Per semplicità il caller passa tutti
 *                              gli utenti "approved or pending" + "external" e
 *                              questa funzione filtra.
 * @param {'externalId'|'matricola'|'email'} matchBy
 * @param {string} source — es. 'isidata'. Usato per la detection orphan.
 * @param {object} [options]
 * @param {Map<string,number>} [options.courseCodeToId] — pre-caricata dal
 *        chiamante via `Course.findAll`. Quando presente, ogni record con
 *        `courseCode` valorizzato viene risolto verso `courseId`; codici
 *        sconosciuti finiscono in `warnings` (soft, NON bloccante).
 *
 * @returns {{toCreate, toUpdate, toOrphan, warnings}} dove `warnings` è
 *        l'array soft (vs. `safetyChecks.warnings` che è bloccante).
 */
function computeDiff(
  externalUsers,
  localUsers,
  matchBy = 'matricola',
  source = 'isidata',
  options = {},
) {
  const courseCodeToId = options.courseCodeToId instanceof Map ? options.courseCodeToId : null;
  const warnings = [];
  // Conta le occorrenze per courseCode sconosciuto: aggreghiamo nel warning
  // così la UI non mostra una riga per ogni studente con lo stesso codice.
  const unknownCourseAgg = new Map(); // courseCode → count
  // Indici di lookup veloce sugli utenti locali.
  const byExternal = new Map(); // (source, externalId) → user
  const byMatricola = new Map(); // matricola normalizzata → user
  const byEmail = new Map(); // email lowercased → user

  for (const u of localUsers) {
    if (u.externalSource && u.externalId) {
      byExternal.set(`${u.externalSource}::${u.externalId}`, u);
    }
    const m = normMatricola(u.matricola);
    if (m) byMatricola.set(m, u);
    const e = normEmail(u.email);
    if (e) byEmail.set(e, u);
  }

  // Per gli orphan: utenti che hanno externalSource=source nel DB e che NON
  // riusciamo a matchare ad alcun ExternalUser. Li raccogliamo a posteriori.
  const matchedLocalIds = new Set();

  const toCreate = [];
  const toUpdate = [];

  for (const ext of externalUsers) {
    const snap = externalToSnapshot(ext);

    // Risoluzione courseCode → courseId (Miglioria 3). Effetto collaterale:
    // muta `ext.courseId` quando il codice corso è noto, così route /apply
    // può semplicemente leggere ext.courseId senza ricalcolare il lookup.
    // I codici sconosciuti vengono aggregati in `unknownCourseAgg` e
    // riportati a fine ciclo come warning soft (non bloccante).
    if (courseCodeToId && ext.courseCode) {
      const courseId = courseCodeToId.get(String(ext.courseCode).trim());
      if (courseId) {
        ext.courseId = courseId;
      } else {
        const key = String(ext.courseCode).trim();
        unknownCourseAgg.set(key, (unknownCourseAgg.get(key) ?? 0) + 1);
      }
    }

    // Strategia di lookup combinata, in ordine deterministico.
    let local = null;
    const tryers = [];
    if (matchBy === 'externalId') {
      tryers.push(() => (snap.externalId ? byExternal.get(`${source}::${snap.externalId}`) : null));
      tryers.push(() => (snap.matricola ? byMatricola.get(normMatricola(snap.matricola)) : null));
      tryers.push(() => (snap.email ? byEmail.get(snap.email) : null));
    } else if (matchBy === 'matricola') {
      tryers.push(() => (snap.matricola ? byMatricola.get(normMatricola(snap.matricola)) : null));
      tryers.push(() => (snap.externalId ? byExternal.get(`${source}::${snap.externalId}`) : null));
      tryers.push(() => (snap.email ? byEmail.get(snap.email) : null));
    } else {
      // email
      tryers.push(() => (snap.email ? byEmail.get(snap.email) : null));
      tryers.push(() => (snap.externalId ? byExternal.get(`${source}::${snap.externalId}`) : null));
      tryers.push(() => (snap.matricola ? byMatricola.get(normMatricola(snap.matricola)) : null));
    }
    for (const t of tryers) {
      const r = t();
      if (r) {
        local = r;
        break;
      }
    }

    if (!local) {
      toCreate.push(ext);
      continue;
    }

    matchedLocalIds.add(local.id);

    const localSnap = localToSnapshot(local);
    const fieldsChanged = diffFields(localSnap, snap);

    // Anche se nessun campo profilo è cambiato, se il legame externalId è
    // mancante o difforme, lo settiamo: lo trattiamo come "update minore"
    // così la pagina admin lo evidenzia (e l'externalId viene fissato).
    const linkChanged = local.externalSource !== source || local.externalId !== snap.externalId;
    if (fieldsChanged.length > 0 || linkChanged) {
      toUpdate.push({ local, external: ext, fieldsChanged, linkChanged });
    }
  }

  // Orphan: locali con externalSource=source che non sono stati matchati.
  // Esclude gli admin: non vogliamo mai disabilitare un admin per un import
  // di studenti/docenti.
  const toOrphan = localUsers.filter(
    (u) => u.externalSource === source && u.role !== 'admin' && !matchedLocalIds.has(u.id),
  );

  // Emette i warning soft per codici corso sconosciuti. Aggreghiamo per
  // courseCode così se 30 studenti hanno tutti "PNF-001" non in catalogo,
  // la UI mostra una sola riga "30 utenti con courseCode PNF-001 ignorato".
  for (const [code, count] of unknownCourseAgg) {
    warnings.push({
      code: 'UNKNOWN_COURSE_CODE',
      courseCode: code,
      count,
      msg: `${count} utent${count === 1 ? 'e' : 'i'} con courseCode "${code}" non riconosciuto: courseId non impostato. Verifica il catalogo corsi.`,
    });
  }

  return { toCreate, toUpdate, toOrphan, warnings };
}

module.exports = {
  computeDiff,
  computeSafetyChecks,
  diffFields,
  externalToSnapshot,
  localToSnapshot,
  SYNCED_FIELDS,
  SAFETY_THRESHOLDS,
};
