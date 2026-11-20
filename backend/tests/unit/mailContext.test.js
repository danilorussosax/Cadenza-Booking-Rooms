'use strict';

const institutionTime = require('../../lib/institutionTime');
const mailContext = require('../../services/mailContext');
const { DEFAULTS } = require('../../services/mailTemplateDefaults');
const { sendPasswordResetEmail } = require('../../services/auth/sendPasswordReset');
const { MailOutbox } = require('../../models');

const SUMMER = '2026-07-15T21:30:00Z'; // 23:30 a Roma (CEST)
const WINTER = '2026-11-20T10:30:00Z'; // 11:30 a Roma (CET)

beforeEach(async () => {
  await resetDatabase();
  institutionTime.setClock(institutionTime.fixedClock(WINTER));
});
afterEach(() => institutionTime.resetClock());

describe('institutionTime.format', () => {
  it('formatta nel fuso istituto, locale it, indipendente dal TZ del processo', () => {
    expect(institutionTime.format(WINTER, 'DD/MM/YYYY HH:mm')).toBe('20/11/2026 11:30');
    expect(institutionTime.format(SUMMER, 'DD/MM/YYYY HH:mm')).toBe('15/07/2026 23:30');
    expect(institutionTime.format(WINTER, 'DD MMM YYYY')).toBe('20 nov 2026');
    expect(institutionTime.format(WINTER, 'HH:mm', { tz: 'UTC' })).toBe('10:30');
  });
  it('senza istante usa l orologio attivo', () => {
    expect(institutionTime.format(undefined, 'HH:mm')).toBe('11:30');
  });
});

describe('mailContext.buildContext', () => {
  it('variante notification: ora istituto, footer di default, now.date/time', async () => {
    const c = await mailContext.buildContext({ institute: null });
    expect(c.institute.name).toBe('Cadenza');
    expect(c.now).toEqual({ dateTime: '20 nov 2026 · 11:30', date: '20/11/2026', time: '11:30' });
    expect(c.copyright).toBe('Cadenza · Per disattivare le notifiche email vai sul tuo profilo.');
  });
  it('footerHint e copyright dell istituto', async () => {
    const hint = await mailContext.buildContext({ institute: {}, footerHint: 'avvisi' });
    expect(hint.copyright).toContain('notifiche avvisi');
    const own = await mailContext.buildContext({ institute: { name: 'Cons', copyright: 'X' } });
    expect(own.copyright).toBe('X');
    expect(own.institute.name).toBe('Cons');
  });
  it('variante security: copyright legale e data numerica', async () => {
    const c = await mailContext.buildContext({ institute: { name: 'Cons' }, variant: 'security' });
    expect(c.copyright).toBe('© 2026 Cons');
    expect(c.now.dateTime).toBe('20/11/2026 11:30');
  });
  it('at esplicito attraversa la mezzanotte locale', async () => {
    const c = await mailContext.buildContext({ institute: null, at: '2026-12-31T23:30:00Z' });
    expect(c.now.date).toBe('01/01/2027');
  });
});

describe('mailContext.renderAndQueue', () => {
  it('template mancante → TEMPLATE_MISSING', async () => {
    const r = await mailContext.renderAndQueue('inventato', {}, { to: 'a@b.it' });
    expect(r.code).toBe('TEMPLATE_MISSING');
    expect(r.ok).toBe(false);
  });

  it('renderizza ogni kind di default senza rete e accoda in outbox', async () => {
    const kinds = Object.keys(DEFAULTS);
    for (const kind of kinds) {
      const r = await mailContext.renderAndQueue(
        kind,
        {},
        { to: `${kind}@x.it`, institute: null, idempotencyKey: `t:${kind}` },
      );
      expect(r.ok, kind).toBe(true);
      expect(r.queued, kind).toBe(true);
    }
    const rows = await MailOutbox.findAll();
    expect(rows).toHaveLength(kinds.length);
  });

  it('idempotencyKey duplicata → dedup', async () => {
    const o = { to: 'a@b.it', institute: null, idempotencyKey: 'k1' };
    const k = Object.keys(DEFAULTS)[0];
    await mailContext.renderAndQueue(k, {}, o);
    const r = await mailContext.renderAndQueue(k, {}, o);
    expect(r.deduped).toBe(true);
  });

  it('deliver security: priorità 0 (senza SMTP finisce in outbox)', async () => {
    const r = await mailContext.renderAndQueue(
      'password_reset',
      {},
      { to: 'a@b.it', institute: null, deliver: 'security' },
    );
    expect(r.ok).toBe(true);
    const row = await MailOutbox.findOne({ where: { to: 'a@b.it' } });
    expect(row.priority).toBe(0);
    expect(row.kind).toBe('security');
  });
});

describe('sendPasswordResetEmail — scadenza in ora istituto', () => {
  it('mostra la scadenza a Roma, non nel TZ del processo', async () => {
    const r = await sendPasswordResetEmail(
      { firstName: 'Ada', lastName: 'L', email: 'ada@x.it' },
      'tok123',
      new Date(WINTER),
    );
    expect(r.ok).toBe(true);
    const row = await MailOutbox.findOne({ where: { to: 'ada@x.it' } });
    expect(row.bodyHtml).toContain('20/11/2026 11:30');
    expect(row.bodyHtml).toContain('tok123');
  });
});
