import { api } from '@/lib/api';
import type { BookingType, PublicConcert, PublicInstitute, Role, RoomType } from '@/types';

export interface PublicBookingUser {
  role: Role;
  displayName: string;
  /** Nome del prenotante. Esposto SOLO per i docenti, usato per disambiguare
   *  cognomi omonimi inserendo l'iniziale tra "Prof." e cognome
   *  ("Prof. M. Rossi" quando esistono più Rossi nella vista corrente). */
  firstName: string | null;
  /** Cognome del prenotante. Esposto al kiosk per costruire "Prof. {cognome}"
   *  nella vista weekly (lezioni docenti). Anonimizzato per studenti. */
  lastName: string | null;
}

export interface PublicBooking {
  id: number;
  startTime: string;
  endTime: string;
  type: BookingType;
  purpose: string | null;
  /** Titolo della scheda concerto, se la booking è di tipo concerto. */
  concertTitle: string | null;
  bookedBy: PublicBookingUser | null;
}

export interface PublicRoom {
  id: number;
  name: string;
  /** Codice aula breve (es. "A.101"). Mostrato come identificativo principale
   *  nella weekly view del kiosk. Null se non configurato. */
  code: string | null;
  floor: string;
  type: RoomType;
  capacity: number;
  bookings: PublicBooking[];
}

export interface PublicBuilding {
  id: number;
  code: string | null;
  name: string;
  floors: string[];
  /** 'weekly' (default) | 'daily' — modalità tabella prenotazioni del kiosk. */
  displayViewMode: 'weekly' | 'daily';
  institute: { id: number; name: string } | null;
  rooms: PublicRoom[];
}

export interface PublicAgenda {
  date: string;
  buildings: PublicBuilding[];
}

export interface PublicStats {
  timestamp: string;
  today: {
    bookings: number;
    inUse: number;
    roomsTotal: number;
    hours: number;
    occupancyPct: number;
  };
  week: { bookings: number; hours: number };
  topRooms: {
    id: number;
    name: string;
    building: string;
    minutes: number;
    count: number;
  }[];
  byType: { type: BookingType; count: number }[];
  bookingsByHour: { hour: number; count: number }[];
  nextConcert: {
    startTime: string;
    endTime: string;
    purpose: string | null;
    room: { name: string; building: string } | null;
  } | null;
}

export interface DisplayConfigBuilding {
  id: number;
  code: string | null;
  name: string;
  intervalSec: number;
  /** Toggle on/off della rotazione concerti per questo edificio. */
  concertsEnabled: boolean;
  /** Finestra (giorni) di anteprima concerti del display per questo edificio. */
  concertsDays: number;
  /** Numero massimo di concerti da mostrare (0 = senza limite). */
  concertsCount: number;
  /** Durata in secondi di una slide concerto sul kiosk. */
  concertsIntervalSec: number;
  /** Master toggle per la rotazione delle prenotazioni di questo edificio. */
  bookingsEnabled: boolean;
  /** Toggle on/off della rotazione annunci sul kiosk. */
  announcementsEnabled: boolean;
  /** Numero massimo di annunci nella rotazione (0 = senza limite). */
  announcementsCount: number;
  /** Durata in secondi di una slide annuncio sul kiosk. */
  announcementsIntervalSec: number;
  /** Mostra solo gli annunci con isPinned=true. */
  announcementsPinnedOnly: boolean;
  /** 'weekly' (default) | 'daily' — modalità tabella prenotazioni del kiosk. */
  viewMode: 'weekly' | 'daily';
}

export interface PublicAnnouncement {
  id: number;
  title: string;
  body: string;
  publishedAt: string;
  expiresAt: string | null;
  isPinned: boolean;
}

export const publicApi = {
  institute: () =>
    api<{ institute: PublicInstitute | null }>('/api/public/institute', { auth: false }),
  agenda: (date?: string) =>
    api<PublicAgenda>('/api/public/agenda', { query: { date }, auth: false }),
  agendaRange: (from: string, to: string) =>
    api<PublicAgenda>('/api/public/agenda', { query: { from, to }, auth: false }),
  stats: () => api<PublicStats>('/api/public/stats', { auth: false }),
  displayConfig: () =>
    api<{ buildings: DisplayConfigBuilding[] }>('/api/public/display-config', { auth: false }),
  concerts: (days: number) =>
    api<{ concerts: PublicConcert[] }>('/api/public/concerts', {
      query: { days },
      auth: false,
    }),
  announcements: (params: { pinned?: boolean; limit?: number; building?: number } = {}) =>
    api<{ announcements: PublicAnnouncement[] }>('/api/public/announcements', {
      query: {
        pinned: params.pinned ? 'true' : undefined,
        limit: params.limit,
        building: params.building,
      },
      auth: false,
    }),
};
