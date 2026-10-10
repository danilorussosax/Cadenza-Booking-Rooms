'use strict';

const { Transaction } = require('sequelize');
const { sequelize, User, PasswordResetToken } = require('../models');
const { withSerializableRetry } = require('../lib/serializableTx');
const twoFa = require('./twoFa');
const { signToken } = require('../middleware/auth');

const error = (status, code, message) => ({ status, body: { error: message, code } });
const transact = (work) =>
  withSerializableRetry(
    sequelize,
    sequelize.getDialect() === 'postgres'
      ? { isolationLevel: Transaction.ISOLATION_LEVELS.SERIALIZABLE }
      : {},
    work,
  );

async function mutateUser(id, version, work) {
  return transact(async (transaction) => {
    const user = await User.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE });
    if (!user || !user.isActive || user.tokenVersion !== version)
      return error(401, 'TOKEN_REVOKED', 'Sessione invalidata, effettua nuovamente il login');
    return work(user, transaction);
  });
}

// Return failures instead of throwing: failed OTP attempts must COMMIT.
async function verifyFactor(user, payload, transaction) {
  let result = { ok: false, reason: 'BAD_CODE' };
  if (payload.code) {
    result = await twoFa.consumeChallenge(user.twoFaChallenge, payload.code);
    user.twoFaChallenge = result.updated;
  }
  if (!result.ok && payload.recoveryCode && Array.isArray(user.twoFaRecoveryCodes)) {
    const index = await twoFa.findRecoveryMatch(payload.recoveryCode, user.twoFaRecoveryCodes);
    if (index >= 0) {
      const codes = [...user.twoFaRecoveryCodes];
      codes.splice(index, 1);
      user.twoFaRecoveryCodes = codes;
      user.twoFaChallenge = null;
      result = { ok: true };
    }
  }
  await user.save({ transaction });
  if (result.ok) return null;
  if (result.reason === 'TOO_MANY_ATTEMPTS')
    return error(429, 'TWO_FA_TOO_MANY_ATTEMPTS', 'Troppi tentativi. Richiedi un nuovo codice.');
  return error(
    401,
    result.reason === 'EXPIRED' ? 'TWO_FA_EXPIRED' : 'TWO_FA_INVALID_CODE',
    result.reason === 'EXPIRED' ? 'Codice scaduto' : 'Codice non valido',
  );
}

async function verifyLogin(payload, factor) {
  return mutateUser(payload.id, payload.tokenVersion, async (user, transaction) => {
    if (!user.twoFaEnabled) return error(400, 'TWO_FA_INVALID_STATE', 'Stato 2FA inconsistente');
    const failure = await verifyFactor(user, factor, transaction);
    if (failure) return failure;
    user.lastLogin = new Date();
    await user.save({ transaction });
    return { status: 200, body: { token: signToken(user), user: user.toSafeJSON() } };
  });
}

async function manageFactor(identity, action, factor) {
  return mutateUser(identity.id, identity.tokenVersion, async (user, transaction) => {
    if (action !== 'enroll' && !user.twoFaEnabled)
      return error(400, 'TWO_FA_NOT_ENABLED', '2FA non attivo');
    if (action === 'enroll' && user.twoFaEnabled)
      return error(409, 'TWO_FA_INVALID_STATE', '2FA già attivo');
    if (action === 'enroll' && !user.twoFaChallenge)
      return error(400, 'TWO_FA_NOT_SETUP', 'Nessun codice in attesa: richiedi un nuovo invio.');
    const failure = await verifyFactor(
      user,
      action === 'disable' ? factor : { code: factor.code },
      transaction,
    );
    if (failure) return failure;
    if (action === 'disable') {
      await user.update(
        { twoFaEnabled: false, twoFaChallenge: null, twoFaRecoveryCodes: null },
        { transaction },
      );
      return { status: 200, body: { enabled: false } };
    }
    const codes = twoFa.generateRecoveryCodes();
    user.twoFaRecoveryCodes = await twoFa.hashRecoveryCodes(codes);
    user.twoFaChallenge = null;
    if (action === 'enroll') {
      user.twoFaEnabled = true;
      user.twoFaActivatedAt ||= new Date();
    }
    await user.save({ transaction });
    return { status: 200, body: { enabled: true, recoveryCodes: codes } };
  });
}

async function resetPassword(tokenHash, password) {
  return transact(async (transaction) => {
    const row = await PasswordResetToken.findOne({
      where: { tokenHash },
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (!row || row.usedAt || row.expiresAt < new Date())
      return error(400, 'RESET_TOKEN_INVALID', 'Token non valido, già utilizzato o scaduto');
    const user = await User.findByPk(row.userId, { transaction, lock: transaction.LOCK.UPDATE });
    if (!user || !user.isActive) return error(400, 'RESET_TOKEN_INVALID', 'Utente non disponibile');
    await user.update(
      {
        passwordHash: password,
        tokenVersion: user.tokenVersion + 1,
        twoFaChallenge: null,
        failedLoginAttempts: 0,
        lockedUntil: null,
      },
      { transaction },
    );
    await row.update({ usedAt: new Date() }, { transaction });
    return { status: 200, body: { ok: true } };
  });
}

module.exports = { mutateUser, verifyLogin, manageFactor, resetPassword };
