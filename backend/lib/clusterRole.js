'use strict';

/**
 * Helper per coordinare gli scheduler quando il backend gira in PM2
 * cluster mode (`exec_mode: 'cluster'`).
 *
 * Problema: in cluster mode tutte le istanze vedono lo stesso
 * `process.env` e potrebbero avviare in parallelo `reminderScheduler`,
 * `backupScheduler`, ecc. Risultato indesiderato: N backup notturni,
 * N invii di reminder per utente, N tentativi di restore retention.
 *
 * Soluzione: PM2 espone `NODE_APP_INSTANCE` con il numero progressivo
 * dell'istanza (0, 1, 2, …). Designiamo l'istanza 0 come "scheduler
 * master": solo lì gli scheduler partono. Le altre istanze servono
 * solo richieste HTTP (parallelismo + restartability).
 *
 * In ambiente non-cluster (singolo processo fork mode, dev, test) la
 * env var non e' settata → il check ritorna true e tutto funziona
 * come prima della pass cluster-mode. Backward-compatible al 100%.
 *
 * Per forzare il comportamento "tutte le istanze runnano gli scheduler"
 * (sconsigliato), impostare `SCHEDULER_FORCE_ALL_INSTANCES=1`.
 */

function isSchedulerMaster() {
  if (process.env.SCHEDULER_FORCE_ALL_INSTANCES === '1') return true;
  const instance = process.env.NODE_APP_INSTANCE;
  // Non-cluster: env non valorizzata → singolo processo, tutto attivo.
  if (instance === undefined || instance === '') return true;
  // Cluster: solo l'istanza 0 esegue gli scheduler.
  return instance === '0';
}

module.exports = { isSchedulerMaster };
