'use strict';

const { DataTypes } = require('sequelize');

// Tracciamento dei consensi prestati dall'utente. Serve come prova ai sensi
// dell'art. 7 GDPR ("dimostrare che l'interessato abbia prestato il proprio
// consenso al trattamento") e per ricostruire lo storico delle versioni di
// policy accettate.
//
// Convenzione consentType:
//   - 'privacy_policy' : presa visione informativa (obbligatorio per registrarsi)
//   - 'terms'          : accettazione termini di servizio (obbligatorio)
//   - 'marketing'      : consenso a comunicazioni promozionali (opzionale)
//
// `granted` è memorizzato perché il consenso può essere revocato ("Sì→No"):
// in tal caso si crea un nuovo record con granted=false invece di cancellare
// quello precedente — l'evento di revoca deve restare tracciabile.
module.exports = (sequelize) => {
  const UserConsent = sequelize.define(
    'UserConsent',
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      userId: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      consentType: {
        type: DataTypes.ENUM('privacy_policy', 'terms', 'marketing'),
        allowNull: false,
      },
      granted: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      // Versione del documento policy/terms al momento del consenso (es. "2026-04-27").
      // Per consensi non versionati (marketing) si memorizza comunque la data ISO.
      policyVersion: {
        type: DataTypes.STRING(40),
        allowNull: false,
      },
      ip: {
        type: DataTypes.STRING(64),
        allowNull: true,
      },
      userAgent: {
        type: DataTypes.STRING(500),
        allowNull: true,
      },
    },
    {
      tableName: 'user_consents',
      timestamps: true,
      // Niente paranoid: i consensi sono storici e non vanno cancellati.
      indexes: [{ fields: ['userId'] }, { fields: ['userId', 'consentType', 'createdAt'] }],
    },
  );

  return UserConsent;
};
