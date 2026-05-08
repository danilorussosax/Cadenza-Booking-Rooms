'use strict';

const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const BookingRuleException = sequelize.define(
    'BookingRuleException',
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      // A chi si applica: un ruolo specifico oppure 'all' (tutti i non-admin)
      role: {
        type: DataTypes.ENUM('admin', 'docente', 'studente', 'all'),
        allowNull: false,
        defaultValue: 'all',
      },
      // Aula a cui è ristretta l'eccezione. null = vale per tutte le aule
      // (comportamento storico). Se valorizzata, l'eccezione blocca/limita
      // SOLO le prenotazioni di quella specifica aula.
      // ON DELETE CASCADE: se l'aula sparisce l'eccezione perde senso.
      roomId: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: 'rooms', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      // Etichetta umana, es. "Pausa pranzo", "Sospensione didattica natalizia"
      name: {
        type: DataTypes.STRING(150),
        allowNull: false,
      },
      // block: impedisce qualunque prenotazione nella finestra
      // time_window: limita le ore prenotabili a maxHoursInWindow nella finestra
      kind: {
        type: DataTypes.ENUM('block', 'time_window'),
        allowNull: false,
      },
      // Array di interi 0-6 (0=domenica, 1=lunedì, ...). null = tutti i giorni
      daysOfWeek: {
        type: DataTypes.JSON,
        allowNull: true,
      },
      // Range di date specifico (data singola: dateFrom = dateTo)
      dateFrom: {
        type: DataTypes.DATEONLY,
        allowNull: true,
      },
      dateTo: {
        type: DataTypes.DATEONLY,
        allowNull: true,
      },
      // Fascia oraria opzionale (HH:mm); null = giorno intero
      startTime: {
        type: DataTypes.STRING(5),
        allowNull: true,
      },
      endTime: {
        type: DataTypes.STRING(5),
        allowNull: true,
      },
      // Limite ore (es. 1.0) — solo per kind='time_window'
      maxHoursInWindow: {
        type: DataTypes.FLOAT,
        allowNull: true,
      },
      isActive: {
        type: DataTypes.BOOLEAN,
        defaultValue: true,
      },
      notes: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
    },
    {
      tableName: 'booking_rule_exceptions',
      indexes: [
        { fields: ['role'] },
        { fields: ['isActive'] },
        { fields: ['roomId'] },
        // Composito sul lookup hot-path del validator: filtro per role + roomId + isActive
        { fields: ['role', 'roomId', 'isActive'] },
      ],
    },
  );

  return BookingRuleException;
};
