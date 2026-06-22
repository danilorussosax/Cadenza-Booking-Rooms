'use strict';

/**
 * Helper condiviso per "find-or-create" di utenti da provider OAuth
 * (Google, Microsoft, eventuali futuri SPID/CIE/SAML).
 *
 * Prima centralizzazione: passport.js aveva googleVerify e microsoftVerify
 * con logica copia-incollata. Qui isoliamo la regola "se esiste un User
 * con quel providerId riusa, altrimenti se esiste l'email collegala,
 * altrimenti crea pending" in un solo posto, così la whitelist domini
 * e i campi di default vivono in un unico flusso.
 */

const { User } = require('../../models');
const { isEmailAllowed, parseAllowedDomains } = require('../../lib/emailDomainPolicy');

/**
 * Errore lanciato dai verify callback OAuth quando il dominio dell'email
 * non rientra nella whitelist amministrativa. La route /callback lo intercetta
 * e redirige a /login con error=oauth_domain_not_allowed.
 */
class OAuthDomainNotAllowedError extends Error {
  constructor(domain) {
    super(`Dominio email non autorizzato: ${domain || 'sconosciuto'}`);
    this.code = 'OAUTH_DOMAIN_NOT_ALLOWED';
    this.domain = domain || null;
  }
}

/**
 * Provider → nome campo che persiste l'ID utente lato User model.
 * Aggiungere qui un nuovo provider è sufficiente: il resto del flusso non cambia.
 */
const PROVIDER_ID_FIELD = {
  google: 'googleId',
  microsoft: 'microsoftId',
};

/**
 * Legge la whitelist domini email dalle OAuth settings. In caso di errore
 * DB (es. tabella non ancora creata al primo avvio) ritorna `[]` = nessuna
 * restrizione.
 */
async function getAllowedEmailDomains() {
  try {
    const { OAuthSettings } = require('../../models');
    const row = await OAuthSettings.findOne({ where: { id: 1 } });
    return parseAllowedDomains(row?.allowedEmailDomains);
  } catch {
    return [];
  }
}

/**
 * Trova o crea un utente da un profilo OAuth.
 *
 * @param {object} args
 * @param {'google'|'microsoft'} args.provider - identifica il campo *Id da popolare.
 * @param {string} args.providerUserId - profile.id del provider.
 * @param {string} args.email - email del profilo (case-insensitive).
 * @param {string} args.firstName - nome dal profilo (fallback "Utente").
 * @param {string} args.lastName - cognome dal profilo (fallback al provider name).
 * @param {string[]} [args.allowedDomains] - whitelist iniettata per test;
 *        in produzione viene letta dal DB se omessa.
 * @param {string[]|null} [args.groups] - displayName gruppi M365 dell'utente
 *        (solo provider microsoft col gate attivo). Se valorizzato attiva la
 *        risoluzione ruolo + lo snapshot; se null/undefined comportamento legacy.
 * @returns {Promise<User>}
 * @throws {OAuthDomainNotAllowedError} se il dominio email non è in whitelist.
 */
async function findOrCreateOAuthUser({
  provider,
  providerUserId,
  email,
  firstName,
  lastName,
  allowedDomains,
  groups,
}) {
  const idField = PROVIDER_ID_FIELD[provider];
  if (!idField) {
    throw new Error(`Provider OAuth sconosciuto: ${provider}`);
  }
  if (!email) {
    throw new Error(`Email non disponibile dal profilo ${provider}`);
  }
  if (!providerUserId) {
    throw new Error(`ID utente non disponibile dal profilo ${provider}`);
  }

  const lowerEmail = String(email).toLowerCase();

  // Whitelist domini: applicata PRIMA di qualunque creazione/aggiornamento
  // utente, così l'amministratore può restringere l'accesso senza dover
  // bonificare account già creati. La lista è letta dal DB ad ogni login
  // (no caching) per non richiedere riavvio dopo una modifica.
  const allowed = Array.isArray(allowedDomains) ? allowedDomains : await getAllowedEmailDomains();
  if (!isEmailAllowed(lowerEmail, allowed)) {
    const domain = lowerEmail.split('@').pop();
    throw new OAuthDomainNotAllowedError(domain);
  }

  // Gate gruppi M365 (Decisione #2: M365 autoritativo, auto-sync ad ogni login).
  // Se `groups` è un array, risolviamo il ruolo dal mapping e prepariamo lo snapshot.
  let mappedRole = null;
  let snapshot = null;
  if (Array.isArray(groups)) {
    snapshot = groups.map((g) => String(g).toLowerCase());
    let settings = null;
    try {
      const { OAuthSettings } = require('../../models');
      settings = await OAuthSettings.findOne({ where: { id: 1 } });
    } catch {
      // tabella non ancora creata al primo avvio → resolver usa i default
    }
    const { loadCadenzaRules, resolveCadenzaRole } = require('../../lib/group-role-map');
    const rules = await loadCadenzaRules(settings);
    mappedRole = resolveCadenzaRole(snapshot, rules);
  }

  // 1) match per providerUserId — path "veloce" per chi ha già fatto login.
  let user = await User.findOne({ where: { [idField]: providerUserId } });
  if (user) return syncExistingOAuthUser(user, { mappedRole, snapshot });

  // 2) match per email — utenti registrati localmente al primo login OAuth:
  //    linkiamo l'ID provider senza duplicare.
  user = await User.findOne({ where: { email: lowerEmail } });
  if (user) {
    user[idField] = providerUserId;
    return syncExistingOAuthUser(user, { mappedRole, snapshot });
  }

  // 3) primo login.
  //    - gruppo M365 noto → crea già col ruolo mappato + status approved (no pending).
  //    - altrimenti → fallback legacy: pending con ruolo studente di default.
  const providerLabel = provider.charAt(0).toUpperCase() + provider.slice(1);
  return User.create({
    email: lowerEmail,
    [idField]: providerUserId,
    firstName: firstName || 'Utente',
    lastName: lastName || providerLabel,
    role: mappedRole || 'studente',
    status: mappedRole ? 'approved' : 'pending',
    m365Groups: snapshot || [],
  });
}

/**
 * Allinea un utente esistente al gruppo M365 (M365 autoritativo).
 * - aggiorna sempre lo snapshot `m365Groups` se fornito;
 * - se `mappedRole` è valorizzato e diverso → allinea il ruolo (promuove/cambia)
 *   e, se l'utente era 'pending', lo porta ad 'approved' (mai tocca 'rejected');
 * - GUARDRAIL: `mappedRole` null (nessun gruppo noto) → ruolo/stato INVARIATI
 *   (utenti gestiti a mano via dominio non vengono declassati).
 */
async function syncExistingOAuthUser(user, { mappedRole, snapshot }) {
  let changed = false;
  if (snapshot) {
    user.m365Groups = snapshot;
    changed = true;
  }
  if (user.changed(PROVIDER_ID_FIELD.microsoft) || user.changed(PROVIDER_ID_FIELD.google)) {
    changed = true;
  }
  if (mappedRole && user.role !== mappedRole) {
    const previous = user.role;
    user.role = mappedRole;
    if (user.status === 'pending') user.status = 'approved';
    changed = true;
    try {
      require('../../lib/logger').info(
        { userId: user.id, email: user.email, from: previous, to: mappedRole },
        'OAuth M365: ruolo allineato dal gruppo',
      );
    } catch {
      /* logger non disponibile, swallow */
    }
  }
  if (changed) await user.save();
  return user;
}

module.exports = {
  findOrCreateOAuthUser,
  getAllowedEmailDomains,
  OAuthDomainNotAllowedError,
};
