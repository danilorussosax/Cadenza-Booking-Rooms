'use strict';

const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const Institute = sequelize.define(
    'Institute',
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      name: {
        type: DataTypes.STRING(200),
        allowNull: false,
      },
      code: {
        type: DataTypes.STRING(50),
        allowNull: true,
        unique: true,
      },
      address: {
        type: DataTypes.STRING(300),
        allowNull: true,
      },
      city: {
        type: DataTypes.STRING(100),
        allowNull: true,
      },
      country: {
        type: DataTypes.STRING(100),
        defaultValue: 'Italia',
      },
      timezone: {
        type: DataTypes.STRING(60),
        defaultValue: 'Europe/Rome',
      },
      description: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      // Logo memorizzato come data URL (data:image/png;base64,…) o URL esterno.
      // Tenuto come TEXT per supportare entrambi senza preprocessing.
      logoUrl: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      // Testo di copyright mostrato nei footer dell'app (configurabile dagli admin)
      copyright: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
      // ===== Dati anagrafici/legali (Privacy Policy, Termini, fatturazione) =====
      // Denominazione legale completa (può differire da `name` che è il nome
      // breve mostrato nell'header). Es. "Conservatorio di Musica Statale ...".
      legalName: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
      vatNumber: {
        type: DataTypes.STRING(32),
        allowNull: true,
      },
      fiscalCode: {
        type: DataTypes.STRING(32),
        allowNull: true,
      },
      // Email PEC istituzionale, usata come canale formale per comunicazioni legali
      pecEmail: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
      // Email di contatto generico mostrata nelle pagine pubbliche
      contactEmail: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
      // ===== Dati DPO (Data Protection Officer) =====
      // Per i conservatori (ente pubblico) la nomina è obbligatoria ai sensi
      // dell'art. 37.1.a GDPR. Esposti pubblicamente nella Privacy Policy.
      dpoName: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
      dpoEmail: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
      // ===== Foro competente =====
      // Città di riferimento per la giurisdizione nei Termini di servizio.
      // Se assente si usa `city` come fallback.
      jurisdictionCity: {
        type: DataTypes.STRING(100),
        allowNull: true,
      },
      // ===== Sub-processor =====
      // Elenco testuale dei responsabili esterni del trattamento (provider
      // hosting, OAuth, SMTP, ecc.). Memorizzato come array JSON di
      // { name, purpose, location, dpaUrl }. Esposto in Privacy Policy.
      subProcessors: {
        type: DataTypes.JSON,
        allowNull: true,
      },
      // ===== Sicurezza check-in =====
      // Quando true, il check-in via QR è ammesso SOLO se l'IP del client
      // ricade in una delle CIDR `instituteNetworkCidrs`. Rifiuta con
      // CHECKIN_NETWORK_RESTRICTED altrimenti. Default false → check-in da
      // qualsiasi rete.
      checkInRequireInstituteNetwork: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      // Lista CIDR (stringhe) della rete d'istituto. Es:
      //   ["192.168.1.0/24", "10.0.0.0/16", "2001:db8::/32"]
      // Validata lato server con ipaddr.js (IPv4 e IPv6). Vuota → nessuna
      // restrizione anche se il toggle è acceso.
      instituteNetworkCidrs: {
        type: DataTypes.JSON,
        allowNull: false,
        defaultValue: [],
      },
    },
    {
      tableName: 'institutes',
      paranoid: true,
    },
  );

  return Institute;
};
