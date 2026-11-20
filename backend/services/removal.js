'use strict';

/**
 * Rimozione a cascata di istituti, edifici, aule e utenti.
 *
 * Interfaccia: `removeInstitute(id, opts)`, `removeBuildings(ids, opts)`,
 * `removeRooms(ids, opts)`, `removeUser(id, opts)`, `removeUsers(ids, opts)`.
 *
 * Possiede, in un unico punto:
 *   - la raccolta degli id (aule, foto, logo, foto profilo) DENTRO la transazione;
 *   - la cascata esplicita del soft-delete (il `paranoid` di Sequelize non
 *     propaga ai figli: Room/Building/MonteOreProposal vanno distrutti a mano);
 *   - la politica sulle prenotazioni, parametro esplicito `opts.bookings`:
 *       'purge'  (default) hard destroy delle prenotazioni, nessuna mail
 *                (pannelli admin di struttura e utenti);
 *       'cancel' annulla le prenotazioni FUTURE ancora attive via
 *                bookingLifecycle.cancelMany (mail/lista d'attesa come da
 *                ciclo di vita); lo storico passato resta (GDPR);
 *   - la mappatura UNICA degli errori FK -> 409 (domainError);
 *   - la pulizia dei file su disco DOPO il commit (best-effort, errori loggati),
 *     tramite l'adattatore `opts.files` iniettabile nei test.
 *
 * Il modulo apre la propria transazione. `removeUser` accetta
 * `opts.prepare(user, t)`, eseguito nella stessa transazione prima della
 * cancellazione (es. anonimizzazione GDPR).
 */

const { Op } = require('sequelize');
const {
  sequelize,
  Institute,
  Building,
  Room,
  Booking,
  User,
  MonteOreProposal,
} = require('../models');
const { domainError } = require('../lib/domainError');
const logger = require('../lib/logger');
const storage = require('./storage');

const POLICIES = Object.freeze(['purge', 'cancel']);
const FK_MESSAGE = 'Eliminazione bloccata da vincoli di integrità.';
const FK_USER_MESSAGE = "Impossibile eliminare: l'utente è ancora referenziato da altri dati.";

// ---------------------------------------------------------------------------
// Adattatore filesystem (default), sostituibile con `opts.files`
// ---------------------------------------------------------------------------

const defaultFiles = {
  /** foto aula / logo istituto: solo url gestiti da noi (`/storage/<file>`) */
  async removeStored(url) {
    await storage.removeStored(url);
  },
  async removeProfilePhoto(url) {
    return require('./profilePhotoCleanup').removeProfilePhoto(url);
  },
};

async function cleanupFiles(files, method, urls) {
  for (const url of urls) {
    if (!url) continue;
    try {
      await files[method](url);
    } catch (err) {
      logger.warn({ err: err.message, method, scope: 'removal' }, 'file cleanup failed');
    }
  }
}

// ---------------------------------------------------------------------------
// Helper interni
// ---------------------------------------------------------------------------

function resolvePolicy(opts) {
  const policy = opts.bookings ?? 'purge';
  if (!POLICIES.includes(policy)) {
    throw new Error(`removal: politica prenotazioni non valida: ${policy}`);
  }
  return policy;
}

/** Mappatura UNICA FK -> 409; qualsiasi altro errore passa invariato. */
function mapError(err, { message = FK_MESSAGE, code } = {}) {
  if (err?.name === 'SequelizeForeignKeyConstraintError') {
    return domainError(code, message, { status: 409 });
  }
  return err;
}

async function inTransaction(fn, fkOpts) {
  try {
    return await sequelize.transaction(fn);
  } catch (err) {
    throw mapError(err, fkOpts);
  }
}

/** Applica la politica alle prenotazioni selezionate da `where`. */
async function disposeBookings(where, policy, t) {
  if (policy === 'purge') {
    const removed = await Booking.destroy({ where, transaction: t });
    return { removedBookings: removed, cancelledBookings: 0 };
  }
  const { cancelMany } = require('./bookingLifecycle');
  const bookings = await Booking.findAll({
    where: {
      ...where,
      startTime: { [Op.gt]: new Date() },
      status: ['confirmed', 'pending_approval'],
    },
    transaction: t,
  });
  const done = await cancelMany({ bookings, transaction: t });
  return { removedBookings: 0, cancelledBookings: done.length };
}

/** Cascata sulle aule selezionate da `where`: prenotazioni, poi aule. */
async function removeRoomsWhere(where, policy, t) {
  const rooms = await Room.findAll({ where, attributes: ['id', 'photoUrl'], transaction: t });
  const roomIds = rooms.map((r) => r.id);
  let counts = { removedBookings: 0, cancelledBookings: 0 };
  let removedRooms = 0;
  if (roomIds.length > 0) {
    counts = await disposeBookings({ roomId: { [Op.in]: roomIds } }, policy, t);
    removedRooms = await Room.destroy({ where: { id: { [Op.in]: roomIds } }, transaction: t });
  }
  return { ...counts, removedRooms, photos: rooms.map((r) => r.photoUrl) };
}

// ---------------------------------------------------------------------------
// API pubblica
// ---------------------------------------------------------------------------

