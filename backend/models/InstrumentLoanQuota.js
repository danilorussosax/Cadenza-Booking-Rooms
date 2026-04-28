'use strict';

const { DataTypes } = require('sequelize');

/**
 * Quote dinamiche sul prestito strumenti — parallelo a `BookingQuota`.
 *
 * Rispetto alle BookingQuota, qui i cap sono naturalmente diversi:
 *   - i prestiti si misurano in **giorni** (interi), non in ore;
 *   - serve un cap su **strumenti contemporanei** (il booking di un'aula
 *     ha già BookingRule.maxActiveBookings, qui è una semantica diversa
 *     legata al possesso fisico).
 *
 * Logica di applicazione (vedi services/loanQuotaValidator.js):
 *   1. Si recuperano tutte le quote `isActive=true` con `role` corrispondente
 *      all'utente.
 *   2. Per la richiesta di prestito si determina quali quote "matchano":
 *        - global       → sempre
 *        - family       → instrument.family === scopeValue
 *        - instrument   → instrument.id === Number(scopeValue)
 *   3. Per ciascuna quota matching:
 *        - se `maxConcurrent > 0` conta i prestiti dello user in stati
 *          attivi (requested|active|overdue) il cui scope corrisponde
 *          alla quota; se ≥ maxConcurrent → errore.
 *        - se `maxDaysPerYear > 0` somma i giorni di prestiti chiusi/aperti
 *          negli ultimi 365 gg che ricadono nello scope; se aggiungere il
 *          nuovo prestito sfora → errore.
 *
 * Convenzioni:
 *   - `maxConcurrent = 0` → cap contemporaneo disattivato
 *   - `maxDaysPerYear = 0` → cap annuale disattivato
 *   - almeno uno dei due deve essere > 0 (validazione lato route)
 *   - per `scopeKind = 'global'`, `scopeValue` = '*' (come BookingQuota).
 *
 * Gli admin sono esclusi dall'applicazione delle quote (coerente con
 * BookingQuota e BookingRule).
 */
module.exports = (sequelize) => {
  const InstrumentLoanQuota = sequelize.define(
    'InstrumentLoanQuota',
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      role: {
        type: DataTypes.ENUM('admin', 'docente', 'studente'),
        allowNull: false,
      },
      scopeKind: {
        // family     → cap per famiglia organologica (es. tutti gli archi)
        // instrument → cap su un singolo strumento (es. "Pianoforte Steinway #3")
        // global     → cap su qualsiasi prestito
        type: DataTypes.ENUM('family', 'instrument', 'global'),
        allowNull: false,
      },
      // Per scopeKind='global' usiamo '*' come "marker".
      // Per family: codice della famiglia (es. 'archi').
      // Per instrument: l'id numerico convertito a stringa.
      scopeValue: {
        type: DataTypes.STRING(80),
        allowNull: false,
        defaultValue: '*',
      },
      maxConcurrent: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
        validate: { min: 0 },
      },
      maxDaysPerYear: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
        validate: { min: 0 },
      },
      isActive: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
    },
    {
      tableName: 'instrument_loan_quotas',
      paranoid: true,
      indexes: [
        { fields: ['role', 'isActive'] },
        { fields: ['scopeKind', 'scopeValue'] },
        // Una sola riga per (ruolo + scope).
        {
          name: 'instrument_loan_quotas_role_scope_unique',
          fields: ['role', 'scopeKind', 'scopeValue'],
          unique: true,
        },
      ],
    },
  );

  return InstrumentLoanQuota;
};
