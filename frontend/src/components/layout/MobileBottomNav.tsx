import { NavLink } from 'react-router-dom';
import { CalendarPlus, ClipboardList, LayoutDashboard, UserRound } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';

interface NavEntry {
  to: string;
  labelKey: string;
  icon: React.ComponentType<{ className?: string }>;
}

// Le 4 destinazioni più frequenti per studenti/docenti. Limit 5 da skill
// rule `bottom-nav-limit` (Material Design). Le sezioni admin restano
// nel drawer hamburger — bottom-nav è "top-level only" (skill rule
// `bottom-nav-top-level`). Ogni voce ha icona + label come da
// `nav-label-icon` (icon-only nav riduce discoverability).
const ENTRIES: NavEntry[] = [
  { to: '/dashboard', labelKey: 'nav.dashboard', icon: LayoutDashboard },
  { to: '/booking', labelKey: 'nav.booking', icon: CalendarPlus },
  { to: '/my-bookings', labelKey: 'nav.my_bookings', icon: ClipboardList },
  { to: '/profile', labelKey: 'nav.profile', icon: UserRound },
];

/**
 * Tab bar mobile fissa in fondo (sotto sm:768 si nasconde su lg:1024+
 * dove la sidebar è visibile). Riduce a 1 tap le destinazioni più usate
 * — prima richiedevano 3 tap (hamburger → drawer → voce).
 *
 * Skill rules: `tab-bar-ios` + `bottom-nav-limit ≤5` + `nav-label-icon`
 * + `nav-state-active` (NavLink applica `aria-current=page`) +
 * `safe-area-awareness` (safe-pb per iOS home indicator).
 */
export function MobileBottomNav() {
  const { t } = useTranslation();

  return (
    <nav
      aria-label={t('nav.primary_label')}
      className="safe-pb fixed inset-x-0 bottom-0 z-30 grid grid-cols-4 border-t bg-background/95 backdrop-blur-sm lg:hidden"
    >
      {ENTRIES.map((entry) => {
        const Icon = entry.icon;
        return (
          <NavLink
            key={entry.to}
            to={entry.to}
            end={entry.to === '/dashboard'}
            className={({ isActive }) =>
              cn(
                'flex min-h-[56px] flex-col items-center justify-center gap-0.5 px-2 py-1.5 text-[11px] font-medium transition-colors',
                isActive
                  ? 'text-primary'
                  : 'text-muted-foreground hover:text-foreground active:text-foreground',
              )
            }
          >
            {({ isActive }) => (
              <>
                <Icon className={cn('h-5 w-5 shrink-0', isActive && 'stroke-[2.25]')} />
                <span className="truncate">{t(entry.labelKey)}</span>
              </>
            )}
          </NavLink>
        );
      })}
    </nav>
  );
}
