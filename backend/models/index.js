'use strict';

const sequelize = require('../config/database');

// =============================================
// GUARDIA DISTRUTTIVA: blocca sync({force:true}) e drop tabelle complete
// in produzione/sviluppo con dialect ≠ sqlite, a meno che non sia
// esplicitamente autorizzato via env (DB_ALLOW_DESTRUCTIVE=1).
//
// Motivazione: il 28 apr 2026 uno script ad-hoc ha lanciato
// sequelize.sync({force:true}) sul DB Postgres di sviluppo `cadenza`
// invece che su un DB di test → wipe completo dei dati. La guardia ferma
// questa classe di errori a tempo di esecuzione.
//
// Casi consentiti senza opt-in:
//   - DB su sqlite (dev locale o test in-memory)
//   - NODE_ENV=test (suite Vitest)
//   - DB_ALLOW_DESTRUCTIVE=1 esplicito (es. per re-init manuale del dev)
// =============================================
(function installDestructiveSyncGuard() {
  const originalSync = sequelize.sync.bind(sequelize);
  sequelize.sync = function guardedSync(options = {}) {
    const dialect = sequelize.getDialect();
    const isForce = !!options.force;
    const isDestructive = isForce; // alter è permesso (non distrugge dati)
    const allowed =
      dialect === 'sqlite' ||
      process.env.NODE_ENV === 'test' ||
      process.env.DB_ALLOW_DESTRUCTIVE === '1';
    if (isDestructive && !allowed) {
      const dbName = sequelize.config?.database || '(?)';
      const e = new Error(
        `[GUARD] sync({force:true}) bloccato su dialect=${dialect} db=${dbName}. ` +
          `Per autorizzare un wipe esplicito imposta DB_ALLOW_DESTRUCTIVE=1 ` +
          `nell'ambiente. Attivare solo dopo aver verificato il DB target.`,
      );
      e.code = 'DESTRUCTIVE_SYNC_BLOCKED';
      throw e;
    }
    return originalSync(options);
  };
})();

// Caricamento modelli
const User = require('./User')(sequelize);
const Course = require('./Course')(sequelize);
const CourseLevel = require('./CourseLevel')(sequelize);
const Institute = require('./Institute')(sequelize);
const Building = require('./Building')(sequelize);
const Room = require('./Room')(sequelize);
const Equipment = require('./Equipment')(sequelize);
const EquipmentTemplate = require('./EquipmentTemplate')(sequelize);
const BookingRule = require('./BookingRule')(sequelize);
const BookingRuleException = require('./BookingRuleException')(sequelize);
const Booking = require('./Booking')(sequelize);
const BookingTemplate = require('./BookingTemplate')(sequelize);
const BookingTypeCatalog = require('./BookingTypeCatalog')(sequelize);
const MailSettings = require('./MailSettings')(sequelize);
const BackupSettings = require('./BackupSettings')(sequelize);
const MailTemplate = require('./MailTemplate')(sequelize);
const OAuthSettings = require('./OAuthSettings')(sequelize);
const Instrument = require('./Instrument')(sequelize);
const InstrumentLoan = require('./InstrumentLoan')(sequelize);
const InstrumentLoanRule = require('./InstrumentLoanRule')(sequelize);
const ConcertInfo = require('./ConcertInfo')(sequelize);
const BookingQuota = require('./BookingQuota')(sequelize);
const BookingWaitlist = require('./BookingWaitlist')(sequelize);
const AuditLog = require('./AuditLog')(sequelize);
const UserConsent = require('./UserConsent')(sequelize);
const InstrumentLoanQuota = require('./InstrumentLoanQuota')(sequelize);
const Announcement = require('./Announcement')(sequelize);
const ChatSession = require('./ChatSession')(sequelize);
const BotBinding = require('./BotBinding')(sequelize);
const MessagingSettings = require('./MessagingSettings')(sequelize);
const IntegrationConfig = require('./IntegrationConfig')(sequelize);
const IntegrationSyncRun = require('./IntegrationSyncRun')(sequelize);
const MonteOreProposal = require('./MonteOreProposal')(sequelize);
const MonteOreSchedule = require('./MonteOreSchedule')(sequelize);
const MonteOreSettings = require('./MonteOreSettings')(sequelize);
const MonteOreSuspension = require('./MonteOreSuspension')(sequelize);
const MonteOreSlot = require('./MonteOreSlot')(sequelize);
const MonteOreAmendment = require('./MonteOreAmendment')(sequelize);
const ContractType = require('./ContractType')(sequelize);

