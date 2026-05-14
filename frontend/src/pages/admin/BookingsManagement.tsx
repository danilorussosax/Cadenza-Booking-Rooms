import { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ClipboardList, Scale, Tag, ClipboardCheck } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { bookingsApi } from '@/api/bookings';
import AdminRules from '@/pages/admin/Rules';
import AdminBookingTypes from '@/pages/admin/BookingTypes';
import AdminApprovals from '@/pages/admin/Approvals';

type TabValue = 'rules' | 'booking-types' | 'approvals';
const VALID_TABS: TabValue[] = ['rules', 'booking-types', 'approvals'];

/**
 * Macro pagina "Gestione prenotazioni" che raggruppa in 3 tab le voci
 * precedentemente separate nella sidebar:
 *   - Regole prenotazioni       (/admin/rules)
 *   - Tipi prenotazione         (/admin/booking-types)
 *   - Approvazione prenotazioni (/admin/approvals)
 *
 * Lo stato del tab è persistito via query param `?tab=` per supportare
 * deep-link e bookmark. I vecchi URL `/admin/rules`, `/admin/booking-types`,
 * `/admin/approvals` sono redirezionati qui in App.tsx.
 *
 * Il badge "in sospeso" sulla tab "Approvazioni" rispecchia quello che
 * compariva sulla voce di sidebar dedicata (counter live, refetch 60s).
 */
export default function AdminBookingsManagement() {
  const [searchParams, setSearchParams] = useSearchParams();
  const requested = searchParams.get('tab') as TabValue | null;
  const tab: TabValue = requested && VALID_TABS.includes(requested) ? requested : 'rules';

  // Auto-correzione URL: se il tab richiesto non è valido (manca o invalid),
  // riscrivi il query param. Evita stati ambigui per refresh/back.
  useEffect(() => {
    if (requested !== tab) {
      const next = new URLSearchParams(searchParams);
      next.set('tab', tab);
      setSearchParams(next, { replace: true });
    }
  }, [requested, tab, searchParams, setSearchParams]);

  const pendingQuery = useQuery({
    queryKey: ['admin', 'bookings', 'pending-count'],
    queryFn: () => bookingsApi.pendingCount(),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
  const pendingCount = pendingQuery.data?.count ?? 0;

  const handleTabChange = (value: string) => {
    const next = new URLSearchParams(searchParams);
    next.set('tab', value);
    setSearchParams(next, { replace: false });
  };

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-display text-3xl font-medium inline-flex items-center gap-2">
          <ClipboardList className="h-6 w-6 text-primary" />
          Gestione prenotazioni
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Regole di prenotazione, catalogo tipi e coda di approvazioni — tutto in un unico
          pannello.
        </p>
      </header>

      <Tabs value={tab} onValueChange={handleTabChange}>
        <TabsList className="h-auto flex-wrap justify-start gap-1">
          <TabsTrigger value="rules" className="gap-1.5">
            <Scale className="h-4 w-4" />
            Regole
          </TabsTrigger>
          <TabsTrigger value="booking-types" className="gap-1.5">
            <Tag className="h-4 w-4" />
            Tipi prenotazione
          </TabsTrigger>
          <TabsTrigger value="approvals" className="gap-1.5">
            <ClipboardCheck className="h-4 w-4" />
            Approvazioni
            {pendingCount > 0 && (
              <Badge variant="destructive" className="ml-1 px-1.5 py-0 text-[10px]">
                {pendingCount}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="rules" className="mt-6">
          <AdminRules />
        </TabsContent>
        <TabsContent value="booking-types" className="mt-6">
          <AdminBookingTypes />
        </TabsContent>
        <TabsContent value="approvals" className="mt-6">
          <AdminApprovals />
        </TabsContent>
      </Tabs>
    </div>
  );
}
