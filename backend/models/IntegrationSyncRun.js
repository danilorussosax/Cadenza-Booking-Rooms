'use strict';

const { DataTypes } = require('sequelize');

/**
 * Storico delle esecuzioni di sincronizzazione di un IntegrationConfig.
 *
 * Pattern: ogni "Apply" del flusso CSV/XLSX (o ogni run automatico Liv B/C)
 * crea una riga. Una riga contiene tutto ciò che serve per:
 *   - mostrare la cronologia in /admin/integrations/runs
 *   - debug post-mortem (errorPayload + diffSnapshot)
 *   - audit forense (chi ha lanciato cosa, quando, con che esito)
 *
 * Campi rilevanti:
 *   - configId: FK opzionale a IntegrationConfig (può essere NULL se l'admin
 *     ha caricato un file prima di salvare una config — il primo run "tap-into").
 *   - triggeredBy: 'manual' | 'schedule' | 'webhook'. Per Liv A sempre 'manual'.
 *   - status: 'success' | 'partial' | 'failed' | 'preview'. La preview viene
 *     loggata solo se serve audit; in genere si scrive solo lo status finale.
 *   - errorPayload: per debug — stack o array di errori per riga.
 *   - diffSnapshot: il diff calcolato al momento dell'apply (per
 *     ricostruire ex-post cosa è effettivamente stato applicato).
 *
 * paranoid:false — non vogliamo perdere righe per errore: append-only.
 */
module.exports = (sequelize) => {
  const IntegrationSyncRun = sequelize.define(
    'IntegrationSyncRun',
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      configId: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      instituteId: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      provider: {
        type: DataTypes.STRING(32),
        allowNull: false,
      },
      actorId: {
        // User.id che ha avviato l'azione (admin per i run manuali).
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      startedAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
      finishedAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      triggeredBy: {
        type: DataTypes.STRING(16),
        allowNull: false,
        defaultValue: 'manual',
      },
      status: {
        type: DataTypes.STRING(16),
        allowNull: false,
        defaultValue: 'preview',
      },
      fetched: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      created: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      updated: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      skipped: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      orphaned: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      errors: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      errorPayload: {
        type: DataTypes.JSON,
        allowNull: true,
      },
      diffSnapshot: {
        type: DataTypes.JSON,
        allowNull: true,
      },
    },
    {
      tableName: 'integration_sync_runs',
      paranoid: false,
      indexes: [
        { fields: ['configId'] },
        { fields: ['instituteId'] },
        { fields: ['provider'] },
        { fields: ['status'] },
        { fields: ['createdAt'] },
      ],
    },
  );

  return IntegrationSyncRun;
};
