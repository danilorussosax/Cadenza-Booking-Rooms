'use strict';

// Adapter registry. Ogni adapter espone:
//   - verifyWebhook(req, config) → boolean
//   - parseIncoming(req) → { channel, externalId, text, raw } | null
//   - send(externalId, text, config) → Promise<void>
//   - testConnection(config) → Promise<{ ok, error? }>
module.exports = {
  telegram: require('./telegram'),
  whatsapp_cloud: require('./whatsapp_cloud'),
  signal_cli: require('./signal_cli'),
  email_imap: require('./email_imap'),
};
