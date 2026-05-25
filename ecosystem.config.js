// ecosystem.config.js — configurazione PM2 per Cadenza
//
// Attivo: cluster mode, 3 istanze (VPS 4 vCPU / 4GB + PgBouncer).
// Prerequisito già soddisfatto: PgBouncer in transaction pooling su :6432.
//
// Cambio fork→cluster: NON basta `pm2 restart`/`reload` (non cambia
// exec_mode). Va fatto il cutover una tantum sul VPS:
//        pm2 delete cadenza-backend
//        pm2 start ecosystem.config.js
//        pm2 save
//        pm2 startup    # se non già configurato per systemd
// Per tornare a fork: instances:1 + exec_mode:'fork' e ripeti il cutover.
//
// PgBouncer è necessario in cluster mode: N istanze × pool Sequelize (20)
// saturerebbero max_connections Postgres (50). PgBouncer in transaction
// pooling multiplexa le connessioni applicative su ~25 connessioni reali.
//
// In cluster mode tutti gli scheduler (reminder, backup, verify, mail
// outbox, retention, excel export) girano SOLO sull'istanza 0 grazie
// al lock in `backend/lib/clusterRole.js`. Le altre istanze servono
// solo richieste HTTP.
//
// Health check via /api/health (liveness) e /api/ready (readiness DB).
//
// kill_timeout 5000ms = tempo per le connessioni in-flight di terminare
// graziosamente prima del SIGKILL. Coerente con il backend (che ha
// safeShutdown con drain di scheduler + httpServer.close).

module.exports = {
  apps: [
    {
      name: 'cadenza-backend',
      script: 'backend/server.js',
      cwd: __dirname,
      // Cluster mode su VPS 4 vCPU: 3 istanze HTTP in parallelo, 1 core
      // lasciato a Postgres + sistema. PgBouncer (transaction pooling)
      // multiplexa i pool Sequelize delle 3 istanze su ~25 conn reali.
      // Scheduler: 5 girano solo su NODE_APP_INSTANCE=0 (clusterRole.js),
      // mailOutbox gira ovunque ma è safe via FOR UPDATE SKIP LOCKED.
      instances: 3,
      exec_mode: 'cluster',
      autorestart: true,
      watch: false,
      // 512M × 3 = 1.5G di tetto worst-case: sicuro su 4GB lasciando spazio
      // a Postgres (shared_buffers ~1G tunato per 4GB). Uso normale ~250M/ist.
      max_memory_restart: '512M',
      env: {
        NODE_ENV: 'production',
      },
      // Graceful shutdown: PM2 invia SIGINT, il backend ha 5s per chiudere
      // scheduler + connessioni HTTP/DB prima del SIGKILL.
      kill_timeout: 5000,
      listen_timeout: 10000,
      // Log files: PM2 di default logga in ~/.pm2/logs/. Espliciti per
      // chiarezza in caso di setup multi-utente.
      out_file: './logs/pm2-out.log',
      error_file: './logs/pm2-error.log',
      merge_logs: true,
      time: true,
    },
  ],
};
