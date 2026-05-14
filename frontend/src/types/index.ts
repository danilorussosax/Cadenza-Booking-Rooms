export type Role = 'admin' | 'docente' | 'studente';
export type UserStatus = 'pending' | 'approved' | 'rejected';

// Codice livello (es. "triennio", "biennio") — ora gestiti dinamicamente dal catalogo CourseLevelEntity
export type CourseLevel = string;

export interface CourseLevelEntity {
  id: number;
  code: string;
  name: string;
  sortOrder: number;
}

export interface Course {
  id: number;
  code: string;
  name: string;
  department?: string | null;
  levels: CourseLevel[];
  description?: string | null;
  isActive: boolean;
}

export interface User {
  id: number;
  email: string;
  firstName: string;
  lastName: string;
  role: Role;
  status: UserStatus;
  matricola?: string | null;
  courseId?: number | null;
  course?: Course | null;
  googleId?: string | null;
  microsoftId?: string | null;
  isActive: boolean;
  emailNotifications?: boolean;
  notifyOnConfirmation?: boolean;
  notifyOnReminder?: boolean;
  notifyOnCancellation?: boolean;
  /** Hard-bounce SMTP rilevato dal worker. Se valorizzato, future email
   *  transazionali a questo utente vengono saltate. Reset via UI admin
   *  (pulsante "Reimposta email") oppure cambiando l'indirizzo. */
  emailBouncedAt?: string | null;
  emailBouncedReason?: string | null;
  profilePhotoUrl?: string | null;
  lastLogin?: string | null;
  /** 2FA TOTP — esposto al client per la UI. Il secret/recovery codes restano
   *  server-side e non sono inclusi nelle response (toSafeJSON ne strippa). */
  twoFaEnabled?: boolean;
  twoFaActivatedAt?: string | null;
  /** Monte Ore — deroga individuale (contratto orario / casi speciali). */
  contractType?: ContractType | null;
  monteOreAnnualHoursOverride?: number | null;
  monteOreBypassDayConstraint?: boolean;
  monteOreOverrideReason?: string | null;
  monteOreOverrideSetAt?: string | null;
  monteOreOverrideSetBy?: number | null;
}

// Tipologie di sistema (sempre presenti, non cancellabili). Le custom create
// dall'admin sono semplici stringhe (slug) — il typing usa string per
// compatibilità con valori arbitrari runtime.
export type SystemContractType = 'titolare' | 'contratto_orario' | 'supplente' | 'altro';
export type ContractType = SystemContractType | (string & {});

