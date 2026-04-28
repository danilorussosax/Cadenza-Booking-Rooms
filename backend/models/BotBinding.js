'use strict';

const { DataTypes } = require('sequelize');

/**
 * BotBinding — associazione persistente (channel, externalId) ↔ userId.
 *
 *   - channel     : 'telegram' | 'whatsapp_cloud' | 'signal_cli' | 'email_imap'
 *   - externalId  : id univoco lato canale (chat_id, msisdn, email)
 *   - userId      : utente Aula Book proprietario del binding
 *   - boundAt     : quando il binding è stato confermato via OTP
 *   - lastSeenAt  : aggiornato a ogni messaggio ricevuto, utile per analytics
 *
 * UNIQUE su (channel, externalId): UN solo utente può possedere quel canale.
 * Un utente può invece avere più binding (uno per canale).
 *
 * Per il binding pending (OTP in attesa) usiamo `User.botBindingChallenge`
 * JSON (stesso pattern di 2FA email).
 */
module.exports = (sequelize) => {
  const BotBinding = sequelize.define(
    'BotBinding',
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      channel: { type: DataTypes.STRING(20), allowNull: false },
      externalId: { type: DataTypes.STRING(190), allowNull: false },
      userId: { type: DataTypes.INTEGER, allowNull: false },
      boundAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      lastSeenAt: { type: DataTypes.DATE, allowNull: true },
    },
    {
      tableName: 'bot_bindings',
      indexes: [
        {
          fields: ['channel', 'externalId'],
          unique: true,
          name: 'bot_bindings_channel_external_unique',
        },
        { fields: ['userId'] },
      ],
    },
  );
  return BotBinding;
};
