/**
 * Registro tipizzato delle query key di react-query.
 *
 * Unica fonte di verita' per i valori delle chiavi: `useQuery`, `setQueryData`
 * e `invalidateQueries` passano da qui, cosi' una chiave letta e una chiave
 * invalidata non possono piu' divergere per un refuso. I valori sono identici
 * a quelli usati prima del registro (le cache esistenti non si spezzano).
 *
 * Convenzione: `qk.<dominio>.all()` e' il prefisso del dominio (adatto a
 * `invalidateQueries`); le altre entry sono chiavi piu' specifiche.
 * Gli eventi di dominio che sanno cosa invalidare stanno in `lib/invalidation.ts`.
 */
export const qk = {
  institute: {
    public: () => ['institute', 'public'] as const,
  },
  institutes: {
    all: () => ['institutes'] as const,
    full: () => ['institutes', 'full'] as const,
  },
  structure: {
    institutesFull: () => ['structure', 'institutes', 'full'] as const,
  },
  rooms: {
    all: () => ['rooms'] as const,
    bookable: () => ['rooms', 'bookable'] as const,
    listAll: () => ['rooms', 'list', 'all'] as const,
    search: (filters: unknown, buildingId: unknown) =>
      ['rooms', 'search', filters, buildingId] as const,
  },
  public: {
    all: () => ['public'] as const,
    institute: () => ['public', 'institute'] as const,
    stats: () => ['public', 'stats'] as const,
    displayConfig: () => ['public', 'display-config'] as const,
    concertsAll: () => ['public', 'concerts'] as const,
    concerts: (horizonDays: unknown) => ['public', 'concerts', horizonDays] as const,
    announcements: (pinnedOnly: unknown, cap: unknown) =>
      ['public', 'announcements', pinnedOnly, cap] as const,
    agendaWeek: (weekStart: unknown) => ['public', 'agenda', 'week', weekStart] as const,
  },
  instruments: {
    all: () => ['instruments'] as const,
    filtered: (filters: unknown) => ['instruments', filters] as const,
    forLoanQuotaDialog: () => ['instruments', 'for-loan-quota-dialog'] as const,
    allForQuota: () => ['instruments', 'all-for-quota'] as const,
  },
  adminInstruments: {
    all: () => ['admin', 'instruments'] as const,
    everything: () => ['admin', 'instruments', 'all'] as const,
    filtered: (filters: unknown) => ['admin', 'instruments', filters] as const,
  },
  users: {
    all: () => ['users'] as const,
    approvedActive: () => ['users', 'approved-active'] as const,
    botBindings: () => ['users', 'me', 'bot-bindings'] as const,
    list: (filters: unknown) => ['users', filters] as const,
  },
  bookings: {
    all: () => ['bookings'] as const,
    usageMe: () => ['bookings', 'usage', 'me'] as const,
    mineUpcoming: () => ['bookings', 'mine', 'upcoming'] as const,
    minePending: () => ['bookings', 'mine', 'pending'] as const,
    mineAll: () => ['bookings', 'mine', 'all'] as const,
    day: (dayStart: unknown, daysCount: unknown) =>
      ['bookings', 'day', dayStart, daysCount] as const,
    checkinCandidates: (roomId: unknown) => ['bookings', 'checkin-candidates', roomId] as const,
  },
  adminBookings: {
    all: () => ['admin', 'bookings'] as const,
    pending: () => ['admin', 'bookings', 'pending'] as const,
    pendingCount: () => ['admin', 'bookings', 'pending', 'count'] as const,
    pendingCountLegacy: () => ['admin', 'bookings', 'pending-count'] as const,
    confirmedFuture: () => ['admin', 'bookings', 'confirmed-future'] as const,
  },
  monteOre: {
    all: () => ['monte-ore'] as const,
    me: () => ['monte-ore', 'me'] as const,
    meSlots: () => ['monte-ore', 'me', 'slots'] as const,
    meAmendments: () => ['monte-ore', 'me', 'amendments'] as const,
    meThreshold: () => ['monte-ore', 'me', 'threshold'] as const,
    proposals: () => ['monte-ore', 'proposals'] as const,
    academicYears: () => ['monte-ore', 'academic-years'] as const,
    academicYearsAdmin: () => ['monte-ore', 'academic-years', 'admin'] as const,
    academicYearMe: () => ['monte-ore', 'academic-year', 'me'] as const,
    meYear: (year: unknown) => ['monte-ore', 'me', year] as const,
    meSlotsYear: (year: unknown) => ['monte-ore', 'me', 'slots', year] as const,
    meThresholdYear: (year: unknown) => ['monte-ore', 'me', 'threshold', year] as const,
    meCalendarYear: (year: unknown) => ['monte-ore', 'me', 'calendar', year] as const,
    meAmendmentsYear: (year: unknown) => ['monte-ore', 'me', 'amendments', year] as const,
  },
  adminMonteOre: {
    all: () => ['admin', 'monte-ore'] as const,
    suspensions: () => ['admin', 'monte-ore', 'suspensions'] as const,
    amendments: () => ['admin', 'monte-ore', 'amendments'] as const,
    amendmentsPendingCount: () => ['admin', 'monte-ore', 'amendments', 'pending-count'] as const,
    settings: () => ['admin', 'monte-ore', 'settings'] as const,
    amendmentsList: (status: unknown) =>
      ['admin', 'monte-ore', 'amendments', 'list', status] as const,
    amendmentsOf: (proposalId: unknown) =>
      ['admin', 'monte-ore', 'amendments', proposalId] as const,
    preview: (proposalId: unknown) => ['admin', 'monte-ore', proposalId, 'preview'] as const,
    suspensionsYear: (year: unknown) => ['admin', 'monte-ore', 'suspensions', year] as const,
    settingsYear: (year: unknown) => ['admin', 'monte-ore', 'settings', year] as const,
    list: (status: unknown, year: unknown) => ['admin', 'monte-ore', 'list', status, year] as const,
    detail: (id: unknown) => ['admin', 'monte-ore', id] as const,
  },
  equipmentTemplates: {
    all: () => ['equipment-templates'] as const,
  },
  courseLevels: {
    all: () => ['course-levels'] as const,
  },
  courses: {
    all: () => ['courses'] as const,
    allList: () => ['courses', 'all'] as const,
    active: () => ['courses', 'active'] as const,
  },
  loans: {
    mine: () => ['loans', 'mine'] as const,
  },
  adminLoans: {
    all: () => ['admin', 'loans'] as const,
    kind: (kind: unknown) => ['admin', 'loans', kind] as const,
  },
  waitlist: {
    me: () => ['waitlist', 'me'] as const,
  },
  gdpr: {
    consents: () => ['gdpr', 'consents'] as const,
  },
  concert: {
    detail: (bookingId: unknown) => ['concert', bookingId] as const,
  },
  auth: {
    twoFaStatus: () => ['auth', '2fa', 'status'] as const,
    icalToken: () => ['auth', 'ical-token'] as const,
  },
  rules: {
    exceptions: () => ['rules', 'exceptions'] as const,
    exceptionsFor: (role: unknown, roomId: unknown) =>
      ['rules', 'exceptions', role, roomId] as const,
    forRole: (role: unknown) => ['rules', role] as const,
  },
  quotas: {
    all: () => ['quotas'] as const,
  },
  loanQuotas: {
    all: () => ['loan-quotas'] as const,
  },
  examSessions: {
    byYear: (academicYear: unknown) => ['examSessions', academicYear] as const,
  },
  contractTypes: {
    all: () => ['contract-types'] as const,
    list: (opts: unknown) => ['contract-types', opts] as const,
    impact: (id: unknown) => ['contract-types', id, 'impact'] as const,
  },
  availability: {
    all: () => ['availability'] as const,
    forRoomDate: (roomId: unknown, date: unknown) => ['availability', roomId, date] as const,
  },
  announcements: {
    all: () => ['announcements'] as const,
    mine: () => ['announcements', 'mine'] as const,
    admin: () => ['announcements', 'admin'] as const,
  },
  bookingTypes: {
    all: () => ['booking-types'] as const,
    admin: () => ['booking-types', 'admin'] as const,
    active: () => ['booking-types', 'active'] as const,
  },
  bookingTemplates: {
    all: () => ['booking-templates'] as const,
  },
  appIcons: {
    all: () => ['app-icons'] as const,
  },
  docs: {
    bySlug: (slug: unknown) => ['docs', slug] as const,
  },
  passwordReset: {
    validate: (token: unknown) => ['password-reset', 'validate', token] as const,
  },
  admin: {
    backups: () => ['admin', 'backups'] as const,
    qrOverview: () => ['admin', 'qr-overview'] as const,
    qrBuildings: () => ['admin', 'qr', 'buildings'] as const,
    roomQr: (roomId: unknown, version: unknown) => ['admin', 'room-qr', roomId, version] as const,
    mailTemplates: () => ['admin', 'mail-templates'] as const,
    messagingSettings: () => ['admin', 'messaging-settings'] as const,
    oauthSettings: () => ['admin', 'oauth-settings'] as const,
    excelExportStatus: () => ['admin', 'excel-export', 'status'] as const,
    checkinSettings: () => ['admin', 'checkin-settings'] as const,
    mailSettings: () => ['admin', 'mail-settings'] as const,
    moduleSettings: () => ['admin', 'module-settings'] as const,
    moduleSettingsRegistry: () => ['admin', 'module-settings', 'registry'] as const,
    mailOutbox: () => ['admin', 'mail-outbox'] as const,
    mailOutboxHealth: () => ['admin', 'mail-outbox', 'health'] as const,
    mailOutboxCounts: () => ['admin', 'mail-outbox', 'counts'] as const,
    mailOutboxList: (filters: unknown) => ['admin', 'mail-outbox', 'list', filters] as const,
    integrations: () => ['admin', 'integrations'] as const,
    integrationsRuns: (source: unknown) => ['admin', 'integrations', 'runs', source] as const,
    integrationsCompare: (runId: unknown) => ['admin', 'integrations', 'compare', runId] as const,
    opsSnapshot: () => ['admin', 'ops', 'snapshot'] as const,
    opsSlowQueriesRecent: () => ['admin', 'ops', 'slow-queries', 'recent'] as const,
    opsSlowQueriesAggregateRoute: () =>
      ['admin', 'ops', 'slow-queries', 'aggregate', 'route'] as const,
    auditLogTargetTypes: () => ['admin', 'audit-log', 'target-types'] as const,
    auditLog: (page: unknown, filters: unknown) => ['admin', 'audit-log', page, filters] as const,
    analytics: (from: unknown, to: unknown) => ['admin', 'analytics', from, to] as const,
  },
} as const;
