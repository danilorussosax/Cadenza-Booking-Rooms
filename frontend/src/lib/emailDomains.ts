/**
 * Normalizza la whitelist di domini email digitata dall'admin: separatori
 * `,` `;` o spazi, lowercase, '@' iniziale tollerato, duplicati rimossi
 * (ordine di prima occorrenza).
 *
 * Specchio di `parseAllowedDomains` in backend/lib/emailDomainPolicy.js:
 * la parità è verificata da tests/lib/emailDomainsParity.test.ts.
 */
export function parseAllowedDomains(raw: string | null | undefined): string[] {
  if (!raw || typeof raw !== 'string') return [];
  const parts = raw
    .split(/[,\s;]+/)
    .map((s) => s.trim().toLowerCase())
    .map((s) => s.replace(/^@/, ''))
    .filter(Boolean);
  return Array.from(new Set(parts));
}
