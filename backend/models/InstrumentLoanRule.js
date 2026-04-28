'use strict';

const { DataTypes } = require('sequelize');

/**
 * Regola di abilitazione al prestito per ogni famiglia strumentale.
 *
 *   family = PK (1 riga per famiglia, upsert idempotente)
 *   allowedCourseIds = lista di Course.id abilitati a richiedere prestiti
 *                      di strumenti di quella famiglia.
 *
 * Semantica:
 *   - Se NON esiste una riga per la famiglia → comportamento permissivo
 *     (qualsiasi utente con profilo completo può richiedere il prestito).
 *   - Se la riga esiste con allowedCourseIds vuoto → BLOCCO totale per
 *     studenti/docenti, lasciato passare solo agli admin.
 *   - Se la riga esiste con allowedCourseIds non vuoto → solo gli utenti
 *     il cui Course.id è nella lista possono richiedere il prestito.
 *
 * Gli admin sono sempre autorizzati a richiedere/approvare prestiti
 * indipendentemente da queste regole.
 */
module.exports = (sequelize) => {
  const InstrumentLoanRule = sequelize.define(
    'InstrumentLoanRule',
    {
      family: {
        type: DataTypes.ENUM(
          'archi',
          'fiati_legni',
          'fiati_ottoni',
          'tastiere',
          'percussioni',
          'corde',
          'voce',
          'elettronica',
          'altro',
        ),
        primaryKey: true,
        allowNull: false,
      },
      allowedCourseIds: {
        // Sequelize JSON funziona su SQLite (TEXT) e Postgres/MySQL (JSON).
        type: DataTypes.JSON,
        allowNull: false,
        defaultValue: [],
      },
      notes: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
    },
    {
      tableName: 'instrument_loan_rules',
    },
  );

  return InstrumentLoanRule;
};
