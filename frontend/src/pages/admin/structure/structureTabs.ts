import type { LucideIcon } from 'lucide-react';
import { Building2, Cog } from 'lucide-react';

// Macro-tab in stile pagina /admin/server-settings: card grandi con icona+label,
// active state con bg-background + ring + colore icona acceso, sotto un header
// descrittivo con la stessa estetica.
export type StructureTab = 'sedi' | 'dotazioni';

export interface StructureTabDef {
  value: StructureTab;
  labelKey: string;
  descriptionKey: string;
  icon: LucideIcon;
  iconColor: string;
  iconBg: string;
}

export const STRUCTURE_TABS: StructureTabDef[] = [
  {
    value: 'sedi',
    labelKey: 'admin.structure.tab_sedi',
    descriptionKey: 'admin.structure.tab_sedi_description',
    icon: Building2,
    iconColor: 'text-blue-600 dark:text-blue-400',
    iconBg: 'bg-blue-100 dark:bg-blue-500/15',
  },
  {
    value: 'dotazioni',
    labelKey: 'admin.structure.tab_dotazioni',
    descriptionKey: 'admin.structure.tab_dotazioni_description',
    icon: Cog,
    iconColor: 'text-violet-600 dark:text-violet-400',
    iconBg: 'bg-violet-100 dark:bg-violet-500/15',
  },
];

export const STRUCTURE_VALID_TABS = STRUCTURE_TABS.map((t) => t.value);
