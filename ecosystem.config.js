// ecosystem.config.js — configurazione PM2 per Cadenza
//
// Default: fork mode (1 istanza), compatibile col deploy esistente.
// Per attivare cluster mode (parallelismo HTTP + zero-downtime reload):
//
//   1. Installa PgBouncer: sudo bash scripts/setup-pgbouncer.sh
//   2. Cambia `instances: 1` → `instances: 'max'` (o un numero, es. 2)
//   3. Cambia `exec_mode: 'fork'` → `exec_mode: 'cluster'`
//   4. Sul VPS:
//        pm2 delete cadenza-backend
//        pm2 start ecosystem.config.js
//        pm2 save
//        pm2 startup    # se non già configurato per systemd
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
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
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
