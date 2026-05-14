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
// Default a SQLite in-memory, ma lascia che l'env esterna (es. lo stress
// test su Postgres) possa forzare un altro dialect. Usiamo `||=` solo
// alla forma esplicita perché alcune env potrebbero arrivare come '' vuoto.
if (!process.env.DB_DIALECT) process.env.DB_DIALECT = 'sqlite';
// :memory: → DB transitorio per processo. Pool max=1 (SQLite default in
// database.js): tutte le query usano la stessa connessione, quindi vedono
// lo stesso storage in-memory. Anche qui rispettiamo eventuali override.
if (!process.env.DB_STORAGE) process.env.DB_STORAGE = ':memory:';
if (!process.env.DB_LOGGING) process.env.DB_LOGGING = 'false';
if (!process.env.DB_SEED) process.env.DB_SEED = 'false';
if (!process.env.DB_SYNC_MODE) process.env.DB_SYNC_MODE = 'force';
// Bcrypt più rapido in test (i hook beforeCreate/beforeUpdate di User
// rispettano la env). 4 è il minimo accettato dalla lib.
process.env.BCRYPT_COST = '4';
// Secret deterministico per JWT
process.env.JWT_SECRET = 'test-jwt-secret';
// Disabilita SMTP nei test
process.env.SMTP_HOST = '';
process.env.SMTP_USER = '';

module.exports = require('./database');
