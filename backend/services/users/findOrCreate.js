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

  // 1) match per providerUserId — il path "veloce" per utenti che hanno
  //    già fatto login una volta.
  let user = await User.findOne({ where: { [idField]: providerUserId } });
  if (user) return user;

  // 2) match per email — utenti registrati localmente che fanno il primo
  //    login OAuth: linkiamo l'ID provider senza duplicare.
  user = await User.findOne({ where: { email: lowerEmail } });
  if (user) {
    user[idField] = providerUserId;
    await user.save();
    return user;
  }

  // 3) primo login: crea utente "pending" con ruolo studente di default.
  //    L'admin lo approverà esplicitamente, oppure l'utente completerà il
  //    profilo (scelta ruolo studente/docente + matricola/corso).
  const providerLabel = provider.charAt(0).toUpperCase() + provider.slice(1);
  return User.create({
    email: lowerEmail,
    [idField]: providerUserId,
    firstName: firstName || 'Utente',
    lastName: lastName || providerLabel,
    role: 'studente',
    status: 'pending',
  });
}

module.exports = {
  findOrCreateOAuthUser,
  getAllowedEmailDomains,
  OAuthDomainNotAllowedError,
};
