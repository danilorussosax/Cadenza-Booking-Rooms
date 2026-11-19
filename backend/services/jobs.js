'use strict';

/**
 * Registro unico degli scheduler: un solo elenco usato sia all'avvio sia
 * all'arresto del server. Ogni voce espone start()/stop() (anche async) e
 * viene caricata in modo lazy (require al momento dell'uso).
 */

const logger = require('../lib/logger').child({ scope: 'jobs' });

const DEFAULT_ENTRIES = [
  { name: 'reminder', load: () => require('./reminderScheduler') },
  { name: 'retention', load: () => require('./retentionScheduler') },
  { name: 'mailOutbox', load: () => require('./mailOutboxScheduler') },
  // start() async (legge BackupSettings da DB): fire-and-forget, errori
  // loggati e mai bloccanti per il boot.
  {
    name: 'backup',
    load: () => require('./backupScheduler'),
    startErrorLabel: '[backup] start failed:',
  },
  { name: 'excelExport', load: () => require('./excelExportScheduler') },
  // Verifica integrita' backup (weekly, default domenica 03:00). Env-only.
  {
    name: 'backupVerify',
    load: () => require('./backupVerifyScheduler'),
    startErrorLabel: '[verify] start failed:',
  },
];

function createRegistry(entries = DEFAULT_ENTRIES) {
  return {
    entries,
    /** Avvia tutti gli scheduler nell'ordine dell'elenco; un errore non blocca gli altri. */
    startAll() {
      for (const entry of entries) {
        const label = entry.startErrorLabel || `[${entry.name}] start failed:`;
        try {
          const res = entry.load().start();
          if (res && typeof res.catch === 'function') {
            res.catch((e) => {
              console.error(label, e.message);
            });
          }
        } catch (e) {
          console.error(label, e.message);
          logger.error({ err: e.message, job: entry.name }, 'scheduler start failed');
        }
      }
    },
    /**
     * Ferma tutti gli scheduler (sincrono, idempotente). Li ferma comunque
     * tutti; se uno lancia, rilancia il primo errore alla fine.
     */
    stopAll() {
      let firstError = null;
      for (const entry of entries) {
        try {
          entry.load().stop();
        } catch (e) {
          if (!firstError) firstError = e;
        }
      }
      if (firstError) throw firstError;
    },
  };
}

const registry = createRegistry();

module.exports = {
  startAll: () => registry.startAll(),
  stopAll: () => registry.stopAll(),
  createRegistry,
  DEFAULT_ENTRIES,
};
