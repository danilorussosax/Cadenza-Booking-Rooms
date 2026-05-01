import { AppIconSection } from '@/components/admin/AppIconSection';
import { CopyrightSection } from '@/components/admin/CopyrightSection';

/**
 * Wrapper della macro "Aspetto" di Impostazioni Server.
 * Raggruppa le configurazioni che governano l'identità visiva dell'app
 * (icona brand) e i testi di copyright nei footer.
 *
 * Le sezioni qui dentro sono admin-only — ServerSettings è già protetto
 * da RequireAdmin a livello di rotta.
 */
export default function AdminAppearanceSettings() {
  return (
    <div className="space-y-6">
      <AppIconSection />
      <CopyrightSection />
    </div>
  );
}
