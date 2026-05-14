#!/usr/bin/env node
/* eslint-disable no-console */
// =============================================================================
// Aggregatore del file JSONL prodotto da `sampler.js` durante il soak test.
//
// Calcola:
//   - durata effettiva del run
//   - memoria RSS: min / max / delta % (segnale di leak se +30%+ monotono)
//   - file descriptor: min / max / delta (segnale di leak se cresce monotono)
//   - /api/ready: p50, p95, p99, % errori
//   - grafico ASCII "memoria nel tempo" con blocchi unicode
//
// Args:
//   --in=<path.jsonl>    (obbligatorio) file di input prodotto dal sampler
//   --out=<path.md>      file markdown di output (default: derivato da --in)
//   --width=60           larghezza colonne grafico ASCII (default 60)
//   --json               stampa anche un summary JSON su stdout
//
// Solo built-in Node. Compatibile macOS + Linux.
// =============================================================================

'use strict';

const fs = require('fs');
const path = require('path');

// ---------- arg parse ----------
const args = {};
for (const a of process.argv.slice(2)) {
  if (!a.startsWith('--')) continue;
  const eq = a.indexOf('=');
  if (eq === -1) args[a.slice(2)] = true;
  else args[a.slice(2, eq)] = a.slice(eq + 1);
}

if (!args.in) {
  console.error('Uso: soak-report.js --in=<metrics.jsonl> [--out=<report.md>] [--width=60] [--json]');
  process.exit(2);
}
const inFile = String(args.in);
const width = Math.max(20, Math.min(200, Number(args.width || 60)));
const emitJson = Boolean(args.json);

if (!fs.existsSync(inFile)) {
  console.error(`File non trovato: ${inFile}`);
  process.exit(1);
}

const outFile = args.out
  ? String(args.out)
  : inFile.replace(/\.jsonl$/, '').replace(/soak-metrics-/, 'soak-report-') + '.md';

// ---------- read & parse ----------
const raw = fs.readFileSync(inFile, 'utf8').split(/\r?\n/).filter(Boolean);
const rows = [];
let malformed = 0;
for (const line of raw) {
  try {
    rows.push(JSON.parse(line));
  } catch {
    malformed++;
  }
}

if (rows.length === 0) {
  console.error(`Nessuna riga valida in ${inFile}`);
  process.exit(1);
}

// ---------- stats helpers ----------
function num(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function stats(values) {
  const xs = values.filter((v) => v !== null).slice().sort((a, b) => a - b);
  if (xs.length === 0) return null;
  const min = xs[0];
  const max = xs[xs.length - 1];
  const pct = (p) => xs[Math.min(xs.length - 1, Math.floor((xs.length - 1) * p))];
  const avg = xs.reduce((a, b) => a + b, 0) / xs.length;
  return {
    n: xs.length,
    min,
    max,
    avg,
    p50: pct(0.5),
    p95: pct(0.95),
    p99: pct(0.99),
    deltaPct: min > 0 ? ((max - min) / min) * 100 : null,
  };
}

const memSeries = rows.map((r) => num(r.memoryMb));
const fdSeries = rows.map((r) => num(r.fdCount));
const cpuSeries = rows.map((r) => num(r.cpuPct));
const readyMs = rows.map((r) => num(r.readyMs)).filter((v) => v !== null && v >= 0);
const readyStatuses = rows.map((r) => r.readyStatus);

const memStats = stats(memSeries);
const fdStats = stats(fdSeries);
const cpuStats = stats(cpuSeries);
const latStats = stats(readyMs);

const totalProbes = readyStatuses.length;
const okProbes = readyStatuses.filter((s) => typeof s === 'number' && s >= 200 && s < 400).length;
const errPct = totalProbes ? ((totalProbes - okProbes) / totalProbes) * 100 : 0;

const tStart = new Date(rows[0].t);
const tEnd = new Date(rows[rows.length - 1].t);
const elapsedMs = Math.max(0, tEnd.getTime() - tStart.getTime());

function fmtDuration(ms) {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

function fmt(v, suffix = '') {
  if (v == null) return '-';
  if (typeof v === 'number') return `${v.toFixed(1)}${suffix}`;
  return String(v);
}

// ---------- ASCII chart ----------
// Blocchi unicode bassi → alti
const BLOCKS = [' ', '▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'];

function sparkline(values, w) {
  const xs = values.filter((v) => v !== null);
  if (xs.length === 0) return '(no data)';
  const min = Math.min(...xs);
  const max = Math.max(...xs);
  // Downsample a w bucket: media di ogni bucket.
  const buckets = new Array(w).fill(null).map(() => ({ sum: 0, n: 0 }));
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v == null) continue;
    const idx = Math.min(w - 1, Math.floor((i / values.length) * w));
    buckets[idx].sum += v;
    buckets[idx].n += 1;
  }
  const range = max - min || 1;
  return buckets
    .map((b) => {
      if (b.n === 0) return ' ';
      const avg = b.sum / b.n;
      const norm = (avg - min) / range;
      const idx = Math.max(0, Math.min(BLOCKS.length - 1, Math.round(norm * (BLOCKS.length - 1))));
      return BLOCKS[idx];
    })
    .join('');
}

