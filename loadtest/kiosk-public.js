// =============================================================================
// SCENARIO 1 — Kiosk display in polling sui pubblici.
//
// Cosa simula:
//   N display pubblici (atrio conservatorio, ingresso aule) che fanno
//   polling sui /api/public/* con la stessa cadenza prevista da
//   docs/analisivps.md §1.
//
// Endpoint colpiti (ratio realistico):
//   - /api/public/agenda      ~50% (è il chiamato più frequente)
//   - /api/public/stats       ~25%
//   - /api/public/announcements ~15%
//   - /api/public/concerts     ~7%
//   - /api/public/display-config ~3%
//
// Run:
//   k6 run --env BASE_URL=http://82.165.110.193:3000 --env TIER=medium loadtest/kiosk-public.js
//
// NB: zero auth → niente loginLimiter, niente token. Stressa solo Express
// + Sequelize + Postgres in lettura. È il workload più PURO da eseguire
// per primo: se il VPS non regge questo, non regge nulla.
// =============================================================================

import http from 'k6/http';
import { check, group } from 'k6';
import { tier } from './lib/tiers.js';
import { thresholdsFor } from './lib/thresholds.js';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
const T = tier();

export const options = {
  scenarios: {
    kiosk_polling: {
      executor: 'constant-arrival-rate',
      rate: T.public.rate,
      timeUnit: '1s',
      duration: T.public.duration,
      preAllocatedVUs: T.public.preAllocatedVUs,
      maxVUs: T.public.maxVUs,
    },
  },
  thresholds: thresholdsFor(),
  // Identifica il run nel resoconto finale e in eventuale output cloud.
  tags: { tier: T.label, scenario: 'kiosk-public' },
};

// Distribuzione realistica delle chiamate per ridurre il rumore.
// Si campiona un endpoint diverso ad ogni iterazione mantenendo il mix.
function pickEndpoint() {
  const r = Math.random();
  if (r < 0.50) return { path: '/api/public/agenda?date=' + isoDateOffset(0), label: 'agenda' };
  if (r < 0.75) return { path: '/api/public/stats', label: 'stats' };
  if (r < 0.90) return { path: '/api/public/announcements', label: 'announcements' };
  if (r < 0.97) return { path: '/api/public/concerts', label: 'concerts' };
  return { path: '/api/public/display-config', label: 'display-config' };
}

function isoDateOffset(days) {
  const d = new Date(Date.now() + days * 86400_000);
  return d.toISOString().slice(0, 10);
}

export default function () {
  group('public', () => {
    const ep = pickEndpoint();
    const res = http.get(`${BASE_URL}${ep.path}`, {
      tags: { name: ep.label, expected: 'true' },
    });
    check(res, {
      'status 200': (r) => r.status === 200,
      'body non vuoto': (r) => r.body && r.body.length > 0,
    });
  });
}

export function handleSummary(data) {
  const reqs = data.metrics.http_reqs?.values?.count ?? 0;
  const dur = data.metrics.http_req_duration?.values ?? {};
  const fails = data.metrics.http_req_failed?.values?.rate ?? 0;
  const summary = [
    '',
    `--- Kiosk public — TIER=${T.label} ---`,
    `Total requests:   ${reqs}`,
    `Throughput:       ${(reqs / parseDuration(T.public.duration)).toFixed(1)} req/s actual`,
    `Latency p50/p95/p99: ${msFmt(dur.med)} / ${msFmt(dur['p(95)'])} / ${msFmt(dur['p(99)'])}`,
    `Failure rate:     ${(fails * 100).toFixed(2)} %`,
    '',
  ].join('\n');
  return { stdout: summary };
}

function parseDuration(s) {
  const m = String(s).match(/(\d+)m/); const sec = String(s).match(/(\d+)s/);
  return (m ? +m[1] * 60 : 0) + (sec ? +sec[1] : 0);
}
function msFmt(v) { return v == null ? '-' : `${v.toFixed(0)}ms`; }