// ===========================================
// Associazioni / Relazioni
// ===========================================

// User -> Course (un utente appartiene a un corso) — eliminando il corso, gli utenti restano (courseId=NULL)
Course.hasMany(User, { foreignKey: 'courseId', as: 'students', onDelete: 'SET NULL' });
User.belongsTo(Course, { foreignKey: 'courseId', as: 'course' });

// Institute -> Building (un istituto ha più edifici)
Institute.hasMany(Building, { foreignKey: 'instituteId', as: 'buildings', onDelete: 'CASCADE' });
Building.belongsTo(Institute, { foreignKey: 'instituteId', as: 'institute' });

// Building -> Room (un edificio ha più aule)
Building.hasMany(Room, { foreignKey: 'buildingId', as: 'rooms', onDelete: 'CASCADE' });
Room.belongsTo(Building, { foreignKey: 'buildingId', as: 'building' });

// Room -> Equipment (un'aula contiene attrezzature)
Room.hasMany(Equipment, { foreignKey: 'roomId', as: 'equipment', onDelete: 'CASCADE' });
Equipment.belongsTo(Room, { foreignKey: 'roomId', as: 'room' });

// User -> Booking — eliminando l'utente, le sue prenotazioni vengono rimosse
User.hasMany(Booking, { foreignKey: 'userId', as: 'bookings', onDelete: 'CASCADE' });
Booking.belongsTo(User, { foreignKey: 'userId', as: 'user' });

// Room -> Booking — eliminando la stanza, le prenotazioni vengono rimosse
Room.hasMany(Booking, { foreignKey: 'roomId', as: 'bookings', onDelete: 'CASCADE' });
Booking.belongsTo(Room, { foreignKey: 'roomId', as: 'room' });

// User/Room -> BookingTemplate — template legati all'utente e a un'aula.
// CASCADE su entrambi: se l'aula sparisce il template diventa orfano e
// preferiamo rimuoverlo che esporre un template che fallirà al primo click.
User.hasMany(BookingTemplate, {
  foreignKey: 'userId',
  as: 'bookingTemplates',
  onDelete: 'CASCADE',
});
BookingTemplate.belongsTo(User, { foreignKey: 'userId', as: 'user' });
Room.hasMany(BookingTemplate, {
  foreignKey: 'roomId',
  as: 'bookingTemplates',
  onDelete: 'CASCADE',
});
BookingTemplate.belongsTo(Room, { foreignKey: 'roomId', as: 'room' });

// Instrument -> InstrumentLoan — eliminando lo strumento, i prestiti vengono rimossi
Instrument.hasMany(InstrumentLoan, {
  foreignKey: 'instrumentId',
  as: 'loans',
  onDelete: 'CASCADE',
});
InstrumentLoan.belongsTo(Instrument, { foreignKey: 'instrumentId', as: 'instrument' });

// User -> InstrumentLoan — eliminando l'utente, i prestiti vengono rimossi
User.hasMany(InstrumentLoan, { foreignKey: 'userId', as: 'instrumentLoans', onDelete: 'CASCADE' });
InstrumentLoan.belongsTo(User, { foreignKey: 'userId', as: 'user' });

// Approver (admin che ha approvato il prestito) — niente cascade: alla cancellazione
// dell'admin restituiamo NULL per non perdere il prestito
User.hasMany(InstrumentLoan, {
  foreignKey: 'approvedBy',
  as: 'approvedLoans',
  onDelete: 'SET NULL',
});
InstrumentLoan.belongsTo(User, { foreignKey: 'approvedBy', as: 'approver' });

