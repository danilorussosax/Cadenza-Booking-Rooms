import { BuildingCheckInCard } from './qrCodes/BuildingCheckInCard';
import { CheckInSecurityCard } from './qrCodes/CheckInSecurityCard';
import { RoomsQrTable } from './qrCodes/RoomsQrTable';

// Pagina admin per la gestione dei QR-code di check-in delle aule + policy
// "check-in solo da rete d'istituto". Inserita come tab dentro
// /admin/server-settings (vedi ServerSettings.tsx).
//
// Sezioni:
//   1. "Sicurezza check-in" — toggle network restriction + CIDR allowlist
//   2. "QR-code per aula" — tabella con preview, regenerate, download, bulk

export default function AdminQrCodes() {
  return (
    <div className="space-y-6">
      <CheckInSecurityCard />
      <BuildingCheckInCard />
      <RoomsQrTable />
    </div>
  );
}
