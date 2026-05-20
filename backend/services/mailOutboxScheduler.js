'use strict';

/**
 * Worker per la coda di outbox email (mail_outbox).
 *
 * Tick ogni TICK_MS:
 *   1. Preleva fino a BATCH_SIZE righe `pending` con nextAttemptAt <= now,
 *      ordinate per priority ASC, nextAttemptAt ASC.
 *      Su Postgres usa SELECT ... FOR UPDATE SKIP LOCKED dentro una tx
 *      così istanze multiple non si pestano i piedi (multi-instance ready).
 *   2. Per ogni riga: render-free sendMail (subject/html sono già snapshot).
 *      Su success → status='sent', sentAt=now.
 *      Su error → attempts++, nextAttemptAt = now + backoff esponenziale.
 *      Su attempts >= maxAttempts → status='dead' (richiede admin).
 *
 * `transporter.verify()` viene chiamato al primo tick utile per dare un
 * feedback chiaro nel log se SMTP non è raggiungibile.
 *
 * No-op se SMTP non è configurato (la coda continuerà ad accumulare
 * righe pending: appena l'admin configura SMTP, partono).
 */

const { Op } = require('sequelize');
const { MailOutbox, User, sequelize } = require('../models');
const emailService = require('./emailService');
const { LeaderLease } = require('../lib/leaderElection');
const logger = require('../lib/logger').child({ scope: 'mailOutboxScheduler' });

const TICK_MS = 15 * 1000; // 15 secondi
const BATCH_SIZE = 20;
const MAX_BACKOFF_MS = 60 * 60 * 1000; // 1 ora

// Lease TTL: 3 × tick → se il worker leader non rinnova in 45s, un'altra
// istanza può prendere il relay (rilevazione down ≤ 45s, recovery a tick
// successivo dell'altra istanza). Niente split-brain: due istanze possono
// fare ognuna `tick` durante il finestra di transizione (15-30s al massimo),
// ma le query usano FOR UPDATE SKIP LOCKED quindi non duplicano gli invii.
const LEASE_TTL_MS = Math.max(45_000, TICK_MS * 3);
const lease = new LeaderLease({ name: 'mail-outbox', ttlMs: LEASE_TTL_MS });

// SMTP "hard bounce" code: il destinatario è permanentemente irraggiungibile.
// Su questi nodemailer ritorna un Error con `responseCode` numerico o con il
// codice nel messaggio. Distinguere da:
//   - 421 (service unavailable) → soft, retriable
//   - 450/451/452 (mailbox temporaneamente non disponibile / quota piena
//     temporanea) → soft, retriable
//   - 552 (storage exceeded) → spesso temporaneo (l'utente svuota la casella)
//     → trattato come soft per evitare falsi positivi
//   - 554 (transaction failed) → generico, troppo ambiguo per essere hard
const HARD_BOUNCE_CODES = new Set([550, 551, 553, 511, 521]);

/**
 * Estrae il codice SMTP da un errore di nodemailer.
 * nodemailer espone `responseCode` direttamente; alcuni provider mettono
 * il codice solo nel `response` testuale (es. "550 5.1.1 user not found").
 */
function extractSmtpCode(err) {
  if (!err) return null;
  if (typeof err.responseCode === 'number') return err.responseCode;
  const msg = String(err.response || err.message || '');
  const m = msg.match(/^\s*(\d{3})\b/);
  return m ? Number(m[1]) : null;
}

function isHardBounce(err) {
  const code = extractSmtpCode(err);
  return code !== null && HARD_BOUNCE_CODES.has(code);
}

let timer = null;
let running = false; // semaforo per evitare overlap se un tick dura > TICK_MS
let verified = false; // verify() già fatto nella vita di questo processo?
let lastTickAt = null;
let lastError = null;

