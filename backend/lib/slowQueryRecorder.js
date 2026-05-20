'use strict';

/**
 * slowQueryRecorder — ring buffer in-memory per query Sequelize che superano
 * il threshold (default 500 ms). Pensato come "scatola nera" leggera per
 * vedere COSA rallenta in produzione senza dover analizzare i log Pino a
 * grep manuale.
 *
 * Caratteristiche:
 *   - ring buffer fisso (BUFFER_SIZE = 500). Quando pieno, scarta il più vecchio.
 *   - normalizzazione SQL: i valori parametrizzati vengono sostituiti con ?
 *     per evitare PII (es. email, matricole) nei log persistenti.
 *   - aggregate per route / model / pattern SQL con p50/p95/p99.
 *   - hook Sequelize: passa per `record()` solo se duration >= threshold.
 *   - zero-config: niente Redis, niente nuova tabella DB. Vive in memoria.
 *
 * Threshold:
 *   - `process.env.SLOW_QUERY_MS` (default 500). Imposta a 0 per loggare tutto
 *     (utile in dev quando si fa l'audit N+1).
 *
 * Persistenza opzionale (off di default):
 *   - se SLOW_QUERY_SNAPSHOT_PATH è valorizzato, ogni 5 minuti il buffer
 *     viene snapshottato come JSON. All'avvio se il file esiste, viene
 *     ripristinato. Utile per non perdere le ultime 24h di history su
 *     restart, ma costa ~100 KB ogni 5 min su disco.
 *
 * Niente accesso a req/res: il middleware requestContext.js mette
 * route/userId nell'AsyncLocalStorage, e il recorder li recupera quando
 * disponibili.
 */

const fs = require('fs');
const path = require('path');
const { getRequestContext } = require('../middleware/requestContext');

const DEFAULT_BUFFER_SIZE = 500;
const DEFAULT_THRESHOLD_MS = 500;
const SNAPSHOT_INTERVAL_MS = 5 * 60 * 1000;
const MAX_SQL_LEN_STORED = 1000;

const BUFFER_SIZE = Number(process.env.SLOW_QUERY_BUFFER || DEFAULT_BUFFER_SIZE);
const THRESHOLD_MS = Math.max(0, Number(process.env.SLOW_QUERY_MS ?? DEFAULT_THRESHOLD_MS));
const SNAPSHOT_PATH = process.env.SLOW_QUERY_SNAPSHOT_PATH || null;

const state = {
  buffer: [],
  head: 0,
  total: 0,
  startedAt: Date.now(),
  snapshotTimer: null,
  // Statistiche di service: quante record() chiamate ricevute,
  // quante effettivamente registrate (oltre il threshold).
  observed: 0,
  recorded: 0,
};

function normalizeSql(sql) {
  if (typeof sql !== 'string') return '';
  // Rimuove il prefisso "Executing (default): " di Sequelize.
  const stripped = sql.replace(/^Executing \([^)]+\):\s*/i, '');
  // Sostituisce stringhe quotate, numeri, NULL/TRUE/FALSE con ?.
  // Volontariamente "stupido": basta per dedup e per evitare PII grezza.
  return stripped
    .replace(/'(?:[^']|'')*'/g, '?')
    .replace(/\b\d+\b/g, '?')
    .replace(/\b(true|false|null)\b/gi, '?')
    .slice(0, MAX_SQL_LEN_STORED);
}

function patternKey(normalizedSql) {
  // Chiave aggregata: prime 80 char del normalized (collassa varianti
  // microscopiche di una stessa query).
  return normalizedSql.slice(0, 80);
}

/**
 * Registra una query osservata. Restituisce true se ha superato il threshold
 * ed è stata salvata, false altrimenti.
 *
 * @param {{ sql: string, durationMs: number, model?: string|null, params?: unknown[] }} arg
 */
function record({ sql, durationMs, model = null }) {
  state.observed += 1;
  if (!Number.isFinite(durationMs) || durationMs < THRESHOLD_MS) return false;

  const ctx = getRequestContext() || {};
  const normalized = normalizeSql(sql);
  const entry = {
    at: new Date().toISOString(),
    durationMs: Math.round(durationMs),
    sql: normalized,
    pattern: patternKey(normalized),
    model: model || null,
    route: ctx.route || null,
    method: ctx.method || null,
    userId: ctx.userId || null,
    requestId: ctx.requestId || null,
  };

  if (state.buffer.length < BUFFER_SIZE) {
    state.buffer.push(entry);
  } else {
    state.buffer[state.head] = entry;
    state.head = (state.head + 1) % BUFFER_SIZE;
  }
  state.recorded += 1;
  state.total += 1;
  return true;
}

function getAll() {
  // Restituisce gli entries dal più nuovo al più vecchio.
  if (state.buffer.length < BUFFER_SIZE) {
    return state.buffer.slice().reverse();
  }
  const ordered = [...state.buffer.slice(state.head), ...state.buffer.slice(0, state.head)];
  return ordered.reverse();
}

