'use strict';

const express = require('express');
// Import/export CSV della struttura (admin).

const { Institute, Building } = require('../../models');
const { authenticate, requireRole } = require('../../middleware/auth');
const { importStructure } = require('../../services/structureImporter');

const { httpError } = require('../../lib/domainError');

const router = express.Router();
// =========================================================
// IMPORT STRUTTURA da CSV (admin only)
// Body: { instituteId: number, csv: string }
// CSV idempotente: upsert su (institute+nome edificio), (edificio+nome aula),
// (aula+nome attrezzatura). Ri-eseguire l'import non duplica.
// =========================================================
// =========================================================
// GET /api/structure/export.csv?instituteId=...
// Esporta in CSV la struttura completa di un istituto: una riga per
// (edificio × aula × attrezzatura). Le aule senza attrezzature compaiono
// con colonne attrezzatura vuote. Round-trip safe: il CSV prodotto può
// essere ricaricato via POST /api/structure/import.
// =========================================================
const { stringify: csvStringify } = require('csv-stringify/sync');
router.get('/export.csv', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    const instituteId = parseInt(req.query.instituteId, 10);
    if (!instituteId) throw httpError(400, 'instituteId obbligatorio');
    const inst = await Institute.findByPk(instituteId);
    if (!inst) throw httpError(404, 'Istituto non trovato');

    const buildings = await Building.findAll({
      where: { instituteId },
      include: [
        {
          association: 'rooms',
          include: [{ association: 'equipment' }],
        },
      ],
      order: [['name', 'ASC']],
    });

    const headers = [
      'Edificio',
      'Codice edificio',
      'Indirizzo edificio',
      'Piano',
      'Aula',
      'Codice aula',
      'Capienza',
      'Tipo aula',
      'Prenotabile',
      'Attrezzatura',
      'Tipo attrezzatura',
      'Marca',
      'Modello',
      'Quantità',
    ];
    const rows = [headers];

    for (const b of buildings) {
      const sortedRooms = (b.rooms || []).slice().sort((a, c) => a.name.localeCompare(c.name));
      if (sortedRooms.length === 0) {
        // Edificio senza aule → riga di sole colonne edificio (utile per
        // preservare metadati nei round-trip).
        rows.push([
          b.name,
          b.code || '',
          b.address || '',
          '',
          '',
          '',
          '',
          '',
          '',
          '',
          '',
          '',
          '',
          '',
        ]);
        continue;
      }
      for (const r of sortedRooms) {
        const equip = (r.equipment || []).slice().sort((a, c) => a.name.localeCompare(c.name));
        if (equip.length === 0) {
          rows.push([
            b.name,
            b.code || '',
            b.address || '',
            r.floor || '',
            r.name,
            r.code || '',
            r.capacity ?? '',
            r.type || '',
            r.isBookable ? 'si' : 'no',
            '',
            '',
            '',
            '',
            '',
          ]);
        } else {
          for (const e of equip) {
            rows.push([
              b.name,
              b.code || '',
              b.address || '',
              r.floor || '',
              r.name,
              r.code || '',
              r.capacity ?? '',
              r.type || '',
              r.isBookable ? 'si' : 'no',
              e.name,
              e.type || '',
              e.brand || '',
              e.model || '',
              e.quantity ?? '',
            ]);
          }
        }
      }
    }

    const csv = csvStringify(rows, { delimiter: ';', quoted_string: true });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="struttura-${inst.code || inst.id}-${new Date().toISOString().slice(0, 10)}.csv"`,
    );
    // BOM UTF-8 → Excel apre in modo corretto i caratteri accentati.
    res.send('﻿' + csv);
  } catch (err) {
    next(err);
  }
});

router.post('/import', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    const { instituteId, csv } = req.body || {};
    const result = await importStructure({
      instituteId: parseInt(instituteId, 10),
      csv: typeof csv === 'string' ? csv : '',
    });
    // Appiattisce la risposta del service per il client e la wrappa in
    // `{ result }` come si aspetta il client esistente (vedi
    // frontend/src/api/structure.ts e CsvImportDialog.tsx). Lo schema piatto
    // (`buildingsCreated`, `roomsCreated`, ecc.) era già documentato nella
    // type CsvImportResult; il bug era che il backend restituiva nested e no
    // wrapper → undefined.roomsCreated.
    res.json({
      result: {
        parsed: result.parsed,
        buildingsCreated: result.buildings.created,
        buildingsUpdated: result.buildings.updated,
        roomsCreated: result.rooms.created,
        roomsUpdated: result.rooms.updated,
        equipmentCreated: result.equipment.created,
        equipmentUpdated: result.equipment.updated,
        skipped: result.skipped,
        // CsvImportDialog usa `e.row` e `e.message` — mappiamo dal service
        // (che usa `line` e `msg`) per mantenere il contratto stabilito.
        errors: result.errors.map((e) => ({ row: e.line, message: e.msg })),
      },
    });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('Errore import CSV:', err);
    next(err);
  }
});

module.exports = router;