function backoffMs(attempts) {
  // 2^attempts * 30s, capped a 1h. Esempio:
  //   attempts=1 → 60s
  //   attempts=2 → 2min
  //   attempts=3 → 4min
  //   attempts=4 → 8min
  //   attempts=5 → 16min
  const ms = Math.pow(2, attempts) * 30 * 1000;
  return Math.min(ms, MAX_BACKOFF_MS);
}

/**
 * Preleva un batch di righe da processare.
 *
 * Postgres: usa FOR UPDATE SKIP LOCKED per consentire multi-instance.
 * SQLite/altri: fa una SELECT senza lock → safe in single-instance test.
 */
async function claimBatch(transaction) {
  const dialect = sequelize.getDialect();
  if (dialect === 'postgres') {
    return MailOutbox.findAll({
      where: {
        status: 'pending',
        nextAttemptAt: { [Op.lte]: new Date() },
      },
      order: [
        ['priority', 'ASC'],
        ['nextAttemptAt', 'ASC'],
      ],
      limit: BATCH_SIZE,
      lock: transaction.LOCK.UPDATE,
      skipLocked: true,
      transaction,
    });
  }
  return MailOutbox.findAll({
    where: {
      status: 'pending',
      nextAttemptAt: { [Op.lte]: new Date() },
    },
    order: [
      ['priority', 'ASC'],
      ['nextAttemptAt', 'ASC'],
    ],
    limit: BATCH_SIZE,
    transaction,
  });
}

async function processOne(row, cfg) {
  try {
    await cfg.transporter.sendMail({
      from: cfg.from,
      to: row.to,
      replyTo: row.replyTo || cfg.replyTo,
      subject: row.subject,
      html: row.bodyHtml,
    });
    await row.update({
      status: 'sent',
      sentAt: new Date(),
      lastError: null,
    });
    return { ok: true };
  } catch (err) {
    const lastError = err?.message ? err.message.slice(0, 1000) : String(err).slice(0, 1000);

    // Hard-bounce SMTP (550/551/553/511/521): destinatario permanentemente
    // irraggiungibile. Niente retry: dead immediato + segna l'utente come
    // bounced così future enqueueMail vengono saltate dal gate.
    if (isHardBounce(err)) {
      const code = extractSmtpCode(err);
      await row.update({
        status: 'dead',
        attempts: row.attempts + 1,
        lastError: `[SMTP ${code}] ${lastError}`,
      });
      try {
        const reason = `SMTP ${code}: ${lastError.slice(0, 400)}`;
        await User.update(
          { emailBouncedAt: new Date(), emailBouncedReason: reason },
          { where: { email: row.to, emailBouncedAt: null } },
        );
      } catch (uErr) {
        logger.warn(
          { err: uErr.message, to: row.to, scope: 'mailOutbox.bounce' },
          'failed to mark User as bounced',
        );
      }
      logger.warn(
        { to: row.to, code, scope: 'mailOutbox.bounce' },
        'hard bounce — marked dead and user bounced',
      );
      return { ok: false, dead: true, bounced: true, error: lastError };
    }

    const attempts = row.attempts + 1;
    const reachedMax = attempts >= row.maxAttempts;
    await row.update({
      attempts,
      status: reachedMax ? 'dead' : 'pending',
      nextAttemptAt: reachedMax ? row.nextAttemptAt : new Date(Date.now() + backoffMs(attempts)),
      lastError,
    });
    return { ok: false, dead: reachedMax, error: lastError };
  }
}

