'use strict';

const { DataTypes } = require('sequelize');

/**
 * Template di email gestiti dagli admin via UI.
 * Una riga per "kind" (confirmation, reminder, cancellation).
 *
 * Substitution sintax (vedi services/templateRenderer.js):
 *   {{user.firstName}}              → singola variabile
 *   {{#if booking.purpose}}…{{/if}} → blocco condizionale
 */
module.exports = (sequelize) => {
  const MailTemplate = sequelize.define(
    'MailTemplate',
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      kind: {
        type: DataTypes.STRING(40),
        allowNull: false,
        unique: true,
      },
      subject: {
        type: DataTypes.STRING(255),
        allowNull: false,
      },
      bodyHtml: {
        type: DataTypes.TEXT,
        allowNull: false,
      },
      isEnabled: {
        type: DataTypes.BOOLEAN,
        defaultValue: true,
      },
    },
    { tableName: 'mail_templates' },
  );

  return MailTemplate;
};
