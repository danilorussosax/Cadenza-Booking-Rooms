import type { QueryClient } from '@tanstack/react-query';

import { qk } from '@/lib/queryKeys';

/**
 * Invalidazioni per evento di dominio.
 *
 * Ogni funzione sa quali cache toccare quando succede qualcosa (es. "e'
 * cambiata la struttura"): le mutation chiamano l'evento invece di elencare
 * a mano le chiavi, cosi' un nuovo consumatore di un dato richiede una
 * modifica in un solo punto. Le chiavi vengono da `lib/queryKeys.ts`.
 *
 * Nota sui due prefissi simili: `['institute', 'public']` e' il branding
 * pubblico (nome, logo, flag moduli: `invalidateInstituteBranding`);
 * `['institutes', ...]` e' la struttura per l'admin (`invalidateStructure`).
 */

type Qc = Pick<QueryClient, 'invalidateQueries'>;

/** Invalida piu' chiavi in parallelo e risolve quando i refetch attivi finiscono. */
const invalidateAll = async (qc: Qc, keys: readonly (readonly unknown[])[]): Promise<void> => {
  await Promise.all(keys.map((queryKey) => qc.invalidateQueries({ queryKey })));
};

/**
 * Aule/edifici/sedi creati, modificati, importati o eliminati.
 * Tocca: albero istituti admin, albero struttura (Quote/Regole/Annunci),
 * liste aule (Dashboard, Prenotazioni, Regole) e Display kiosk
 * (`/api/public/*`, che mostra codice/nome/piano/foto delle aule).
 */
export const invalidateStructure = (qc: Qc): Promise<void> =>
  invalidateAll(qc, [
    qk.institutes.all(),
    qk.structure.institutesFull(),
    qk.rooms.all(),
    qk.public.all(),
  ]);

/**
 * Strumenti/attrezzatura di un'aula creati o modificati.
 * L'attrezzatura compare nell'albero istituti (Struttura, Aule, Display
 * admin) e nella ricerca aule per tipo di attrezzatura (`['rooms','search']`);
 * il Display kiosk pubblico non la mostra, quindi `['public']` non si tocca.
 */
export const invalidateEquipment = (qc: Qc): Promise<void> =>
  invalidateAll(qc, [qk.institutes.all(), qk.structure.institutesFull(), qk.rooms.all()]);

/** Branding pubblico dell'istituto (nome, logo, icona app, copyright, flag moduli). */
export const invalidateInstituteBranding = (qc: Qc): Promise<void> =>
  invalidateAll(qc, [qk.institute.public()]);

/** Anagrafica istituto (dati, logo): struttura admin + branding pubblico. */
export const invalidateInstituteProfile = (qc: Qc): Promise<void> =>
  invalidateAll(qc, [qk.institutes.all(), qk.institute.public()]);

/**
 * Eliminazione di istituto/edificio/aula: tutto quello che cambia con la
 * struttura piu' il branding pubblico (un istituto eliminato cambia il
 * branding risolto).
 */
export const invalidateStructureDeleted = (qc: Qc): Promise<void> =>
  invalidateAll(qc, [
    qk.institutes.all(),
    qk.structure.institutesFull(),
    qk.institute.public(),
    qk.rooms.all(),
    qk.public.all(),
  ]);

/**
 * Prenotazione creata/modificata/annullata/approvata: elenchi prenotazioni
 * utente e admin (inclusi i conteggi pending) e disponibilita' aule.
 */
export const invalidateBookings = (qc: Qc): Promise<void> =>
  invalidateAll(qc, [qk.bookings.all(), qk.availability.all(), qk.adminBookings.all()]);

/** Monte ore (vista utente e admin): cambio anno accademico, import, impostazioni. */
export const invalidateMonteOre = (qc: Qc): Promise<void> =>
  invalidateAll(qc, [qk.monteOre.all(), qk.adminMonteOre.all()]);

// ---------------------------------------------------------------------------
// Strumenti e prestiti
// ---------------------------------------------------------------------------

/** Strumento creato/modificato/eliminato/importato: liste utente e admin. */
export const invalidateInstruments = (qc: Qc): Promise<void> =>
  invalidateAll(qc, [qk.instruments.all(), qk.adminInstruments.all()]);

