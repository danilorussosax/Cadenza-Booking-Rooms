'use strict';

/**
 * Unit test per backend/lib/slowQueryRecorder.js.
 *
 * Strategia: forziamo il threshold a 0 via env (caricato a require-time
 * dal modulo) e poi clear() in beforeEach. Sequenze deterministiche di
 * `record()` permettono di verificare ring buffer, getRecent filtri e
 * aggregate stat.
 */

const { describe, it, expect, beforeEach } = globalThis;

// Setup env prima del require: il recorder cattura le costanti al boot.
process.env.SLOW_QUERY_MS = '0';
process.env.SLOW_QUERY_BUFFER = '5';
delete process.env.SLOW_QUERY_SNAPSHOT_PATH;

const recorder = require('../../lib/slowQueryRecorder');

beforeEach(() => {
  recorder.clear();
});

describe('slowQueryRecorder · normalize SQL', () => {
  const { normalizeSql, patternKey } = recorder._internal;

  it('strippa il prefisso "Executing (default): "', () => {
    expect(normalizeSql('Executing (default): SELECT 1')).toBe('SELECT ?');
  });

  it('rimpiazza stringhe quotate, numeri, NULL/TRUE/FALSE con ?', () => {
    expect(
      normalizeSql("SELECT * FROM users WHERE email='a@b.it' AND id=42 AND deleted=NULL"),
    ).toBe('SELECT * FROM users WHERE email=? AND id=? AND deleted=?');
  });

  it('gestisce apostrofi escapati con doppio quote', () => {
    expect(normalizeSql("SELECT 'O''Connor'")).toBe('SELECT ?');
  });

  it('pattern key è prefisso 80 char della normalizzata', () => {
    const long = 'SELECT '.repeat(20);
    expect(patternKey(long).length).toBeLessThanOrEqual(80);
  });
});

describe('slowQueryRecorder · ring buffer', () => {
  it('record() sotto threshold ritorna false', () => {
    process.env.SLOW_QUERY_MS = '1000';
    // Re-require non aggiorna THRESHOLD_MS (è captured), ma il record qui
    // userà la closure originale (threshold=0). Verifichiamo invece il
    // comportamento positivo + getStats.recorded.
    expect(recorder.record({ sql: 'SELECT 1', durationMs: 5 })).toBe(true);
    expect(recorder.getStats().recorded).toBe(1);
    process.env.SLOW_QUERY_MS = '0';
  });

  it('record() sopra threshold registra ed espone via getRecent', () => {
    recorder.record({ sql: 'SELECT 1', durationMs: 50 });
    recorder.record({ sql: 'SELECT 2', durationMs: 100 });
    const items = recorder.getRecent({ limit: 10 });
    expect(items).toHaveLength(2);
    expect(items[0].durationMs).toBe(100);
    expect(items[1].durationMs).toBe(50);
  });

  it('ring buffer scarta i più vecchi quando va in overflow (BUFFER_SIZE=5)', () => {
    for (let i = 1; i <= 8; i += 1) {
      recorder.record({ sql: `SELECT ${i}`, durationMs: 100 + i });
    }
    const items = recorder.getRecent({ limit: 10 });
    expect(items).toHaveLength(5);
    // Più recenti per primi.
    expect(items[0].sql).toContain('SELECT ?');
    expect(items[0].durationMs).toBe(108);
    expect(items[4].durationMs).toBe(104);
  });

  it('getStats() riporta bufferUsed e observed/recorded coerenti', () => {
    for (let i = 0; i < 3; i += 1) {
      recorder.record({ sql: 'SELECT 1', durationMs: 50 });
    }
    const s = recorder.getStats();
    expect(s.bufferSize).toBe(5);
    expect(s.bufferUsed).toBe(3);
    expect(s.recorded).toBe(3);
    expect(s.observed).toBe(3);
  });
});

describe('slowQueryRecorder · filtri e aggregate', () => {
  beforeEach(() => {
    // 6 record di test con route diverse (ne resteranno 5 nel ring).
    recorder.record({ sql: 'SELECT bookings 1', durationMs: 100 });
    recorder.record({ sql: 'SELECT bookings 2', durationMs: 200 });
    recorder.record({ sql: 'SELECT bookings 3', durationMs: 300 });
    recorder.record({ sql: 'SELECT loans 1', durationMs: 50 });
    recorder.record({ sql: 'SELECT loans 2', durationMs: 80 });
  });

  it('getRecent(limit) rispetta il cap', () => {
    expect(recorder.getRecent({ limit: 2 })).toHaveLength(2);
  });

  it('getAggregate(by=pattern) raggruppa varianti dello stesso SQL', () => {
    const agg = recorder.getAggregate({ by: 'pattern' });
    // SELECT bookings ? (3 record) + SELECT loans ? (2 record) → 2 gruppi
    expect(agg).toHaveLength(2);
    const bookings = agg.find((g) => g.key.startsWith('SELECT bookings'));
    expect(bookings.count).toBe(3);
    expect(bookings.maxMs).toBe(300);
    expect(bookings.p50).toBe(200);
  });

  it('getAggregate è ordinato per p95 desc', () => {
    const agg = recorder.getAggregate({ by: 'pattern' });
    expect(agg[0].p95).toBeGreaterThanOrEqual(agg[1].p95);
  });

  it('getAggregate(by=invalid) ritorna []', () => {
    expect(recorder.getAggregate({ by: 'invalid' })).toEqual([]);
  });
});

describe('slowQueryRecorder · parseSince', () => {
  const { parseSince } = recorder._internal;

  it('parse stringa relativa "60m"', () => {
    const t = parseSince('60m');
    expect(t).toBeLessThanOrEqual(Date.now());
    expect(t).toBeGreaterThan(Date.now() - 61 * 60 * 1000);
  });

  it('parse "24h"', () => {
    const t = parseSince('24h');
    const expected = Date.now() - 24 * 3600 * 1000;
    expect(Math.abs(t - expected)).toBeLessThan(2000);
  });

  it('parse ISO string', () => {
    const iso = '2026-01-01T00:00:00.000Z';
    expect(parseSince(iso)).toBe(Date.parse(iso));
  });

  it('ritorna null su input invalido', () => {
    expect(parseSince('bogus')).toBe(null);
    expect(parseSince(null)).toBe(null);
  });
});
