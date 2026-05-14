'use strict';

/**
 * Helper per la whitelist di domini email applicata al login OAuth
 * (Google/Microsoft). Il dato è memorizzato in `oauth_settings.allowedEmailDomains`
 * come stringa CSV (es: "studenti.unimi.it, docenti.unimi.it").
 *
 * - parseAllowedDomains(raw): array normalizzato (lowercase, no '@', dedup)
 * - normalizeAllowedDomainsInput(raw): stringa canonica da salvare in DB
 * - isEmailAllowed(email, list): true se la whitelist è vuota o se il dominio
 *   match-a esattamente uno degli elementi (case-insensitive).
 */

function parseAllowedDomains(raw) {
  if (!raw || typeof raw !== 'string') return [];
  const parts = raw
    .split(/[,\s;]+/)
    .map((s) => s.trim().toLowerCase())
    // tollera un eventuale '@' davanti ("@example.com")
    .map((s) => s.replace(/^@/, ''))
    .filter(Boolean);
  return Array.from(new Set(parts));
}

function normalizeAllowedDomainsInput(raw) {
  const list = parseAllowedDomains(raw);
  return list.length ? list.join(',') : null;
}

function extractEmailDomain(email) {
  if (!email || typeof email !== 'string') return null;
  const at = email.lastIndexOf('@');
  if (at < 0 || at === email.length - 1) return null;
  return email
    .slice(at + 1)
    .toLowerCase()
    .trim();
}

function isEmailAllowed(email, allowedList) {
  const list = Array.isArray(allowedList) ? allowedList : parseAllowedDomains(allowedList);
  if (list.length === 0) return true; // nessuna restrizione
  const domain = extractEmailDomain(email);
  if (!domain) return false;
  return list.includes(domain);
}

module.exports = {
  parseAllowedDomains,
  normalizeAllowedDomainsInput,
  extractEmailDomain,
  isEmailAllowed,
};
