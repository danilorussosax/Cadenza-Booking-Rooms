'use strict';

/**
 * Unit: services/twoFaFlow — emissione/invio codice 2FA con mailer iniettato e
 * risoluzione del tempToken. Nessun HTTP: solo modulo + DB in-memory.
 */

const jwt = require('jsonwebtoken');
const { User } = require('../../models');
const { createUser } = require('../factories');
const twoFa = require('../../services/twoFa');
const authSecurity = require('../../services/authSecurity');
const twoFaFlow = require('../../services/twoFaFlow');

const reload = (id) => User.findByPk(id);
const okMailer = () => vi.fn().mockResolvedValue({ ok: true });

describe('twoFaFlow.issueAndSend', () => {
  beforeEach(async () => {
    await globalThis.resetDatabase();
  });

  it('invio riuscito: persiste la challenge, manda la mail col codice, esito tipizzato', async () => {
    const u = await createUser({ twoFaEnabled: true, firstName: '<b>Ann</b>' });
    const mailer = okMailer();
    const r = await twoFaFlow.issueAndSend(u, 'login', { mailer });
    expect(r).toEqual({
      ok: true,
      sentTo: twoFa.maskEmail(u.email),
      expiresInMinutes: twoFa.TWO_FA_TTL_MIN,
    });
    expect(mailer).toHaveBeenCalledTimes(1);
    const msg = mailer.mock.calls[0][0];
    expect(msg.to).toBe(u.email);
    expect(msg.html).toContain("completare l'accesso");
    expect(msg.html).toContain('&lt;b&gt;Ann&lt;/b&gt;');
    expect((await reload(u.id)).twoFaChallenge).toBeTruthy();
  });

  it('purpose enroll: testo di attivazione', async () => {
    const u = await createUser();
    const mailer = okMailer();
    await twoFaFlow.issueAndSend(u, 'enroll', { mailer });
    expect(mailer.mock.calls[0][0].html).toContain('attivare la verifica in due passaggi');
  });

  it('mailer che fallisce: ok:false con code, challenge GIA persistita (nessun rollback)', async () => {
    const u = await createUser({ twoFaEnabled: true });
    const mailer = vi.fn().mockResolvedValue({ ok: false, error: 'SMTP down' });
    const r = await twoFaFlow.issueAndSend(u, 'login', { mailer });
    expect(r).toEqual({ ok: false, code: 'TWO_FA_SEND_FAILED', error: 'SMTP down' });
    // Comportamento storico: la scrittura precede l'invio e non viene annullata.
    expect((await reload(u.id)).twoFaChallenge).toBeTruthy();
  });

  it('utente inattivo/tokenVersion errata: ok:false e la mail NON parte', async () => {
    const u = await createUser({ twoFaEnabled: true });
    const mailer = okMailer();
    await User.update({ tokenVersion: u.tokenVersion + 1 }, { where: { id: u.id } });
    const r = await twoFaFlow.issueAndSend(u, 'login', { mailer });
    expect(r.ok).toBe(false);
    expect(r.code).toBe('TWO_FA_SEND_FAILED');
    expect(mailer).not.toHaveBeenCalled();
    expect((await reload(u.id)).twoFaChallenge).toBeNull();
  });
});

describe('twoFaFlow — tempToken', () => {
  beforeEach(async () => {
    await globalThis.resetDatabase();
  });

  const expectCode = async (promiseOrFn, code, status) => {
    let err;
    try {
      await (typeof promiseOrFn === 'function' ? promiseOrFn() : promiseOrFn);
    } catch (e) {
      err = e;
    }
    expect(err?.code).toBe(code);
    if (status) expect(err.status).toBe(status);
  };

  it('parseTempToken: valido → payload', async () => {
    const u = await createUser({ twoFaEnabled: true });
    const p = twoFaFlow.parseTempToken(twoFa.signPre2faToken(u.id, u.tokenVersion));
    expect(p.id).toBe(u.id);
  });

  it('parseTempToken: invalido, scaduto, token non pre2fa → 401 TWO_FA_BAD_TEMP_TOKEN', async () => {
    const secret = process.env.JWT_SECRET;
    const expired = jwt.sign({ id: 1, tokenVersion: 0, tfa: 'pre' }, secret, { expiresIn: -10 });
    const notPre = jwt.sign({ id: 1, tokenVersion: 0 }, secret);
    for (const t of ['garbage', expired, notPre]) {
      await expectCode(() => twoFaFlow.parseTempToken(t), 'TWO_FA_BAD_TEMP_TOKEN', 401);
    }
  });

  it('resolveResendUser: utente valido', async () => {
    const u = await createUser({ twoFaEnabled: true });
    const r = await twoFaFlow.resolveResendUser(twoFa.signPre2faToken(u.id, u.tokenVersion));
    expect(r.id).toBe(u.id);
  });

  it('resolveResendUser: token invalido → TWO_FA_BAD_TEMP_TOKEN', async () => {
    await expectCode(twoFaFlow.resolveResendUser('nope'), 'TWO_FA_BAD_TEMP_TOKEN', 401);
  });

  it('resolveResendUser: inattivo / tokenVersion errata / 2FA off / assente → TWO_FA_INVALID_STATE 400', async () => {
    const inactive = await createUser({ twoFaEnabled: true, isActive: false });
    const stale = await createUser({ twoFaEnabled: true });
    const off = await createUser({ twoFaEnabled: false });
    for (const [id, tv] of [
      [inactive.id, inactive.tokenVersion],
      [stale.id, stale.tokenVersion + 1],
      [off.id, off.tokenVersion],
      [999999, 0],
    ]) {
      await expectCode(
        twoFaFlow.resolveResendUser(twoFa.signPre2faToken(id, tv)),
        'TWO_FA_INVALID_STATE',
        400,
      );
    }
  });

  it('differenza documentata: verifyLogin con utente inattivo → TOKEN_REVOKED 401 (non INVALID_STATE)', async () => {
    const inactive = await createUser({ twoFaEnabled: true, isActive: false });
    const payload = twoFaFlow.parseTempToken(
      twoFa.signPre2faToken(inactive.id, inactive.tokenVersion),
    );
    const r = await authSecurity.verifyLogin(payload, { code: '000000' });
    expect(r.status).toBe(401);
    expect(r.body.code).toBe('TOKEN_REVOKED');
  });
});
