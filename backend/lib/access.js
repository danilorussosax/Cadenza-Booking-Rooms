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

module.exports = { isAdmin, isOwner, isOwnerOrAdmin, assertOwnerOrAdmin };