// Booking <-> ConcertInfo 1:1 (cascade: cancellata la booking, sparisce la scheda)
Booking.hasOne(ConcertInfo, { foreignKey: 'bookingId', as: 'concertInfo', onDelete: 'CASCADE' });
ConcertInfo.belongsTo(Booking, { foreignKey: 'bookingId', as: 'booking' });

// User -> BookingWaitlist (cascade: utente cancellato, le sue code vengono rimosse)
User.hasMany(BookingWaitlist, { foreignKey: 'userId', as: 'waitlistEntries', onDelete: 'CASCADE' });
BookingWaitlist.belongsTo(User, { foreignKey: 'userId', as: 'user' });

// Room -> BookingWaitlist (cascade: aula cancellata, le code vengono rimosse)
Room.hasMany(BookingWaitlist, { foreignKey: 'roomId', as: 'waitlistEntries', onDelete: 'CASCADE' });
BookingWaitlist.belongsTo(Room, { foreignKey: 'roomId', as: 'room' });

// AuditLog -> User (actor): SET NULL se l'utente viene cancellato, perché
// l'audit deve sopravvivere a una cancellazione utente per fini probatori.
User.hasMany(AuditLog, { foreignKey: 'actorId', as: 'auditEntries', onDelete: 'SET NULL' });
AuditLog.belongsTo(User, { foreignKey: 'actorId', as: 'actor' });

// User -> UserConsent (cascade: cancellando l'utente in modo definitivo,
// si rimuovono anche i consensi). Nota: usiamo soft-delete sull'utente,
// quindi i consensi restano disponibili finché l'utente è solo "anonimizzato".
User.hasMany(UserConsent, { foreignKey: 'userId', as: 'consents', onDelete: 'CASCADE' });
UserConsent.belongsTo(User, { foreignKey: 'userId', as: 'user' });

// User -> Announcement (autore admin). SET NULL: gli avvisi sopravvivono
// alla cancellazione del loro autore (storia immutabile della bacheca).
User.hasMany(Announcement, {
  foreignKey: 'createdBy',
  as: 'createdAnnouncements',
  onDelete: 'SET NULL',
});
Announcement.belongsTo(User, { foreignKey: 'createdBy', as: 'author' });

// =========================================================
// Hook Booking → notifica waitlist
//
// Dopo che una booking viene cancellata (soft destroy o hard), tenta di
// notificare il primo in coda d'attesa per quella room nello stesso slot.
// Il service `waitlistService` viene importato lazy per evitare cicli di
// dipendenza (waitlistService include i model qui sopra).
//
// CORRETTEZZA TRANSAZIONALE (P1-6):
// I hook Sequelize vengono invocati durante la transazione, PRIMA del
// commit. Se chiamiamo `notifyNextOnSlot()` direttamente dentro una
// transazione che successivamente fa rollback, l'email "il tuo turno è
// disponibile" sarebbe stata già inviata pur essendo annullata la
// cancellazione → falso positivo per l'utente in coda.
//
// Soluzione: dispatch via `transaction.afterCommit()` quando l'hook è
// invocato dentro una tx; sync diretta solo per chiamate fuori tx.
// =========================================================

// Utility: dispatcher che incapsula la chiamata waitlist + error handling.
// Lazy require di waitlistService per evitare cicli a startup.
function dispatchWaitlistNotification(booking) {
  return (async () => {
    try {
      const { notifyNextOnSlot } = require('../services/waitlistService');
      await notifyNextOnSlot({
        roomId: booking.roomId,
        startTime: booking.startTime,
        endTime: booking.endTime,
      });
    } catch (err) {
      // Mai propagare: la waitlist è best-effort.
      // Logger lazy per evitare circolare a startup.
      try {
        require('../lib/logger').warn(
          { err: err.message, bookingId: booking.id, roomId: booking.roomId },
          'waitlist notification failed',
        );
      } catch {
        /* logger non disponibile, swallow silenzioso */
      }
    }
  })();
}

