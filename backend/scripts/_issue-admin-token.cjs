'use strict';

/**
 * Emette un token JWT admin valido senza passare da login + 2FA.
 * Usato dallo script Playwright `screenshots.mjs` quando l'admin è già
 * presente in DB (script "interno" — non esposto a runtime via API).
 *
 * Uso:
 *   node issue-admin-token.cjs <email>
 *
 * Cerca un utente con `email LIKE '%<email>%' AND role='admin'` (case-insensitive)
 * e ne stampa un JWT firmato con il JWT_SECRET corrente.
 */

const path = require('path');
const { Op } = require('sequelize');

const BACKEND = path.resolve(__dirname, '..');
require('dotenv').config({ path: path.join(BACKEND, '.env') });

const { sequelize, User } = require(path.join(BACKEND, 'models'));
const { signToken } = require(path.join(BACKEND, 'middleware', 'auth'));

(async () => {
  const arg = process.argv[2];
  if (!arg) {
    console.error('Uso: node issue-admin-token.cjs <email-or-substring>');
    process.exit(2);
  }
  await sequelize.authenticate();
  const user = await User.findOne({
    where: {
      role: 'admin',
      email: { [Op.iLike]: `%${arg}%` },
    },
    order: [['id', 'ASC']],
  });
  if (!user) {
    console.error(`Nessun admin trovato con email contenente "${arg}"`);
    process.exit(3);
  }
  const token = signToken(user);
  process.stdout.write(
    JSON.stringify({
      token,
      user: { id: user.id, email: user.email, role: user.role },
    }),
  );
  await sequelize.close();
})().catch((err) => {
  console.error(err.stack || err.message);
  process.exit(1);
});
