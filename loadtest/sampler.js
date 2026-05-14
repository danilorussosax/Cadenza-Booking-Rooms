#!/usr/bin/env node
/* eslint-disable no-console */
// =============================================================================
// Sampler di sistema per soak test.
//
// Ogni N secondi scrive una riga JSON Lines con:
//   - timestamp ISO
//   - PID del backend (pm2 o --pid override)
//   - memoria RSS in MB (da pm2 jlist se disponibile)
//   - CPU % (idem)
//   - count di file descriptor aperti (lsof -p <PID>)
//   - status e latenza ms di una GET su /api/ready
//
// Args:
//   --interval=30      secondi tra sample (default: 30)
//   --out=path.jsonl   file di output (default: ./soak-metrics.jsonl)
//   --url=http://...   base URL backend (default: http://localhost:3001)
//   --pid=12345        override PID (skip pm2 jlist). Memoria/CPU mancanti.
//   --pm2-name=name    nome processo pm2 (default: cadenza-backend)
//   --quiet            non stampare ogni riga su stdout (solo errori)
//
// Solo built-in Node: http, fs, child_process. Niente npm install.
//
// Termina con SIGINT/SIGTERM: stampa "[sampler] stop" ed esce 0.
// =============================================================================

'use strict';

const fs = require('fs');
const { execSync } = require('child_process');
const http = require('http');
const https = require('https');
const { URL } = require('url');

// ---------- arg parse (minimale, niente dipendenze) ----------
const args = {};
for (const a of process.argv.slice(2)) {
  if (!a.startsWith('--')) continue;
  const eq = a.indexOf('=');
  if (eq === -1) {
    args[a.slice(2)] = true;
  } else {
    args[a.slice(2, eq)] = a.slice(eq + 1);
  }
}

const intervalMs = Math.max(1, Number(args.interval ?? 30)) * 1000;
const outFile = String(args.out ?? 'soak-metrics.jsonl');
const baseUrl = String(args.url ?? 'http://localhost:3001');
const pm2Name = String(args['pm2-name'] ?? 'cadenza-backend');
const pidOverride = args.pid ? Number(args.pid) : null;
const quiet = Boolean(args.quiet);

// ---------- helpers ----------
function getPm2Process() {
  try {
    const out = execSync('pm2 jlist', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 5000,
    });
    const list = JSON.parse(out);
    if (!Array.isArray(list)) return null;
    return list.find((p) => p && p.name === pm2Name) || null;
  } catch {
    return null;
  }
}

function getFdCount(pid) {
  if (!pid || pid <= 0) return -1;
  try {
    // -p <PID> + -a (AND) garantisce che usciamo con righe del solo processo.
    // wc -l su macOS aggiunge spazi davanti → trim e Number.
    const out = execSync(`lsof -p ${pid} 2>/dev/null | wc -l`, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 5000,
      shell: '/bin/sh',
    });
    const n = Number(String(out).trim());
    return Number.isFinite(n) ? n : -1;
  } catch {
    return -1;
  }
}

function probeReady() {
  return new Promise((resolve) => {
    let url;
    try {
      url = new URL('/api/ready', baseUrl);
    } catch {
      return resolve({ status: 0, latencyMs: -1, error: 'bad_url' });
    }
    const start = Date.now();
    const lib = url.protocol === 'https:' ? https : http;
    const req = lib.get(url, (res) => {
      const elapsed = Date.now() - start;
      // Drena il body per liberare il socket.
      res.on('data', () => {});
      res.on('end', () => resolve({ status: res.statusCode || 0, latencyMs: elapsed }));
    });
    req.on('error', (err) => {
      resolve({ status: 0, latencyMs: -1, error: err.code || err.message });
    });
    req.setTimeout(5000, () => {
      req.destroy(new Error('timeout'));
      resolve({ status: 0, latencyMs: -1, error: 'timeout' });
    });
  });
}

// ---------- main tick ----------
let stopping = false;
let timer = null;

async function tick() {
  if (stopping) return;
  let pid = pidOverride;
  let memoryMb = null;
  let cpuPct = null;

  if (!pidOverride) {
    const proc = getPm2Process();
    if (proc) {
      pid = proc.pid || (proc.pm2_env && proc.pm2_env.pid) || null;
      const memBytes = proc.monit && proc.monit.memory;
      if (memBytes && Number.isFinite(memBytes)) {
        memoryMb = Math.round((memBytes / 1024 / 1024) * 10) / 10;
      }
      const cpu = proc.monit && proc.monit.cpu;
      if (Number.isFinite(cpu)) cpuPct = cpu;
    }
  }

  const fdCount = pid ? getFdCount(pid) : -1;
  const ready = await probeReady();

  const row = {
    t: new Date().toISOString(),
    pid: pid || null,
    memoryMb,
    cpuPct,
    fdCount,
    readyStatus: ready.status,
    readyMs: ready.latencyMs,
  };
  if (ready.error) row.readyError = ready.error;

  try {
    fs.appendFileSync(outFile, JSON.stringify(row) + '\n');
  } catch (err) {
    console.error('[sampler] append failed:', err.message);
  }
  if (!quiet) console.log(JSON.stringify(row));
}

function start() {
  if (!quiet) {
    console.error(
      `[sampler] interval=${intervalMs / 1000}s out=${outFile} url=${baseUrl} pm2Name=${pm2Name}` +
        (pidOverride ? ` pidOverride=${pidOverride}` : ''),
    );
  }
  // Primo tick immediato, poi cadenza regolare.
  tick().catch((err) => console.error('[sampler] tick error:', err.message));
  timer = setInterval(() => {
    tick().catch((err) => console.error('[sampler] tick error:', err.message));
  }, intervalMs);
}

function stop(signal) {
  stopping = true;
  if (timer) clearInterval(timer);
  console.error(`\n[sampler] stop (${signal || 'manual'})`);
  // Lascia tempo all'eventuale tick in volo di completare l'append.
  setTimeout(() => process.exit(0), 200);
}

process.on('SIGINT', () => stop('SIGINT'));
process.on('SIGTERM', () => stop('SIGTERM'));

start();