/** @returns {Promise<{ removedBookings, cancelledBookings, removedRooms, removedBuildings }>} */
async function removeInstitute(id, opts = {}) {
  const policy = resolvePolicy(opts);
  const files = opts.files ?? defaultFiles;
  let logoUrl = null;
  let photos = [];
  const result = await inTransaction(async (t) => {
    const inst = await Institute.findByPk(id, { transaction: t });
    if (!inst) throw domainError('NOT_FOUND', 'Istituto non trovato', { status: 404 });
    logoUrl = inst.logoUrl;
    const buildings = await Building.findAll({
      where: { instituteId: inst.id },
      attributes: ['id'],
      transaction: t,
    });
    const buildingIds = buildings.map((b) => b.id);
    let r = { removedBookings: 0, cancelledBookings: 0, removedRooms: 0, photos: [] };
    if (buildingIds.length > 0) {
      r = await removeRoomsWhere({ buildingId: { [Op.in]: buildingIds } }, policy, t);
      await Building.destroy({ where: { instituteId: inst.id }, transaction: t });
    }
    await inst.destroy({ transaction: t });
    photos = r.photos;
    return {
      removedBookings: r.removedBookings,
      cancelledBookings: r.cancelledBookings,
      removedRooms: r.removedRooms,
      removedBuildings: buildingIds.length,
    };
  });
  await cleanupFiles(files, 'removeStored', [...photos, logoUrl]);
  return result;
}

/** @returns {Promise<{ deleted, removedRooms, removedBookings, cancelledBookings }>} */
async function removeBuildings(ids, opts = {}) {
  const policy = resolvePolicy(opts);
  const files = opts.files ?? defaultFiles;
  let photos = [];
  const result = await inTransaction(async (t) => {
    const r = await removeRoomsWhere({ buildingId: { [Op.in]: ids } }, policy, t);
    photos = r.photos;
    const deleted = await Building.destroy({ where: { id: { [Op.in]: ids } }, transaction: t });
    return {
      deleted,
      removedRooms: r.removedRooms,
      removedBookings: r.removedBookings,
      cancelledBookings: r.cancelledBookings,
    };
  });
  await cleanupFiles(files, 'removeStored', photos);
  return result;
}

/** @returns {Promise<{ deleted, removedBookings, cancelledBookings }>} */
async function removeRooms(ids, opts = {}) {
  const policy = resolvePolicy(opts);
  const files = opts.files ?? defaultFiles;
  let photos = [];
  const result = await inTransaction(async (t) => {
    const rooms = await Room.findAll({
      where: { id: { [Op.in]: ids } },
      attributes: ['id', 'photoUrl'],
      transaction: t,
    });
    photos = rooms.map((r) => r.photoUrl);
    const counts = await disposeBookings({ roomId: { [Op.in]: ids } }, policy, t);
    const deleted = await Room.destroy({ where: { id: { [Op.in]: ids } }, transaction: t });
    return { deleted, ...counts };
  });
  await cleanupFiles(files, 'removeStored', photos);
  return result;
}

async function removeUsersInTx(ids, policy, t, prepare) {
  const users = await User.findAll({ where: { id: { [Op.in]: ids } }, transaction: t });
  const photos = users.map((u) => u.profilePhotoUrl);
  if (prepare) await prepare(users[0], t);
  const counts = await disposeBookings({ userId: { [Op.in]: ids } }, policy, t);
  // User e' paranoid: la CASCADE FK non scatta, le proposte Monte Ore vanno
  // distrutte a mano (schedules/slots/amendments seguono via CASCADE).
  const removedMonteOreProposals = await MonteOreProposal.destroy({
    where: { userId: { [Op.in]: ids } },
    transaction: t,
  });
  const deleted = await User.destroy({ where: { id: { [Op.in]: ids } }, transaction: t });
  return { deleted, ...counts, removedMonteOreProposals, photos };
}

/**
 * Elimina un utente. `opts.prepare(user, t)` gira nella stessa transazione
 * (es. anonimizzazione GDPR). La foto profilo e' sempre rimossa dopo il commit.
 * @returns {Promise<{ removedBookings, cancelledBookings, removedMonteOreProposals }>}
 */
async function removeUser(id, opts = {}) {
  const policy = resolvePolicy(opts);
  const files = opts.files ?? defaultFiles;
  let photos = [];
  const result = await inTransaction(
    async (t) => {
      const exists = await User.count({ where: { id }, transaction: t });
      if (!exists) throw domainError('USER_NOT_FOUND', 'Utente non trovato', { status: 404 });
      const r = await removeUsersInTx([id], policy, t, opts.prepare);
      photos = r.photos;
      return {
        removedBookings: r.removedBookings,
        cancelledBookings: r.cancelledBookings,
        removedMonteOreProposals: r.removedMonteOreProposals,
      };
    },
    { message: FK_USER_MESSAGE, code: 'FK_CONSTRAINT' },
  );
  await cleanupFiles(files, 'removeProfilePhoto', photos);
  return result;
}

/** @returns {Promise<{ deleted, removedBookings, cancelledBookings, removedMonteOreProposals }>} */
async function removeUsers(ids, opts = {}) {
  const policy = resolvePolicy(opts);
  const files = opts.files ?? defaultFiles;
  let photos = [];
  const result = await inTransaction(async (t) => {
    const { photos: p, ...r } = await removeUsersInTx(ids, policy, t);
    photos = p;
    return r;
  });
  await cleanupFiles(files, 'removeProfilePhoto', photos);
  return result;
}

module.exports = {
  removeInstitute,
  removeBuildings,
  removeRooms,
  removeUser,
  removeUsers,
  defaultFiles,
};
