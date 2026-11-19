'use strict';

const multer = require('multer');

const { User, MonteOreSettings, MonteOreSuspension } = require('../../models');
const { resolveAdminYear } = require('../../services/academicYearContext');
const { authenticate, requireRole } = require('../../middleware/auth');
const workflow = require('../../services/monteOreWorkflowService');

// ---- Import Excel compilato dal docente (admin upload) ----
//
// L'admin scarica il template via `/import-template.xlsx`, lo passa al
// docente, riceve il file compilato e lo carica qui. Il backend:
//   1. parse del foglio "Anagrafica" + "Orario" (vedi monteOreImportService)
//   2. lookup del docente via email (paranoid:false, accetta anche utenti
//      soft-deleted: caso di subentro a fine anno)
//   3. validazione AA + esistenza MonteOreSettings per quell'AA
//   4. upsert della proposta con status='submitted' e source='admin_import'
//   5. ricrea le righe MonteOreSchedule a partire dalle fasce aggregate
//      (roomId=null: il coordinatore le assegnerà prima di approvare).
//
// Multer in-memory (mai su disco), limite 5 MB.
const ALLOWED_XLSX = [
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  // Alcuni browser (Safari, Firefox in certi build) inviano i .xlsx come
  // octet-stream: lo accettiamo come fallback e ci affidiamo al parsing.
  'application/octet-stream',
];

const importUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter(req, file, cb) {
    const okMime = ALLOWED_XLSX.includes(file.mimetype || '');
    const okExt = /\.xlsx$/i.test(file.originalname || '');
    if (!okMime && !okExt) {
      return cb(new Error('Formato non supportato (atteso .xlsx)'));
    }
    cb(null, true);
  },
});

const { defaultRangeForYear, serializeProposal } = require('./shared');

module.exports = function registerImports(adminRouter) {
  // ---- Import template Excel ----
  adminRouter.get(
    '/import-template.xlsx',
    authenticate,
    requireRole('admin'),
    async (req, res, next) => {
      try {
        const year = resolveAdminYear(req);
        const settings = await MonteOreSettings.findOne({ where: { academicYear: year } });
        const suspensions = await MonteOreSuspension.findAll({
          where: { academicYear: year },
          order: [['dateFrom', 'ASC']],
        });
        const { streamTemplate } = require('../../services/monteOreTemplateService');
        await streamTemplate(res, {
          academicYear: year,
          settings: settings ? settings.toJSON() : null,
          suspensions: suspensions.map((s) => s.toJSON()),
        });
      } catch (err) {
        next(err);
      }
    },
  );

  adminRouter.post(
    '/import',
    authenticate,
    requireRole('admin'),
    (req, res, next) => {
      // Wrappa multer per catturare i suoi errori e ritornarli come 400
      // (altrimenti diventano 500 dal next handler globale).
      importUpload.single('file')(req, res, (err) => {
        if (err) {
          const status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
          return res.status(status).json({ error: err.message, code: err.code || 'UPLOAD_FAILED' });
        }
        next();
      });
    },
    async (req, res, next) => {
      try {
        if (!req.file) {
          return res.status(400).json({ error: 'Nessun file caricato', code: 'NO_FILE' });
        }

        const { parseExcel } = require('../../services/monteOreImportService');
        let parsed;
        try {
          parsed = await parseExcel(req.file.buffer);
        } catch (e) {
          return res.status(400).json({
            error: `File Excel non valido: ${e.message}`,
            code: 'PARSE_FAILED',
          });
        }
        const { anagrafica, schedules, warnings } = parsed;

        // --- Email obbligatoria e ben formata ---
        const email = (anagrafica.email || '').trim().toLowerCase();
        if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          return res.status(400).json({
            error: 'Email docente mancante o non valida nel foglio Anagrafica',
            code: 'INVALID_EMAIL',
          });
        }

        // --- AA: formato + coerenza Y/Y+1 ---
        const academicYear = String(anagrafica.academicYear || '').trim();
        if (!/^\d{4}\/\d{4}$/.test(academicYear)) {
          return res.status(400).json({
            error: 'Anno Accademico mancante o formato non valido (atteso "YYYY/YYYY")',
            code: 'INVALID_YEAR',
          });
        }
        const [yA, yB] = academicYear.split('/').map(Number);
        if (yB !== yA + 1) {
          return res.status(400).json({
            error: 'Anno Accademico non coerente: il secondo anno deve essere il primo + 1',
            code: 'INVALID_YEAR',
          });
        }

        // --- Lookup docente (include soft-deleted) ---
        const teacher = await User.findOne({
          where: { email },
          paranoid: false,
        });
        if (!teacher) {
          return res.status(404).json({
            error: `Docente con email ${email} non trovato`,
            code: 'TEACHER_NOT_FOUND',
          });
        }

        // --- Verifica esistenza MonteOreSettings per l'AA dell'istituto ---
        // Il modello User non ha instituteId: la verifica si riduce a "esiste un
        // settings per quell'AA" (multi-istituto è gestito altrove via routing).
        const settings = await MonteOreSettings.findOne({ where: { academicYear } });
        if (!settings) {
          return res.status(400).json({
            error: `AA ${academicYear} non configurato per l'istituto del docente`,
            code: 'YEAR_NOT_CONFIGURED',
          });
        }

        if (settings.status === 'archived')
          workflow.fail(
            'Anno archiviato: ripubblicalo prima di modificarlo',
            'ACADEMIC_YEAR_ARCHIVED',
            409,
          );

        // --- Calcolo ore totali del pattern (somma delle fasce, non moltiplicato per occurrences) ---
        const totalHoursPattern = schedules.reduce((acc, s) => {
          const [sh, sm] = s.startTime.split(':').map(Number);
          const [eh, em] = s.endTime.split(':').map(Number);
          return acc + (eh + em / 60 - (sh + sm / 60));
        }, 0);

        const overwriteParam = String(
          req.body?.overwrite ?? req.query?.overwrite ?? '',
        ).toLowerCase();
        const overwrite = overwriteParam !== 'false'; // default true
        const force = String(req.body?.force ?? req.query?.force ?? '').toLowerCase() === 'true';

        const result = await workflow.importPlanAsSubmitted({
          teacher,
          academicYear,
          actor: req.user,
          schedules,
          purpose: anagrafica.materia,
          coordinatorNotes: anagrafica.note,
          sourceRef: req.file.originalname || 'import.xlsx',
          range: defaultRangeForYear(academicYear),
          totalHoursPattern,
          overwrite,
          force,
        });

        return res.status(201).json({
          proposal: serializeProposal(result),
          user: {
            id: teacher.id,
            email: teacher.email,
            fullName: `${teacher.firstName || ''} ${teacher.lastName || ''}`.trim(),
          },
          summary: {
            schedulesCreated: schedules.length,
            totalHoursPattern: Number(totalHoursPattern.toFixed(2)),
            warnings,
          },
        });
      } catch (err) {
        if (err.status) {
          return res.status(err.status).json({ error: err.message, code: err.code });
        }
        next(err);
      }
    },
  );
};
