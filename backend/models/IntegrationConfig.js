'use strict';

const { DataTypes } = require('sequelize');

/**
 * Configurazione di un'integrazione esterna (Isidata, Spaggiari, …).
 *
 * Per Liv A (CSV/XLSX manual upload) la riga serve principalmente come
 * "puntatore" del provider attivo per istituto e per memorizzare il mapping
 * dei campi sovrascritto dall'admin (gli header dell'export Isidata possono
 * variare per release o per istituto).
 *
 * Per Liv B/C (SOAP / webhook automatico) lo stesso record ospita le
 * credenziali cifrate con `lib/crypto.js` (AES-256-GCM) e lo schedule.
 *
 * Campi:
 *   - provider: 'isidata' (per ora unico). ENUM string per estendibilità.
 *   - isEnabled: master switch per disattivare velocemente l'integrazione
 *     senza perderne la configurazione.
 *   - credentialsEncrypted: blob JSON cifrato (Liv B/C). NULL per Liv A.
 *   - fieldMappingOverrides: oggetto che rimappa header sorgente → campo
 *     ExternalUser. Se NULL si usa il default in fieldMapping.js.
 *   - syncSchedule: cron expression (Liv B/C). NULL per Liv A (manual).
 *   - lastRunAt / lastRunStatus / lastRunSummary / lastErrorMessage:
 *     denormalizzati per la card "ultima esecuzione" senza dover fare JOIN
 *     con IntegrationSyncRun. Aggiornati al termine di ogni run.
 */
module.exports = (sequelize) => {
  const IntegrationConfig = sequelize.define(
    'IntegrationConfig',
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      instituteId: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      provider: {
        type: DataTypes.STRING(32),
        allowNull: false,
      },
      isEnabled: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      credentialsEncrypted: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      fieldMappingOverrides: {
        type: DataTypes.JSON,
        allowNull: true,
      },
      syncSchedule: {
        type: DataTypes.STRING(64),
        allowNull: true,
      },
      lastRunAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      lastRunStatus: {
        type: DataTypes.STRING(16),
        allowNull: true,
      },
      lastRunSummary: {
        type: DataTypes.JSON,
        allowNull: true,
      },
      lastErrorMessage: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
    },
    {
      tableName: 'integration_configs',
      indexes: [
        {
          fields: ['instituteId', 'provider'],
          unique: true,
          name: 'integration_configs_inst_provider_uq',
        },
      ],
    },
  );

  return IntegrationConfig;
};
