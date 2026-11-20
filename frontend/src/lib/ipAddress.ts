/**
 * Loopback detection: ::1 (IPv6 puro), 127.0.0.0/8 (IPv4) e ::ffff:127.x.x.x
 * (IPv4-mapped). Lato backend extractClientIp/normalizeIp strippa già
 * ::ffff: dai valori IPv4-mapped, ma per robustezza lo gestiamo anche qui.
 */
export function isLoopbackIp(ip: string | null | undefined): boolean {
  return (
    !!ip &&
    (ip === '::1' ||
      ip === '0:0:0:0:0:0:0:1' ||
      ip.startsWith('127.') ||
      ip.startsWith('::ffff:127.'))
  );
}
