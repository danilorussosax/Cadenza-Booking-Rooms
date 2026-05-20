'use strict';

/**
 * Lease per leader election degli scheduler (v1.13).
 *
 * Una sola riga per `name` di worker (es. 'mail-outbox'). Il primo che
 * riesce a fare il claim per un nome diventa leader. Il leader rinnova
 * `leaseUntil` ogni N secondi; se non rinnova entro la deadline, qualsiasi
 * altra istanza può prendere il lease.
 *
 * Atomicità:
 *   - L'INSERT iniziale è gated dal vincolo UNIQUE su `name`: due istanze
 *     che provano insieme l'INSERT, solo una vince.
 *   - Il rinnovo (UPDATE) usa WHERE `holderId=me AND leaseUntil > now`:
 *     se il lease è scaduto, l'UPDATE non matcha e l'altra istanza può
 *     entrare via INSERT (NB: prima va fatta DELETE del record scaduto,
 *     o useremo `holderId='' WHERE leaseUntil < NOW` come stato "libero").
 *
 * Niente Redis, niente Postgres advisory lock: tabella standard + UNIQUE.
 * Funziona identico su SQLite (dev/test) e Postgres (prod).
 */

const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const SchedulerLease = sequelize.define(
    'SchedulerLease',
    {
      // Nome del worker (chiave logica). Esempi: 'mail-outbox', 'reminder',
      // 'backup', 'retention'. UNIQUE perché una sola istanza per worker.
      name: {
        type: DataTypes.STRING(64),
        primaryKey: true,
      },
      // Identificatore opaco dell'istanza che detiene il lease. Formato
      // libero: in pratica `${hostname}:${pid}:${randomHex}` generato al boot.
      // Stringa vuota = lease libero (record creato dal seed/migration ma
      // mai stato "claimato").
      holderId: {
        type: DataTypes.STRING(128),
        allowNull: false,
        defaultValue: '',
      },
      acquiredAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      renewedAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      // Scadenza del lease. Se now > leaseUntil, qualsiasi istanza può
      // riprenderlo via UPDATE atomico.
      leaseUntil: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      // Diagnostica: ultimo motivo di rilascio ('shutdown', 'expired', ...).
      lastReleaseReason: {
        type: DataTypes.STRING(64),
        allowNull: true,
      },
    },
    {
      tableName: 'scheduler_leases',
      timestamps: false,
    },
  );

  return SchedulerLease;
};
