'use strict';

/**
 * Configurazione DB per i test integrazione.
 *
 * Imposta le env var prima che `./database.js` venga richiesto, in modo da
 * forzare un SQLite in-memory isolato e silenziare tutti i log SQL.
 *
 * Usato da `tests/setup.js` (vitest setupFiles) — non importarlo direttamente
 * dai singoli test.
 */

process.env.NODE_ENV = 'test';
process.env.DB_DIALECT = 'sqlite';
// :memory: → DB transitorio per processo. Pool max=1 (SQLite default in
// database.js): tutte le query usano la stessa connessione, quindi vedono
// lo stesso storage in-memory.
process.env.DB_STORAGE = ':memory:';
process.env.DB_LOGGING = 'false';
process.env.DB_SEED = 'false';
process.env.DB_SYNC_MODE = 'force';
// Bcrypt più rapido in test (i hook beforeCreate/beforeUpdate di User
// rispettano la env). 4 è il minimo accettato dalla lib.
process.env.BCRYPT_COST = '4';
// Secret deterministici per JWT/sessione
process.env.JWT_SECRET = 'test-jwt-secret';
process.env.SESSION_SECRET = 'test-session-secret';
// Disabilita SMTP nei test
process.env.SMTP_HOST = '';
process.env.SMTP_USER = '';

module.exports = require('./database');
