// ecosystem.config.js — configurazione PM2 per Cadenza
//
// Attivo: cluster mode, 3 istanze (VPS 4 vCPU). Sfrutta i core finora
// inutilizzati dal fork singolo.
//
// PgBouncer è necessario in cluster: 3 istanze × pool Sequelize (20) = 60
// connessioni applicative saturerebbero max_connections Postgres (50).
// In transaction pooling PgBouncer le multiplexa su ~25 conn reali.
// Prerequisito (fatto): la userlist PgBouncer include cadenza_user, il
// ruolo con cui il backend si autentica (default_pool_size=25).
//
// DB_PORT/DB_PGBOUNCER sono forzati QUI nell'env PM2 (non solo in
// backend/.env): l'env di PM2 precede dotenv, così le 3 istanze passano da
// PgBouncer in modo deterministico anche se .env o l'ambiente shell divergono.
// ⚠ Tornando a fork+diretto :5432, rimuovere DB_PORT/DB_PGBOUNCER da qui.
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
      instances: 3,
      exec_mode: 'cluster',
      autorestart: true,
      watch: false,
      // 3×512M=1.5G di tetto worst-case: sicuro su 4GB lasciando spazio a
      // Postgres (shared_buffers ~1G). Uso normale ~180M/istanza.
      max_memory_restart: '512M',
      env: {
        NODE_ENV: 'production',
        // Forza il pool attraverso PgBouncer (vedi nota in testa al file).
        DB_PORT: '6432',
        DB_PGBOUNCER: 'true',
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
