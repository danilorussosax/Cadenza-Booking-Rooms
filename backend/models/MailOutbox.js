'use strict';

const { DataTypes } = require('sequelize');

/**
 * Coda di outbox email: ogni invio passa qui prima di partire davvero.
 * Il worker (services/mailOutboxScheduler.js) preleva le righe `pending`
 * con next_attempt_at <= now() e tenta l'invio via SMTP. Su errore
 * applica backoff esponenziale; superato max_attempts la riga diventa
 * `dead` e va ispezionata da un admin.
 *
 * subject + bodyHtml sono SNAPSHOT pre-renderizzati: i retry non
 * dipendono dal template corrente — se l'admin modifica il template a
 * metà, il retry usa il rendering originale (predicibile, idempotente).
 *
 * idempotencyKey (es. "booking:42:confirmation") è UNIQUE: previene
 * doppi enqueue dovuti a doppi click admin / retry idempotenti delle
 * route handler.
 */
module.exports = (sequelize) => {
  const MailOutbox = sequelize.define(
    'MailOutbox',
    {
      id: {
        type: DataTypes.UUID,
        primaryKey: true,
        defaultValue: DataTypes.UUIDV4,
      },
      kind: {
        // confirmation | reminder | cancellation | ghost_cancellation |
        // claim_waitlist | booking_approved | booking_rejected |
        // booking_pending_admin | loan_request | loan_approved |
        // loan_returned | loan_reminder | loan_overdue |
        // announcement | security | test
        type: DataTypes.STRING(40),
        allowNull: false,
      },
      to: {
        type: DataTypes.STRING(320), // RFC 5321 max email length
        allowNull: false,
      },
      subject: {
        type: DataTypes.STRING(500),
        allowNull: false,
      },
      bodyHtml: {
        type: DataTypes.TEXT,
        allowNull: false,
      },
      replyTo: {
        type: DataTypes.STRING(320),
        allowNull: true,
      },
      priority: {
        // 0 = security/2FA (massima priorità), 5 = transactional (default),
        // 9 = bulk (announcement). Il worker ordina ASC.
        type: DataTypes.SMALLINT,
        allowNull: false,
        defaultValue: 5,
      },
      idempotencyKey: {
        // Se valorizzato, INSERT con vincolo UNIQUE → dedup naturale.
        // NULL = nessuna idempotenza (es. test email arbitrario).
        type: DataTypes.STRING(120),
        allowNull: true,
        unique: true,
      },
      status: {
        // pending = in attesa o in retry / sent = consegnata al server SMTP /
        // dead = fallita oltre max_attempts (richiede ispezione admin)
        type: DataTypes.ENUM('pending', 'sent', 'dead'),
        allowNull: false,
        defaultValue: 'pending',
      },
      attempts: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      maxAttempts: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 5,
      },
      nextAttemptAt: {
        // Backoff: appena enqueued = NOW(); su retry = NOW() + 2^attempts*30s.
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
      lastError: {
        // Errore SMTP umanizzato (vedi smtpHumanError in emailService).
        type: DataTypes.TEXT,
        allowNull: true,
      },
      sentAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
    },
    {
      tableName: 'mail_outbox',
      indexes: [
        // Query principale del worker:
        //   WHERE status='pending' AND nextAttemptAt <= NOW()
        //   ORDER BY priority ASC, nextAttemptAt ASC
        { fields: ['status', 'nextAttemptAt'] },
        { fields: ['priority'] },
      ],
    },
  );

  return MailOutbox;
};
