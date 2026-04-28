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

const SYNCED_FIELDS = ['email', 'firstName', 'lastName', 'role', 'matricola', 'isActive'];

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
  return {
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
    let b = ext[f];
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
 * @param {ExternalUser[]} externalUsers
 * @param {User[]} localUsers — solo gli utenti che hanno externalSource=source
 *                              OPPURE quelli con email/matricola che potrebbe
 *                              fare match. Per semplicità il caller passa tutti
 *                              gli utenti "approved or pending" + "external" e
 *                              questa funzione filtra.
 * @param {'externalId'|'matricola'|'email'} matchBy
 * @param {string} source — es. 'isidata'. Usato per la detection orphan.
 *
 * @returns {{toCreate, toUpdate, toOrphan}}
 */
function computeDiff(externalUsers, localUsers, matchBy = 'matricola', source = 'isidata') {
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

  return { toCreate, toUpdate, toOrphan };
}

module.exports = {
  computeDiff,
  diffFields,
  externalToSnapshot,
  localToSnapshot,
  SYNCED_FIELDS,
};
