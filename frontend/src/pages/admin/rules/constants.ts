import {
  BookMarked,
  CalendarRange,
  Gauge,
  GraduationCap,
  Package,
  ShieldCheck,
  Users as UsersIcon,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { Role } from '@/types';

export const ROLES: {
  value: Role;
  label: string;
  help: string;
  icon: LucideIcon;
  iconColor: string;
}[] = [
  {
    value: 'studente',
    label: 'Studenti',
    help: 'Limiti applicati agli studenti.',
    icon: GraduationCap,
    iconColor: 'text-blue-600 dark:text-blue-400',
  },
  {
    value: 'docente',
    label: 'Docenti',
    help: 'Limiti applicati ai docenti.',
    icon: BookMarked,
    iconColor: 'text-amber-600 dark:text-amber-400',
  },
  {
    value: 'admin',
    label: 'Amministratori',
    help: 'Limiti opzionali per gli admin.',
    icon: ShieldCheck,
    iconColor: 'text-emerald-600 dark:text-emerald-400',
  },
];

export type MacroTab = 'roles' | 'quotas' | 'loan-quotas' | 'exceptions';

export interface MacroTabDef {
  value: MacroTab;
  labelKey: string;
  icon: LucideIcon;
  iconColor: string;
  iconBg: string;
  descriptionKey: string;
}

export const MACRO_TABS: MacroTabDef[] = [
  {
    value: 'roles',
    labelKey: 'admin.rules.tabs.by_role',
    icon: UsersIcon,
    iconColor: 'text-blue-600 dark:text-blue-400',
    iconBg: 'bg-blue-100 dark:bg-blue-500/15',
    descriptionKey: 'admin.rules.tabs.by_role_description',
  },
  {
    value: 'quotas',
    labelKey: 'admin.rules.tabs.quotas',
    icon: Gauge,
    iconColor: 'text-amber-600 dark:text-amber-400',
    iconBg: 'bg-amber-100 dark:bg-amber-500/15',
    descriptionKey: 'admin.rules.tabs.quotas_description',
  },
  {
    value: 'loan-quotas',
    labelKey: 'admin.rules.tabs.loan_quotas',
    icon: Package,
    iconColor: 'text-purple-600 dark:text-purple-400',
    iconBg: 'bg-purple-100 dark:bg-purple-500/15',
    descriptionKey: 'admin.rules.tabs.loan_quotas_description',
  },
  {
    value: 'exceptions',
    labelKey: 'admin.rules.tabs.exceptions',
    icon: CalendarRange,
    iconColor: 'text-rose-600 dark:text-rose-400',
    iconBg: 'bg-rose-100 dark:bg-rose-500/15',
    descriptionKey: 'admin.rules.tabs.exceptions_description',
  },
];
