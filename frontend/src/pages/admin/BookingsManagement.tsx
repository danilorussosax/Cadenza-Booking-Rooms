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
    <div className="mx-auto max-w-6xl space-y-6">
      <header>
        <h1 className="font-display text-3xl font-medium inline-flex items-center gap-2">
          <ClipboardList className="h-6 w-6 text-primary" />
          Gestione prenotazioni
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Regole di prenotazione, catalogo tipi e coda di approvazioni — tutto in un unico pannello.
        </p>
      </header>

      <Tabs value={tab} onValueChange={handleTabChange}>
        <TabsList className="grid h-auto w-full grid-cols-1 gap-2 bg-transparent p-0 sm:grid-cols-3">
          <TabsTrigger
            value="rules"
            className="group flex h-auto flex-col items-start gap-1 rounded-lg border border-border bg-card p-4 text-left shadow-xs hover:bg-accent data-[state=active]:border-primary data-[state=active]:bg-primary/5 data-[state=active]:shadow-sm"
          >
            <div className="flex items-center gap-2">
              <Scale className="h-5 w-5 text-amber-600 dark:text-amber-400" />
              <span className="text-base font-semibold">Regole</span>
            </div>
            <span className="text-xs text-muted-foreground">
              Policy di prenotazione, finestre, quote
            </span>
          </TabsTrigger>
          <TabsTrigger
            value="booking-types"
            className="group flex h-auto flex-col items-start gap-1 rounded-lg border border-border bg-card p-4 text-left shadow-xs hover:bg-accent data-[state=active]:border-primary data-[state=active]:bg-primary/5 data-[state=active]:shadow-sm"
          >
            <div className="flex items-center gap-2">
              <Tag className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
              <span className="text-base font-semibold">Tipi prenotazione</span>
            </div>
            <span className="text-xs text-muted-foreground">
              Catalogo dei tipi (lezione, prova, concerto…)
            </span>
          </TabsTrigger>
          <TabsTrigger
            value="approvals"
            className="group flex h-auto flex-col items-start gap-1 rounded-lg border border-border bg-card p-4 text-left shadow-xs hover:bg-accent data-[state=active]:border-primary data-[state=active]:bg-primary/5 data-[state=active]:shadow-sm"
          >
            <div className="flex w-full items-center gap-2">
              <ClipboardCheck className="h-5 w-5 text-blue-600 dark:text-blue-400" />
              <span className="text-base font-semibold">Approvazioni</span>
              {pendingCount > 0 && (
                <Badge variant="destructive" className="ml-auto px-2 py-0.5 text-xs font-bold">
                  {pendingCount}
                </Badge>
              )}
            </div>
            <span className="text-xs text-muted-foreground">
              Coda richieste in attesa di approvazione admin
            </span>
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
