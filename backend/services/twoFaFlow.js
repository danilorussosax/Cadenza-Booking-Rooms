'use strict';

/**
 * Flusso 2FA lato emissione: challenge + persistenza + mail del codice, e
 * risoluzione del tempToken (pre-2FA JWT). Le route restano adapter HTTP.
 *
 * Interfaccia:
 *   - issueAndSend(user, purpose, { mailer }) → { ok:true, sentTo, expiresInMinutes }
 *                                              | { ok:false, code:'TWO_FA_SEND_FAILED', error }
 *   - parseTempToken(token)                    → payload JWT | throw TWO_FA_BAD_TEMP_TOKEN (401)
 *   - resolveResendUser(token)                 → User | throw TWO_FA_BAD_TEMP_TOKEN / TWO_FA_INVALID_STATE
 *
 * `mailer` è iniettabile (default: emailService.sendSecurityEmail, risolto a
 * ogni chiamata) con firma ({to, subject, html}) → { ok, error? }.
 *
 * Due controlli «utente attivo» volutamente DISTINTI (differenza osservabile
 * via HTTP, non unificare):
 *   - resend (resolveResendUser): utente assente/inattivo/tokenVersion diversa/
 *     senza 2FA → 400 TWO_FA_INVALID_STATE «Stato 2FA inconsistente».
 *   - verify (authSecurity.verifyLogin, che parte da parseTempToken): passa da
 *     mutateUser → 401 TOKEN_REVOKED per assente/inattivo/tokenVersion errata,
 *     e 400 TWO_FA_INVALID_STATE solo per twoFaEnabled=false.
 *
 * Nota (comportamento storico preservato): la challenge viene PERSISTITA prima
 * dell'invio; se la mail fallisce non c'è rollback (il codice resta in DB ma
 * l'utente non lo riceve; un nuovo invio lo sovrascrive).
 */

const { getConfig } = require('../lib/config');
const { domainError } = require('../lib/domainError');
const { User } = require('../models');
const emailService = require('./emailService');
const authSecurity = require('./authSecurity');
const twoFa = require('./twoFa');

const SEND_FAILED = 'TWO_FA_SEND_FAILED';

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildCodeEmail({ issuer, firstName, purpose, code, expires }) {
  const subject = `${issuer} · Codice di accesso`;
  const html = `<!doctype html><html><body style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Inter,sans-serif;background:#f7f9fc;margin:0;padding:24px;">
    <div style="max-width:480px;margin:0 auto;background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:28px;">
      <h1 style="font-size:18px;color:#3762aa;margin:0 0 12px;">Codice di verifica · ${issuer}</h1>
      <p style="color:#1a2234;font-size:14px;margin:0 0 16px;">Ciao ${escapeHtml(firstName || '')},</p>
      <p style="color:#1a2234;font-size:14px;margin:0 0 16px;">Inserisci questo codice per ${
        purpose === 'enroll' ? 'attivare la verifica in due passaggi' : "completare l'accesso"
      }. Il codice scade tra <b>${expires} minuti</b> e può essere usato una sola volta.</p>
      <div style="margin:20px 0;text-align:center;">
        <span style="display:inline-block;font-family:'SF Mono',Menlo,Consolas,monospace;font-size:34px;letter-spacing:10px;font-weight:700;color:#1a2234;background:#f1f5f9;border:1px solid #e2e8f0;border-radius:10px;padding:14px 22px;">${code}</span>
      </div>
      <p style="color:#6b7a90;font-size:12px;margin:0 0 8px;">Se non hai richiesto tu questo codice, ignora questa email — qualcuno potrebbe aver provato ad accedere al tuo account. Considera anche di cambiare la password.</p>
      <p style="color:#9aa5b4;font-size:11px;margin-top:24px;text-transform:uppercase;letter-spacing:0.06em;text-align:center;">${issuer} · email automatica</p>
    </div>
  </body></html>`;
  return { subject, html };
}

/**
 * Genera la challenge, la persiste (mutateUser: TOKEN_REVOKED se l'utente è
 * inattivo/tokenVersion cambiata) e invia il codice. Mai throw per mail/persist
 * falliti: esito tipizzato. `error` è il messaggio sottostante (non esposto
 * dalle route, che usano testi propri per endpoint).
 */
async function issueAndSend(user, purpose, { mailer } = {}) {
  const send = mailer ?? ((msg) => emailService.sendSecurityEmail(msg));
  const issuer = getConfig().TWO_FA_ISSUER;
  const { code, record } = await twoFa.createChallenge(purpose);
  const saved = await authSecurity.mutateUser(
    user.id,
    user.tokenVersion,
    async (fresh, transaction) => {
      await fresh.update({ twoFaChallenge: record }, { transaction });
      return { status: 200 };
    },
  );
  if (saved.status !== 200) return { ok: false, code: SEND_FAILED, error: saved.body.error };
  const expires = twoFa.TWO_FA_TTL_MIN;
  const { subject, html } = buildCodeEmail({
    issuer,
    firstName: user.firstName,
    purpose,
    code,
    expires,
  });
  const result = await send({ to: user.email, subject, html });
  if (!result.ok) return { ok: false, code: SEND_FAILED, error: result.error };
  return { ok: true, sentTo: twoFa.maskEmail(user.email), expiresInMinutes: expires };
}

/** Verifica il pre-2FA token; QUALSIASI errore → 401 TWO_FA_BAD_TEMP_TOKEN. */
function parseTempToken(token) {
  try {
    return twoFa.verifyPre2faToken(token);
  } catch {
    throw domainError('TWO_FA_BAD_TEMP_TOKEN', 'Token temporaneo non valido o scaduto', {
      status: 401,
    });
  }
}

/** Resend (login step 2): token valido + utente attivo, tokenVersion coerente, 2FA attivo. */
async function resolveResendUser(token) {
  const payload = parseTempToken(token);
  const user = await User.findByPk(payload.id);
  if (!user || !user.isActive || user.tokenVersion !== payload.tokenVersion || !user.twoFaEnabled) {
    throw domainError('TWO_FA_INVALID_STATE', 'Stato 2FA inconsistente');
  }
  return user;
}

module.exports = { issueAndSend, parseTempToken, resolveResendUser, SEND_FAILED };
