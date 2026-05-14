import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import {
  BarChart3,
  BookOpen,
  Building2,
  CalendarCheck,
  CalendarPlus,
  ChevronDown,
  ClipboardList,
  Clock,
  GraduationCap,
  Guitar,
  LayoutDashboard,
  LogOut,
  Megaphone,
  Menu,
  Music4,
  Package,
  PackageOpen,
  Server,
  Users,
  UserRound,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { bookingsApi } from '@/api/bookings';
import { institutesApi } from '@/api/institutes';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Separator } from '@/components/ui/separator';
import { ThemeToggle } from '@/components/ThemeToggle';
import { LanguageToggle } from '@/components/LanguageToggle';
import { AppFooter } from '@/components/AppFooter';
import { MobileBottomNav } from '@/components/layout/MobileBottomNav';
import { ConsentGate } from '@/components/legal/ConsentGate';
import { useAppIcon } from '@/hooks/useAppIcon';
import type { Role } from '@/types';

interface NavItem {
  to: string;
  labelKey: string;
  icon: React.ComponentType<{ className?: string }>;
  roles?: Role[];
}

const NAV: NavItem[] = [
  { to: '/dashboard', labelKey: 'nav.dashboard', icon: LayoutDashboard },
  { to: '/booking', labelKey: 'nav.booking', icon: CalendarPlus },
  { to: '/my-bookings', labelKey: 'nav.my_bookings', icon: ClipboardList },
  // Monte Ore — proposta annuale del docente. Voce visibile a tutti i ruoli
  // approvati: studenti vedranno comunque la pagina (mostra il loro stato
  // "non applicabile" se non sono docenti). Volendo nasconderla ai soli
  // studenti basta filtrare con `roles: ['docente', 'admin']`.
  { to: '/monte-ore', labelKey: 'nav.monte_ore', icon: Clock, roles: ['docente', 'admin'] },
  { to: '/rooms', labelKey: 'nav.rooms', icon: Music4 },
  { to: '/instruments', labelKey: 'nav.instruments', icon: Guitar },
  { to: '/my-loans', labelKey: 'nav.my_loans', icon: PackageOpen },
  // Manuale in-app: ogni utente vede il manuale docente (la pagina filtra
  // poi se l'utente è admin per offrire il toggle al manuale admin).
  { to: '/help/docente', labelKey: 'nav.help', icon: BookOpen },
];