// Helper: se l'hook è dentro una transazione, registriamo su afterCommit
// così la notifica parte SOLO se la tx committa effettivamente. Altrimenti
// (no-tx) eseguiamo subito fire-and-forget.
function scheduleWaitlistDispatch(booking, options) {
  if (options?.transaction) {
    options.transaction.afterCommit(() => {
      dispatchWaitlistNotification(booking);
    });
  } else {
    dispatchWaitlistNotification(booking);
  }
}

Booking.afterDestroy((booking, options) => {
  // Anche per cancellazioni "soft" (status='cancelled') non passa da qui:
  // l'app usa booking.update({status:'cancelled'}) NON booking.destroy().
  // Quando passa da qui (es. paranoid destroy o hard delete) la slot
  // è effettivamente liberata.
  scheduleWaitlistDispatch(booking, options);
});

// L'app usa update(status='cancelled') per le cancellazioni utente (vedi
// routes/bookings.js#delete). Aggiungiamo un afterUpdate che reagisce
// quando lo status passa a 'cancelled' o 'no_show', equivalente alla
// liberazione dello slot.
Booking.afterUpdate((booking, options) => {
  if (!booking.changed('status')) return;
  const newStatus = booking.status;
  if (newStatus !== 'cancelled' && newStatus !== 'no_show') return;
  scheduleWaitlistDispatch(booking, options);
});

// Bot messaging: relazioni leggere
ChatSession.belongsTo(User, { foreignKey: 'userId', as: 'user' });
User.hasMany(ChatSession, { foreignKey: 'userId', as: 'chatSessions', onDelete: 'CASCADE' });
BotBinding.belongsTo(User, { foreignKey: 'userId', as: 'user' });
User.hasMany(BotBinding, { foreignKey: 'userId', as: 'botBindings', onDelete: 'CASCADE' });

// Integrazioni esterne — configurazioni per istituto e storico run.
// CASCADE su Institute (config legate al tenant). Su SyncRun usiamo SET NULL
// così la cancellazione di una config non distrugge lo storico forense.
Institute.hasMany(IntegrationConfig, {
  foreignKey: 'instituteId',
  as: 'integrationConfigs',
  onDelete: 'CASCADE',
});
IntegrationConfig.belongsTo(Institute, { foreignKey: 'instituteId', as: 'institute' });
IntegrationConfig.hasMany(IntegrationSyncRun, {
  foreignKey: 'configId',
  as: 'runs',
  onDelete: 'SET NULL',
});
IntegrationSyncRun.belongsTo(IntegrationConfig, { foreignKey: 'configId', as: 'config' });
User.hasMany(IntegrationSyncRun, {
  foreignKey: 'actorId',
  as: 'integrationSyncRuns',
  onDelete: 'SET NULL',
});
IntegrationSyncRun.belongsTo(User, { foreignKey: 'actorId', as: 'actor' });

// Monte Ore — proposte annuali del docente + righe di pianificazione.
// CASCADE su User (cancellando il docente spariscono anche le sue proposte).
// CASCADE su Proposal → Schedule (le righe sono parte integrante della proposta).
// SET NULL per approverId: la cancellazione dell'admin non distrugge la storia.
User.hasMany(MonteOreProposal, {
  foreignKey: 'userId',
  as: 'monteOreProposals',
  onDelete: 'CASCADE',
});
MonteOreProposal.belongsTo(User, { foreignKey: 'userId', as: 'user' });
User.hasMany(MonteOreProposal, {
  foreignKey: 'approverId',
  as: 'monteOreApprovals',
  onDelete: 'SET NULL',
});
MonteOreProposal.belongsTo(User, { foreignKey: 'approverId', as: 'approver' });
MonteOreProposal.hasMany(MonteOreSchedule, {
  foreignKey: 'proposalId',
  as: 'schedules',
  onDelete: 'CASCADE',
});
MonteOreSchedule.belongsTo(MonteOreProposal, { foreignKey: 'proposalId', as: 'proposal' });
Room.hasMany(MonteOreSchedule, {
  foreignKey: 'roomId',
  as: 'monteOreSchedules',
  onDelete: 'SET NULL',
});
MonteOreSchedule.belongsTo(Room, { foreignKey: 'roomId', as: 'room' });

