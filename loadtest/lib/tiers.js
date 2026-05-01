// =============================================================================
// Tre profili di carico mappati 1:1 sulle fasce dell'analisi VPS:
//   low    = "carico basso"     (≤ 25 req/s sostenute, 30–80 utenti simultanei)
//   medium = "carico medio"     (~80 req/s, 100–250 simultanei, burst 200)
//   high   = "carico alto"      (~200 req/s, 300–450 simultanei, limite VPS 4/4)
//
// Selezione: --env TIER=low|medium|high  (default: low)
//
// Tutti i numeri qui sono "arrival rate" (req/s che k6 INIETTA al server,
// indipendentemente dal tempo di risposta). Usiamo executor
// `constant-arrival-rate` perché è il modello giusto per misurare la
// capacità sostenuta: se il server rallenta, k6 alza il numero di VU per
// mantenere il tasso, e tu vedi nelle metriche dropped_iterations o
// vus_running che salgono → quello è il segnale di saturazione.
// =============================================================================

const TIERS = {
  low: {
    label: 'low',
    public: { rate: 15, duration: '3m', preAllocatedVUs: 30, maxVUs: 60 },
    auth:   { rate:  5, duration: '3m', preAllocatedVUs: 15, maxVUs: 40 },
    write:  { rate:  1, duration: '3m', preAllocatedVUs:  5, maxVUs: 15 },
  },
  medium: {
    label: 'medium',
    public: { rate: 50, duration: '5m', preAllocatedVUs: 100, maxVUs: 200 },
    auth:   { rate: 25, duration: '5m', preAllocatedVUs:  60, maxVUs: 150 },
    write:  { rate:  3, duration: '5m', preAllocatedVUs:  15, maxVUs:  40 },
  },
  high: {
    label: 'high',
    public: { rate: 130, duration: '7m', preAllocatedVUs: 250, maxVUs: 500 },
    auth:   { rate:  60, duration: '7m', preAllocatedVUs: 150, maxVUs: 350 },
    write:  { rate:   8, duration: '7m', preAllocatedVUs:  40, maxVUs: 100 },
  },
};

export function tier() {
  const t = (__ENV.TIER || 'low').toLowerCase();
  if (!TIERS[t]) {
    throw new Error(`TIER non valido: "${t}" (atteso: low|medium|high)`);
  }
  return TIERS[t];
}