// Sidebar admin riorganizzata nell'ordine logico richiesto:
//   1. Utenti       → gestione anagrafica (chi può accedere)
//   2. Corsi        → catalogo SAD (a cosa appartengono)
//   3. Regole       → policy di prenotazione + quote
//   4. Strutture    → istituti / edifici / aule / equipment
//   5. Inventario   → strumenti e prestiti
// Le voci operative (mail, messaging, display kiosk) e di tracciabilità
// (audit-log, backups) sono raggruppate dentro "Impostazioni Server" —
// un'unica voce con tab interne per ridurre il rumore in sidebar.
const ADMIN_NAV: NavItem[] = [
  { to: '/admin/users', labelKey: 'nav.admin_users', icon: Users, roles: ['admin'] },
  { to: '/admin/courses', labelKey: 'nav.admin_courses', icon: GraduationCap, roles: ['admin'] },
  // Gestione Monte Ore — DOPO i Corsi come richiesto: l'admin/coordinatore
  // approva le proposte annuali dei docenti, riassegna le aule e genera
  // le prenotazioni ricorrenti.
  { to: '/admin/monte-ore', labelKey: 'nav.admin_monte_ore', icon: Clock, roles: ['admin'] },
  // Macro pagina "Gestione prenotazioni" — raggruppa in 3 tab interni le voci
  // precedentemente separate: Regole, Tipi prenotazione, Approvazione
  // prenotazioni. Riduce il rumore in sidebar e mantiene coerenza con il
  // pattern già usato per "Impostazioni Server".
  // I vecchi URL /admin/rules, /admin/booking-types, /admin/approvals sono
  // redirezionati ai rispettivi tab (vedi App.tsx).
  {
    to: '/admin/bookings-management',
    labelKey: 'nav.admin_bookings_management',
    icon: CalendarCheck,
    roles: ['admin'],
  },
  // "Registro attività" — promossa da sub-tab di /admin/audit-log a voce
  // autonoma in sidebar (gestione prenotazioni confermate: ricerca,
  // filtri, bulk-cancel, swap atomico). Posizionata subito dopo
  // "Approvazione prenotazioni" come richiesto.
  {
    to: '/admin/activity-log',
    labelKey: 'nav.admin_activity_log',
    icon: ClipboardList,
    roles: ['admin'],
  },
  { to: '/admin/structure', labelKey: 'nav.admin_structure', icon: Building2, roles: ['admin'] },
  { to: '/admin/instruments', labelKey: 'nav.admin_instruments', icon: Package, roles: ['admin'] },
  { to: '/admin/analytics', labelKey: 'nav.admin_analytics', icon: BarChart3, roles: ['admin'] },
  {
    to: '/admin/announcements',
    labelKey: 'nav.admin_announcements',
    icon: Megaphone,
    roles: ['admin'],
  },
  // "Impostazioni Server" raggruppa: Servizio Posta, Bot Messaging,
  // Registro attività e Backup come tab interne (vedi ServerSettings.tsx).
  {
    to: '/admin/server-settings',
    labelKey: 'nav.admin_server_settings',
    icon: Server,
    roles: ['admin'],
  },
  // Manuale Admin in-app — separato dal Manuale (docente) della sidebar
  // utente. Punta a /help/admin (la pagina filtra anche client-side).
  { to: '/help/admin', labelKey: 'nav.help_admin', icon: BookOpen, roles: ['admin'] },
  // L'import anagrafica Isidata è esposto come riquadro nella pagina
  // "Utenti" (admin/users), accanto alle card di Google/Microsoft OAuth.
  // Manteniamo la rotta `/admin/integrations/isidata` per accesso diretto
  // (deep-link, bookmark) ma niente voce di sidebar — nav minimal.
];

function userInitials(firstName?: string, lastName?: string) {
  return `${firstName?.[0] ?? ''}${lastName?.[0] ?? ''}`.trim() || '?';
}

