'use strict';

const { DataTypes } = require('sequelize');

/**
 * Monte Ore — singola cella della griglia di pianificazione settimanale.
 *
 * Una `MonteOreSchedule` (pattern, es. "lun 09-13") viene espansa in tante
 * `MonteOreSlot` quante sono le settimane lavorative del calendario didattico
 * (al netto delle sospensioni admin). Il docente clicca/decliccia singole
 * celle dalla griglia per personalizzare la proposta.
 *
 * Quando il coordinatore clicca "Crea prenotazioni dal monte ore", solo gli
 * slot con `isActive = true` vengono espansi in `Booking`.
 *
 * Stato:
 *   - `isActive = true` → slot incluso nella proposta finale
 *   - `isActive = false` → slot escluso dal docente (cella deselezionata)
 *   - `isLocked = true` → cella bloccata: cade in un giorno di sospensione
 *     parziale (festività infrasettimanale) e NON è cliccabile dal docente
 *
 * Storico modifiche post-approval:
 *   - `originalActive` → snapshot del valore al momento dell'approvazione.
 *     Serve alla logica di amendment per distinguere "modifica su giornata
 *     già approvata (auto-approve)" da "nuova giornata (manual approve)".
 */
module.exports = (sequelize) => {
  const MonteOreSlot = sequelize.define(
    'MonteOreSlot',
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      proposalId: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      scheduleId: {
        // FK al pattern che ha generato questo slot. Se il pattern viene
        // rimosso, lo slot viene cancellato (rigenerato eventualmente).
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      date: {
        // YYYY-MM-DD — la data effettiva (es. 3 nov 2025)
        type: DataTypes.DATEONLY,
        allowNull: false,
      },
      dayOfWeek: {
        type: DataTypes.INTEGER,
        allowNull: false,
        validate: { min: 0, max: 6 },
      },
      startTime: { type: DataTypes.STRING(5), allowNull: false },
      endTime: { type: DataTypes.STRING(5), allowNull: false },
      isActive: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      isLocked: {
        // True se cade in un giorno di sospensione parziale (cella rossa
        // non cliccabile)
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      lockReason: {
        // Etichetta della sospensione che blocca lo slot (es. "Festa della
        // Repubblica") — mostrata in tooltip sulla cella rossa.
        type: DataTypes.STRING(120),
        allowNull: true,
      },
      // Snapshot del valore `isActive` al momento dell'ultima approvazione.
      // Usato dalla logica amendment: se `isActive !== originalActive` su
      // una data che era originalmente isActive=true → auto-approve.
      originalActive: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      // Booking.id generato (uno per slot, valorizzato solo dopo generate)
      bookingId: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
    },
    {
      tableName: 'monte_ore_slots',
      paranoid: false,
      indexes: [
        { fields: ['proposalId'] },
        { fields: ['scheduleId'] },
        { fields: ['date'] },
        { fields: ['proposalId', 'date'] },
      ],
    },
  );

  return MonteOreSlot;
};
