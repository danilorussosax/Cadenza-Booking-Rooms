import type { LucideIcon } from 'lucide-react';
import { AlertTriangle, ArrowLeftRight, Boxes, Hourglass, ShieldCheck } from 'lucide-react';
import type { InstrumentCondition, InstrumentFamily, LoanStatus } from '@/types';

export type Tab = 'inventory' | 'all_loans' | 'overdue' | 'expiring' | 'rules';

export interface TabDef {
  value: Tab;
  labelKey: string;
  descriptionKey: string;
  icon: LucideIcon;
  iconColor: string;
  iconBg: string;
}

export const TAB_DEFS: TabDef[] = [
  {
    value: 'inventory',
    labelKey: 'admin.instruments.tabs.inventory',
    descriptionKey: 'admin.instruments.tabs.inventory_description',
    icon: Boxes,
    iconColor: 'text-sky-600 dark:text-sky-400',
    iconBg: 'bg-sky-100 dark:bg-sky-500/15',
  },
  {
    value: 'all_loans',
    labelKey: 'admin.instruments.tabs.all_loans',
    descriptionKey: 'admin.instruments.tabs.all_loans_description',
    icon: ArrowLeftRight,
    iconColor: 'text-violet-600 dark:text-violet-400',
    iconBg: 'bg-violet-100 dark:bg-violet-500/15',
  },
  {
    value: 'overdue',
    labelKey: 'admin.instruments.tabs.overdue',
    descriptionKey: 'admin.instruments.tabs.overdue_description',
    icon: AlertTriangle,
    iconColor: 'text-rose-600 dark:text-rose-400',
    iconBg: 'bg-rose-100 dark:bg-rose-500/15',
  },
  {
    value: 'expiring',
    labelKey: 'admin.instruments.tabs.expiring',
    descriptionKey: 'admin.instruments.tabs.expiring_description',
    icon: Hourglass,
    iconColor: 'text-emerald-600 dark:text-emerald-400',
    iconBg: 'bg-emerald-100 dark:bg-emerald-500/15',
  },
  {
    value: 'rules',
    labelKey: 'admin.instruments.tabs.rules',
    descriptionKey: 'admin.instruments.tabs.rules_description',
    icon: ShieldCheck,
    iconColor: 'text-amber-600 dark:text-amber-400',
    iconBg: 'bg-amber-100 dark:bg-amber-500/15',
  },
];

export const VALID_INSTR_TABS = TAB_DEFS.map((t) => t.value);

export const FAMILY_KEYS: InstrumentFamily[] = [
  'archi',
  'fiati_legni',
  'fiati_ottoni',
  'tastiere',
  'percussioni',
  'corde',
  'voce',
  'elettronica',
  'altro',
];
export const CONDITION_KEYS: InstrumentCondition[] = [
  'ottimo',
  'buono',
  'discreto',
  'da_riparare',
  'fuori_uso',
];

export const STATUS_VARIANT: Record<LoanStatus, 'success' | 'secondary' | 'muted' | 'default'> = {
  requested: 'secondary',
  active: 'success',
  returned: 'muted',
  overdue: 'default',
  rejected: 'muted',
};