export function AppLayout() {
  const { user, logout, hasRole } = useAuth();
  const appIcon = useAppIcon();
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useTranslation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);

  // Chiudi entrambi i menu quando cambia rotta. NavLink interno alla sidebar
  // chiama già setMobileOpen(false), ma questo copre anche navigazioni via
  // useNavigate o redirect — evita lo stato "drawer aperto dopo navigation".
  useEffect(() => {
    setMobileOpen(false);
    setUserMenuOpen(false);
  }, [location.pathname]);

  // Quando la viewport diventa desktop (lg breakpoint), chiudi il drawer
  // mobile: senza questo, ridimensionando la finestra mentre il drawer è
  // aperto, il portal Radix resta visibile sopra il layout desktop.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia('(min-width: 1024px)');
    const onChange = (e: MediaQueryListEvent) => {
      if (e.matches) setMobileOpen(false);
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  // Click-outside + ESC per il menu profilo. Sostituisce il backdrop
  // fullscreen che su iOS Safari intercettava il tap sul trigger generando
  // un doppio evento (chiusura + immediata riapertura → menu sempre aperto).
  useEffect(() => {
    if (!userMenuOpen) return;
    const onPointer = (e: PointerEvent) => {
      const el = userMenuRef.current;
      if (el && !el.contains(e.target as Node)) {
        setUserMenuOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setUserMenuOpen(false);
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [userMenuOpen]);

  const { data: instituteData } = useQuery({
    queryKey: ['institute', 'public'],
    queryFn: () => institutesApi.public(),
    staleTime: 5 * 60 * 1000,
  });
  const institute = instituteData?.institute;

  const handleLogout = () => {
    logout();
    void navigate('/login', { replace: true });
  };

  const showAdmin = hasRole('admin');

  // Module flags arrivano dal public-institute endpoint: quando il flag è
  // false la voce di sidebar viene nascosta, ma le rotte e le API restano
  // sempre attive (i bookmark esistenti continuano a funzionare).
  const monteOreEnabled = institute?.moduleMonteOreEnabled ?? true;
  const instrumentLoansEnabled = institute?.moduleInstrumentLoansEnabled ?? true;

  const visibleNav = NAV.filter((n) => {
    if (!monteOreEnabled && n.to === '/monte-ore') return false;
    if (!instrumentLoansEnabled && (n.to === '/instruments' || n.to === '/my-loans')) return false;
    return true;
  });

  const visibleAdminNav = ADMIN_NAV.filter((n) => {
    if (!monteOreEnabled && n.to === '/admin/monte-ore') return false;
    if (!instrumentLoansEnabled && n.to === '/admin/instruments') return false;
    return true;
  });

  // Title from current path (best-effort; pages can also override via document.title)
  const currentItem =
    visibleNav.find((n) => location.pathname.startsWith(n.to)) ??
    visibleAdminNav.find((n) => location.pathname.startsWith(n.to)) ??
    NAV.find((n) => location.pathname.startsWith(n.to)) ??
    ADMIN_NAV.find((n) => location.pathname.startsWith(n.to));

  return (
    <div className="flex min-h-dvh bg-muted/30">
      {/* Skip link (WCAG 2 SC 2.4.1 Bypass Blocks). Visivamente nascosto
       * finché non riceve il focus da tastiera: l'utente che naviga con Tab
       * lo vede come prima cosa e può saltare direttamente al contenuto. */}
      <a
        href="#main-content"
        className="absolute left-2 top-2 z-50 -translate-y-16 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground shadow-md transition-transform focus-visible:translate-y-0 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      >
        {t('common.skip_to_content')}
      </a>
      {/* Sidebar (desktop) */}
      <aside className="hidden w-64 shrink-0 flex-col border-r bg-card lg:flex">
        <SidebarBrand institute={institute} />
        <SidebarNav showAdmin={showAdmin} navItems={visibleNav} adminNavItems={visibleAdminNav} />
        <SidebarFooter user={user} onLogout={handleLogout} />
      </aside>

      {/* Sidebar (mobile) — Radix Sheet: focus trap, scroll-lock, ESC e
       * click-outside gestiti dalla primitive. Risolve i casi in cui due
       * AnimatePresence concorrenti (drawer + page transition) si
       * incastravano lasciando l'overlay in DOM dopo la navigazione. */}
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent
          side="left"
          className="safe-pt safe-pb flex w-72 max-w-[85vw] flex-col gap-0 border-r bg-card p-0 sm:max-w-xs"
        >
          <SidebarBrand institute={institute} compact />
          <SidebarNav
            showAdmin={showAdmin}
            navItems={visibleNav}
            adminNavItems={visibleAdminNav}
            onNavigate={() => {
              setMobileOpen(false);
            }}
          />
          <SidebarFooter user={user} onLogout={handleLogout} />
        </SheetContent>
      </Sheet>

      {/* Main */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Topbar — sticky con safe-area top+laterali per iPhone (notch in
         * portrait E in landscape). `min-h-*` invece di `h-*` perché il
         * `padding-top: env(safe-area-inset-top)` aggiunge altezza variabile
         * sopra il contenuto: con `h-14` fisso il padding "schiacciava" gli
         * elementi interni; `min-h-14` lascia all'header crescere quando il
         * notch è presente, senza mai scendere sotto il minimo. */}
        <header className="safe-pt safe-pl safe-pr sticky top-0 z-30 flex min-h-14 items-center gap-2 border-b bg-background/80 px-3 backdrop-blur-sm sm:min-h-16 sm:gap-3 sm:px-4 lg:min-h-20 lg:px-8">
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden"
            onClick={() => {
              setMobileOpen(true);
            }}
          >
            <Menu className="h-5 w-5" />
          </Button>
          <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
            <div className="hidden h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 ring-1 ring-primary/20 sm:flex sm:h-11 sm:w-11">
              {institute?.logoUrl ? (
                <img
                  src={institute.logoUrl}
                  alt=""
                  className="h-6 w-6 object-contain sm:h-8 sm:w-8"
                />
              ) : (
                <img src={appIcon} alt="" className="h-6 w-6 object-contain sm:h-8 sm:w-8" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p
                className="truncate text-[10px] font-semibold uppercase tracking-wider sm:text-[11px]"
                style={{ color: 'rgb(55 98 170)' }}
              >
                {institute?.name ?? t('app.institute_default')}
              </p>
              <h1 className="truncate font-display text-base font-semibold leading-tight text-foreground sm:text-lg lg:text-xl">
                {currentItem ? t(currentItem.labelKey) : t('app.subtitle')}
              </h1>
            </div>
          </div>

          <LanguageToggle />
          <ThemeToggle />

          {/* User menu — chiusura via click-outside + ESC + cambio rotta
           * (vedi useEffect sopra). Niente backdrop fullscreen perché su
           * iOS Safari intercettava il tap sul trigger generando un doppio
           * evento (chiusura + immediata riapertura del menu). */}
          <div className="relative" ref={userMenuRef}>
            <button
              type="button"
              aria-haspopup="menu"
              aria-expanded={userMenuOpen}
              onClick={() => {
                setUserMenuOpen((s) => !s);
              }}
              className="flex items-center gap-2 rounded-full border bg-card p-1 pl-2 text-left text-sm transition-colors hover:bg-accent"
            >
              <span className="hidden text-right sm:block">
                <span className="block text-sm font-medium leading-tight text-foreground">
                  {user?.firstName}
                </span>
                <span className="block text-xs text-muted-foreground">
                  {user ? t(`roles.${user.role}`) : ''}
                </span>
              </span>
              <Avatar className="h-8 w-8">
                {user?.profilePhotoUrl && <AvatarImage src={user.profilePhotoUrl} alt="" />}
                <AvatarFallback className="bg-primary/10 text-primary">
                  {userInitials(user?.firstName, user?.lastName)}
                </AvatarFallback>
              </Avatar>
              <ChevronDown className="mr-1 h-3.5 w-3.5 text-muted-foreground" />
            </button>
            <AnimatePresence initial={false}>
              {userMenuOpen && (
                <motion.div
                  key="user-menu"
                  role="menu"
                  initial={{ opacity: 0, y: -6, scale: 0.97 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -6, scale: 0.97 }}
                  transition={{ duration: 0.15 }}
                  className="absolute right-0 top-full z-50 mt-2 w-64 overflow-hidden rounded-lg border bg-popover shadow-lg"
                >
                  <div className="border-b p-3">
                    <p className="text-sm font-medium">
                      {user?.firstName} {user?.lastName}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">{user?.email}</p>
                    {user?.matricola && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        {t('profile.account.matricola')} · {user.matricola}
                      </p>
                    )}
                  </div>
                  <Link
                    to="/profile"
                    role="menuitem"
                    onClick={() => {
                      setUserMenuOpen(false);
                    }}
                    className="flex w-full items-center gap-2 border-b px-3 py-2.5 text-sm text-foreground transition-colors hover:bg-accent"
                  >
                    <UserRound className="h-4 w-4" />
                    {t('nav.profile')}
                  </Link>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={handleLogout}
                    className="flex w-full items-center gap-2 px-3 py-2.5 text-sm text-foreground transition-colors hover:bg-accent"
                  >
                    <LogOut className="h-4 w-4" />
                    {t('common.logout')}
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </header>

        {/* Page content — safe-area orizzontale su iPhone landscape (notch laterale).
         * `id="main-content"` è il target dello skip link in cima al layout.
         * `pb-20` riserva spazio per la MobileBottomNav fissa (h-14 + safe-pb);
         * su lg:768+ la bottom-nav si nasconde e il padding torna normale. */}
        <main
          id="main-content"
          tabIndex={-1}
          className="safe-pl safe-pr flex-1 px-3 py-4 pb-24 focus-visible:outline-hidden sm:px-4 sm:py-6 lg:px-8 lg:py-8 lg:pb-8"
        >
          <motion.div
            key={location.pathname}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25, ease: 'easeOut' }}
          >
            <Outlet />
          </motion.div>
        </main>
        <AppFooter className="safe-pb hidden border-t lg:block" />
      </div>
      <MobileBottomNav />
      <ConsentGate />
    </div>
  );
}

function SidebarBrand({
  compact,
}: {
  institute?: { name: string; logoUrl?: string | null } | null;
  compact?: boolean;
}) {
  const appIcon = useAppIcon();
  return (
    <div className={cn('flex items-center gap-3 px-5', compact ? 'py-1' : 'py-5')}>
      <img src={appIcon} alt="Cadenza" className="h-10 w-10 shrink-0 rounded-lg object-contain" />
      <div className="min-w-0 leading-tight">
        <p className="truncate font-display text-lg font-semibold tracking-tight text-primary">
          Cadenza
        </p>
        <p className="truncate text-[11px] leading-tight text-muted-foreground">
          Prenotazione Aule
        </p>
      </div>
    </div>
  );
}

function SidebarNav({
  showAdmin,
  navItems,
  adminNavItems,
  onNavigate,
}: {
  showAdmin: boolean;
  navItems: NavItem[];
  adminNavItems: NavItem[];
  onNavigate?: () => void;
}) {
  const { t } = useTranslation();
  return (
    <nav className="flex-1 overflow-y-auto px-3 py-2">
      <ul className="space-y-1">
        {navItems.map((item) => (
          <NavRow key={item.to} item={item} onNavigate={onNavigate} />
        ))}
      </ul>
      {showAdmin && (
        <>
          <Separator className="my-4" />
          <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            {t('common.administration')}
          </p>
          <AdminNavList items={adminNavItems} onNavigate={onNavigate} />
        </>
      )}
    </nav>
  );
}

/**
 * Render del blocco admin con badge counter sulla voce "Approvazioni":
 * polling ogni 60s di /api/bookings/pending/count, rosso se > 0.
 */
function AdminNavList({ items, onNavigate }: { items: NavItem[]; onNavigate?: () => void }) {
  const pendingQuery = useQuery({
    queryKey: ['admin', 'bookings', 'pending', 'count'],
    queryFn: () => bookingsApi.pendingCount(),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
  const pendingCount = pendingQuery.data?.count ?? 0;
  return (
    <ul className="space-y-1">
      {items.map((item) => (
        <NavRow
          key={item.to}
          item={item}
          onNavigate={onNavigate}
          badge={
            item.to === '/admin/bookings-management' && pendingCount > 0 ? pendingCount : undefined
          }
        />
      ))}
    </ul>
  );
}

function NavRow({
  item,
  onNavigate,
  badge,
}: {
  item: NavItem;
  onNavigate?: () => void;
  badge?: number;
}) {
  const { t } = useTranslation();
  return (
    <li>
      <NavLink
        to={item.to}
        onClick={onNavigate}
        className={({ isActive }) =>
          cn(
            'group flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
            isActive
              ? 'bg-primary/10 text-primary'
              : 'text-muted-foreground hover:bg-accent hover:text-foreground',
          )
        }
      >
        <item.icon className="h-4 w-4" />
        <span className="truncate">{t(item.labelKey)}</span>
        {badge !== undefined && badge > 0 && (
          <span className="ml-auto inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1.5 text-[10px] font-semibold tabular-nums text-destructive-foreground">
            {badge > 99 ? '99+' : badge}
          </span>
        )}
      </NavLink>
    </li>
  );
}

function SidebarFooter({
  user,
  onLogout,
}: {
  user: {
    firstName: string;
    lastName: string;
    role: Role;
    email: string;
    profilePhotoUrl?: string | null;
  } | null;
  onLogout: () => void;
}) {
  const { t } = useTranslation();
  if (!user) return null;
  return (
    <div className="border-t p-4">
      <div className="flex items-center gap-3">
        <Avatar>
          {user.profilePhotoUrl && <AvatarImage src={user.profilePhotoUrl} alt="" />}
          <AvatarFallback className="bg-primary/10 text-primary">
            {userInitials(user.firstName, user.lastName)}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">
            {user.firstName} {user.lastName}
          </p>
          <p className="truncate text-xs text-muted-foreground">{t(`roles.${user.role}`)}</p>
        </div>
        <button
          onClick={onLogout}
          className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          title={t('common.logout')}
        >
          <LogOut className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
