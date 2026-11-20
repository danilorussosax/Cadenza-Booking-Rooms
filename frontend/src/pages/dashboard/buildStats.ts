import {
  CalendarCheck2,
  ClipboardCheck,
  DoorOpen,
  GitPullRequest,
  Hourglass,
  PackageOpen,
  Sparkles,
} from 'lucide-react';
import type { TFunction } from 'i18next';
import type { monteOreApi } from '@/api/monteOre';
import { dayjs, formatDate } from '@/lib/date';
import { monteOreMeetsThreshold } from '@/lib/dashboardData';
import type { Booking, BookingUsage } from '@/types';
import type { StatTile } from './StatTileCard';

type MonteOreThreshold = Awaited<ReturnType<typeof monteOreApi.getMyThreshold>>;

export interface UsageDisplay {
  value: string;
  hint: string;
}

export interface StatsContext {
  t: TFunction;
  isAdmin: boolean;
  isDocente: boolean;
  isDesktop: boolean;
  upcomingCount: number | undefined;
  roomsCount: number | undefined;
  next: Booking | undefined;
  usageLoading: boolean;
  usageDisplay: UsageDisplay;
  hasMonteOreOverride: boolean;
  monteOreThreshold: MonteOreThreshold | undefined;
  monteOrePlanned: number | undefined;
  monteOreLoading: boolean;
  bookingsPending: { loading: boolean; count: number };
  amendmentsPending: { loading: boolean; count: number };
  activeLoansCount: number;
  pendingLoansCount: number;
  showLoansCard: boolean;
}

const TONE_EMERALD = 'bg-emerald-100 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400';
const TONE_AMBER = 'bg-amber-100 text-amber-600 dark:bg-amber-500/15 dark:text-amber-400';
const TONE_FUCHSIA = 'bg-fuchsia-100 text-fuchsia-600 dark:bg-fuchsia-500/15 dark:text-fuchsia-400';

/** Formatta la quota settimanale residua (tile "ore residue") dall'uso corrente. */
export function computeUsageDisplay(usage: BookingUsage | undefined, t: TFunction): UsageDisplay {
  if (!usage) return { value: '—', hint: '' };
  const w = usage.weekly;
  if (usage.unlimited || w.max == null) {
    return {
      value: '∞',
      hint: t('dashboard.stats.weekly_remaining_unlimited', { used: w.usedHours }),
    };
  }
  return {
    value: `${w.remainingHours ?? 0}h`,
    hint: t('dashboard.stats.weekly_remaining_hint', { max: w.max, used: w.usedHours }),
  };
}

/** Costruisce i tile KPI della dashboard in base al ruolo e ai dati caricati. */
export function buildStats(ctx: StatsContext): StatTile[] {
  const { t } = ctx;
  const stats: StatTile[] = [
    {
      label: t('dashboard.stats.active_bookings'),
      value: ctx.upcomingCount ?? '—',
      icon: CalendarCheck2,
      hint: t('dashboard.stats.active_bookings_hint'),
      tone: 'bg-blue-100 text-blue-600 dark:bg-blue-500/15 dark:text-blue-400',
    },
  ];

  const availableRooms: StatTile = {
    label: t('dashboard.stats.available_rooms'),
    value: ctx.roomsCount ?? '—',
    icon: DoorOpen,
    hint: t('dashboard.stats.available_rooms_hint'),
    tone: TONE_EMERALD,
  };

  if (ctx.isAdmin) {
    // Admin layout: 1) Prenotazioni attive, 2) Aule disponibili,
    // 3) Prenotazioni da approvare, 4) Variazioni monte ore. Le ultime due
    // card (cliccabili) puntano alle code di approvazione.
    stats.push(availableRooms);
    stats.push({
      label: t('dashboard.stats.pending_bookings_approvals'),
      value: ctx.bookingsPending.loading ? '—' : ctx.bookingsPending.count,
      icon: ClipboardCheck,
      hint: t('dashboard.stats.pending_bookings_approvals_hint'),
      tone: TONE_AMBER,
      to: '/admin/approvals',
    });
    stats.push({
      label: t('dashboard.stats.pending_amendments'),
      value: ctx.amendmentsPending.loading ? '—' : ctx.amendmentsPending.count,
      icon: GitPullRequest,
      hint: t('dashboard.stats.pending_amendments_hint'),
      tone: TONE_FUCHSIA,
      to: '/admin/monte-ore',
    });
  } else {
    // Tile "ore quota": per docenti con deroga Monte Ore individuale
    // (contratto orario, supplenti, part-time) sostituiamo la quota
    // settimanale di booking — che è meaningless rispetto al monte ore
    // annuale contrattuale — con "Monte Ore: pianificate/soglia".
    const threshold = ctx.monteOreThreshold;
    if (ctx.isDocente && ctx.hasMonteOreOverride && threshold) {
      const minH = threshold.minHours;
      const planned = ctx.monteOrePlanned ?? 0;
      const mode = threshold.mode;
      const meets = monteOreMeetsThreshold(mode, planned, minH);
      const ctLabel: Record<string, string> = {
        titolare: 'titolare',
        contratto_orario: 'contratto orario',
        supplente: 'supplente',
        altro: 'altro',
      };
      const ct = threshold.contractType;
      const ctText = ct ? (ctLabel[ct] ?? 'individuale') : 'individuale';
      stats.push({
        label: 'Monte Ore annuali',
        value: ctx.monteOreLoading ? '—' : `${planned.toFixed(1)} / ${minH} h`,
        icon: Hourglass,
        hint: meets
          ? `✓ Piano conforme · ${ctText}`
          : `Obiettivo${mode === 'maximum' ? ' massimo' : ''}: ${minH} h · ${ctText}`,
        tone: meets ? TONE_EMERALD : TONE_AMBER,
        // Link a /monte-ore solo su desktop: la pagina di planning con
        // tabelle dense non e' gestibile da smartphone. Su mobile il tile
        // mostra lo stato (informativo) ma non e' navigabile.
        to: ctx.isDesktop ? '/monte-ore' : undefined,
      });
    } else {
      stats.push({
        label: t('dashboard.stats.weekly_remaining_hours'),
        value: ctx.usageLoading ? '—' : ctx.usageDisplay.value,
        icon: Hourglass,
        hint:
          ctx.usageDisplay.hint ||
          `${dayjs().startOf('isoWeek').format('D MMM')} – ${dayjs()
            .endOf('isoWeek')
            .format('D MMM')}`,
        tone: TONE_AMBER,
      });
    }
    stats.push(availableRooms);
    stats.push({
      label: t('dashboard.stats.next_session'),
      value: ctx.next ? dayjs(ctx.next.startTime).fromNow() : '—',
      icon: Sparkles,
      hint: ctx.next
        ? formatDate(ctx.next.startTime, 'ddd D MMM, HH:mm')
        : t('dashboard.stats.next_session_none'),
      tone: TONE_FUCHSIA,
    });
  }

  if (ctx.showLoansCard) {
    stats.push({
      label: t('dashboard.stats.active_loans'),
      value: ctx.activeLoansCount,
      icon: PackageOpen,
      hint: t('dashboard.stats.active_loans_hint', { pending: ctx.pendingLoansCount }),
      tone: 'bg-violet-100 text-violet-600 dark:bg-violet-500/15 dark:text-violet-400',
    });
  }

  return stats;
}
