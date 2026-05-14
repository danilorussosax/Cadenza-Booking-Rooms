'use strict';

/**
 * Mapping di default tra header CSV/XLSX di Isidata e campi `ExternalUser`.
 *
 * Isidata esporta in italiano e gli header reali variano leggermente per
 * release/istituto (case, spazi, accenti). Normalizziamo via `normalizeHeader`
 * (lowercase, trim, rimozione spazi e segni di punteggiatura) e cerchiamo il
 * primo header del CSV che corrisponde ad uno degli alias del campo target.
 *
 * L'admin può sovrascrivere il mapping per istituto via
 * IntegrationConfig.fieldMappingOverrides — formato:
 *
 *   { externalId: 'NumeroMatr', email: 'EmailIstituz', courseCode: 'CodiceCorso', ... }
 *
 * (i valori sono header del FILE; vengono normalizzati anch'essi).
 */

function normalizeHeader(s) {
  if (s === null || s === undefined) return '';
  return String(s)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip accenti
    .replace(/[^a-z0-9]+/g, ''); // strip spazi e punteggiatura
}

// Per ogni campo target, lista di alias (già normalizzati) che riconosciamo
// nel file Isidata. L'ORDINE conta: il primo match vince.
//
// NOTA su `contractType` vs `role`: entrambi possono attingere dall'header
// "qualifica" perché Isidata esporta in modo non standardizzato (a volte la
// colonna "Qualifica" contiene "Docente"/"Studente", altre volte "Titolare
// di cattedra"/"Contratto orario"). `role` viene risolto PRIMA (alias più
// specifici come "tipoutente", "figura"). Per `contractType` accettiamo
// alias dedicati ("tipocontratto", "tipologiacontratto") e in fallback la
// stessa "qualifica" — coerceContractType ritorna null se il testo non
// matcha alcuna keyword di contratto, così non sovrascriviamo nulla quando
// la colonna è in realtà un ruolo generico.
const DEFAULT_ALIASES = {
  externalId: ['matricola', 'idstudente', 'idutente', 'idanagrafica', 'codice', 'iddocente'],
  email: ['email', 'emailistituzionale', 'emailaccademica', 'mail', 'posta', 'emailpersonale'],
  firstName: ['nome', 'firstname', 'givenname', 'nomeproprio'],
  lastName: ['cognome', 'lastname', 'surname', 'familyname'],
  role: ['ruolo', 'tipo', 'tipoutente', 'figura', 'qualifica'],
  matricola: ['matricola', 'numerodimatricola', 'numeromatricola'],
  courseCode: ['codicecorso', 'corsocodice', 'codcorso', 'codiceindirizzo'],
  courseName: ['corso', 'nomecorso', 'descrizionecorso', 'indirizzo', 'classe'],
  status: ['stato', 'attivo', 'isactive', 'status', 'iscritto'],
  birthDate: ['datadinascita', 'datanascita', 'birthdate', 'dataancita'],
  contractType: [
    'tipocontratto',
    'tipologiacontratto',
    'tipologiacontrattuale',
    'contratto',
    'qualifica',
    'ruolo',
  ],
};

/**
 * Risolve, per un set di header reali del file, l'header che mappa al campo
 * `target`. Considera prima eventuali override admin, poi gli alias di default.
 *
 * @returns {string|null} l'header originale (case preserved) o null se non c'è.
 */
function resolveHeader(target, headers, overrides = null) {
  // 1. Override esplicito admin: l'admin ha specificato il nome dell'header
  //    nel file. Confrontiamo dopo normalizzazione su entrambe le sponde.
  if (overrides && overrides[target]) {
    const wantedNorm = normalizeHeader(overrides[target]);
    const found = headers.find((h) => normalizeHeader(h) === wantedNorm);
    if (found) return found;
  }
  // 2. Alias di default.
  const aliases = DEFAULT_ALIASES[target] || [];
  for (const alias of aliases) {
    const found = headers.find((h) => normalizeHeader(h) === alias);
    if (found) return found;
  }
  return null;
}

/**
 * Costruisce, per un set di header reali del file, una mappa
 * { externalId: 'Matricola', email: 'Email', ... } che indica QUALE header
 * del file fornisce QUALE campo target.
 */
function buildHeaderMap(headers, overrides = null) {
  const map = {};
  for (const target of Object.keys(DEFAULT_ALIASES)) {
    const h = resolveHeader(target, headers, overrides);
    if (h) map[target] = h;
  }
  return map;
}

