'use strict';

/**
 * Regole di autorizzazione per ruolo/proprietà, in un unico punto.
 * Funzioni pure (nessun I/O): `user` è l'utente autenticato (o un actor con
 * `id` e `role`), `ownerId` l'id dell'utente proprietario della risorsa.
 */
const { domainError } = require('./domainError');

function isAdmin(user) {
  return user?.role === 'admin';
}

function isOwner(user, ownerId) {
  return user?.id !== undefined && user.id !== null && user.id === ownerId;
}

function isOwnerOrAdmin(user, ownerId) {
  return isOwner(user, ownerId) || isAdmin(user);
}

/**
 * Lancia 403 FORBIDDEN ("Non autorizzato") se l'utente non è proprietario né admin.
 * @param {object} [opts] override di `code`/`message`
 */
function assertOwnerOrAdmin(
  user,
  ownerId,
  { code = 'FORBIDDEN', message = 'Non autorizzato' } = {},
) {
  if (!isOwnerOrAdmin(user, ownerId)) {
    throw domainError(code, message, { status: 403 });
  }
}

// ---------- Tabella dichiarativa delle azioni ----------
//
// Ogni azione è associata a una regola. Oggi nel codice le azioni su risorse
// "di proprietà" sono tutte: proprietario oppure admin, senza eccezioni per
// ruolo docente/studente (le differenze per ruolo vivono altrove: BookingRule,
// quote, finestre di cancellazione — non sono controlli di accesso).
const RULES = Object.freeze({
  ownerOrAdmin: (actor, resource) => isOwnerOrAdmin(actor, resource?.userId),
  admin: (actor) => isAdmin(actor),
});

const ACTIONS = Object.freeze({
  'booking:view': 'ownerOrAdmin',
  'booking:modify': 'ownerOrAdmin',
  // Solo la titolarità: la scadenza di cancellazione per ruolo resta in canCancel().
  'booking:cancel': 'ownerOrAdmin',
  'series:cancel': 'ownerOrAdmin',
  'series:view': 'ownerOrAdmin',
  'series:modify': 'ownerOrAdmin',
  'loan:view': 'ownerOrAdmin',
  'loan:modify': 'ownerOrAdmin',
  'loan:return': 'ownerOrAdmin',
  'loan:cancel': 'ownerOrAdmin',
  // Cancellare un prestito già attivo/restituito (pulizia inventario).
  'loan:cancel-processed': 'admin',
  'waitlist:remove': 'ownerOrAdmin',
  'concert:modify': 'ownerOrAdmin',
});

/**
 * @param {object} actor utente autenticato ({id, role})
 * @param {string} action chiave di ACTIONS (es. 'booking:cancel')
 * @param {object} [resource] risorsa con `userId` del proprietario
 * @returns {boolean} false per azioni sconosciute (deny by default)
 */
function can(actor, action, resource) {
  const rule = RULES[ACTIONS[action]];
  return rule ? rule(actor, resource) === true : false;
}

/** Lancia 403 (stesso errore di assertOwnerOrAdmin) se `can` è falso. */
function assertCan(
  actor,
  action,
  resource,
  { code = 'FORBIDDEN', message = 'Non autorizzato' } = {},
) {
  if (!can(actor, action, resource)) {
    throw domainError(code, message, { status: 403 });
  }
}

module.exports = {
  isAdmin,
  isOwner,
  isOwnerOrAdmin,
  assertOwnerOrAdmin,
  ACTIONS,
  can,
  assertCan,
};
