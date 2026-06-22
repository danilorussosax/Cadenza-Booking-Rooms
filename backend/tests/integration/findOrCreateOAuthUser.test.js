'use strict';

/**
 * Integration: services/users/findOrCreate.js — find-or-create utenti OAuth
 * (Google/Microsoft) con whitelist domini + gate gruppi M365.
 *
 * Centralizza la regola condivisa dai verify callback di passport. Qui copriamo:
 *   - validazione argomenti (provider/email/providerUserId)
 *   - whitelist domini (iniettata e letta dal DB via OAuthSettings)
 *   - creazione legacy (no gruppi → pending/studente)
 *   - creazione con gruppo M365 noto → approved + ruolo mappato + snapshot
 *   - match per providerId e per email (link senza duplicare)
 *   - sync M365 autoritativo: promozione ruolo, pending→approved
 *   - GUARDRAIL: nessun gruppo noto → ruolo/stato invariati
 *   - resolver da GroupRoleMap (DB) vs default da OAuthSettings
 *   - getAllowedEmailDomains: legge DB, best-effort [] su assenza riga
 */

const {
  findOrCreateOAuthUser,
  getAllowedEmailDomains,
  OAuthDomainNotAllowedError,
} = require('../../services/users/findOrCreate');
const { User, OAuthSettings, GroupRoleMap } = require('../../models');

beforeEach(async () => {
  await globalThis.resetDatabase();
});

describe('findOrCreateOAuthUser — validazione argomenti', () => {
  it('provider sconosciuto → throw', async () => {
    await expect(
      findOrCreateOAuthUser({ provider: 'spid', providerUserId: 'x', email: 'a@x.it' }),
    ).rejects.toThrow(/Provider OAuth sconosciuto/);
  });

  it('email mancante → throw', async () => {
    await expect(
      findOrCreateOAuthUser({ provider: 'google', providerUserId: 'x', email: '' }),
    ).rejects.toThrow(/Email non disponibile/);
  });

  it('providerUserId mancante → throw', async () => {
    await expect(
      findOrCreateOAuthUser({ provider: 'google', providerUserId: '', email: 'a@x.it' }),
    ).rejects.toThrow(/ID utente non disponibile/);
  });
});

describe('findOrCreateOAuthUser — whitelist domini', () => {
  it('dominio non in whitelist → OAuthDomainNotAllowedError con code+domain', async () => {
    const err = await findOrCreateOAuthUser({
      provider: 'google',
      providerUserId: 'g1',
      email: 'mario@gmail.com',
      allowedDomains: ['conservatorio.it'],
    }).catch((e) => e);
    expect(err).toBeInstanceOf(OAuthDomainNotAllowedError);
    expect(err.code).toBe('OAUTH_DOMAIN_NOT_ALLOWED');
    expect(err.domain).toBe('gmail.com');
  });

  it('whitelist letta dal DB (OAuthSettings) quando allowedDomains omesso', async () => {
    await OAuthSettings.create({ id: 1, allowedEmailDomains: 'conservatorio.it' });
    await expect(
      findOrCreateOAuthUser({
        provider: 'google',
        providerUserId: 'g2',
        email: 'mario@gmail.com',
      }),
    ).rejects.toBeInstanceOf(OAuthDomainNotAllowedError);

    const ok = await findOrCreateOAuthUser({
      provider: 'google',
      providerUserId: 'g3',
      email: 'mario@conservatorio.it',
    });
    expect(ok.email).toBe('mario@conservatorio.it');
  });
});

describe('findOrCreateOAuthUser — creazione', () => {
  it('primo login legacy (no groups) → pending/studente, email lowercased, fallback nome', async () => {
    const u = await findOrCreateOAuthUser({
      provider: 'microsoft',
      providerUserId: 'm1',
      email: 'Anna.Rossi@Example.IT',
    });
    expect(u.email).toBe('anna.rossi@example.it');
    expect(u.microsoftId).toBe('m1');
    expect(u.role).toBe('studente');
    expect(u.status).toBe('pending');
    expect(u.firstName).toBe('Utente'); // fallback
    expect(u.lastName).toBe('Microsoft'); // fallback = provider label
    expect(u.m365Groups).toEqual([]);
  });

  it('gruppo M365 noto → approved + ruolo mappato + snapshot lowercased', async () => {
    const u = await findOrCreateOAuthUser({
      provider: 'microsoft',
      providerUserId: 'm2',
      email: 'dir@example.it',
      firstName: 'Dir',
      lastName: 'Ettore',
      groups: ['Direzione'],
    });
    expect(u.role).toBe('admin');
    expect(u.status).toBe('approved');
    expect(u.m365Groups).toEqual(['direzione']);
  });

  it('gruppi senza match → fallback pending/studente, snapshot conservato', async () => {
    const u = await findOrCreateOAuthUser({
      provider: 'microsoft',
      providerUserId: 'm3',
      email: 'tizio@example.it',
      groups: ['Coro Polifonico'],
    });
    expect(u.role).toBe('studente');
    expect(u.status).toBe('pending');
    expect(u.m365Groups).toEqual(['coro polifonico']);
  });
});