/** Prestito gestito dall'admin: prestiti admin e disponibilita' strumenti. */
export const invalidateAdminLoans = (qc: Qc): Promise<void> =>
  invalidateAll(qc, [qk.adminLoans.all(), qk.instruments.all()]);

/** Prestito dell'utente (richiesta/restituzione/annullo): "miei prestiti" e strumenti. */
export const invalidateMyLoans = (qc: Qc): Promise<void> =>
  invalidateAll(qc, [qk.loans.mine(), qk.instruments.all()]);

// ---------------------------------------------------------------------------
// Prenotazioni: concerti e lista d'attesa
// ---------------------------------------------------------------------------

/** Dettaglio concerto + elenco pubblico concerti. */
export const invalidateConcertDetail = (qc: Qc, bookingId: unknown): Promise<void> =>
  invalidateAll(qc, [qk.concert.detail(bookingId), qk.public.concertsAll()]);

/** Info concerto modificate: dettaglio, elenco pubblico e prenotazioni. */
export const invalidateConcertInfo = (qc: Qc, bookingId: unknown): Promise<void> =>
  invalidateAll(qc, [qk.concert.detail(bookingId), qk.public.concertsAll(), qk.bookings.all()]);

/** Iscrizione/uscita dalla lista d'attesa. */
export const invalidateWaitlist = (qc: Qc): Promise<void> => invalidateAll(qc, [qk.waitlist.me()]);

/** Posto in lista d'attesa convertito/rimosso: lista d'attesa + prenotazioni. */
export const invalidateWaitlistPromoted = (qc: Qc): Promise<void> =>
  invalidateAll(qc, [qk.waitlist.me(), qk.bookings.all()]);

// ---------------------------------------------------------------------------
// Monte ore
// ---------------------------------------------------------------------------

/** Solo vista utente del monte ore (selettore anno accademico). */
export const invalidateMonteOreUser = (qc: Qc): Promise<void> =>
  invalidateAll(qc, [qk.monteOre.all()]);

/** Solo vista admin del monte ore. */
export const invalidateAdminMonteOre = (qc: Qc): Promise<void> =>
  invalidateAll(qc, [qk.adminMonteOre.all()]);

/** Piano personale (proposta, slot, soglie, calendario, variazioni) dell'utente. */
export const invalidateMonteOreMyPlan = (qc: Qc): Promise<void> =>
  invalidateAll(qc, [qk.monteOre.me()]);

/** Solo gli slot della griglia personale. */
export const invalidateMonteOreMySlots = (qc: Qc): Promise<void> =>
  invalidateAll(qc, [qk.monteOre.meSlots()]);

/** Proposta dell'utente per un anno accademico. */
export const invalidateMonteOreYear = (qc: Qc, year: unknown): Promise<void> =>
  invalidateAll(qc, [qk.monteOre.meYear(year)]);

/** Proposta dell'anno + slot della griglia. */
export const invalidateMonteOreYearAndSlots = (qc: Qc, year: unknown): Promise<void> =>
  invalidateAll(qc, [qk.monteOre.meYear(year), qk.monteOre.meSlots()]);

/** Variazioni (amendments) richieste dall'utente. */
export const invalidateMonteOreMyAmendments = (qc: Qc): Promise<void> =>
  invalidateAll(qc, [qk.monteOre.meAmendments()]);

/**
 * Griglia rigenerata: riscrive tutti gli slot e aggiorna i contatori della
 * proposta. Oltre agli slot invalida solo le proposal-key
 * (`['monte-ore','me',<anno>]`, 3 segmenti), non soglie/calendario/variazioni.
 */
export const invalidateMonteOreRegenerated = async (qc: Qc): Promise<void> => {
  await Promise.all([
    qc.invalidateQueries({ queryKey: qk.monteOre.meSlots() }),
    qc.invalidateQueries({
      queryKey: qk.monteOre.me(),
      predicate: (q) => q.queryKey.length === 3 && q.queryKey[2] !== 'slots',
    }),
  ]);
};

/** Import Excel del monte ore: proposte, anni accademici e vista admin. */
export const invalidateMonteOreImport = (qc: Qc): Promise<void> =>
  invalidateAll(qc, [qk.monteOre.proposals(), qk.monteOre.academicYears(), qk.adminMonteOre.all()]);

