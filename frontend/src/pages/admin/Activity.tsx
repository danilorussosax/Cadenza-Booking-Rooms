import { CalendarRange } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { AdminBookingsContent } from '@/pages/admin/Bookings';

/**
 * /admin/activity-log — "Registro attività" indipendente in sidebar.
 *
 * Mostra le prenotazioni confermate future con filtri, ricerca, selezione
 * multipla e operazioni bulk (cancel + swap atomico). Era una sub-tab
 * "Approvazioni" dentro /admin/audit-log; promossa a pagina autonoma per
 * dargli dignità nel menu (dopo "Approvazione prenotazioni").
 *
 * La gestione del log immutabile (audit append-only) vive ora in
 * /admin/audit-log → "Registro Log" (tab dentro Impostazioni Server).
 */
export default function AdminActivityLog() {
  const { t } = useTranslation();
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <header className="space-y-1.5">
        <h1 className="font-display text-3xl font-medium inline-flex items-center gap-2">
          <CalendarRange className="h-6 w-6 text-primary" />
          {t('admin.activity.title')}
        </h1>
        <p className="text-sm text-muted-foreground">{t('admin.activity.subtitle')}</p>
      </header>
      <AdminBookingsContent />
    </div>
  );
}
