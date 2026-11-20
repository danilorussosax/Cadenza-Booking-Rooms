'use strict';

/**
 * Unit: services/analyticsMetrics.js + analyticsPdf.js — parte pura.
 * Le query SQL (Postgres-only) sono coperte da
 * tests/integration/analyticsAggregations.postgres.test.js.
 */

const { PassThrough } = require('stream');
const {
  bookedMinutesSql,
  COUNTABLE_BOOKING_SQL,
  countableBookingWhere,
  minutesToHours,
  buildHeatmap,
  mapTopRooms,
  mapTopUsers,
  mapTrendRows,
  noShowRatePct,
} = require('../../services/analyticsMetrics');
const { writeAnalyticsPdf, heatmapColor } = require('../../services/analyticsPdf');

describe('frammenti SQL condivisi', () => {
  it('bookedMinutesSql non qualificato (query raw su bookings)', () => {
    expect(bookedMinutesSql()).toBe('EXTRACT(EPOCH FROM ("endTime" - "startTime")) / 60');
  });

  it('bookedMinutesSql qualificato con alias (findAll Sequelize)', () => {
    expect(bookedMinutesSql('Booking')).toBe(
      'EXTRACT(EPOCH FROM ("Booking"."endTime" - "Booking"."startTime")) / 60',
    );
  });

  it('prenotazione contabile = confermata e non cancellata logicamente', () => {
    expect(COUNTABLE_BOOKING_SQL).toBe(`status = 'confirmed' AND "deletedAt" IS NULL`);
    const range = { from: new Date(0), to: new Date(1) };
    expect(countableBookingWhere(range).status).toBe('confirmed');
  });
});

describe('mapping righe → oggetti', () => {
  it('minutesToHours arrotonda a 1 decimale (accetta stringhe di Postgres)', () => {
    expect(minutesToHours(120)).toBe(2);
    expect(minutesToHours('90')).toBe(1.5);
    expect(minutesToHours(100)).toBe(1.7);
  });

  it('buildHeatmap: matrice 7×24, domenica Postgres (0) → ultima riga, ora clampata', () => {
    const h = buildHeatmap([
      { dow: '0', hour: '22', count: '3', minutes: '180' },
      { dow: 1, hour: 10, count: 1, minutes: 60 },
      { dow: 2, hour: 99, count: 2, minutes: 30 },
    ]);
    expect(h).toHaveLength(7);
    expect(h[0]).toHaveLength(24);
    expect(h[6][22]).toEqual({ count: 3, hours: 3 });
    expect(h[0][10]).toEqual({ count: 1, hours: 1 });
    expect(h[1][23]).toEqual({ count: 2, hours: 0.5 });
    expect(h[3][3]).toEqual({ count: 0, hours: 0 });
  });

  it('mapTopRooms / mapTopUsers leggono dataValues e relazioni opzionali', () => {
    expect(
      mapTopRooms([
        {
          roomId: 4,
          room: { name: 'A1', floor: 2, building: { name: 'Sede' } },
          dataValues: { minutes: '150', count: '2' },
        },
        { roomId: 5, dataValues: { minutes: 60, count: 1 } },
      ]),
    ).toEqual([
      { roomId: 4, name: 'A1', building: 'Sede', floor: 2, hours: 2.5, count: 2 },
      { roomId: 5, name: undefined, building: undefined, floor: undefined, hours: 1, count: 1 },
    ]);
    expect(
      mapTopUsers([
        {
          userId: 9,
          user: { firstName: 'A', lastName: 'B', email: 'e', role: 'docente', matricola: 'm' },
          dataValues: { minutes: 30, count: '1' },
        },
      ]),
    ).toEqual([
      {
        userId: 9,
        firstName: 'A',
        lastName: 'B',
        email: 'e',
        role: 'docente',
        matricola: 'm',
        hours: 0.5,
        count: 1,
      },
    ]);
  });

  it('mapTrendRows mantiene weekStart come stringa YYYY-MM-DD', () => {
    expect(mapTrendRows([{ week_start: '2026-11-16', count: '4', minutes: 240 }])).toEqual([
      { weekStart: '2026-11-16', count: 4, hours: 4 },
    ]);
  });

  it('noShowRatePct: 1 decimale, 0 senza prenotazioni', () => {
    expect(noShowRatePct(1, 3)).toBe(33.3);
    expect(noShowRatePct(1, 2)).toBe(50);
    expect(noShowRatePct(0, 0)).toBe(0);
  });
});

describe('analyticsPdf', () => {
  it('heatmapColor: vuoto → primo step, massimo → ultimo', () => {
    expect(heatmapColor(0, 10)).toBe('#fff1f2');
    expect(heatmapColor(10, 10)).toBe('#be123c');
  });

  it('writeAnalyticsPdf produce un PDF valido con trend (weekStart UTC) e dati', async () => {
    const out = new PassThrough();
    const chunks = [];
    out.on('data', (c) => chunks.push(c));
    const done = new Promise((r) => out.on('end', r));
    const data = {
      summary: { confirmedBookings: 1, ghostedBookings: 0, totalCreated: 1, noShowRatePct: 0 },
      heatmap: buildHeatmap([{ dow: 1, hour: 10, count: 1, minutes: 60 }]),
      trend: [
        { weekStart: '2026-11-09', count: 1, hours: 1 },
        { weekStart: '2026-11-16', count: 2, hours: 2 },
      ],
      topRooms: [{ name: 'A1', hours: 1, count: 1 }],
      topUsers: [{ firstName: 'A', lastName: 'B', role: 'docente', hours: 1, count: 1 }],
    };
    writeAnalyticsPdf(data, { from: new Date('2026-11-01'), to: new Date('2026-11-20') }, out);
    await done;
    const buf = Buffer.concat(chunks);
    expect(buf.slice(0, 4).toString()).toBe('%PDF');
    expect(buf.length).toBeGreaterThan(500);
  });
});