describe('findOrCreateOAuthUser — match esistente', () => {
  it('match per providerId → riusa, sync M365 promuove pending→approved', async () => {
    const existing = await User.create({
      email: 'doc@example.it',
      microsoftId: 'm10',
      firstName: 'Doc',
      lastName: 'Ente',
      role: 'studente',
      status: 'pending',
    });
    const u = await findOrCreateOAuthUser({
      provider: 'microsoft',
      providerUserId: 'm10',
      email: 'doc@example.it',
      groups: ['Docenti'],
    });
    expect(u.id).toBe(existing.id);
    expect(u.role).toBe('docente');
    expect(u.status).toBe('approved');
    expect(u.m365Groups).toEqual(['docenti']);
  });

  it('match per email → linka microsoftId senza duplicare', async () => {
    const existing = await User.create({
      email: 'local@example.it',
      firstName: 'Local',
      lastName: 'User',
      role: 'studente',
      status: 'approved',
    });
    const u = await findOrCreateOAuthUser({
      provider: 'microsoft',
      providerUserId: 'm20',
      email: 'local@example.it',
    });
    expect(u.id).toBe(existing.id);
    expect(u.microsoftId).toBe('m20');
    const count = await User.count({ where: { email: 'local@example.it' } });
    expect(count).toBe(1);
  });

  it('GUARDRAIL: utente esistente senza gruppo noto → ruolo/stato invariati', async () => {
    const existing = await User.create({
      email: 'manuale@example.it',
      microsoftId: 'm30',
      firstName: 'Man',
      lastName: 'Uale',
      role: 'admin',
      status: 'approved',
    });
    const u = await findOrCreateOAuthUser({
      provider: 'microsoft',
      providerUserId: 'm30',
      email: 'manuale@example.it',
      groups: [], // nessun gruppo → mappedRole null
    });
    expect(u.id).toBe(existing.id);
    expect(u.role).toBe('admin'); // NON declassato
    expect(u.status).toBe('approved');
  });

  it('legacy senza groups su utente esistente → nessuna modifica ruolo', async () => {
    await User.create({
      email: 'legacy@example.it',
      googleId: 'g50',
      firstName: 'Leg',
      lastName: 'Acy',
      role: 'docente',
      status: 'approved',
    });
    const u = await findOrCreateOAuthUser({
      provider: 'google',
      providerUserId: 'g50',
      email: 'legacy@example.it',
    });
    expect(u.role).toBe('docente');
    expect(u.status).toBe('approved');
  });
});

describe('findOrCreateOAuthUser — resolver GroupRoleMap vs default', () => {
  it('regole custom da GroupRoleMap (DB) hanno priorità sui default', async () => {
    await GroupRoleMap.create({ groupDisplayName: 'Tutor', role: 'docente', priority: 1 });
    const u = await findOrCreateOAuthUser({
      provider: 'microsoft',
      providerUserId: 'm40',
      email: 'tutor@example.it',
      groups: ['Tutor'],
    });
    expect(u.role).toBe('docente');
    expect(u.status).toBe('approved');
  });

  it('default da OAuthSettings (nomi gruppo custom) quando GroupRoleMap vuota', async () => {
    await OAuthSettings.create({ id: 1, groupDocenti: 'Faculty' });
    const u = await findOrCreateOAuthUser({
      provider: 'microsoft',
      providerUserId: 'm41',
      email: 'fac@example.it',
      groups: ['Faculty'],
    });
    expect(u.role).toBe('docente');
  });
});

describe('getAllowedEmailDomains', () => {
  it('legge e normalizza la CSV da OAuthSettings', async () => {
    await OAuthSettings.create({
      id: 1,
      allowedEmailDomains: 'A.IT, b.it; a.it',
    });
    const list = await getAllowedEmailDomains();
    expect(list).toEqual(['a.it', 'b.it']);
  });

  it('nessuna riga OAuthSettings → [] (nessuna restrizione)', async () => {
    const list = await getAllowedEmailDomains();
    expect(list).toEqual([]);
  });
});
