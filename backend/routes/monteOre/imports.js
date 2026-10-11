'use strict';

const multer = require('multer');

const {
  sequelize,
  MonteOreProposal,
  MonteOreSchedule,
  User,
  MonteOreSettings,
  MonteOreSuspension,
  MonteOreSlot,
} = require('../../models');
const { authenticate, requireRole } = require('../../middleware/auth');
const workflow = require('../../services/monteOreWorkflowService');
const slotService = require('../../services/monteOreSlotService');
const calendarService = require('../../services/monteOreCalendarService');
const { resolveAnnualThreshold } = require('../../services/monteOreThresholdService');

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
        const year = req.query.academicYear || calendarService.currentAcademicYear();
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

        const range = defaultRangeForYear(academicYear);
        const now = new Date();
        const originalName = req.file.originalname || 'import.xlsx';

        // --- Transazione: findOrCreate proposal + ricrea schedules ---
        const result = await sequelize.transaction(async (t) => {
          const [proposal, created] = await MonteOreProposal.findOrCreate({
            where: { userId: teacher.id, academicYear },
            defaults: {
              userId: teacher.id,
              academicYear,
              validFrom: range.validFrom,
              validTo: range.validTo,
              status: 'submitted',
              source: 'admin_import',
              importedAt: now,
              importedById: req.user.id,
              importSourceRef: originalName,
              submittedAt: now,
              coordinatorNotes: anagrafica.note || null,
              totalHoursRequested: Number(totalHoursPattern.toFixed(2)),
            },
            transaction: t,
          });

          if (!created) {
            if (!overwrite) {
              const err = new Error('Proposta già esistente per questo docente e AA');
              err.status = 409;
              err.code = 'ALREADY_EXISTS';
              throw err;
            }
            // Se la proposta esisteva in stato diverso da draft/submitted/rejected,
            // richiediamo `force=true` per non sovrascrivere lavoro già approvato.
            if (proposal.status === 'generated')
              workflow.fail(
                'Annulla la generazione prima di sostituire il piano via import',
                'INVALID_STATE',
              );
            if (!['draft', 'submitted', 'rejected'].includes(proposal.status) && !force) {
              const err = new Error(
                `Proposta in stato '${proposal.status}': passa force=true per sovrascrivere`,
              );
              err.status = 409;
              err.code = 'INVALID_STATE_FOR_OVERWRITE';
              throw err;
            }
            // Cancella le righe esistenti (verranno ricreate sotto)
            await MonteOreSchedule.destroy({
              where: { proposalId: proposal.id },
              transaction: t,
            });
            await proposal.update(
              {
                status: 'submitted',
                source: 'admin_import',
                importedAt: now,
                importedById: req.user.id,
                importSourceRef: originalName,
                submittedAt: now,
                coordinatorNotes: anagrafica.note || null,
                totalHoursRequested: Number(totalHoursPattern.toFixed(2)),
                rejectedAt: null,
                rejectionReason: null,
              },
              { transaction: t },
            );
          }

          // Crea le righe schedule in batch (era N INSERT sequenziali pre-v1.14.1).
          // roomId=null: l'admin assegnerà l'aula prima di approvare la proposta.
          const schedulePayloads = schedules.map((s) => ({
            proposalId: proposal.id,
            roomId: null,
            dayOfWeek: s.dayOfWeek,
            startTime: s.startTime,
            endTime: s.endTime,
            bookingType: s.bookingType || 'lezione',
            purpose: anagrafica.materia || null,
            notes: s.notes || null,
            excludeDates: [],
          }));
          if (schedulePayloads.length > 0) {
            await MonteOreSchedule.bulkCreate(schedulePayloads, {
              transaction: t,
              validate: true,
            });
          }

          await slotService.regenerateSlotsFromPattern(proposal.id, {
            transaction: t,
            confirmRemoval: true,
          });
          await MonteOreSlot.update(
            { isActive: true },
            {
              where: { proposalId: proposal.id, isLocked: false },
              transaction: t,
              validate: false,
            },
          );
          await slotService.recomputeTotals(proposal.id, { transaction: t });
          const plan = await workflow.loadPlan(proposal.id, t);
          const rule = await resolveAnnualThreshold(teacher.id, academicYear, { transaction: t });
          if (rule.mode === 'exact' || rule.mode === 'maximum') {
            await workflow.validatePlan(plan, workflow.expandRooms(plan, plan.slots), {
              transaction: t,
              snapshot: false,
            });
          }
          await proposal.reload({ transaction: t });
          await proposal.update(
            {
              contractSnapshot: rule,
              minRequiredHoursSnapshot: rule.minHours,
              totalHoursRequested: proposal.totalHoursPlanned,
            },
            { transaction: t },
          );

          // Reload con schedules per ritornare il dato fresco.
          const fresh = await MonteOreProposal.findByPk(proposal.id, {
            include: [{ model: MonteOreSchedule, as: 'schedules' }],
            transaction: t,
          });
          return fresh;
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
