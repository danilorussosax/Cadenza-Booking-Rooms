import { QueryClient } from '@tanstack/react-query';
import { beforeEach, describe, expect, it } from 'vitest';

import * as inv from '@/lib/invalidation';

// Una query viva per ogni vista, con chiavi realistiche (prefisso + suffissi).
const VIEWS = {
  instruments: ['instruments', { q: 'x' }],
  adminInstruments: ['admin', 'instruments', 'all'],
  adminLoans: ['admin', 'loans', 'active'],
  myLoans: ['loans', 'mine'],
  concert: ['concert', 5],
  concertOther: ['concert', 9],
  publicConcerts: ['public', 'concerts', 30],
  publicStats: ['public', 'stats'],
  bookings: ['bookings', 'mine', 'all'],
  availability: ['availability', 3],
  waitlist: ['waitlist', 'me'],
  moAll: ['monte-ore', 'academic-years'],
  moProposals: ['monte-ore', 'proposals'],
  moMeYear2025: ['monte-ore', 'me', 2025],
  moMeYear2026: ['monte-ore', 'me', 2026],
  moMeSlots: ['monte-ore', 'me', 'slots', 2025],
  moMeThreshold: ['monte-ore', 'me', 'threshold', 2025],
  moMeAmendments: ['monte-ore', 'me', 'amendments', 2025],
  adminMo: ['admin', 'monte-ore', 'list', 'all', 2025],
  adminMoSettings: ['admin', 'monte-ore', 'settings', 2025],
  adminMoSuspensions: ['admin', 'monte-ore', 'suspensions', 2025],
  adminMoAmendments: ['admin', 'monte-ore', 'amendments', 'list', 'pending'],
  adminMoAmendmentsOf7: ['admin', 'monte-ore', 'amendments', 7],
  exam2025: ['examSessions', 2025],
  exam2026: ['examSessions', 2026],
  users: ['users', { role: 'x' }],
  integrations: ['admin', 'integrations'],
  backups: ['admin', 'backups'],
  qrOverview: ['admin', 'qr-overview'],
  qrBuildings: ['admin', 'qr', 'buildings'],
  mailTemplates: ['admin', 'mail-templates'],
  mailOutbox: ['admin', 'mail-outbox'],
  messaging: ['admin', 'messaging-settings'],
  contractTypes: ['contract-types'],
  courses: ['courses', 'active'],
  courseLevels: ['course-levels'],
  equipmentTemplates: ['equipment-templates'],
  quotas: ['quotas', 'x'],
  loanQuotas: ['loan-quotas', 'x'],
  announcements: ['announcements', 'x'],
  ruleExceptions: ['rules', 'exceptions'],
  twoFa: ['auth', '2fa', 'status'],
  consents: ['gdpr', 'consents'],
} as const;

type View = keyof typeof VIEWS;

let qc: QueryClient;

beforeEach(() => {
  qc = new QueryClient();
  for (const key of Object.values(VIEWS)) qc.setQueryData(key, 'dati');
});

const invalidated = (): View[] =>
  (Object.keys(VIEWS) as View[])
    .filter((name) => qc.getQueryState(VIEWS[name] as readonly unknown[])?.isInvalidated)
    .sort();

const MO_USER: View[] = [
  'moAll',
  'moProposals',
  'moMeYear2025',
  'moMeYear2026',
  'moMeSlots',
  'moMeThreshold',
  'moMeAmendments',
];

type Case = [string, (q: QueryClient) => Promise<void>, View[]];

