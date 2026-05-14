'use strict';

/**
 * Aggiunge `oauth_settings.allowedEmailDomains` — lista CSV di domini email
 * autorizzati a loggarsi via Google/Microsoft. NULL o stringa vuota = nessuna
 * restrizione (qualunque account è accettato). I valori sono memorizzati già
 * normalizzati (lowercase, trim) e separati da virgola.
 *
 * Idempotente.
 */

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const desc = await queryInterface.describeTable('oauth_settings');
    if (!desc.allowedEmailDomains) {
      await queryInterface.addColumn('oauth_settings', 'allowedEmailDomains', {
        type: Sequelize.STRING(1000),
        allowNull: true,
      });
    }
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('oauth_settings', 'allowedEmailDomains').catch(() => {});
  },
};