/**
 * Ritorna le query recenti. `since` può essere un Date / ISO string oppure
 * una stringa relativa tipo "24h" / "60m".
 */
function getRecent({ limit = 50, since = null, route = null } = {}) {
  let items = getAll();

  if (since) {
    const cutoff = parseSince(since);
    if (cutoff) items = items.filter((e) => new Date(e.at).getTime() >= cutoff);
  }
  if (route) items = items.filter((e) => e.route === route);

  return items.slice(0, Math.max(1, Math.min(limit, BUFFER_SIZE)));
}

function parseSince(value) {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value;
  if (typeof value !== 'string') return null;
  const m = value.match(/^(\d+)([smhd])$/);
  if (m) {
    const n = Number(m[1]);
    const mult = { s: 1e3, m: 60e3, h: 3.6e6, d: 86.4e6 }[m[2]];
    return Date.now() - n * mult;
  }
  const t = Date.parse(value);
  return Number.isNaN(t) ? null : t;
}

function percentile(sortedAsc, p) {
  if (sortedAsc.length === 0) return 0;
  const idx = Math.min(sortedAsc.length - 1, Math.floor((p / 100) * sortedAsc.length));
  return sortedAsc[idx];
}

/**
 * Aggrega gli entries per `by`: 'route' | 'model' | 'pattern'.
 * Ritorna array ordinato per durationMs.p95 desc.
 */
function getAggregate({ by = 'route', since = null, limit = 20 } = {}) {
  const validKeys = ['route', 'model', 'pattern'];
  if (!validKeys.includes(by)) return [];
  const items = since ? getRecent({ since, limit: BUFFER_SIZE }) : getAll();

  const groups = new Map();
  for (const e of items) {
    const key = e[by] || '(none)';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(e.durationMs);
  }

  const out = [];
  for (const [key, durations] of groups) {
    const sorted = [...durations].sort((a, b) => a - b);
    const sum = sorted.reduce((acc, n) => acc + n, 0);
    out.push({
      key,
      count: sorted.length,
      avgMs: Math.round(sum / sorted.length),
      p50: percentile(sorted, 50),
      p95: percentile(sorted, 95),
      p99: percentile(sorted, 99),
      maxMs: sorted[sorted.length - 1],
    });
  }
  out.sort((a, b) => b.p95 - a.p95);
  return out.slice(0, Math.max(1, Math.min(limit, 100)));
}

function getStats() {
  return {
    thresholdMs: THRESHOLD_MS,
    bufferSize: BUFFER_SIZE,
    bufferUsed: state.buffer.length,
    observed: state.observed,
    recorded: state.recorded,
    startedAt: new Date(state.startedAt).toISOString(),
  };
}

function clear() {
  state.buffer = [];
  state.head = 0;
  state.total = 0;
  state.observed = 0;
  state.recorded = 0;
  state.startedAt = Date.now();
}

// ------------- snapshot opzionale -------------

function loadSnapshot() {
  if (!SNAPSHOT_PATH) return;
  try {
    if (!fs.existsSync(SNAPSHOT_PATH)) return;
    const raw = fs.readFileSync(SNAPSHOT_PATH, 'utf8');
    const data = JSON.parse(raw);
    if (Array.isArray(data?.buffer)) {
      state.buffer = data.buffer.slice(-BUFFER_SIZE);
      state.head = 0;
    }
  } catch {
    // Snapshot corrotto: ignoriamo silenziosamente, ripartiamo da 0.
  }
}

function saveSnapshot() {
  if (!SNAPSHOT_PATH) return;
  try {
    const dir = path.dirname(SNAPSHOT_PATH);
    fs.mkdirSync(dir, { recursive: true });
    const data = { savedAt: new Date().toISOString(), buffer: getAll() };
    fs.writeFileSync(SNAPSHOT_PATH, JSON.stringify(data));
  } catch {
    // Disk full / permessi: niente da fare in process, il prossimo tick riproverà.
  }
}

function startSnapshotTimer() {
  if (!SNAPSHOT_PATH || state.snapshotTimer) return;
  state.snapshotTimer = setInterval(saveSnapshot, SNAPSHOT_INTERVAL_MS);
  state.snapshotTimer.unref?.();
}

function stopSnapshotTimer() {
  if (state.snapshotTimer) {
    clearInterval(state.snapshotTimer);
    state.snapshotTimer = null;
  }
}

// Bootstrap su require: carica snapshot precedente, avvia timer.
loadSnapshot();
startSnapshotTimer();

module.exports = {
  record,
  getRecent,
  getAggregate,
  getStats,
  clear,
  // utility esposte per test:
  _internal: { normalizeSql, patternKey, percentile, parseSince },
  // ops:
  saveSnapshot,
  stopSnapshotTimer,
};