/**
 * Coerce stringa di stato in 'active' | 'inactive'.
 *
 *   - 'attivo', 'iscritto', 's', 'si', 'sì', 'true', '1', 'a', 'active' → active
 *   - 'cessato', 'non iscritto', 'n', 'no', 'false', '0', 'i', 'inactive' → inactive
 *   - vuoto/sconosciuto → 'active' (default permissivo: importiamo, l'admin disattiva
 *     manualmente se serve)
 */
function coerceStatus(raw) {
  if (raw === null || raw === undefined) return 'active';
  const s = String(raw).trim().toLowerCase();
  if (s === '') return 'active';
  if (
    [
      'attivo',
      'iscritto',
      's',
      'si',
      'sì',
      'true',
      '1',
      'a',
      'active',
      'in corso',
      'incorso',
    ].includes(s)
  ) {
    return 'active';
  }
  if (
    [
      'cessato',
      'non iscritto',
      'noniscritto',
      'n',
      'no',
      'false',
      '0',
      'i',
      'inactive',
      'disattivato',
      'sospeso',
    ].includes(s)
  ) {
    return 'inactive';
  }
  return 'active';
}

/**
 * Coerce stringa di ruolo in 'docente' | 'studente'.
 *
 * Isidata usa terminologia variabile: "Docente", "Professore", "DOC", oppure
 * "Studente", "Allievo", "Iscritto", "STUD". Per casi ambigui (es. solo
 * codice numerico) ricadiamo su 'studente' (la maggior parte degli utenti
 * Isidata è studente).
 */
function coerceRole(raw) {
  if (raw === null || raw === undefined) return 'studente';
  const s = String(raw).trim().toLowerCase();
  if (s.startsWith('doc') || s.startsWith('prof')) return 'docente';
  if (s.startsWith('stud') || s.startsWith('all') || s.startsWith('iscr')) return 'studente';
  return 'studente';
}

/**
 * Coerce stringa di qualifica/tipo contratto in uno dei codici di
 * `ContractType.code` seed dell'app (`titolare` | `contratto_orario` |
 * `supplente` | `altro`). Strategia "keyword-match" non aggressiva:
 *
 *   - "titolare di cattedra", "ordinario", "cattedra" → 'titolare'
 *   - "contratto orario", "co.co.co.", "collaborazione" → 'contratto_orario'
 *   - "supplente", "supplenza" → 'supplente'
 *   - stringa vuota / nessun match → null
 *
 * `null` significa "non sovrascrivere": l'apply non tocca il campo lato DB.
 * Non c'è fuzzy match: se la segreteria scrive "ruolo provvisorio" non
 * cerchiamo di indovinare, restituiamo null e l'admin lo setterà a mano.
 */
function coerceContractType(raw) {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim().toLowerCase();
  if (s === '') return null;
  // Titolare: cattedra / ordinario / titolare.
  if (s.includes('titolare') || s.includes('ordinario') || s.includes('cattedra') || s === 'tit') {
    return 'titolare';
  }
  // Contratto orario: keyword "orario" o varianti "co.co.co"/"collabora".
  if (
    s.includes('orario') ||
    s.includes('co.co.co') ||
    s.includes('cococo') ||
    s.includes('collabora') ||
    s.includes('a contratto')
  ) {
    return 'contratto_orario';
  }
  // Supplenza: "supplente" / "supplenza" / abbreviazioni.
  if (s.startsWith('supp') || s.includes('supplen')) {
    return 'supplente';
  }
  return null;
}

function pick(row, headerMap, target) {
  const h = headerMap[target];
  if (!h) return null;
  const v = row[h];
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s.length > 0 ? s : null;
}

/**
 * Trasforma una riga "raw" del file (oggetto chiave=header originale) in un
 * ExternalUser canonico, applicando il mapping risolto da `buildHeaderMap`.
 *
 * Restituisce {ok: true, user} oppure {ok: false, msg} se la riga è inutile
 * (mancano i campi minimi: cognome+nome o externalId).
 */
