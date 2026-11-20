import { useCallback, useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { institutesApi } from '@/api/institutes';
import { structureApi } from '@/api/structure';
import { httpErrorMessage } from '@/lib/api';
import {
  deriveAnnouncementsCfg,
  deriveConcertsCfg,
  type AnnouncementsCfg,
  type ConcertsCfg,
} from '@/lib/displayKioskConfig';
import {
  buildBuildingPatch,
  deriveBookingsCfg,
  isAnnouncementsDirty,
  isConcertsDirty,
  isRowChanged,
  rowFromBuilding,
  type BookingsCfg,
  type RowState,
} from '@/lib/displayKioskForm';
import { qk } from '@/lib/queryKeys';
import type { Building } from '@/types';

const DEFAULT_CONCERTS: ConcertsCfg = { enabled: true, days: 30, count: 0, intervalSec: 15 };
const DEFAULT_ANNOUNCEMENTS: AnnouncementsCfg = {
  enabled: true,
  count: 5,
  intervalSec: 12,
  pinnedOnly: false,
};

/** Stato del form admin del kiosk: edifici, righe, card globali, dirty e salvataggio. */
export function useDisplayKioskForm() {
  const { t } = useTranslation();
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: qk.institutes.full(),
    queryFn: () => institutesApi.listFull(),
  });

  const buildings: Building[] = useMemo(() => {
    const all: Building[] = [];
    for (const inst of query.data?.institutes ?? []) {
      for (const b of inst.buildings) all.push(b);
    }
    return all.sort((a, b) => a.name.localeCompare(b.name));
  }, [query.data]);

  // Stato locale per ogni riga della tabella edifici (toggle rotazione + durata)
  const [rows, setRows] = useState<Record<number, RowState | undefined>>({});
  const [bookings, setBookings] = useState<BookingsCfg>({ enabled: true });
  const [bookingsBaseline, setBookingsBaseline] = useState<BookingsCfg>({ enabled: true });
  const [concerts, setConcerts] = useState<ConcertsCfg>(DEFAULT_CONCERTS);
  const [concertsBaseline, setConcertsBaseline] = useState<ConcertsCfg>(DEFAULT_CONCERTS);
  const [announcements, setAnnouncements] = useState<AnnouncementsCfg>(DEFAULT_ANNOUNCEMENTS);
  const [announcementsBaseline, setAnnouncementsBaseline] =
    useState<AnnouncementsCfg>(DEFAULT_ANNOUNCEMENTS);

  useEffect(() => {
    const next: Record<number, RowState> = {};
    for (const b of buildings) next[b.id] = rowFromBuilding(b);
    setRows(next);
    const bcfg = deriveBookingsCfg(buildings);
    setBookings(bcfg);
    setBookingsBaseline(bcfg);
    const cfg = deriveConcertsCfg(buildings);
    setConcerts(cfg);
    setConcertsBaseline(cfg);
    const acfg = deriveAnnouncementsCfg(buildings);
    setAnnouncements(acfg);
    setAnnouncementsBaseline(acfg);
  }, [buildings]);

  /** Aggiorna parzialmente la riga di un edificio (no-op se la riga non esiste). */
  const updateRow = useCallback((id: number, patch: Partial<RowState>) => {
    setRows((s) => {
      const cur = s[id];
      return cur ? { ...s, [id]: { ...cur, ...patch } } : s;
    });
  }, []);

  const bookingsDirty = bookings.enabled !== bookingsBaseline.enabled;
  const concertsDirty = useMemo(
    () => isConcertsDirty(concerts, concertsBaseline),
    [concerts, concertsBaseline],
  );
  const announcementsDirty = useMemo(
    () => isAnnouncementsDirty(announcements, announcementsBaseline),
    [announcements, announcementsBaseline],
  );
  const tableDirty = useMemo(
    () =>
      buildings.some((b) => {
        const r = rows[b.id];
        return r !== undefined && isRowChanged(r, b);
      }),
    [buildings, rows],
  );

  const dirty = bookingsDirty || concertsDirty || announcementsDirty || tableDirty;

  const saveMutation = useMutation({
    mutationFn: async () => {
      const updates: Promise<unknown>[] = [];
      for (const b of buildings) {
        const row = rows[b.id];
        if (!row) continue;
        // Quando una delle card globali è "dirty" propaghiamo i valori a
        // tutti gli edifici, indipendentemente dalla riga tabella.
        if (!(isRowChanged(row, b) || bookingsDirty || concertsDirty || announcementsDirty)) {
          continue;
        }
        updates.push(
          structureApi.updateBuilding(
            b.id,
            buildBuildingPatch(b, {
              row,
              bookings,
              concerts,
              announcements,
              bookingsDirty,
              concertsDirty,
              announcementsDirty,
            }),
          ),
        );
      }
      await Promise.all(updates);
    },
    onSuccess: () => {
      toast.success(t('admin.display.saved'));
      void qc.invalidateQueries({ queryKey: qk.institutes.all() });
    },
    onError: (err) => toast.error(httpErrorMessage(err)),
  });

  return {
    isLoading: query.isLoading,
    buildings,
    rows,
    updateRow,
    bookings,
    setBookings,
    concerts,
    setConcerts,
    announcements,
    setAnnouncements,
    dirty,
    saveMutation,
  };
}
