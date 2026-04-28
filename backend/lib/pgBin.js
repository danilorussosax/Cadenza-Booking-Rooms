'use strict';

/**
 * Risolve il path dei tool Postgres (pg_dump, psql, ...) su macOS/Linux.
 * Necessario perché lo spawn di Node usa il PATH del processo, e Node
 * avviato come servizio (launchd, systemd, npm start da GUI) può non
 * avere `/Library/PostgreSQL/18/bin/` nel PATH anche se il binario è
 * installato.
 *
 * Override esplicito: env `PG_DUMP_PATH` / `PSQL_PATH`. Auto-detect se non
 * impostato, controllando le installazioni standard.
 */
const fs = require('fs');

function makeResolver(envVar, binaryName) {
  return function resolve() {
    if (process.env[envVar] && fs.existsSync(process.env[envVar])) {
      return process.env[envVar];
    }
    const candidates = [
      `/usr/bin/${binaryName}`,
      `/usr/local/bin/${binaryName}`,
      `/opt/homebrew/bin/${binaryName}`,
      // EnterpriseDB / installer ufficiale macOS — versioni recenti
      `/Library/PostgreSQL/18/bin/${binaryName}`,
      `/Library/PostgreSQL/17/bin/${binaryName}`,
      `/Library/PostgreSQL/16/bin/${binaryName}`,
      `/Library/PostgreSQL/15/bin/${binaryName}`,
      // Postgres.app
      `/Applications/Postgres.app/Contents/Versions/latest/bin/${binaryName}`,
    ];
    for (const c of candidates) {
      if (fs.existsSync(c)) return c;
    }
    // Fallback: lascia spawn cercare in PATH (errore ENOENT esplicito poi)
    return binaryName;
  };
}

module.exports = {
  resolvePgDump: makeResolver('PG_DUMP_PATH', 'pg_dump'),
  resolvePsql: makeResolver('PSQL_PATH', 'psql'),
};