/** Impostazioni monte ore admin modificate: impostazioni + tutta la vista utente. */
export const invalidateMonteOreSettings = (qc: Qc): Promise<void> =>
  invalidateAll(qc, [qk.adminMonteOre.settings(), qk.monteOre.all()]);

/** Variazione modificata dall'admin: vista admin + piano personale. */
export const invalidateMonteOreAmendmentEdited = (qc: Qc): Promise<void> =>
  invalidateAll(qc, [qk.adminMonteOre.all(), qk.monteOre.me()]);

/** Sospensioni monte ore (admin). */
export const invalidateMonteOreSuspensions = (qc: Qc): Promise<void> =>
  invalidateAll(qc, [qk.adminMonteOre.suspensions()]);

/** Lista variazioni lato admin. */
export const invalidateAdminAmendments = (qc: Qc): Promise<void> =>
  invalidateAll(qc, [qk.adminMonteOre.amendments()]);

/** Variazioni di una singola proposta (admin). */
export const invalidateProposalAmendments = (qc: Qc, proposalId: unknown): Promise<void> =>
  invalidateAll(qc, [qk.adminMonteOre.amendmentsOf(proposalId)]);

/** Sessioni d'esame di un anno accademico. */
export const invalidateExamSessions = (qc: Qc, year: unknown): Promise<void> =>
  invalidateAll(qc, [qk.examSessions.byYear(year)]);

// ---------------------------------------------------------------------------
// Utenti, anagrafiche e configurazione admin
// ---------------------------------------------------------------------------

/** Utenti creati/modificati/importati/approvati/eliminati. */
export const invalidateUsers = (qc: Qc): Promise<void> => invalidateAll(qc, [qk.users.all()]);

/** Import Isidata: utenti + stato integrazioni. */
export const invalidateUsersImported = (qc: Qc): Promise<void> =>
  invalidateAll(qc, [qk.users.all(), qk.admin.integrations()]);

export const invalidateBackups = (qc: Qc): Promise<void> => invalidateAll(qc, [qk.admin.backups()]);

/** Mappa QR: edifici + panoramica. */
export const invalidateQrStructure = (qc: Qc): Promise<void> =>
  invalidateAll(qc, [qk.admin.qrBuildings(), qk.admin.qrOverview()]);

export const invalidateQrOverview = (qc: Qc): Promise<void> =>
  invalidateAll(qc, [qk.admin.qrOverview()]);

export const invalidateMailTemplates = (qc: Qc): Promise<void> =>
  invalidateAll(qc, [qk.admin.mailTemplates()]);

export const invalidateMailOutbox = (qc: Qc): Promise<void> =>
  invalidateAll(qc, [qk.admin.mailOutbox()]);

export const invalidateMessagingSettings = (qc: Qc): Promise<void> =>
  invalidateAll(qc, [qk.admin.messagingSettings()]);

export const invalidateContractTypes = (qc: Qc): Promise<void> =>
  invalidateAll(qc, [qk.contractTypes.all()]);

export const invalidateCourses = (qc: Qc): Promise<void> => invalidateAll(qc, [qk.courses.all()]);

export const invalidateCourseLevels = (qc: Qc): Promise<void> =>
  invalidateAll(qc, [qk.courseLevels.all()]);

export const invalidateEquipmentTemplates = (qc: Qc): Promise<void> =>
  invalidateAll(qc, [qk.equipmentTemplates.all()]);

export const invalidateQuotas = (qc: Qc): Promise<void> => invalidateAll(qc, [qk.quotas.all()]);

export const invalidateLoanQuotas = (qc: Qc): Promise<void> =>
  invalidateAll(qc, [qk.loanQuotas.all()]);

export const invalidateAnnouncements = (qc: Qc): Promise<void> =>
  invalidateAll(qc, [qk.announcements.all()]);

export const invalidateRuleExceptions = (qc: Qc): Promise<void> =>
  invalidateAll(qc, [qk.rules.exceptions()]);

/** Stato 2FA dell'utente. */
export const invalidateTwoFaStatus = (qc: Qc): Promise<void> =>
  invalidateAll(qc, [qk.auth.twoFaStatus()]);

/** Consensi GDPR dell'utente. */
export const invalidateConsents = (qc: Qc): Promise<void> =>
  invalidateAll(qc, [qk.gdpr.consents()]);
