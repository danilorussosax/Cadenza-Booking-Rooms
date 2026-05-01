'use strict';

const { DataTypes } = require('sequelize');

/**
 * Tipologia contrattuale dei docenti (es. "Titolare di cattedra",
 * "Contratto orario", "Supplente part-time 50%", custom dell'istituto).
 *
 * Il `code` è un identificatore stabile usato come valore di
 * `User.contractType` (STRING, no FK relazionale per limitare la portata
 * delle migration). È **immutabile** dopo la creazione: per "rinominare"
 * un tipo si modifica solo `label`. Il code è unique per istituto.
 *
 * `defaultHours` viene usato dal monteOreThresholdService come valore di
 * default fra l'override individuale dell'utente e MonteOreSettings:
 * cascata 4 livelli → user override > contract default > institute > 324.
 *
 * I 4 tipi storici (`titolare`, `contratto_orario`, `supplente`, `altro`)
 * vengono creati come `isSystem: true` dal preSyncMigrations al boot:
 * non sono cancellabili (solo disattivabili) per backward-compat con
 * l'enum hardcoded usato fino alla v2.3.
 */
module.exports = (sequelize) => {
  const ContractType = sequelize.define(
    'ContractType',
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      instituteId: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      // Slug stabile (es. "titolare", "contratto_orario", "borsa_100h").
      // Lowercase + underscore + cifre, max 40 char. Usato come valore
      // di User.contractType senza FK.
      code: {
        type: DataTypes.STRING(40),
        allowNull: false,
        validate: { is: /^[a-z0-9_]{1,40}$/ },
      },
      // Etichetta visibile ("Titolare di cattedra", "Co.Co.Co. 60h", ...).
      label: {
        type: DataTypes.STRING(80),
        allowNull: false,
      },
      // Soglia di default in ore (es. 324 per titolare, 162 per part-time
      // 50%). Se NULL il tipo eredita MonteOreSettings.minRequiredHours.
      defaultHours: {
        type: DataTypes.FLOAT,
        allowNull: true,
        validate: { min: 0, max: 1500 },
      },
      // Se true, gli utenti di questo tipo possono concentrare tutto in
      // 1 giorno (default). L'utente singolo può override con
      // monteOreBypassDayConstraint.
      bypassDayConstraintDefault: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      // Tipo "di sistema" (i 4 originali). Bloccati alla DELETE.
      isSystem: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      // Disattivato → nascosto dalle UI di nuova assegnazione, gli utenti
      // già assegnati continuano a funzionare con il code legacy.
      isActive: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      sortOrder: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      // Note interne dell'admin (riferimento contrattuale, riservate).
      notes: {
        type: DataTypes.STRING(500),
        allowNull: true,
      },
    },
    {
      tableName: 'contract_types',
      paranoid: true,
      indexes: [
        {
          fields: ['instituteId', 'code'],
          unique: true,
          name: 'contract_types_inst_code_uq',
        },
        { fields: ['instituteId', 'isActive'] },
      ],
    },
  );

  return ContractType;
};
