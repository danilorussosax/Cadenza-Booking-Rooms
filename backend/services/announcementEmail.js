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

  // Invio sequenziale per non saturare il rate-limit del provider SMTP.
  // Per >1000 destinatari converrebbe una coda (BullMQ); per ora ok.
  let sent = 0;
  for (const user of recipients) {
    try {
      await sendOne({ user, announcement: ann });
      sent += 1;
    } catch (err) {
      console.error(`[announcement] errore invio a ${user.email}:`, err.message);
    }
  }

  await ann.update({ emailSentAt: new Date() });
  return { sent, recipients: recipients.length };
}

async function sendOne({ user, announcement }) {
  const svc = getEmailService();
  // Riusiamo il transporter + render template di emailService passando un
  // "fake booking" — però il kind 'announcement_published' ha un context
  // diverso. Il template di mailTemplateDefaults usa {{announcement.*}}.
  // Dobbiamo passare un context custom: implementato sotto bypassando
  // sendBookingEmail.
  const cfg = await svc.loadConfig();
  if (!cfg?.transporter) return;

  const tpl = await svc.getTemplate('announcement_published');
  if (!tpl) return;

  const ctx = await buildAnnouncementContext({ user, announcement });
  await cfg.transporter.sendMail({
    from: cfg.from,
    to: user.email,
    replyTo: cfg.replyTo,
    subject: svc.renderText(tpl.subject, ctx),
    html: svc.render(tpl.bodyHtml, ctx),
  });
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
      publishedAtLong: dayjs(announcement.publishedAt).format('dddd D MMMM YYYY'),
      expiresAtLong: announcement.expiresAt
        ? dayjs(announcement.expiresAt).format('dddd D MMMM YYYY')
        : '',
    },
    institute: {
      name: inst?.name || 'Aula Book',
      copyright:
        inst?.copyright || 'Aula Book · Per disattivare le notifiche avvisi vai sul tuo profilo.',
    },
    now: { dateTime: dayjs().format('DD MMM YYYY · HH:mm') },
  };
}

module.exports = { sendAnnouncementBroadcast };
