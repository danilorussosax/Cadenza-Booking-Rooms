// =============================================================================
// SCENARIO SOAK — traffico costante a basso volume per ore.
//
// Obiettivo: stanare bug "lenti" che non emergono in un run da 5–7 minuti:
//   - leak di memoria heap nel processo Node
//   - leak di file descriptor (socket non chiusi, fs.open senza close)
//   - esaurimento del pool Sequelize / dei prepared statement Postgres
//   - drift di latenza in funzione del tempo (event-loop saturation
//     che si manifesta solo dopo che la GC ha lavorato a lungo)
//
// Esegue un mix realistico ma READ-HEAVY: niente scritture per default,
// così il database non si gonfia e il test resta safe contro lo stato.
// Lo script-driver `soak.sh` campiona in parallelo memoria/FD del backend.
//
// Args ambiente:
//   HOURS=4              durata totale (default 4h). Accetta anche frazioni
//                        decimali (es. 0.01 = ~36s, utile per smoke).
//   RPS=5                arrival rate costante in req/s (default 5)
//   BASE_URL=http://...  default http://localhost:3001
//
// Run:
//   k6 run --env HOURS=4 --env RPS=5 --env BASE_URL=http://localhost:3001 \
//          loadtest/soak.js
// =============================================================================

import http from 'k6/http';
import { check, sleep } from 'k6';

const HOURS = Number(__ENV.HOURS || 4);
const RPS = Number(__ENV.RPS || 5);
const BASE = __ENV.BASE_URL || 'http://localhost:3001';

// k6 vuole una stringa con suffisso unità per "duration". Mappiamo:
//   - frazioni < 1m → secondi (utile per smoke a 0.01h ≈ 36s)
//   - >= 1m         → minuti
//   - >= 1h         → ore intere + minuti residui
function durationString(hours) {
  const totalSec = Math.max(1, Math.round(hours * 3600));
  if (totalSec < 60) return `${totalSec}s`;
  if (totalSec < 3600) return `${Math.round(totalSec / 60)}m`;
  const h = Math.floor(totalSec / 3600);
  const m = Math.round((totalSec - h * 3600) / 60);
  return m > 0 ? `${h}h${m}m` : `${h}h`;
}

export const options = {
  scenarios: {
    soak: {
      executor: 'constant-arrival-rate',
      duration: durationString(HOURS),
      rate: RPS,
      timeUnit: '1s',
      preAllocatedVUs: 20,
      maxVUs: 50,
      gracefulStop: '30s',
    },
  },
  thresholds: {
    // Soglie volutamente larghe — il soak non è uno stress test.
    // L'obiettivo è che le metriche restino STABILI nel tempo, non
    // ottimali. Drift > 30% nel report finale = sospetto leak.
    http_req_failed: ['rate<0.01'], // <1% errori HTTP
    http_req_duration: ['p(95)<500', 'p(99)<1500'],
  },
  tags: { scenario: 'soak', hours: String(HOURS), rps: String(RPS) },
  // Riduce il rumore nel summary finale.
  summaryTrendStats: ['avg', 'min', 'med', 'p(95)', 'p(99)', 'max'],
};

// Mix realistico read-heavy:
//   70% letture di endpoint pubblici (kiosk-like)
//   20% readiness probe (touch DB connection)
//   10% stats pubbliche
function pickEndpoint() {
  const r = Math.random();
  if (r < 0.7) return { path: '/api/public/agenda', label: 'agenda' };
  if (r < 0.9) return { path: '/api/ready', label: 'ready' };
  return { path: '/api/public/stats', label: 'stats' };
}

export default function () {
  const ep = pickEndpoint();
  const res = http.get(`${BASE}${ep.path}`, {
    tags: { name: ep.label, expected: 'true' },
    timeout: '10s',
  });
  check(res, {
    'status 2xx/3xx': (r) => r.status >= 200 && r.status < 400,
  });
  // sleep marginale: aiuta a distribuire il carico negli slot dell'arrival-rate
  // executor; non incide sul rate (è k6 a regolarlo).
  sleep(1);
}

export function handleSummary(data) {
  const reqs = data.metrics.http_reqs?.values?.count ?? 0;
  const dur = data.metrics.http_req_duration?.values ?? {};
  const fails = data.metrics.http_req_failed?.values?.rate ?? 0;
  const dropped = data.metrics.dropped_iterations?.values?.count ?? 0;
  const lines = [
    '',
    `--- Soak — HOURS=${HOURS} RPS=${RPS} ---`,
    `Total requests:      ${reqs}`,
    `Latency p50/p95/p99: ${msFmt(dur.med)} / ${msFmt(dur['p(95)'])} / ${msFmt(dur['p(99)'])}`,
    `Failure rate:        ${(fails * 100).toFixed(3)} %`,
    `Dropped iterations:  ${dropped}`,
    '',
  ];
  return { stdout: lines.join('\n') };
}

function msFmt(v) {
  return v == null ? '-' : `${v.toFixed(0)}ms`;
}
