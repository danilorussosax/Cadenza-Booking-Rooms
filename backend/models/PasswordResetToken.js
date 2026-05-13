'use strict';

const { DataTypes } = require('sequelize');

/**
 * Token monouso per reset password via email self-service.
 *
 * Sicurezza:
 *   - In DB salviamo SOLO l'hash del token (SHA-256 hex), mai il plain.
 *     Se il DB viene esfiltrato, gli attaccanti non possono usare i
 *     token in volo per cambiare password.
 *   - Il token plain viene generato in routes/auth.js con randomBytes(32)
 *     e mandato SOLO via email (link `/reset-password/<token>`).
 *   - `expiresAt` 1h dal createdAt. Dopo, il token è inutilizzabile.
 *   - `usedAt` valorizzato alla prima validazione riuscita → token monouso.
 *   - Index su (userId, createdAt) per rate-limit "max 3 token/ora".
 *
 * Cleanup: i token scaduti/usati restano in DB per audit (chi ha
 * resettato e quando). Una eventuale routine di pulizia periodica può
 * cancellare le righe più vecchie di 30 giorni.
 *
 * Niente paranoid: il DELETE soft non aggiunge valore per token
 * monouso (la vita utile è max 1h).
 */
module.exports = (sequelize) => {
  const PasswordResetToken = sequelize.define(
    'PasswordResetToken',
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
      // SHA-256 hex digest del token plain (64 char hex)
      tokenHash: {
        type: DataTypes.STRING(64),
        allowNull: false,
      },
      expiresAt: {
        type: DataTypes.DATE,
        allowNull: false,
      },
      usedAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      // IP/UA del richiedente — per audit dei reset sospetti
      requestIp: {
        type: DataTypes.STRING(64),
        allowNull: true,
      },
      requestUserAgent: {
        type: DataTypes.STRING(512),
        allowNull: true,
      },
    },
    {
      tableName: 'password_reset_tokens',
      timestamps: true,
      updatedAt: false, // append + un solo update (usedAt) — non serve updatedAt generico
      indexes: [{ fields: ['userId', 'createdAt'] }, { fields: ['tokenHash'], unique: true }],
    },
  );

  return PasswordResetToken;
};