// Monte Ore — settings e sospensioni a livello istituto + slot+amendment per proposta.
Institute.hasMany(MonteOreSettings, {
  foreignKey: 'instituteId',
  as: 'monteOreSettings',
  onDelete: 'CASCADE',
});
MonteOreSettings.belongsTo(Institute, { foreignKey: 'instituteId', as: 'institute' });
Institute.hasMany(ContractType, {
  foreignKey: 'instituteId',
  as: 'contractTypes',
  onDelete: 'CASCADE',
});
ContractType.belongsTo(Institute, { foreignKey: 'instituteId', as: 'institute' });
Institute.hasMany(MonteOreSuspension, {
  foreignKey: 'instituteId',
  as: 'monteOreSuspensions',
  onDelete: 'CASCADE',
});
MonteOreSuspension.belongsTo(Institute, { foreignKey: 'instituteId', as: 'institute' });
MonteOreProposal.hasMany(MonteOreSlot, {
  foreignKey: 'proposalId',
  as: 'slots',
  onDelete: 'CASCADE',
});
MonteOreSlot.belongsTo(MonteOreProposal, { foreignKey: 'proposalId', as: 'proposal' });
MonteOreSchedule.hasMany(MonteOreSlot, {
  foreignKey: 'scheduleId',
  as: 'slots',
  onDelete: 'CASCADE',
});
MonteOreSlot.belongsTo(MonteOreSchedule, { foreignKey: 'scheduleId', as: 'schedule' });
Booking.hasOne(MonteOreSlot, { foreignKey: 'bookingId', as: 'monteOreSlot', onDelete: 'SET NULL' });
MonteOreSlot.belongsTo(Booking, { foreignKey: 'bookingId', as: 'booking' });
// roomId valorizzato solo per slot fuori-pattern (creati da add_new_day):
// abbiamo bisogno della FK reale per evitare orfani su Room.destroy.
Room.hasMany(MonteOreSlot, { foreignKey: 'roomId', as: 'monteOreSlots', onDelete: 'SET NULL' });
MonteOreSlot.belongsTo(Room, { foreignKey: 'roomId', as: 'room' });
MonteOreProposal.hasMany(MonteOreAmendment, {
  foreignKey: 'proposalId',
  as: 'amendments',
  onDelete: 'CASCADE',
});
MonteOreAmendment.belongsTo(MonteOreProposal, { foreignKey: 'proposalId', as: 'proposal' });
MonteOreSlot.hasMany(MonteOreAmendment, {
  foreignKey: 'slotId',
  as: 'amendments',
  onDelete: 'SET NULL',
});
MonteOreAmendment.belongsTo(MonteOreSlot, { foreignKey: 'slotId', as: 'slot' });
User.hasMany(MonteOreAmendment, {
  foreignKey: 'requesterId',
  as: 'monteOreAmendmentRequests',
  onDelete: 'CASCADE',
});
MonteOreAmendment.belongsTo(User, { foreignKey: 'requesterId', as: 'requester' });

module.exports = {
  sequelize,
  User,
  Course,
  CourseLevel,
  Institute,
  Building,
  Room,
  Equipment,
  EquipmentTemplate,
  BookingRule,
  BookingRuleException,
  Booking,
  BookingTemplate,
  MailSettings,
  BackupSettings,
  MailTemplate,
  OAuthSettings,
  Instrument,
  InstrumentLoan,
  InstrumentLoanRule,
  ConcertInfo,
  BookingQuota,
  BookingWaitlist,
  AuditLog,
  UserConsent,
  InstrumentLoanQuota,
  Announcement,
  ChatSession,
  BotBinding,
  MessagingSettings,
  IntegrationConfig,
  IntegrationSyncRun,
  MonteOreProposal,
  MonteOreSchedule,
  MonteOreSettings,
  MonteOreSuspension,
  MonteOreSlot,
  MonteOreAmendment,
  ContractType,
  BookingTypeCatalog,
};
