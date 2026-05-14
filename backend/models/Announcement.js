'use strict';

const { DataTypes } = require('sequelize');

/**
 * Bacheca avvisi (Announcement).
 *
 * Comunicazione 1→N dall'amministrazione verso utenti e/o display kiosk.
 * Ogni avviso ha un'`audience` che ne determina i destinatari.
 *
 * Forma di `audience` (JSON):
 *   { kind: 'all' }                            → tutti gli utenti
 *   { kind: 'role',     value: 'studente' }    → un singolo ruolo
 *   { kind: 'course',   value: 12 }            → studenti del corso (Course.id)
 *   { kind: 'building', value: 3 }             → mostrato sul kiosk dell'edificio
 *
 * Note:
 *   - kind='building' non è visibile nel feed personale di un utente: è
 *     pensato come targeting kiosk (vedi /api/public/announcements).
 *   - `isPinned` ha doppia semantica: ordinamento (pinnati in alto nel feed
 *     user) e selezione (?pinned=true per il kiosk).
 *   - `expiresAt` nullable: se NULL = non scade mai. Se valorizzato ed è nel
 *     passato → l'avviso non viene più ritornato dal feed.
 *   - `publishedAt`: la data effettiva di pubblicazione (può essere
 *     future-dated → "drafts" che diventano visibili automaticamente).
 *   - `emailSentAt`: marcato dal route handler quando l'email broadcast è
 *     stata inviata, per evitare doppi invii a re-publish (idempotenza).
 *   - paranoid: soft delete; mantiene auditability.
 */
module.exports = (sequelize) => {
  const Announcement = sequelize.define(
    'Announcement',
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      title: {
        type: DataTypes.STRING(200),
        allowNull: false,
      },
      body: {
        // Markdown. Reso a HTML safe nel frontend con react-markdown.
        type: DataTypes.TEXT,
        allowNull: false,
      },
      publishedAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
      expiresAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      audience: {
        // JSON { kind, value? }. Vedi commento sopra per la forma.
        type: DataTypes.JSON,
        allowNull: false,
        defaultValue: { kind: 'all' },
      },
      isPinned: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      isActive: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      emailSentAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      createdBy: {
        // userId dell'admin autore (SET NULL se l'utente viene cancellato)
        type: DataTypes.INTEGER,
        allowNull: true,
      },
    },
    {
      tableName: 'announcements',
      paranoid: true,
      // Indice composito sul feed pubblico: WHERE isActive=true AND
      // publishedAt<=now AND (expiresAt IS NULL OR expiresAt>now)
      // ORDER BY isPinned DESC, publishedAt DESC.
      // Vedi routes/announcements.js (GET /api/announcements).
      indexes: [
        { fields: ['isActive', 'publishedAt', 'expiresAt'], name: 'announcements_active_feed_idx' },
      ],
    },
  );

  return Announcement;
};