/** Record runtime di una tipologia contrattuale (anagrafica admin). */
export interface ContractTypeRow {
  id: number;
  instituteId: number;
  code: string;
  label: string;
  defaultHours: number | null;
  bypassDayConstraintDefault: boolean;
  isSystem: boolean;
  isActive: boolean;
  sortOrder: number;
  notes?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface SubProcessor {
  name: string;
  purpose?: string;
  location?: string;
  dpaUrl?: string;
}

export interface InstituteLegalFields {
  legalName?: string | null;
  vatNumber?: string | null;
  fiscalCode?: string | null;
  pecEmail?: string | null;
  contactEmail?: string | null;
  dpoName?: string | null;
  dpoEmail?: string | null;
  jurisdictionCity?: string | null;
  subProcessors?: SubProcessor[] | null;
}

export interface Institute extends InstituteLegalFields {
  id: number;
  name: string;
  code?: string | null;
  address?: string | null;
  city?: string | null;
  country?: string;
  timezone?: string;
  description?: string | null;
  logoUrl?: string | null;
  /** Icona app scelta dall'admin (file in /logo-app/). NULL = default `/cadenza.png`. */
  appIconUrl?: string | null;
  copyright?: string | null;
}

export interface PublicInstitute extends InstituteLegalFields {
  id?: number;
  name: string;
  code?: string | null;
  address?: string | null;
  city?: string | null;
  country?: string | null;
  logoUrl?: string | null;
  /** Icona app correntemente attiva — letta da tutti i client per propagare la scelta dell'admin. */
  appIconUrl?: string | null;
  copyright?: string | null;
  /** Module flag: mostra/nasconde la voce "Monte ore" nella sidebar. */
  moduleMonteOreEnabled?: boolean;
  /** Module flag: mostra/nasconde "Strumenti" e "I miei prestiti". */
  moduleInstrumentLoansEnabled?: boolean;
}

export interface Building {
  id: number;
  instituteId: number;
  name: string;
  code?: string | null;
  address?: string | null;
  floors: string[];
  /** Se true, l'edificio compare nella rotazione del kiosk /display. */
  displayEnabled?: boolean;
  /** Durata in secondi della visualizzazione di questo edificio sul display. */
  displayIntervalSec?: number;
  /** Giorni di anteprima dei concerti nella rotazione /display (0 = disattivato). */
  displayConcertsDays?: number;
  /** Attiva la rotazione concerti su questo edificio. */
  displayConcertsEnabled?: boolean;
  /** Numero massimo di concerti da mostrare (0 = senza limite). */
  displayConcertsCount?: number;
  /** Durata in secondi di una slide concerto sul kiosk. */
  displayConcertsIntervalSec?: number;
  /** Master toggle per la rotazione delle prenotazioni di questo edificio. */
  displayBookingsEnabled?: boolean;
  /** Attiva la rotazione annunci sul kiosk per questo edificio. */
  displayAnnouncementsEnabled?: boolean;
  /** Numero massimo di annunci nella rotazione (0 = senza limite). */
  displayAnnouncementsCount?: number;
  /** Durata in secondi di una slide annuncio. */
  displayAnnouncementsIntervalSec?: number;
  /** Mostra solo gli annunci con isPinned=true. */
  displayAnnouncementsPinnedOnly?: boolean;
  /**
   * Modalità tabella prenotazioni del kiosk per questo edificio:
   *   - 'weekly' (default storico): matrice aule × giorni della settimana
   *   - 'daily' : matrice aule × orari del giorno corrente
   */
  displayViewMode?: 'weekly' | 'daily';
  /** Toggle "check-in per edificio" (impostazione generale).
   *  Se true, tutte le aule senza override esplicito (Room.requireCheckIn=null)
   *  richiedono il check-in QR. */
  checkInDefault?: boolean;
  rooms?: Room[];
}

export type RoomType =
  | 'studio'
  | 'sala_prove'
  | 'aula_concerti'
  | 'classe'
  | 'aula_didattica'
  | 'altro';

export interface Equipment {
  id: number;
  roomId: number;
  name: string;
  type: string;
  brand?: string | null;
  model?: string | null;
  quantity: number;
  isWorking: boolean;
}

export interface Room {
  id: number;
  buildingId: number;
  name: string;
  code?: string | null;
  floor: string;
  capacity: number;
  type: RoomType;
  allowedRoles: Role[];
  allowedCourseIds: number[];
  isBookable: boolean;
  /** Toggle check-in QR per aula con cascata Building → Room:
   *   - null       → eredita Building.checkInDefault (impostazione generale)
   *   - true/false → override esplicito su questa aula
   *  Quando il valore risolto è false, lo scheduler ghost-cancel non agisce
   *  e la UI nasconde il pulsante "Stampa QR" e il badge "senza check-in". */
  requireCheckIn?: boolean | null;
  /** Aula "high-impact" (sala concerti, auditorium): le prenotazioni di
   *  non-admin nascono in 'pending_approval' e devono essere approvate da
   *  un admin. Default false. */
  requiresApproval?: boolean;
  notes?: string | null;
  /** URL pubblico della foto dell'aula (es. "/storage/room-12-…webp"). Null = usa fallback. */
  photoUrl?: string | null;
  building?: Building;
  equipment?: Equipment[];
}

export type BookingType = 'studio_individuale' | 'lezione' | 'prova' | 'concerto' | 'altro';

/**
 * Catalogo configurabile dei tipi prenotazione (gap #7 EasyRoom parity).
 * I 5 valori `code` corrispondono a `BookingType` ENUM legacy backend; in
 * questa release l'admin può personalizzare label/color/icon/sortOrder/...
 * ma non aggiungere nuovi tipi (richiede migration ENUM formale).
 */
export interface BookingTypeCatalog {
  code: BookingType;
  label: string;
  color: string; // #RRGGBB
  icon: string; // nome icona lucide-react (es. 'GraduationCap', 'Mic', 'Music')
  sortOrder: number;
  isActive: boolean;
  isSystem: boolean;
  defaultDurationMinutes: number | null;
  description: string | null;
}
export type BookingStatus =
  | 'confirmed'
  | 'cancelled'
  | 'completed'
  | 'no_show'
  | 'pending_approval';

export interface Booking {
  id: number;
  userId: number;
  roomId: number;
  startTime: string;
  endTime: string;
  purpose?: string | null;
  type: BookingType;
  status: BookingStatus;
  notes?: string | null;
  cancelledAt?: string | null;
  cancelReason?: string | null;
  /** Sistema check-in / anti ghost-booking. */
  checkedInAt?: string | null;
  autoCancelledAt?: string | null;
  user?: User;
  room?: Room;
  /** Scheda concerto: presente solo per booking type='concerto' con dati salvati. */
  concertInfo?: ConcertInfo | null;
}

export interface ConcertInfo {
  id: number;
  bookingId: number;
  title: string;
  performers?: string | null;
  program?: string | null;
  /** Locandina caricata (formato `/storage/concert-{id}-{ts}.webp`).
   *  Se null la pagina display usa il fallback `/assets/concerto.png` blurato. */
  posterUrl?: string | null;
}

export interface PublicConcert {
  id: number;
  startTime: string;
  endTime: string;
  title: string;
  performers: string;
  program: string;
  posterUrl: string | null;
  room: {
    id: number;
    name: string;
    floor: string;
    building: { id: number; name: string } | null;
  } | null;
}

export interface BookingRule {
  id: number;
  role: Role;
  maxActiveBookings: number;
  maxHoursPerWeek: number;
  maxHoursPerDay: number;
  maxBookingDurationMinutes: number;
  minBookingDurationMinutes: number;
  maxAdvanceDays: number;
  minAdvanceHours: number;
  cancellationDeadlineHours: number;
  minIntervalBetweenBookingsMinutes: number;
  allowRecurring: boolean;
  allowNightHours: boolean;
  allowedStartTime: string;
  allowedEndTime: string;
}

export type BookingRuleExceptionScope = Role | 'all';
export type BookingRuleExceptionKind = 'block' | 'time_window';

export type QuotaScopeKind = 'roomType' | 'equipmentType' | 'room' | 'building' | 'global';

export interface BookingQuota {
  id: number;
  role: Role;
  scopeKind: QuotaScopeKind;
  /**
   * Valore dello scope:
   *   - roomType / equipmentType → codice (es. 'studio', 'pianoforte')
   *   - room / building → id numerico serializzato come stringa
   *   - global → '*'
   */
  scopeValue: string;
  /** 0 = cap settimanale disattivato. Almeno uno dei 4 cap deve essere > 0. */
  maxHoursPerWeek: number;
  maxHoursPerDay: number;
  /** Cap mensile (mese di calendario in cui inizia la booking). 0 = off. */
  maxHoursPerMonth: number;
  /** Cap su numero prenotazioni nello scope (settimana ISO). 0 = off. */
  maxBookings: number;
  /** Giorni della settimana in cui la quota è attiva (0=domenica .. 6=sabato). [] = sempre. */
  daysOfWeek: number[];
  /** Fascia oraria HH:mm. Entrambi NULL = sempre. */
  timeFrom: string | null;
  timeTo: string | null;
  isActive: boolean;
}

export interface AuditLogEntry {
  id: number;
  actorId: number | null;
  action: 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  targetType: string;
  targetId: number | null;
  path: string;
  statusCode: number;
  payload: unknown;
  response: {
    entityId?: number;
    entityKey?: string;
    message?: string;
    code?: string;
    deleted?: number;
  } | null;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
  actor?: {
    id: number;
    firstName: string;
    lastName: string;
    email: string;
    role: Role;
  } | null;
}

export interface BookingWaitlistEntry {
  id: number;
  userId: number;
  roomId: number;
  startTime: string;
  endTime: string;
  position: number;
  type: BookingType;
  purpose?: string | null;
  /** Quando l'utente è stato avvisato che è il suo turno (null = ancora in coda). */
  notifiedAt?: string | null;
  /** Scadenza del claim window (notifiedAt + 30 min). */
  expiresAt?: string | null;
  claimedAt?: string | null;
  cancelledAt?: string | null;
  cancelReason?: string | null;
  room?: Room;
}

export interface BookingRuleException {
  id: number;
  role: BookingRuleExceptionScope;
  name: string;
  kind: BookingRuleExceptionKind;
  daysOfWeek: number[] | null;
  dateFrom: string | null;
  dateTo: string | null;
  startTime: string | null;
  endTime: string | null;
  maxHoursInWindow: number | null;
  isActive: boolean;
  notes: string | null;
  /** Scope per aula: null = vale per tutte le aule (eccezione globale).
   *  Se valorizzato, l'eccezione si applica SOLO alle prenotazioni di
   *  quell'aula. */
  roomId: number | null;
  /** Popolato solo quando il backend ritorna l'include `room`. */
  room?: { id: number; name: string; buildingId: number } | null;
}

export interface OAuthSettings {
  googleEnabled: boolean;
  googleClientId: string;
  googleClientSecretSet: boolean;
  googleCallbackUrl: string;
  microsoftEnabled: boolean;
  microsoftClientId: string;
  microsoftClientSecretSet: boolean;
  microsoftCallbackUrl: string;
  microsoftTenant: string;
}

export interface BookingUsage {
  unlimited: boolean;
  weekly: {
    max: number | null;
    usedHours: number;
    remainingHours: number | null;
    periodFrom: string;
    periodTo: string;
  };
  daily: {
    max: number | null;
    usedHours: number;
    remainingHours: number | null;
  };
}

export interface EquipmentTemplate {
  id: number;
  name: string;
  type: EquipmentType;
}

export type EquipmentType =
  | 'pianoforte'
  | 'pianoforte_a_coda'
  | 'organo'
  | 'clavicembalo'
  | 'leggio'
  | 'amplificatore'
  | 'mixer'
  | 'microfono'
  | 'computer'
  | 'proiettore'
  | 'lavagna'
  | 'sedia'
  | 'altro';

export interface AuthResponse {
  token: string;
  user: User;
}

/** Risposta del login quando l'utente ha 2FA attivo: il backend ha appena
 *  inviato un codice via email; il client deve presentarlo a /2fa/verify
 *  insieme al `tempToken` (TTL 5min). */
export interface LoginNeedsTwoFa {
  needsTwoFa: true;
  tempToken: string;
  /** Email mascherata (es. `mar*****@example.it`) per mostrare all'utente
   *  dove è stato inviato il codice. */
  sentTo: string;
  expiresInMinutes: number;
}

export interface TwoFaStatus {
  enabled: boolean;
  pendingSetup: boolean;
  recoveryCodesRemaining: number;
  activatedAt: string | null;
  /** Email mascherata dell'utente, per UI profilo. */
  email: string;
}

export interface TwoFaSendResponse {
  sentTo: string;
  expiresInMinutes: number;
}

export interface ApiError {
  error: string;
  details?: { field?: string; message: string }[];
  code?: string;
}

// =====================================================
// Modulo Prestiti Strumenti
// =====================================================
export type InstrumentFamily =
  | 'archi'
  | 'fiati_legni'
  | 'fiati_ottoni'
  | 'tastiere'
  | 'percussioni'
  | 'corde'
  | 'voce'
  | 'elettronica'
  | 'altro';

export type InstrumentCondition = 'ottimo' | 'buono' | 'discreto' | 'da_riparare' | 'fuori_uso';

export type LoanStatus = 'requested' | 'active' | 'returned' | 'overdue' | 'rejected';

export interface Instrument {
  id: number;
  code?: string | null;
  name: string;
  family: InstrumentFamily;
  brand?: string | null;
  model?: string | null;
  serialNumber?: string | null;
  condition: InstrumentCondition;
  isLoanable: boolean;
  /** Codici SAD (Course.id) abilitati a richiedere il prestito di questo strumento.
   *  Array vuoto = chiunque (non admin) con corso/profilo completo. */
  allowedCourseIds?: number[];
  notes?: string | null;
  photoUrl?: string | null;
  /** Stato del prestito attualmente in corso/richiesto su questo strumento (lato backend annotato in list). */
  currentLoanStatus?: LoanStatus | null;
  currentLoanUntil?: string | null;
  /** True se l'utente corrente può richiedere questo strumento secondo Instrument.allowedCourseIds (lato backend annotato in list). */
  userAllowedForFamily?: boolean;
  /** Storico/embed: presente quando la singola GET /:id include i prestiti. */
  loans?: InstrumentLoan[];
}

export interface InstrumentLoanUserSummary {
  id: number;
  firstName: string;
  lastName: string;
  email?: string;
  matricola?: string | null;
  role?: Role;
}

export interface InstrumentLoan {
  id: number;
  instrumentId: number;
  userId: number;
  fromDate: string; // YYYY-MM-DD
  toDate: string; // YYYY-MM-DD
  returnedAt?: string | null;
  status: LoanStatus;
  notes?: string | null;
  approvedBy?: number | null;
  approvedAt?: string | null;
  reminderSentAt?: string | null;
  overdueNotifiedAt?: string | null;
  instrument?: Instrument | null;
  user?: InstrumentLoanUserSummary | null;
  approver?: InstrumentLoanUserSummary | null;
}
