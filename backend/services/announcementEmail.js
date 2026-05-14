'use strict';

/**
 * Invio email broadcast su pubblicazione di un Announcement.
 *
 * Convenzioni:
 *   - Solo se SMTP configurato (vedi emailService.emailEnabled).
 *   - Solo agli utenti che matchano l'audience (vedi audienceMatcher).
 *   - Solo agli utenti con `notifyOnAnnouncements=true` ed `emailNotifications=true`.
 *   - Solo se `announcement.emailSentAt` è null (idempotente — un re-publish
 *     senza pulizia del flag NON rinotifica).
 *
 * NB: il body markdown viene mantenuto come testo nel rendering email.
 * Markdown non viene convertito in HTML: l'utente vede `**bold**` letterale.
 * Trade-off accettato per evitare deps ulteriori (markdown-it ecc.) e
 * mantenere dimensione bundle.
 */

const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');
dayjs.extend(utc);
dayjs.extend(timezone);

// L'email mostra date/orari all'utente: ora italiana indipendentemente
// dal TZ del processo (container/UTC). Allinea pattern di emailService.
const DEFAULT_TZ = 'Europe/Rome';
const { Op } = require('sequelize');
const { User, Announcement, Institute } = require('../models');
const { audienceMatchesUserWhere } = require('./audienceMatcher');

// Lazy import per evitare dipendenze cicliche (emailService → models → ...)
let emailService = null;
function getEmailService() {
  if (!emailService) emailService = require('./emailService');
  return emailService;
}

async function sendAnnouncementBroadcast(announcementId) {
  const ann = await Announcement.findByPk(announcementId);
  if (!ann) return { sent: 0, skipped: 'not_found' };
  if (!ann.isActive) return { sent: 0, skipped: 'inactive' };
  if (ann.emailSentAt) return { sent: 0, skipped: 'already_sent' };
  if (ann.publishedAt && ann.publishedAt > new Date()) return { sent: 0, skipped: 'future_dated' };

  const svc = getEmailService();
  if (!(await svc.emailEnabled())) return { sent: 0, skipped: 'smtp_off' };

  // Trova destinatari secondo l'audience.
  const where = audienceMatchesUserWhere(ann.audience);
  if (where === null) return { sent: 0, skipped: 'no_audience_match' };

  const recipients = await User.findAll({
    where: {
      ...where,
      isActive: true,
      status: 'approved',
      emailNotifications: { [Op.ne]: false },
      notifyOnAnnouncements: { [Op.ne]: false },
      email: { [Op.ne]: null },
    },
    attributes: ['id', 'email', 'firstName', 'lastName'],
  });

  if (recipients.length === 0) {
    await ann.update({ emailSentAt: new Date() });
    return { sent: 0, skipped: 'no_recipients' };
  }

  const tpl = await svc.getTemplate('announcement_published');
  if (!tpl) {
    await ann.update({ emailSentAt: new Date() });
    return { sent: 0, skipped: 'template_missing' };
  }

  // Bulk enqueue nell'outbox: il worker rispetta il pool SMTP e processa
  // con priority=9 (più bassa di transactional). Idempotency key per
  // (announcement, user) evita doppi invii in caso di re-publish.
  let queued = 0;
  for (const user of recipients) {
    const ctx = await buildAnnouncementContext({ user, announcement: ann });
    const r = await svc.enqueueMail({
      kind: 'announcement',
      to: user.email,
      subject: svc.renderText(tpl.subject, ctx),
      html: svc.render(tpl.bodyHtml, ctx),
      priority: 9,
      idempotencyKey: `announcement:${ann.id}:user:${user.id}`,
    });
    if (r.queued) queued += 1;
  }

  await ann.update({ emailSentAt: new Date() });
  return { sent: queued, recipients: recipients.length };
}

async function buildAnnouncementContext({ user, announcement }) {
  const inst = await Institute.findOne({
    attributes: ['name', 'copyright'],
    order: [['id', 'ASC']],
  }).catch(() => null);

  return {
    user: {
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
    },
    announcement: {
      title: announcement.title,
      body: announcement.body,
      publishedAtLong: dayjs(announcement.publishedAt).tz(DEFAULT_TZ).format('dddd D MMMM YYYY'),
      expiresAtLong: announcement.expiresAt
        ? dayjs(announcement.expiresAt).tz(DEFAULT_TZ).format('dddd D MMMM YYYY')
        : '',
    },
    institute: {
      name: inst?.name || 'Cadenza',
      copyright:
        inst?.copyright || 'Cadenza · Per disattivare le notifiche avvisi vai sul tuo profilo.',
    },
    now: { dateTime: dayjs().tz(DEFAULT_TZ).format('DD MMM YYYY · HH:mm') },
  };
}

module.exports = { sendAnnouncementBroadcast };
