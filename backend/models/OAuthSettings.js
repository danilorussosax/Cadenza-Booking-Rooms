'use strict';

const { DataTypes } = require('sequelize');

/**
 * Configurazione OAuth (Google e Microsoft) gestibile dagli admin via UI.
 * Singleton (id=1). I client secret sono cifrati AES-256-GCM (vedi lib/crypto.js).
 * Le strategie passport vengono caricate da queste impostazioni all'avvio del server;
 * un riavvio è richiesto dopo modifiche.
 */
module.exports = (sequelize) => {
  const OAuthSettings = sequelize.define(
    'OAuthSettings',
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      // ----- Google -----
      googleEnabled: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
      },
      googleClientId: {
        type: DataTypes.STRING(500),
        allowNull: true,
      },
      googleClientSecretEncrypted: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      googleCallbackUrl: {
        type: DataTypes.STRING(500),
        allowNull: true,
      },
      // ----- Microsoft -----
      microsoftEnabled: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
      },
      microsoftClientId: {
        type: DataTypes.STRING(500),
        allowNull: true,
      },
      microsoftClientSecretEncrypted: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      microsoftCallbackUrl: {
        type: DataTypes.STRING(500),
        allowNull: true,
      },
      microsoftTenant: {
        type: DataTypes.STRING(200),
        allowNull: true,
        defaultValue: 'common',
      },
    },
    { tableName: 'oauth_settings' },
  );

  return OAuthSettings;
};
