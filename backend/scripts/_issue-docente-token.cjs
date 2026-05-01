'use strict';

/**
 * Emette un JWT per un docente (preferibilmente con override Monte Ore).
 * Usato da e2e/screenshots.mjs per catturare il banner /monte-ore.
 *
 * Uso:
 *   node _issue-docente-token.cjs <email-or-substring>
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
    console.error('Uso: node _issue-docente-token.cjs <email-or-substring>');
    process.exit(2);
  }
  await sequelize.authenticate();
  const user = await User.findOne({
    where: {
      role: 'docente',
      email: { [Op.iLike]: `%${arg}%` },
    },
    order: [['id', 'ASC']],
  });
  if (!user) {
    console.error(`Nessun docente trovato con email contenente "${arg}"`);
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