function applyMapping(row, headerMap) {
  const externalId = pick(row, headerMap, 'externalId');
  const email = pick(row, headerMap, 'email');
  const firstName = pick(row, headerMap, 'firstName');
  const lastName = pick(row, headerMap, 'lastName');
  const matricola = pick(row, headerMap, 'matricola') ?? externalId;

  // Fallback: se firstName/lastName mancano ma c'è un campo "Nominativo" come
  // "Rossi Mario" (Cognome Nome), proviamo a splittarlo.
  let fn = firstName,
    ln = lastName;
  if (!fn || !ln) {
    const fullKey = Object.keys(row).find((k) =>
      /^(cognomenome|nominativo|fullname|nomecompleto)$/.test(
        String(k)
          .toLowerCase()
          .normalize('NFD')
          .replace(/[̀-ͯ]/g, '')
          .replace(/[^a-z0-9]+/g, ''),
      ),
    );
    if (fullKey && row[fullKey]) {
      const parts = String(row[fullKey]).trim().split(/\s+/);
      if (parts.length >= 2) {
        ln = ln || parts[0];
        fn = fn || parts.slice(1).join(' ');
      }
    }
  }

  if (!externalId && !email) {
    return { ok: false, msg: 'riga senza matricola né email — impossibile matchare' };
  }
  if (!fn || !ln) {
    return { ok: false, msg: 'riga senza nome o cognome' };
  }

  const role = coerceRole(pick(row, headerMap, 'role'));
  const status = coerceStatus(pick(row, headerMap, 'status'));
  const courseCode = pick(row, headerMap, 'courseCode');
  const courseName = pick(row, headerMap, 'courseName');
  // contractType: SOLO per i docenti. Gli studenti non hanno una tipologia
  // contrattuale, e includere il campo li farebbe finire nel diff di update
  // come se fossero cambiati a ogni import. Per i docenti il campo è
  // opzionale (null = non sovrascrivere).
  const contractType =
    role === 'docente' ? coerceContractType(pick(row, headerMap, 'contractType')) : null;

  // Fallback externalId quando manca matricola/id ma c'è email: usiamo
  // un prefisso `email_<sha-troncato>` invece di includere l'email cruda.
  // L'email cruda finisce sintetizzata in `import-${externalId}@imported.local`
  // dal route handler quando manca; un externalId tipo `email:foo@bar.com`
  // generava un local-part con `:` e `@` interni → `isEmail` falliva.
  let resolvedExternalId = externalId;
  if (!resolvedExternalId && email) {
    const tag = require('crypto')
      .createHash('sha1')
      .update(email.toLowerCase())
      .digest('hex')
      .slice(0, 12);
    resolvedExternalId = `email_${tag}`;
  }

  const user = {
    externalId: resolvedExternalId,
    email: email ? email.toLowerCase() : null,
    firstName: fn,
    lastName: ln,
    role,
    matricola,
    courseCode,
    courseName,
    status,
    raw: row,
  };
  // Aggiungiamo `contractType` solo quando ha senso (docente con valore
  // riconosciuto). Per gli studenti il campo resta del tutto assente
  // — non `null` — così il diff engine può distinguere "non fornito" da
  // "fornito esplicitamente come null" e non mandarlo in update.
  if (contractType !== null) {
    user.contractType = contractType;
  }
  return { ok: true, user };
}

/**
 * Valida e restituisce una versione "safe" di mappingOverrides ricevuto dal
 * client. L'admin invia JSON arbitrario: non vogliamo fidarci della shape.
 *
 * Regole:
 *   - dev'essere un plain object (no array, no null);
 *   - solo le chiavi note (DEFAULT_ALIASES) sono accettate, le altre vengono
 *     droppate silenziosamente — nessun pollution su targets sconosciuti;
 *   - i valori devono essere stringhe non-vuote ≤ 100 char (header reale del
 *     file); altri tipi vengono droppati;
 *   - se l'input è null/undefined, restituiamo null (mapping default).
 *
 * Lancia un Error con `code='VALIDATION_FAILED'` se l'input non è null/object.
 */
function sanitizeOverrides(input) {
  if (input === null || input === undefined) return null;
  if (typeof input !== 'object' || Array.isArray(input)) {
    const e = new Error('mappingOverrides deve essere un oggetto');
    e.code = 'VALIDATION_FAILED';
    throw e;
  }
  const out = {};
  const allowed = Object.keys(DEFAULT_ALIASES);
  for (const k of allowed) {
    // Hasown via Object.prototype per gestire oggetti senza prototype.
    if (!Object.prototype.hasOwnProperty.call(input, k)) continue;
    const v = input[k];
    if (typeof v !== 'string') continue;
    const trimmed = v.trim();
    if (!trimmed || trimmed.length > 100) continue;
    out[k] = trimmed;
  }
  return Object.keys(out).length > 0 ? out : null;
}

module.exports = {
  normalizeHeader,
  resolveHeader,
  buildHeaderMap,
  applyMapping,
  coerceRole,
  coerceStatus,
  coerceContractType,
  sanitizeOverrides,
  DEFAULT_ALIASES,
};