// ---------- leak verdict ----------
function verdict(s, label) {
  if (!s) return `- **${label}**: nessun dato campionato`;
  if (s.deltaPct == null) return `- **${label}**: solo 1 sample`;
  const delta = s.deltaPct;
  let tag;
  if (delta > 30) tag = '⚠️ SOSPETTO LEAK';
  else if (delta > 15) tag = '⚠ borderline';
  else tag = '✓ stabile';
  return `- **${label}**: min ${fmt(s.min)} / max ${fmt(s.max)} / Δ +${delta.toFixed(1)}% — ${tag}`;
}

// ---------- compose markdown ----------
const md = [];
md.push(`# Soak test report`);
md.push('');
md.push(`- Input: \`${path.basename(inFile)}\``);
md.push(`- Start: ${tStart.toISOString()}`);
md.push(`- End:   ${tEnd.toISOString()}`);
md.push(`- Duration: **${fmtDuration(elapsedMs)}**`);
md.push(`- Samples: ${rows.length}${malformed ? ` (${malformed} righe malformate ignorate)` : ''}`);
md.push('');
md.push('## Stabilità del processo backend');
md.push('');
md.push(verdict(memStats, 'Memoria RSS (MB)'));
md.push(verdict(fdStats, 'File descriptor aperti'));
if (cpuStats) {
  md.push(`- **CPU %**: avg ${fmt(cpuStats.avg)} / max ${fmt(cpuStats.max)}`);
}
md.push('');
md.push('## Latenza `/api/ready`');
md.push('');
if (latStats) {
  md.push(`- p50: ${fmt(latStats.p50)} ms`);
  md.push(`- p95: ${fmt(latStats.p95)} ms`);
  md.push(`- p99: ${fmt(latStats.p99)} ms`);
  md.push(`- max: ${fmt(latStats.max)} ms`);
} else {
  md.push('- nessun probe riuscito');
}
md.push(`- Probe totali: ${totalProbes} — errori: ${errPct.toFixed(2)}%`);
md.push('');
md.push('## Grafico ASCII');
md.push('');
md.push('```');
md.push(`memoria (RSS MB) min=${fmt(memStats?.min)} max=${fmt(memStats?.max)}`);
md.push(sparkline(memSeries, width));
md.push('');
md.push(`fd count          min=${fmt(fdStats?.min)} max=${fmt(fdStats?.max)}`);
md.push(sparkline(fdSeries, width));
md.push('');
md.push(`ready ms          min=${fmt(latStats?.min)} max=${fmt(latStats?.max)}`);
md.push(sparkline(rows.map((r) => num(r.readyMs)), width));
md.push('```');
md.push('');
md.push('## Come leggerlo');
md.push('');
md.push('- **Memoria stabile o oscillante attorno a una media**: OK, niente leak macroscopico.');
md.push('- **Memoria che cresce monotona con Δ > 30%**: sospetto leak. Profila con `clinic.js doctor` puntato al PID.');
md.push('- **FD count che cresce monotono**: leak di socket/file. Cerca `fs.createReadStream` senza `close`, o `net.Socket` non chiusi.');
md.push('- **Latenza ready che degrada nel tempo**: event loop saturato (GC lunga, query DB lente, lock).');

fs.writeFileSync(outFile, md.join('\n') + '\n');

// ---------- stdout digest ----------
const digestLines = [
  '',
  `Soak report → ${outFile}`,
  `Duration:    ${fmtDuration(elapsedMs)} (${rows.length} samples)`,
  `Memory MB:   ${memStats ? `${fmt(memStats.min)} → ${fmt(memStats.max)} (Δ ${memStats.deltaPct?.toFixed(1) ?? '-'}%)` : '-'}`,
  `FD count:    ${fdStats ? `${fmt(fdStats.min)} → ${fmt(fdStats.max)} (Δ ${fdStats.deltaPct?.toFixed(1) ?? '-'}%)` : '-'}`,
  `Ready p95:   ${latStats ? `${fmt(latStats.p95)} ms` : '-'}`,
  `Ready err:   ${errPct.toFixed(2)}%`,
  '',
];
console.log(digestLines.join('\n'));

if (emitJson) {
  console.log(JSON.stringify({
    durationMs: elapsedMs,
    samples: rows.length,
    memoryMb: memStats,
    fdCount: fdStats,
    cpuPct: cpuStats,
    readyMs: latStats,
    readyErrPct: errPct,
    out: outFile,
  }));
}
