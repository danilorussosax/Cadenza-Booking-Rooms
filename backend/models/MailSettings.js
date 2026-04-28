'use strict';

const { DataTypes } = require('sequelize');

/**
 * Configurazione SMTP gestibile dagli admin via UI (singleton, id=1).
 * La password è memorizzata cifrata (AES-256-GCM) in `passwordEncrypted`.
 */
module.exports = (sequelize) => {
  const MailSettings = sequelize.define(
    'MailSettings',
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      isEnabled: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
      },
      host: {
        type: DataTypes.STRING(200),
        allowNull: true,
      },
      port: {
        type: DataTypes.INTEGER,
        defaultValue: 587,
      },
      secure: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
      },
      username: {
        type: DataTypes.STRING(200),
        allowNull: true,
      },
      passwordEncrypted: {
        // base64 (iv + tag + ciphertext) — vedi backend/lib/crypto.js
        type: DataTypes.TEXT,
        allowNull: true,
      },
      fromAddress: {
        type: DataTypes.STRING(200),
        allowNull: true,
      },
      fromName: {
        type: DataTypes.STRING(200),
        allowNull: true,
      },
      replyTo: {
        type: DataTypes.STRING(200),
        allowNull: true,
      },
    },
    { tableName: 'mail_settings' },
  );

  return MailSettings;
};
