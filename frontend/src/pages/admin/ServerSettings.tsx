import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Bot,
  ClipboardList,
  Cog,
  Database,
  FileSpreadsheet,
  Inbox,
  Mail,
  Monitor,
  Palette,
  QrCode,
  ToggleLeft,
} from 'lucide-react';
import type { ComponentType } from 'react';
import type { LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { Card, CardContent } from '@/components/ui/card';
import AdminMailSettings from '@/pages/admin/MailSettings';
import AdminMailOutbox from '@/pages/admin/MailOutbox';
import AdminMessagingSettings from '@/pages/admin/MessagingSettings';
import AdminDisplayKiosk from '@/pages/admin/DisplayKiosk';
import AdminQrCodes from '@/pages/admin/QrCodes';
import { AuditLogPanel } from '@/pages/admin/AuditLog';
import AdminBackups from '@/pages/admin/Backups';
import AdminExcelExport from '@/pages/admin/ExcelExport';
import AdminModules from '@/pages/admin/Modules';
import AdminAppearanceSettings from '@/pages/admin/AppearanceSettings';

// Macro-area in stile pagina /admin/rules: card grandi con icona+label.
// Da v2.4 introduciamo un raggruppamento "Servizi" che contiene i 3 servizi
// di backend (Posta, Bot Messaging, Backup) come sotto-tab. Le altre voci
// restano top-level. URL: ?tab=<macro>[&sub=<subTab>].

// ─────────────────────────────────────────────────────────────────────────
// Type definitions
// ─────────────────────────────────────────────────────────────────────────

type SubTabValue = 'mail' | 'mail-outbox' | 'messaging' | 'backups' | 'excel-export';
type MacroValue = 'servizi' | 'aspetto' | 'qrcodes' | 'display' | 'audit-log' | 'modules';

interface SubTabDef {
  value: SubTabValue;
  labelKey: string;
  descriptionKey: string;
  icon: LucideIcon;
  iconColor: string;
  iconBg: string;
  Component: ComponentType;
}

interface MacroDef {
  value: MacroValue;
  labelKey: string;
  descriptionKey: string;
  icon: LucideIcon;
  iconColor: string;
  iconBg: string;
  /** Macro con singolo contenuto (no sub-tabs). */
  Component?: ComponentType;
  /** Macro raggruppata: contiene sub-tab navigabili. */
  subTabs?: SubTabDef[];
}

// ─────────────────────────────────────────────────────────────────────────
// Sub-tabs della macro "Servizi"
// ─────────────────────────────────────────────────────────────────────────

const SERVIZI_SUBTABS: SubTabDef[] = [
  {
    value: 'mail',
    labelKey: 'nav.admin_mail',
    descriptionKey: 'admin.server_settings.tabs.mail_description',
    icon: Mail,
    iconColor: 'text-blue-600 dark:text-blue-400',
    iconBg: 'bg-blue-100 dark:bg-blue-500/15',
    Component: AdminMailSettings,
  },
  {
    value: 'mail-outbox',
    labelKey: 'nav.admin_mail_outbox',
    descriptionKey: 'admin.server_settings.tabs.mail_outbox_description',
    icon: Inbox,
    iconColor: 'text-cyan-600 dark:text-cyan-400',
    iconBg: 'bg-cyan-100 dark:bg-cyan-500/15',
    Component: AdminMailOutbox,
  },
  {
    value: 'messaging',
    labelKey: 'nav.admin_messaging',
    descriptionKey: 'admin.server_settings.tabs.messaging_description',
    icon: Bot,
    iconColor: 'text-emerald-600 dark:text-emerald-400',
    iconBg: 'bg-emerald-100 dark:bg-emerald-500/15',
    Component: AdminMessagingSettings,
  },
  {
    value: 'backups',
    labelKey: 'nav.admin_backups',
    descriptionKey: 'admin.server_settings.tabs.backups_description',
    icon: Database,
    iconColor: 'text-amber-600 dark:text-amber-400',
    iconBg: 'bg-amber-100 dark:bg-amber-500/15',
    Component: AdminBackups,
  },
  {
    value: 'excel-export',
    labelKey: 'admin.server_settings.tabs.excel_export',
    descriptionKey: 'admin.server_settings.tabs.excel_export_description',
    icon: FileSpreadsheet,
    iconColor: 'text-green-600 dark:text-green-400',
    iconBg: 'bg-green-100 dark:bg-green-500/15',
    Component: AdminExcelExport,
  },
];

// ─────────────────────────────────────────────────────────────────────────
// Macro-tab top-level
// ─────────────────────────────────────────────────────────────────────────

const SERVER_MACROS: MacroDef[] = [
  {
    value: 'servizi',
    labelKey: 'admin.server_settings.tabs.servizi',
    descriptionKey: 'admin.server_settings.tabs.servizi_description',
    icon: Cog,
    iconColor: 'text-indigo-600 dark:text-indigo-400',
    iconBg: 'bg-indigo-100 dark:bg-indigo-500/15',
    subTabs: SERVIZI_SUBTABS,
  },
  {
    value: 'aspetto',
    labelKey: 'admin.server_settings.tabs.aspetto',
    descriptionKey: 'admin.server_settings.tabs.aspetto_description',
    icon: Palette,
    iconColor: 'text-pink-600 dark:text-pink-400',
    iconBg: 'bg-pink-100 dark:bg-pink-500/15',
    Component: AdminAppearanceSettings,
  },
  {
    value: 'qrcodes',
    labelKey: 'admin.server_settings.tabs.qrcodes',
    descriptionKey: 'admin.server_settings.tabs.qrcodes_description',
    icon: QrCode,
    iconColor: 'text-cyan-600 dark:text-cyan-400',
    iconBg: 'bg-cyan-100 dark:bg-cyan-500/15',
    Component: AdminQrCodes,
  },
  {
    value: 'display',
    labelKey: 'nav.admin_display',
    descriptionKey: 'admin.server_settings.tabs.display_description',
    icon: Monitor,
    iconColor: 'text-rose-600 dark:text-rose-400',
    iconBg: 'bg-rose-100 dark:bg-rose-500/15',
    Component: AdminDisplayKiosk,
  },
  {
    value: 'audit-log',
    labelKey: 'nav.admin_audit_log',
    descriptionKey: 'admin.server_settings.tabs.audit_log_description',
    icon: ClipboardList,
    iconColor: 'text-violet-600 dark:text-violet-400',
    iconBg: 'bg-violet-100 dark:bg-violet-500/15',
    Component: AuditLogPanel,
  },
  {
    value: 'modules',
    labelKey: 'admin.server_settings.tabs.modules',
    descriptionKey: 'admin.server_settings.tabs.modules_description',
    icon: ToggleLeft,
    iconColor: 'text-sky-600 dark:text-sky-400',
    iconBg: 'bg-sky-100 dark:bg-sky-500/15',
    Component: AdminModules,
  },
];

const VALID_MACROS = SERVER_MACROS.map((m) => m.value);
const VALID_SUBTABS_SERVIZI = SERVIZI_SUBTABS.map((s) => s.value);

// Backward-compat: i bookmark vecchi avevano ?tab=mail / messaging / backups.
// Li rerouter-iamo nella macro "servizi" mantenendo il sub-tab.
function resolveLegacyTab(raw: string | null): { macro: MacroValue; sub?: SubTabValue } {
  if (!raw) return { macro: 'servizi', sub: 'mail' };
  if (VALID_SUBTABS_SERVIZI.includes(raw as SubTabValue)) {
    return { macro: 'servizi', sub: raw as SubTabValue };
  }
  if (VALID_MACROS.includes(raw as MacroValue)) {
    return { macro: raw as MacroValue };
  }
  return { macro: 'servizi', sub: 'mail' };
}

// ─────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────

export default function AdminServerSettings() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const initialResolved = resolveLegacyTab(params.get('tab') ?? params.get('sub'));
  const initialSubFromUrl = params.get('sub');

  const [macro, setMacro] = useState<MacroValue>(initialResolved.macro);
  const [subTab, setSubTab] = useState<SubTabValue>(() => {
    if (initialSubFromUrl && VALID_SUBTABS_SERVIZI.includes(initialSubFromUrl as SubTabValue)) {
      return initialSubFromUrl as SubTabValue;
    }
    return initialResolved.sub ?? 'mail';
  });

  const activeMacro = SERVER_MACROS.find((m) => m.value === macro) ?? SERVER_MACROS[0];
  const activeSubTab =
    activeMacro.subTabs?.find((s) => s.value === subTab) ?? activeMacro.subTabs?.[0];

  const onSelectMacro = (next: MacroValue) => {
    setMacro(next);
    const newParams = new URLSearchParams(params);
    newParams.set('tab', next);
    // Quando si lascia "servizi" rimuoviamo il sub; quando si entra ci mettiamo
    // il sub corrente (default mail).
    const target = SERVER_MACROS.find((m) => m.value === next);
    if (target?.subTabs) {
      newParams.set('sub', subTab);
    } else {
      newParams.delete('sub');
    }
    setParams(newParams, { replace: true });
  };

  const onSelectSubTab = (next: SubTabValue) => {
    setSubTab(next);
    const newParams = new URLSearchParams(params);
    newParams.set('tab', macro);
    newParams.set('sub', next);
    setParams(newParams, { replace: true });
  };

  // Header descrittivo: per le macro semplici usa la macro stessa, per
  // "servizi" mostra il sotto-servizio attivo (più informativo per l'admin).
  const headerDef =
    activeMacro.subTabs && activeSubTab
      ? {
          labelKey: activeSubTab.labelKey,
          descriptionKey: activeSubTab.descriptionKey,
          icon: activeSubTab.icon,
          iconColor: activeSubTab.iconColor,
          iconBg: activeSubTab.iconBg,
        }
      : {
          labelKey: activeMacro.labelKey,
          descriptionKey: activeMacro.descriptionKey,
          icon: activeMacro.icon,
          iconColor: activeMacro.iconColor,
          iconBg: activeMacro.iconBg,
        };
  const HeaderIcon = headerDef.icon;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <header className="space-y-1.5">
        <h1 className="font-display text-3xl font-medium">{t('admin.server_settings.title')}</h1>
        <p className="text-sm text-muted-foreground">{t('admin.server_settings.subtitle')}</p>
      </header>

      {/* Strip macro-tab (top-level) */}
      <div className="grid gap-2 rounded-xl border bg-muted/30 p-1.5 sm:grid-cols-2 lg:grid-cols-6">
        {SERVER_MACROS.map((mdef) => {
          const Icon = mdef.icon;
          const isActive = mdef.value === macro;
          return (
            <button
              key={mdef.value}
              type="button"
              onClick={() => {
                onSelectMacro(mdef.value);
              }}
              className={cn(
                'flex items-center gap-2 rounded-lg px-3 py-2.5 text-left transition-all',
                isActive
                  ? 'bg-background shadow-xs ring-1 ring-border'
                  : 'text-muted-foreground hover:bg-background/60',
              )}
            >
              <Icon className={cn('h-4 w-4', isActive ? mdef.iconColor : '')} />
              <span className={cn('text-sm font-medium', isActive && 'text-foreground')}>
                {t(mdef.labelKey)}
              </span>
            </button>
          );
        })}
      </div>

      {/* Sub-tab strip (visibile solo quando la macro attiva ne ha) */}
      {activeMacro.subTabs && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/20 p-1">
          <span className="px-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            {t(activeMacro.labelKey)}
          </span>
          {activeMacro.subTabs.map((sdef) => {
            const Icon = sdef.icon;
            const isActive = sdef.value === subTab;
            return (
              <button
                key={sdef.value}
                type="button"
                onClick={() => {
                  onSelectSubTab(sdef.value);
                }}
                className={cn(
                  'inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm transition-all',
                  isActive
                    ? 'bg-background font-medium shadow-xs ring-1 ring-border'
                    : 'text-muted-foreground hover:bg-background/70',
                )}
              >
                <Icon className={cn('h-3.5 w-3.5', isActive ? sdef.iconColor : '')} />
                <span className={cn(isActive && 'text-foreground')}>{t(sdef.labelKey)}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* Header descrittivo */}
      <Card>
        <CardContent className="flex items-center gap-3 p-4">
          <div className={cn('rounded-lg p-2', headerDef.iconBg)}>
            <HeaderIcon className={cn('h-4 w-4', headerDef.iconColor)} />
          </div>
          <div className="space-y-0.5">
            <h2 className="font-display text-lg font-medium leading-tight">
              {t(headerDef.labelKey)}
            </h2>
            <p className="text-xs text-muted-foreground">{t(headerDef.descriptionKey)}</p>
          </div>
        </CardContent>
      </Card>

      {/* Contenuto attivo */}
      <div>
        {activeMacro.subTabs ? (
          activeSubTab && <activeSubTab.Component />
        ) : activeMacro.Component ? (
          <activeMacro.Component />
        ) : null}
      </div>
    </div>
  );
}
