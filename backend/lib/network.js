'use strict';

/**
 * Utility di rete per la restrizione check-in alla rete d'istituto.
 *
 * - validateCidr(cidr): { ok, normalized, error }
 *     Valida una stringa CIDR IPv4/IPv6 (es. '192.168.1.0/24', '2001:db8::/32').
 *
 * - extractClientIp(req): string
 *     Ritorna l'IP del client tenendo conto di trust proxy e header X-Forwarded-For.
 *     Express imposta req.ip in modo coerente quando `app.set('trust proxy', ...)`
 *     è configurato; altrimenti fallback a req.connection.remoteAddress.
 *
 * - isIpInCidrList(ip, cidrList): boolean
 *     True se l'IP cade in almeno un CIDR. Lista vuota → false.
 *     Normalizza IPv4 mappato in IPv6 (::ffff:192.168.1.1) prima del match.
 */

const ipaddr = require('ipaddr.js');

function validateCidr(cidr) {
  if (typeof cidr !== 'string' || !cidr.includes('/')) {
    return { ok: false, error: 'Formato CIDR non valido (atteso "ip/prefisso")' };
  }
  const trimmed = cidr.trim();
  try {
    const parsed = ipaddr.parseCIDR(trimmed);
    return { ok: true, normalized: `${parsed[0].toNormalizedString()}/${parsed[1]}` };
  } catch (err) {
    return { ok: false, error: err.message || 'CIDR non parsabile' };
  }
}

function extractClientIp(req) {
  // Express imposta req.ip in base a trust proxy. Fallback robusto.
  return (
    req.ip ||
    (req.connection && req.connection.remoteAddress) ||
    (req.socket && req.socket.remoteAddress) ||
    null
  );
}

/**
 * Normalizza un IP per la visualizzazione: rimuove il prefisso `::ffff:`
 * dagli indirizzi IPv4-mapped IPv6 (formato comune quando Express ascolta su
 * dual-stack IPv6). Esempi:
 *   '::ffff:192.168.1.234' → '192.168.1.234'
 *   '::1'                  → '::1'      (loopback IPv6 puro, mantenuto)
 *   '127.0.0.1'            → '127.0.0.1'
 *   null                   → null
 *
 * Usato per:
 *   - mostrare l'IP nel pannello admin in forma "umana"
 *   - costruire CIDR /32 quando l'admin clicca "Aggiungi mio IP corrente"
 */
function normalizeIp(ip) {
  if (!ip) return null;
  try {
    const parsed = ipaddr.parse(String(ip));
    if (parsed.kind() === 'ipv6' && parsed.isIPv4MappedAddress()) {
      return parsed.toIPv4Address().toString();
    }
    // Forma compatta (es. '::1' invece di '0:0:0:0:0:0:0:1') per UX.
    return parsed.toString();
  } catch {
    return String(ip);
  }
}

function isIpInCidrList(ip, cidrList) {
  if (!ip || !Array.isArray(cidrList) || cidrList.length === 0) return false;

  let parsed;
  try {
    parsed = ipaddr.parse(ip);
  } catch {
    return false;
  }

  // Normalizza ::ffff:1.2.3.4 (IPv4-mapped IPv6) → 1.2.3.4 per matching IPv4.
  if (parsed.kind() === 'ipv6' && parsed.isIPv4MappedAddress()) {
    parsed = parsed.toIPv4Address();
  }

  for (const cidr of cidrList) {
    try {
      const range = ipaddr.parseCIDR(String(cidr).trim());
      // ipaddr.js richiede stesso family su entrambi i lati per .match().
      if (parsed.kind() !== range[0].kind()) continue;
      if (parsed.match(range)) return true;
    } catch {
      // CIDR malformato in DB → skip silenzioso, log lasciato all'admin.
      continue;
    }
  }
  return false;
}

module.exports = {
  validateCidr,
  extractClientIp,
  isIpInCidrList,
  normalizeIp,
};
