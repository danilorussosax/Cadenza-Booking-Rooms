'use strict';

const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const InstrumentLoan = sequelize.define(
    'InstrumentLoan',
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      instrumentId: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      userId: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      fromDate: {
        type: DataTypes.DATEONLY,
        allowNull: false,
      },
      toDate: {
        type: DataTypes.DATEONLY,
        allowNull: false,
      },
      returnedAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      status: {
        // requested = richiesto in attesa di approvazione admin
        // active    = approvato e in corso
        // returned  = restituito (chiuso)
        // overdue   = data di rientro superata e ancora non restituito
        // rejected  = richiesta rifiutata dall'admin
        type: DataTypes.ENUM('requested', 'active', 'returned', 'overdue', 'rejected'),
        allowNull: false,
        defaultValue: 'requested',
      },
      notes: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      approvedBy: {
        // userId dell'admin che ha approvato (null se ancora "requested")
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      approvedAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      reminderSentAt: {
        // Marcato dallo scheduler quando è stato inviato il promemoria 2gg prima.
        type: DataTypes.DATE,
        allowNull: true,
      },
      overdueNotifiedAt: {
        // Marcato dallo scheduler alla prima notifica di scaduto.
        type: DataTypes.DATE,
        allowNull: true,
      },
    },
    {
      tableName: 'instrument_loans',
      paranoid: true,
      indexes: [
        { fields: ['userId', 'status'] },
        { fields: ['instrumentId', 'status'] },
        { fields: ['status', 'toDate'] },
      ],
    },
  );

  return InstrumentLoan;
};