const CASES: Case[] = [
  ['invalidateInstruments', inv.invalidateInstruments, ['instruments', 'adminInstruments']],
  ['invalidateAdminLoans', inv.invalidateAdminLoans, ['adminLoans', 'instruments']],
  ['invalidateMyLoans', inv.invalidateMyLoans, ['myLoans', 'instruments']],
  [
    'invalidateConcertDetail',
    (q) => inv.invalidateConcertDetail(q, 5),
    ['concert', 'publicConcerts'],
  ],
  [
    'invalidateConcertInfo',
    (q) => inv.invalidateConcertInfo(q, 5),
    ['concert', 'publicConcerts', 'bookings'],
  ],
  ['invalidateWaitlist', inv.invalidateWaitlist, ['waitlist']],
  ['invalidateWaitlistPromoted', inv.invalidateWaitlistPromoted, ['waitlist', 'bookings']],
  ['invalidateMonteOreUser', inv.invalidateMonteOreUser, MO_USER],
  [
    'invalidateAdminMonteOre',
    inv.invalidateAdminMonteOre,
    [
      'adminMo',
      'adminMoSettings',
      'adminMoSuspensions',
      'adminMoAmendments',
      'adminMoAmendmentsOf7',
    ],
  ],
  [
    'invalidateMonteOreMyPlan',
    inv.invalidateMonteOreMyPlan,
    ['moMeYear2025', 'moMeYear2026', 'moMeSlots', 'moMeThreshold', 'moMeAmendments'],
  ],
  ['invalidateMonteOreMySlots', inv.invalidateMonteOreMySlots, ['moMeSlots']],
  ['invalidateMonteOreYear', (q) => inv.invalidateMonteOreYear(q, 2025), ['moMeYear2025']],
  [
    'invalidateMonteOreYearAndSlots',
    (q) => inv.invalidateMonteOreYearAndSlots(q, 2025),
    ['moMeYear2025', 'moMeSlots'],
  ],
  ['invalidateMonteOreMyAmendments', inv.invalidateMonteOreMyAmendments, ['moMeAmendments']],
  // predicate: slots + sole proposal-key a 3 segmenti, non soglie/variazioni.
  [
    'invalidateMonteOreRegenerated',
    inv.invalidateMonteOreRegenerated,
    ['moMeSlots', 'moMeYear2025', 'moMeYear2026'],
  ],
  [
    'invalidateMonteOreImport',
    inv.invalidateMonteOreImport,
    [
      'moAll',
      'moProposals',
      'adminMo',
      'adminMoSettings',
      'adminMoSuspensions',
      'adminMoAmendments',
      'adminMoAmendmentsOf7',
    ],
  ],
  ['invalidateMonteOreSettings', inv.invalidateMonteOreSettings, ['adminMoSettings', ...MO_USER]],
  [
    'invalidateMonteOreAmendmentEdited',
    inv.invalidateMonteOreAmendmentEdited,
    [
      'adminMo',
      'adminMoSettings',
      'adminMoSuspensions',
      'adminMoAmendments',
      'adminMoAmendmentsOf7',
      'moMeYear2025',
      'moMeYear2026',
      'moMeSlots',
      'moMeThreshold',
      'moMeAmendments',
    ],
  ],
  ['invalidateMonteOreSuspensions', inv.invalidateMonteOreSuspensions, ['adminMoSuspensions']],
  [
    'invalidateAdminAmendments',
    inv.invalidateAdminAmendments,
    ['adminMoAmendments', 'adminMoAmendmentsOf7'],
  ],
  [
    'invalidateProposalAmendments',
    (q) => inv.invalidateProposalAmendments(q, 7),
    ['adminMoAmendmentsOf7'],
  ],
  ['invalidateExamSessions', (q) => inv.invalidateExamSessions(q, 2025), ['exam2025']],
  ['invalidateUsers', inv.invalidateUsers, ['users']],
  ['invalidateUsersImported', inv.invalidateUsersImported, ['users', 'integrations']],
  ['invalidateBackups', inv.invalidateBackups, ['backups']],
  ['invalidateQrStructure', inv.invalidateQrStructure, ['qrOverview', 'qrBuildings']],
  ['invalidateQrOverview', inv.invalidateQrOverview, ['qrOverview']],
  ['invalidateMailTemplates', inv.invalidateMailTemplates, ['mailTemplates']],
  ['invalidateMailOutbox', inv.invalidateMailOutbox, ['mailOutbox']],
  ['invalidateMessagingSettings', inv.invalidateMessagingSettings, ['messaging']],
  ['invalidateContractTypes', inv.invalidateContractTypes, ['contractTypes']],
  ['invalidateCourses', inv.invalidateCourses, ['courses']],
  ['invalidateCourseLevels', inv.invalidateCourseLevels, ['courseLevels']],
  ['invalidateEquipmentTemplates', inv.invalidateEquipmentTemplates, ['equipmentTemplates']],
  ['invalidateQuotas', inv.invalidateQuotas, ['quotas']],
  ['invalidateLoanQuotas', inv.invalidateLoanQuotas, ['loanQuotas']],
  ['invalidateAnnouncements', inv.invalidateAnnouncements, ['announcements']],
  ['invalidateRuleExceptions', inv.invalidateRuleExceptions, ['ruleExceptions']],
  ['invalidateTwoFaStatus', inv.invalidateTwoFaStatus, ['twoFa']],
  ['invalidateConsents', inv.invalidateConsents, ['consents']],
];

describe('lib/invalidation · eventi di dominio (anagrafiche, monte ore, prestiti)', () => {
  it.each(CASES)('%s invalida esattamente le viste attese', async (_name, run, expected) => {
    await run(qc);
    expect(invalidated()).toEqual([...expected].sort());
  });

  it('gli eventi parametrici non toccano altri anni/id', async () => {
    await inv.invalidateConcertDetail(qc, 5);
    expect(invalidated()).not.toContain('concertOther');
    await inv.invalidateExamSessions(qc, 2025);
    expect(invalidated()).not.toContain('exam2026');
  });
});
