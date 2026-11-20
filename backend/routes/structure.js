'use strict';

const express = require('express');

// Router /api/structure: composizione dei sotto-router per risorsa.
// L'ORDINE di montaggio coincide con l'ordine di registrazione storico: le
// route statiche (es. /buildings/checkin-defaults, /rooms/search,
// /rooms/qr/download-all) devono restare PRIMA delle parametriche (:id).
const router = express.Router();

router.use(require('./structure/importExport'));
router.use(require('./structure/institutes'));
router.use(require('./structure/checkInSettings'));
router.use(require('./structure/moduleSettings'));
router.use(require('./structure/instituteAdmin'));
router.use(require('./structure/buildings'));
router.use(require('./structure/rooms'));
router.use(require('./structure/roomQr'));
router.use(require('./structure/roomsAdmin'));
router.use(require('./structure/equipment'));
router.use(require('./structure/equipmentTemplates'));

module.exports = router;