async function tick() {
  if (running) return;
  running = true;
  try {
    const cfg = await emailService.loadConfig();
    if (!cfg?.transporter) return; // SMTP non configurato

    if (!verified) {
      try {
        await cfg.transporter.verify();
        verified = true;
        logger.info({ scope: 'mailOutbox.verify' }, 'SMTP transporter verified');
      } catch (err) {
        // Verify fallita: lo segnaliamo ma proseguiamo (l'invio reale potrebbe
        // funzionare comunque per provider che non supportano EHLO probe).
        logger.warn(
          { err: err.message, scope: 'mailOutbox.verify' },
          'SMTP transporter verify failed (proceeding anyway)',
        );
        verified = true; // non riprovare a ogni tick
      }
    }

    // Una transazione "claim", poi processiamo fuori transazione perché
    // sendMail può durare secondi e non vogliamo tenere il lock DB aperto.
    let batch = [];
    await sequelize.transaction(async (t) => {
      batch = await claimBatch(t);
      if (batch.length === 0) return;
      // Marcatore "in elaborazione": spostiamo nextAttemptAt nel futuro
      // così se questo processo crasha mid-send la riga sarà ripresa
      // da un altro tick (o da questo) tra 5 minuti.
      const ids = batch.map((r) => r.id);
      await MailOutbox.update(
        { nextAttemptAt: new Date(Date.now() + 5 * 60 * 1000) },
        { where: { id: ids }, transaction: t },
      );
    });

    if (batch.length === 0) return;

    let okCount = 0;
    let failCount = 0;
    let deadCount = 0;
    for (const row of batch) {
      // Refresh dalla DB per avere attempts aggiornati nel caso il lock
      // multi-instance avesse permesso un piccolo race window.
      const fresh = await MailOutbox.findByPk(row.id);
      if (!fresh || fresh.status !== 'pending') continue;
      const r = await processOne(fresh, cfg);
      if (r.ok) okCount += 1;
      else if (r.dead) deadCount += 1;
      else failCount += 1;
    }

    if (okCount + failCount + deadCount > 0) {
      logger.info(
        { ok: okCount, retry: failCount, dead: deadCount, scope: 'mailOutbox.tick' },
        'mail outbox tick processed',
      );
    }
    lastError = null;
  } catch (err) {
    lastError = err?.message ? String(err.message).slice(0, 500) : String(err).slice(0, 500);
    logger.error({ err: err.message, scope: 'mailOutbox.tick' }, 'mail outbox tick failed');
  } finally {
    lastTickAt = new Date();
    running = false;
  }
}

function getStatus() {
  return {
    name: 'mailOutbox',
    enabled: timer != null,
    running,
    intervalMs: TICK_MS,
    lastTickAt,
    lastError,
    nextTickAt: timer ? new Date(Date.now() + TICK_MS) : null,
  };
}

// Leader-aware tick wrapper: prima di eseguire il vero tick, rinnova o
// acquisisce il lease. Se non siamo leader, skip (un'altra istanza sta
// lavorando). Se l'attuale leader cade, dopo LEASE_TTL_MS qualsiasi
// istanza al prossimo wake può rilevare il lease scaduto e prendere il
// relay → mail outbox riparte automaticamente senza intervento manuale.
async function leaderAwareTick() {
  let acquired;
  if (lease.isLeader()) {
    acquired = await lease.renew();
    if (!acquired) acquired = await lease.acquire();
  } else {
    acquired = await lease.acquire();
  }
  if (!acquired) return; // un'altra istanza è leader
  await tick();
}

function start() {
  if (timer) return;
  // primo tick a 5s dal boot (lascia tempo al sync DB e al primo claim
  // del lease). In cluster mode tutte le istanze entrano qui: solo quella
  // che vince il lease esegue il tick vero (vedi leaderAwareTick).
  setTimeout(leaderAwareTick, 5_000);
  timer = setInterval(leaderAwareTick, TICK_MS);
  logger.info(
    `[mail-outbox] worker avviato (tick ogni ${TICK_MS / 1000}s, batch ${BATCH_SIZE}, lease ${LEASE_TTL_MS / 1000}s)`,
  );
}

function stop() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  // Reset verify per il prossimo start (utile nei test)
  verified = false;
  // Best-effort release del lease (no await: stop() è sync). Se la release
  // fallisce, il lease scade naturalmente entro LEASE_TTL_MS.
  lease.release('stop').catch(() => {});
}

module.exports = {
  start,
  stop,
  getStatus,
  // Esposti per test integration: chiamare il tick deterministicamente
  // invece di aspettare il setInterval.
  tick,
  backoffMs,
};
