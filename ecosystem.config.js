// ecosystem.config.js — configurazione PM2 per Cadenza
//
// Attivo: fork mode (1 istanza) — stato known-good in produzione.
//
// Cluster mode (3 istanze) è PRONTO nel codice (scheduler gated su
// NODE_APP_INSTANCE=0 + mailOutbox FOR UPDATE SKIP LOCKED) ma BLOCCATO da un
// problema di credenziali in prod:
//   - il backend si autentica al DB come PGUSER=cadenza_user (var libpq
//     nell'ambiente), NON dal backend/.env (che non ha DB_USER/PASSWORD);
//   - la userlist di PgBouncer contiene solo `postgres` (setup-pgbouncer.sh
//     ha defaultato lì perché .env non espone DB_USER).
// Risultato: in cluster+PgBouncer l'app va su :6432 come cadenza_user →
// "no such user" → auth fail → crash loop. (In fork+diretto :5432 funziona
// perché cadenza_user è un ruolo reale di Postgres.)
//
// Per attivare cluster in sicurezza servono DUE cose:
//   1. aggiungere cadenza_user (con la sua password) alla userlist PgBouncer
//      → /etc/pgbouncer/pgbouncer_userlist, poi `systemctl reload pgbouncer`
//   2. riportare backend/.env a DB_PORT=6432 (così il pool passa da PgBouncer)
// poi: instances:3 + exec_mode:'cluster' e cutover:
//        pm2 delete cadenza-backend && pm2 start ecosystem.config.js && pm2 save
// Senza PgBouncer NON mettere 3 istanze su :5432 diretto: 3×pool 20 = 60 > 50
// max_connections.
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
      // In cluster usare 512M (3×512M=1.5G, sicuro su 4GB con Postgres).
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
