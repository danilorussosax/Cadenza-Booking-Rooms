import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderWithProviders, screen, waitFor, fireEvent } from '../../test-utils';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
  Toaster: () => null,
}));

const overviewMock = vi.fn();
const listBuildingCheckInMock = vi.fn();
const setBuildingCheckInMock = vi.fn();

vi.mock('@/api/qrcodes', () => ({
  qrcodesApi: {
    overview: () => overviewMock(),
    imageUrl: (id: number) => `/api/structure/rooms/${id}/qr`,
    regenerate: vi.fn(),
    bulkRegenerate: vi.fn(),
    getCheckInSettings: () =>
      Promise.resolve({
        checkInRequireInstituteNetwork: false,
        instituteNetworkCidrs: [],
        callerIp: null,
      }),
    saveCheckInSettings: vi.fn(),
    listBuildingCheckIn: () => listBuildingCheckInMock(),
    setBuildingCheckIn: (id: number, enabled: boolean) => setBuildingCheckInMock(id, enabled),
  },
}));

// Stub api lib (HttpError isn't used in this test but qrcodes module imports it transitively).
vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return { ...actual };
});

import AdminQrCodes from '@/pages/admin/QrCodes';

const sampleBuildings = [
  {
    id: 1,
    name: 'Sede principale',
    code: 'MAIN',
    checkInDefault: false,
    roomsTotal: 12,
    roomsWithOverride: 2,
  },
  {
    id: 2,
    name: 'Sede distaccata',
    code: null,
    checkInDefault: true,
    roomsTotal: 5,
    roomsWithOverride: 0,
  },
];

const sampleRooms = [
  {
    id: 10,
    name: 'Aula Verdi',
    code: 'V1',
    building: { id: 1, name: 'Sede principale' },
    requireCheckIn: null,
    effectiveCheckIn: false,
    inheritedFromBuilding: true,
    hasQrToken: true,
    qrTokenUpdatedAt: '2025-01-01T10:00:00.000Z',
  },
  {
    id: 11,
    name: 'Aula Rossi',
    code: 'R1',
    building: { id: 1, name: 'Sede principale' },
    requireCheckIn: true,
    effectiveCheckIn: true,
    inheritedFromBuilding: false,
    hasQrToken: true,
    qrTokenUpdatedAt: '2025-01-01T10:00:00.000Z',
  },
  {
    id: 12,
    name: 'Aula Bianchi',
    code: 'B1',
    building: { id: 1, name: 'Sede principale' },
    requireCheckIn: false,
    effectiveCheckIn: false,
    inheritedFromBuilding: false,
    hasQrToken: false,
    qrTokenUpdatedAt: null,
  },
];

describe('<AdminQrCodes /> — BuildingCheckInCard', () => {
  beforeEach(() => {
    listBuildingCheckInMock.mockReset();
    setBuildingCheckInMock.mockReset();
    overviewMock.mockReset();
    listBuildingCheckInMock.mockResolvedValue({ items: sampleBuildings });
    overviewMock.mockResolvedValue({ rooms: sampleRooms });
    setBuildingCheckInMock.mockImplementation((id: number, enabled: boolean) =>
      Promise.resolve({
        building: {
          id,
          name: 'Sede principale',
          code: 'MAIN',
          checkInDefault: enabled,
          roomsTotal: 12,
          roomsWithOverride: 2,
        },
      }),
    );
  });

  it('renderizza la tabella edifici con conta aule e override', async () => {
    renderWithProviders(<AdminQrCodes />);
    expect(
      await screen.findByText(/Check-in per edificio.*impostazione generale/i),
    ).toBeInTheDocument();
    expect(await screen.findByText('Sede principale')).toBeInTheDocument();
    expect(screen.getByText('Sede distaccata')).toBeInTheDocument();
    // roomsTotal di Sede principale
    expect(screen.getByText('12')).toBeInTheDocument();
    // override badge
    expect(screen.getByText(/2 con override/)).toBeInTheDocument();
  });

  it('toggle chiama la mutation setBuildingCheckIn col valore corretto', async () => {
    renderWithProviders(<AdminQrCodes />);
    const toggle = await screen.findByLabelText(/Toggle check-in per Sede principale/i);
    expect(toggle).toBeInTheDocument();
    fireEvent.click(toggle);
    await waitFor(() => {
      expect(setBuildingCheckInMock).toHaveBeenCalledWith(1, true);
    });
  });

  it('mostra badge "Eredita (disattivo)" per aule con requireCheckIn=null', async () => {
    renderWithProviders(<AdminQrCodes />);
    // Attende il rendering di entrambe le card
    await screen.findByText('Sede principale');
    await waitFor(() => {
      // Aula Verdi eredita disattivo
      const inheritBadges = screen.getAllByText(/Eredita \(disattivo\)/i);
      expect(inheritBadges.length).toBeGreaterThanOrEqual(1);
    });
  });

  it('mostra badge "Check-in attivo" e "Check-in non richiesto" su override espliciti', async () => {
    renderWithProviders(<AdminQrCodes />);
    await screen.findByText('Sede principale');
    // I badge sono nella tabella RoomsQrTable (caricata via overviewMock).
    await waitFor(() => {
      // L'aula Rossi ha requireCheckIn=true → badge "Check-in attivo"
      expect(screen.getAllByText(/Check-in attivo/i).length).toBeGreaterThanOrEqual(1);
      // L'aula Bianchi ha requireCheckIn=false → badge "Check-in non richiesto"
      expect(screen.getByText(/Check-in non richiesto/i)).toBeInTheDocument();
    });
  });
});
