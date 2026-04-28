'use strict';

const { DataTypes } = require('sequelize');

/**
 * Configurazione runtime del backup automatico (singleton id=1).
 *
 * Storicamente questi parametri erano solo env (`BACKUP_AUTO_ENABLED`,
 * `BACKUP_TICK_HOUR`, ecc.). Spostarli in DB consente all'admin di
 * modificarli da UI senza riavvio. Le env restano:
 *   - usate come default al primo bootstrap (riga DB inesistente);
 *   - sempre rispettate per `BACKUP_DIR` (path non modificabile da UI: è
 *     una proprietà del filesystem, errori la renderebbero inutilizzabile).
 *
 * I valori UI hanno precedenza sulle env per i parametri "soft":
 *   autoEnabled, hour/minute, keep*, autoRestartEnabled.
 */
module.exports = (sequelize) => {
  return sequelize.define(
    'BackupSettings',
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      autoEnabled: { type: DataTypes.BOOLEAN, defaultValue: true },
      scheduledHour: {
        type: DataTypes.INTEGER,
        defaultValue: 2,
        validate: { min: 0, max: 23 },
      },
      scheduledMinute: {
        type: DataTypes.INTEGER,
        defaultValue: 30,
        validate: { min: 0, max: 59 },
      },
      keepDaily: {
        type: DataTypes.INTEGER,
        defaultValue: 30,
        validate: { min: 1, max: 365 },
      },
      keepWeekly: {
        type: DataTypes.INTEGER,
        defaultValue: 12,
        validate: { min: 1, max: 104 },
      },
      keepMonthly: {
        type: DataTypes.INTEGER,
        defaultValue: 12,
        validate: { min: 1, max: 60 },
      },
      autoRestartEnabled: { type: DataTypes.BOOLEAN, defaultValue: false },
    },
    { tableName: 'backup_settings' },
  );
};
