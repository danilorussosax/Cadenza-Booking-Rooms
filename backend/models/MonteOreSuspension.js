'use strict';

const { DataTypes } = require('sequelize');

/**
 * Monte Ore — periodi di sospensione delle lezioni (vacanze, festività,
 * ponti). Definiti dall'admin e applicati a tutti i docenti per filtrare
 * la griglia settimanale di pianificazione.
 *
 * Distinzione importante (richiesta dalla UX):
 *   - `kind = 'full_week'` → la riga della settimana **scompare** dalla
 *     griglia. Tipicamente vacanze di Natale/Pasqua che coprono settimane
 *     intere. Nessuna pianificazione possibile.
 *   - `kind = 'partial'` → solo i giorni inclusi diventano celle ROSSE
 *     non cliccabili nella griglia. Tipicamente festività infrasettimanali
 *     (1 nov, 8 dic, 25 apr, 1 mag, 2 giu, ecc.).
 *
 * Il generator monte ore (services/monteOreService.js) usa la stessa
 * lookup per skippare le date.
 */
module.exports = (sequelize) => {
  const MonteOreSuspension = sequelize.define(
    'MonteOreSuspension',
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
      academicYear: {
        type: DataTypes.STRING(16),
        allowNull: false,
      },
      name: {
        // Etichetta visibile in UI: "Vacanze di Natale", "Festa della Repubblica"
        type: DataTypes.STRING(120),
        allowNull: false,
      },
      dateFrom: { type: DataTypes.DATEONLY, allowNull: false },
      dateTo: { type: DataTypes.DATEONLY, allowNull: false },
      kind: {
        type: DataTypes.ENUM('full_week', 'partial'),
        allowNull: false,
        defaultValue: 'partial',
      },
      notes: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      // Se valorizzato, la sospensione (di solito kind='partial') è "linkata"
      // a una BookingRuleException con kind='block' e role='all' creata
      // automaticamente: il blocco delle festività si applica anche alle
      // prenotazioni manuali normali, non solo al monte ore.
      // Cancellare la suspension → cancella anche l'exception (handled in route).
      bookingRuleExceptionId: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
    },
    {
      tableName: 'monte_ore_suspensions',
      paranoid: false,
      indexes: [{ fields: ['instituteId', 'academicYear'] }, { fields: ['dateFrom', 'dateTo'] }],
    },
  );

  return MonteOreSuspension;
};
