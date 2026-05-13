/**
 * Helper lato frontend per gestire la risposta `MODULE_DISABLED` del
 * backend. Quando una rotta protetta da `requireModuleEnabled(...)` riceve
 * una richiesta mentre il modulo è OFF, il server risponde con:
 *   { status: 404, payload: { code: 'MODULE_DISABLED', module: '<key>' } }
 *
 * Esportiamo qui l'unica utility, separata dal componente UI, per non
 * confondere react-refresh in dev (un file dovrebbe esportare solo
 * componenti React o solo utility, non un mix).
 */

export function isModuleDisabledError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { status?: number; payload?: { code?: string } };
  return e.status === 404 && e.payload?.code === 'MODULE_DISABLED';
}
