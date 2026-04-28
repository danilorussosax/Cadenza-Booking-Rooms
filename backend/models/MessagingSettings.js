'use strict';

const { DataTypes } = require('sequelize');

/**
 * MessagingSettings — una riga per canale supportato. Le credenziali sono
 * cifrate con la stessa pipeline di MailSettings (lib/crypto encrypt/decrypt).
 *
 *   - channel     : 'telegram' | 'whatsapp_cloud' | 'signal_cli' | 'email_imap'
 *                   UNIQUE → 1 riga per canale
 *   - isEnabled   : master switch — se false, webhook risponde 404 e
 *                   adapter.send rifiuta
 *   - settings    : oggetto JSON in chiaro (configurazione non sensibile,
 *                   es. numero phoneNumberId WhatsApp, daemonUrl Signal)
 *   - credentialsEncrypted : JSON cifrato con i secret (botToken Telegram,
 *                            access_token WhatsApp Cloud, IMAP password,
 *                            webhookSecret HMAC). Lib `crypto.js`.
 *
 * Nota privacy: `credentialsEncrypted` non è mai esposto al client. La UI
 * admin mostra solo `isEnabled`, `settings` e flag "secret configurato".
 */
module.exports = (sequelize) => {
  const MessagingSettings = sequelize.define(
    'MessagingSettings',
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      channel: { type: DataTypes.STRING(20), allowNull: false, unique: true },
      isEnabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      settings: { type: DataTypes.JSON, allowNull: true },
      credentialsEncrypted: { type: DataTypes.TEXT, allowNull: true },
    },
    {
      tableName: 'messaging_settings',
      indexes: [{ fields: ['channel'], unique: true }],
    },
  );
  return MessagingSettings;
};
