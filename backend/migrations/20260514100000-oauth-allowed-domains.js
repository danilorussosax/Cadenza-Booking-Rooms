'use strict';

/**
 * Aggiunge `oauth_settings.allowedEmailDomains` — lista CSV di domini email
 * autorizzati a loggarsi via Google/Microsoft. NULL o stringa vuota = nessuna
 * restrizione (qualunque account è accettato). I valori sono memorizzati già
 * normalizzati (lowercase, trim) e separati da virgola.
 *
 * Idempotente.
 */

const { runPreSyncStep } = require('../lib/preSyncMigrations');

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  // Stessa definizione delle pre-sync (una sola fonte).
  async up() {
    await runPreSyncStep('oauth_settings.allowedEmailDomains');
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('oauth_settings', 'allowedEmailDomains').catch(() => {});
  },
};
