'use strict';

/**
 * Leader election dinamica per scheduler distribuiti su PM2 cluster mode.
 *
 * Sostituisce il check fisso `NODE_APP_INSTANCE === 0` (clusterRole.js) con
 * un lease su tabella `scheduler_leases`: se l'istanza 0 va down, gli altri
 * worker rilevano il lease scaduto e ne acquisiscono uno nuovo, prendendo
 * il relay automaticamente.
 *
 * API:
 *   const lease = new LeaderLease({ name: 'mail-outbox', ttlMs: 30_000 });
 *   const isLeader = await lease.acquire();   // true se siamo leader
 *   await lease.renew();                       // chiamato dal tick worker
 *   await lease.release('shutdown');           // cleanup grazioso
 *
 * Robustezza:
 *   - Atomic acquire via UPDATE con WHERE `holderId='' OR leaseUntil<now`.
 *     Se 0 row modificate → siamo già fuori. Niente race.
 *   - Sul primo claim: INSERT con UNIQUE(name) gestisce la collisione.
 *     Solo una istanza vince.
 *   - Niente Postgres advisory lock: codice identico su SQLite e Postgres.
 *
 * Backward-compat:
 *   - In fork mode (single instance) il lease funziona ugualmente: una
 *     sola istanza, prende sempre il lease, lo rinnova, lo rilascia su
 *     shutdown. Nessun overhead percepibile (1 query ogni TTL/2).
 *   - Nei test (NODE_ENV=test) il modulo NON va in panic se la tabella
 *     non esiste ancora: acquire() torna `false` e l'utente del worker
 *     decide cosa fare (in genere: skip silenzioso, come oggi con
 *     isSchedulerMaster()).
 */

const crypto = require('node:crypto');
const os = require('node:os');
const { Op } = require('sequelize');

const logger = require('./logger').child({ scope: 'leader' });

// Identità di questa istanza: hostname:pid:rand. Random byte per evitare
// che due istanze con stesso pid (improbabile ma plausibile in container)
// si pestino i piedi.
const INSTANCE_ID = `${os.hostname()}:${process.pid}:${crypto.randomBytes(4).toString('hex')}`;

class LeaderLease {
  /**
   * @param {object} opts
   * @param {string} opts.name — nome univoco del worker (es. 'mail-outbox')
   * @param {number} [opts.ttlMs=30000] — durata del lease prima della scadenza
   * @param {object} [opts.SchedulerLease] — model Sequelize (lazy: default da require)
   */
  constructor({ name, ttlMs = 30_000, SchedulerLease } = {}) {
    if (!name || typeof name !== 'string') {
      throw new Error('LeaderLease: name richiesto');
    }
    this.name = name;
    this.ttlMs = Math.max(5_000, ttlMs);
    this._isLeader = false;
    this._SchedulerLease = SchedulerLease || null;
    this.holderId = INSTANCE_ID;
  }

  _model() {
    if (this._SchedulerLease) return this._SchedulerLease;
    const { SchedulerLease } = require('../models');
    this._SchedulerLease = SchedulerLease;
    return SchedulerLease;
  }

  isLeader() {
    return this._isLeader;
  }

  /**
   * Prova ad acquisire o rinnovare il lease. Restituisce true se siamo
   * leader (ora o già). Pattern:
   *   - se la riga non esiste: tenta INSERT (UNIQUE name gate)
   *   - se esiste libera/scaduta: UPDATE atomico con WHERE
   *   - se esiste e siamo noi i detentori: UPDATE renew
   *   - altrimenti: false (qualcun altro è leader)
   */
  async acquire() {
    const now = new Date();
    const expires = new Date(now.getTime() + this.ttlMs);
    let model;
    try {
      model = this._model();
    } catch {
      // Boot ordering: i model non sono ancora caricati. Fallback "no leader".
      return false;
    }

    try {
      // 1) Prova UPDATE atomico: prendiamo il lease se è libero (holderId='')
      // o scaduto (leaseUntil < now), oppure se è già nostro (renew).
      const [rowsAffected] = await model.update(
        {
          holderId: this.holderId,
          acquiredAt: now,
          renewedAt: now,
          leaseUntil: expires,
          lastReleaseReason: null,
        },
        {
          where: {
            name: this.name,
            [Op.or]: [
              { holderId: this.holderId },
              { holderId: '' },
              { leaseUntil: { [Op.lt]: now } },
            ],
          },
        },
      );
      if (rowsAffected === 1) {
        if (!this._isLeader) {
          logger.info({ name: this.name, holder: this.holderId }, 'leader acquired');
        }
        this._isLeader = true;
        return true;
      }
    } catch (err) {
      // Errori DB (es. SQLite locked momentaneamente): logghiamo e procediamo
      // come "non leader". Il prossimo tick ritenta.
      logger.warn({ err: err.message, name: this.name }, 'leader acquire UPDATE failed');
    }

    // 2) Riga inesistente: prova INSERT. UNIQUE(name) → solo uno vince.
    try {
      await model.create({
        name: this.name,
        holderId: this.holderId,
        acquiredAt: now,
        renewedAt: now,
        leaseUntil: expires,
      });
      logger.info({ name: this.name, holder: this.holderId }, 'leader acquired (initial)');
      this._isLeader = true;
      return true;
    } catch (err) {
      // Collisione UNIQUE = un'altra istanza ha vinto. Non logghiamo come
      // errore (è path atteso) salvo dialect-specific noise.
      if (
        err?.name === 'SequelizeUniqueConstraintError' ||
        err?.parent?.code === 'SQLITE_CONSTRAINT' ||
        err?.parent?.code === '23505'
      ) {
        this._isLeader = false;
        return false;
      }
      logger.warn({ err: err.message, name: this.name }, 'leader acquire INSERT failed');
      this._isLeader = false;
      return false;
    }
  }

  /**
   * Rinnova il lease. Restituisce true se siamo ancora leader, false se
   * abbiamo perso il lease (es. clock skew o release manuale dal DB).
   * Da chiamare ogni tick del worker.
   */
  async renew() {
    const now = new Date();
    const expires = new Date(now.getTime() + this.ttlMs);
    try {
      const model = this._model();
      const [rowsAffected] = await model.update(
        { renewedAt: now, leaseUntil: expires },
        { where: { name: this.name, holderId: this.holderId } },
      );
      if (rowsAffected === 1) {
        this._isLeader = true;
        return true;
      }
      if (this._isLeader) {
        logger.warn({ name: this.name }, 'lease perso al renew, attivo retry acquire');
      }
      this._isLeader = false;
      return false;
    } catch (err) {
      logger.warn({ err: err.message, name: this.name }, 'lease renew failed');
      return this._isLeader;
    }
  }

  /**
   * Rilascia il lease (cleanup grazioso). Idempotente: se non siamo leader,
   * no-op.
   */
  async release(reason = 'shutdown') {
    if (!this._isLeader) return;
    try {
      const model = this._model();
      await model.update(
        { holderId: '', leaseUntil: new Date(0), lastReleaseReason: reason },
        { where: { name: this.name, holderId: this.holderId } },
      );
      logger.info({ name: this.name, reason }, 'lease released');
    } catch (err) {
      logger.warn({ err: err.message, name: this.name }, 'lease release failed');
    } finally {
      this._isLeader = false;
    }
  }
}

module.exports = {
  LeaderLease,
  INSTANCE_ID,
};
