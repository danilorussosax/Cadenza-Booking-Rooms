'use strict';

const { DataTypes } = require('sequelize');

/**
 * ChatSession — sessione conversazionale del bot per (channel, externalId).
 *
 *   - channel    : 'telegram' | 'whatsapp_cloud' | 'signal_cli' | 'email_imap'
 *   - externalId : id univoco sul canale (chat_id Telegram, msisdn WA/Signal,
 *                  email per IMAP)
 *   - userId     : utente Aula Book bindato (null finché il binding non è
 *                  completato — vedi BotBinding + endpoint /me/bot-bindings)
 *   - state      : nome dello step della state-machine (intent.js); null
 *                  quando non c'è un wizard in corso
 *   - slots      : valori raccolti finora dal wizard (JSON)
 *   - expiresAt  : la sessione viene scartata se non aggiornata da N minuti
 *
 * Soft-delete (paranoid): manteniamo storico per audit / GDPR retention.
 * UNIQUE su (channel, externalId) anche su soft-deleted: se un utente cambia
 * binding e torna, riusiamo la stessa riga.
 */
module.exports = (sequelize) => {
  const ChatSession = sequelize.define(
    'ChatSession',
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      channel: { type: DataTypes.STRING(20), allowNull: false },
      externalId: { type: DataTypes.STRING(190), allowNull: false },
      userId: { type: DataTypes.INTEGER, allowNull: true },
      state: { type: DataTypes.STRING(40), allowNull: true },
      slots: { type: DataTypes.JSON, allowNull: true },
      expiresAt: { type: DataTypes.DATE, allowNull: true },
    },
    {
      tableName: 'chat_sessions',
      paranoid: true,
      indexes: [
        {
          fields: ['channel', 'externalId'],
          unique: true,
          name: 'chat_sessions_channel_external_unique',
        },
        { fields: ['userId'] },
      ],
    },
  );
  return ChatSession;
};
