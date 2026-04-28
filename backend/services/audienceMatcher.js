'use strict';

/**
 * Helpers per il matching dell'audience di un Announcement.
 *
 * Forme di audience supportate:
 *   { kind: 'all' }                  → tutti gli utenti
 *   { kind: 'role',     value }      → un singolo ruolo
 *   { kind: 'course',   value }      → studenti del corso (Course.id)
 *   { kind: 'building', value }      → solo kiosk (NON nel feed user)
 *
 * `kind='building'` è gestita separatamente: l'utente non ha un edificio,
 * quindi nel feed personale viene saltata. Lo si vede solo sul kiosk
 * dell'edificio target.
 */

const VALID_KINDS = ['all', 'role', 'course', 'building'];
const VALID_ROLES = ['admin', 'docente', 'studente'];

function normalizeAudience(input) {
  if (!input || typeof input !== 'object') return { kind: 'all' };
  const kind = VALID_KINDS.includes(input.kind) ? input.kind : 'all';
  if (kind === 'all') return { kind: 'all' };
  const value = input.value;
  if (kind === 'role') {
    return VALID_ROLES.includes(value) ? { kind: 'role', value } : { kind: 'all' };
  }
  // course / building → id numerico
  const num = Number(value);
  if (!Number.isInteger(num) || num <= 0) return { kind: 'all' };
  return { kind, value: num };
}

/**
 * Determina se uno specifico utente fa match con un'audience.
 * (Usato in /api/announcements per il filtro feed personale.)
 */
function audienceMatchesUser(audience, user) {
  if (!user) return false;
  const a = normalizeAudience(audience);
  if (a.kind === 'all') return true;
  if (a.kind === 'role') return user.role === a.value;
  if (a.kind === 'course') return Number(user.courseId) === Number(a.value);
  // 'building': l'utente non ha un edificio → mai match nel feed user.
  return false;
}

/**
 * Costruisce un WHERE Sequelize che seleziona gli utenti destinatari di
 * un'audience (per il broadcast email).
 *
 * Ritorna `null` se l'audience non ha destinatari espressi via User
 * (es. 'building' → solo kiosk, niente email).
 */
function audienceMatchesUserWhere(audience) {
  const a = normalizeAudience(audience);
  if (a.kind === 'all') return {};
  if (a.kind === 'role') return { role: a.value };
  if (a.kind === 'course') return { courseId: a.value };
  // 'building' → null = nessun destinatario via email
  return null;
}

module.exports = {
  VALID_KINDS,
  normalizeAudience,
  audienceMatchesUser,
  audienceMatchesUserWhere,
};
