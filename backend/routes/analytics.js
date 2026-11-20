'use strict';

/**
 * Dashboard analytics admin per Cadenza.
 *
 * Endpoints (tutti `requireRole('admin')`):
 *   GET  /api/admin/analytics?dateFrom&dateTo
 *        Aggregato unico per il dashboard: heatmap 7×24, top10 rooms, top10
 *        users, no-show rate, trend ultime 8 settimane.
 *   GET  /api/admin/analytics/export.csv?dateFrom&dateTo
 *        CSV con righe (giorno, ora, occupazione, count) — utile per Excel.
 *   GET  /api/admin/analytics/export.pdf?dateFrom&dateTo
 *        PDF report mensile sintetico via pdfkit.
 *
 * Filtro date range: default 30 giorni indietro → oggi. Cap massimo 1 anno
 * per evitare aggregazioni pesanti per sbaglio.
 *
 * Strategia di aggregazione: tutto in SQL via Sequelize.fn / .literal su
 * Postgres (`EXTRACT(dow|hour FROM …)`). Nessun N+1, nessun fetch grezzo
 * sull'app. Per dataset enormi conviene aggiungere un materialized view —
 * tracked nel `develop.md` per le evolution.
 */

const express = require('express');
const dayjs = require('dayjs');
const { Op } = require('sequelize');
const { stringify } = require('csv-stringify/sync');
const { Booking, Room, Building, User } = require('../models');
const { authenticate, requireRole } = require('../middleware/auth');
const { domainError } = require('../lib/domainError');
const { gatherAnalytics } = require('../services/analyticsMetrics');
const { writeAnalyticsPdf } = require('../services/analyticsPdf');

const institutionTime = require('../lib/institutionTime');

const router = express.Router();

// =====================================================
// Helper comuni
// =====================================================

function parseRange(req) {
  // Date pure 'YYYY-MM-DD' = giorno dell'istituto (non del processo).
  const to = dayjs(institutionTime.toInstant(req.query.dateTo || undefined));
  const fromRaw = req.query.dateFrom
    ? dayjs(institutionTime.toInstant(req.query.dateFrom))
    : to.subtract(30, 'day');
  // Cap a 1 anno per protezione
  const minFrom = to.subtract(366, 'day');
  const from = fromRaw.isBefore(minFrom) ? minFrom : fromRaw;
  if (!from.isValid() || !to.isValid() || !from.isBefore(to.add(1, 'day'))) {
    return null;
  }
  return {
    from: institutionTime.startOfDay(from),
    to: institutionTime.endOfDay(to),
  };
}

// =====================================================
// GET /api/admin/analytics
// =====================================================
router.get('/', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    const range = parseRange(req);
    if (!range) {
      throw domainError('VALIDATION_FAILED', 'Range date non valido');
    }
    const data = await gatherAnalytics(range);
    res.json(data);
  } catch (err) {
    next(err);
  }
});

// =====================================================
// GET /api/admin/analytics/export.csv
// =====================================================
router.get('/export.csv', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    const range = parseRange(req);
    if (!range) throw domainError('VALIDATION_FAILED', 'Range date non valido');

    const rows = await Booking.findAll({
      attributes: ['id', 'startTime', 'endTime', 'status', 'autoCancelledAt'],
      where: { startTime: { [Op.between]: [range.from, range.to] } },
      include: [
        {
          model: User,
          as: 'user',
          attributes: ['firstName', 'lastName', 'email', 'role', 'matricola'],
        },
        {
          model: Room,
          as: 'room',
          attributes: ['name'],
          include: [{ model: Building, as: 'building', attributes: ['name'] }],
        },
      ],
      order: [['startTime', 'ASC']],
    });

    const records = rows.map((b) => ({
      id: b.id,
      start: institutionTime.inInstitute(b.startTime).format('YYYY-MM-DD HH:mm'),
      end: institutionTime.inInstitute(b.endTime).format('YYYY-MM-DD HH:mm'),
      durationHours: Math.round(dayjs(b.endTime).diff(dayjs(b.startTime), 'minute') / 6) / 10,
      status: b.status,
      ghosted: b.autoCancelledAt ? 'yes' : 'no',
      building: b.room?.building?.name || '',
      room: b.room?.name || '',
      user: `${b.user?.firstName || ''} ${b.user?.lastName || ''}`.trim(),
      email: b.user?.email || '',
      matricola: b.user?.matricola || '',
      role: b.user?.role || '',
    }));

    const csv = stringify(records, {
      header: true,
      columns: [
        'id',
        'start',
        'end',
        'durationHours',
        'status',
        'ghosted',
        'building',
        'room',
        'user',
        'email',
        'matricola',
        'role',
      ],
      delimiter: ',',
    });
    const filename =
      `analytics-${dayjs(range.from).format('YYYYMMDD')}-${dayjs(range.to).format('YYYYMMDD')}.csv`.replace(
        /[^\w\-.]/g,
        '_',
      );
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send('﻿' + csv); // BOM per Excel italiano
  } catch (err) {
    next(err);
  }
});

// =====================================================
// GET /api/admin/analytics/export.pdf
//
// Layout PDF mirror della pagina /admin/analytics:
//   - header con titolo "Statistiche di utilizzo" + range/timestamp
//   - 4 KPI card colorate (emerald/amber/rose/sky) con valore grosso
//   - heatmap 7×24 con scala colore rose (light → dark)
//   - sparkline trend ultime 8 settimane
//   - top 10 aule con barre orizzontali sky
//   - top 10 utenti come lista con rank circolare
//
// Tutto disegnato a basso livello con pdfkit (rect, lineTo, fillColor):
// niente immagini esterne — il PDF è autocontenuto e leggero.
// =====================================================
router.get('/export.pdf', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    const range = parseRange(req);
    if (!range) throw domainError('VALIDATION_FAILED', 'Range date non valido');

    const data = await gatherAnalytics(range);

    const filename =
      `analytics-${dayjs(range.from).format('YYYYMMDD')}-${dayjs(range.to).format('YYYYMMDD')}.pdf`.replace(
        /[^\w\-.]/g,
        '_',
      );
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    writeAnalyticsPdf(data, range, res);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
