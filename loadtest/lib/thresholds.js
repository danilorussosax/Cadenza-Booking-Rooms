// =============================================================================
// SLO/threshold condivisi. Se uno fallisce, k6 esce con codice 99 e CI
// può segnalare regressione di performance.
//
// Le soglie sono CONSAPEVOLI del fatto che Cadenza gira su un VPS
// 4 vCPU / 4 GB con Postgres co-residente. Sono pensate per "ok per
// uso reale", non per benchmark teorici.
// =============================================================================

export const slo = {
  // Latency budget per categoria di richiesta. p95 perché il p99 è
  // dominato da garbage collector di Node + checkpoint di Postgres.
  publicLatency: ['p(95)<400', 'p(99)<1500'],   // /api/public/* — kiosk, polling, no auth
  authLatency:   ['p(95)<600', 'p(99)<2000'],   // GET /api/* autenticati
  writeLatency:  ['p(95)<1200', 'p(99)<3500'],  // POST /api/bookings — transazione + validator + audit log

  // Errori HTTP. Tolleriamo:
  //   - rate limit 429 (default 300 req/min/IP) se il TIER spinge oltre — è atteso
  //   - validation 400 sui POST quando lo slot è già occupato (collisione)
  // Errori 5xx = sempre regressione.
  httpFailRate: ['rate<0.02'],          // <2% di 5xx complessivi
  serverErrors: ['count<10'],           // hard cap su 5xx in tutto il run
};

// Combina più array di threshold in un oggetto k6 `thresholds: {...}`.
export function thresholdsFor(opts = {}) {
  const out = {
    'http_req_failed{expected:true}': slo.httpFailRate,
    'http_req_duration{group:public}': slo.publicLatency,
    'http_req_duration{group:auth}': slo.authLatency,
    'http_req_duration{group:write}': slo.writeLatency,
    'http_reqs{status:5xx}': slo.serverErrors,
  };
  return { ...out, ...(opts.extra || {}) };
}
