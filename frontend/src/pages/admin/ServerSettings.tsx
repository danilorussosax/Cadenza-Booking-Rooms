import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Bot, ClipboardList, Database, Mail, Monitor, QrCode } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { Card, CardContent } from '@/components/ui/card';
import AdminMailSettings from '@/pages/admin/MailSettings';
import AdminMessagingSettings from '@/pages/admin/MessagingSettings';
import AdminDisplayKiosk from '@/pages/admin/DisplayKiosk';
import AdminQrCodes from '@/pages/admin/QrCodes';
import AdminAuditLog from '@/pages/admin/AuditLog';
import AdminBackups from '@/pages/admin/Backups';

// Macro-tab in stile pagina /admin/rules: card grandi con icona+label,
// active state con bg-background + ring + colore icona acceso, sotto un
// header descrittivo con la stessa estetica.
type ServerTab = 'mail' | 'qrcodes' | 'messaging' | 'display' | 'audit-log' | 'backups';

interface ServerTabDef {
  value: ServerTab;
  labelKey: string;
  descriptionKey: string;
  icon: LucideIcon;
  iconColor: string;
  iconBg: string;
}

const SERVER_TABS: ServerTabDef[] = [
  {
    value: 'mail',
    labelKey: 'nav.admin_mail',
    descriptionKey: 'admin.server_settings.tabs.mail_description',
    icon: Mail,
    iconColor: 'text-blue-600 dark:text-blue-400',
    iconBg: 'bg-blue-100 dark:bg-blue-500/15',
  },
  {
    value: 'qrcodes',
    labelKey: 'admin.server_settings.tabs.qrcodes',
    descriptionKey: 'admin.server_settings.tabs.qrcodes_description',
    icon: QrCode,
    iconColor: 'text-cyan-600 dark:text-cyan-400',
    iconBg: 'bg-cyan-100 dark:bg-cyan-500/15',
  },
  {
    value: 'messaging',
    labelKey: 'nav.admin_messaging',
    descriptionKey: 'admin.server_settings.tabs.messaging_description',
    icon: Bot,
    iconColor: 'text-emerald-600 dark:text-emerald-400',
    iconBg: 'bg-emerald-100 dark:bg-emerald-500/15',
  },
  {
    value: 'display',
    labelKey: 'nav.admin_display',
    descriptionKey: 'admin.server_settings.tabs.display_description',
    icon: Monitor,
    iconColor: 'text-rose-600 dark:text-rose-400',
    iconBg: 'bg-rose-100 dark:bg-rose-500/15',
  },
  {
    value: 'audit-log',
    labelKey: 'nav.admin_audit_log',
    descriptionKey: 'admin.server_settings.tabs.audit_log_description',
    icon: ClipboardList,
    iconColor: 'text-violet-600 dark:text-violet-400',
    iconBg: 'bg-violet-100 dark:bg-violet-500/15',
  },
  {
    value: 'backups',
    labelKey: 'nav.admin_backups',
    descriptionKey: 'admin.server_settings.tabs.backups_description',
    icon: Database,
    iconColor: 'text-amber-600 dark:text-amber-400',
    iconBg: 'bg-amber-100 dark:bg-amber-500/15',
  },
];

const VALID_TABS = SERVER_TABS.map((t) => t.value);

export default function AdminServerSettings() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const initial = params.get('tab');
  const [tab, setTab] = useState<ServerTab>(
    initial && VALID_TABS.includes(initial as ServerTab) ? (initial as ServerTab) : 'mail',
  );
  const activeTab = SERVER_TABS.find((tdef) => tdef.value === tab) ?? SERVER_TABS[0];
  const ActiveIcon = activeTab.icon;

  const onSelect = (next: ServerTab) => {
    setTab(next);
    const newParams = new URLSearchParams(params);
    newParams.set('tab', next);
    setParams(newParams, { replace: true });
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <header className="space-y-1.5">
        <h1 className="font-display text-3xl font-medium">{t('admin.server_settings.title')}</h1>
        <p className="text-sm text-muted-foreground">{t('admin.server_settings.subtitle')}</p>
      </header>

      {/* Strip macro-tab in stile /admin/rules */}
      <div className="grid gap-2 rounded-xl border bg-muted/30 p-1.5 sm:grid-cols-2 lg:grid-cols-6">
        {SERVER_TABS.map((tdef) => {
          const Icon = tdef.icon;
          const isActive = tdef.value === tab;
          return (
            <button
              key={tdef.value}
              type="button"
              onClick={() => {
                onSelect(tdef.value);
              }}
              className={cn(
                'flex flex-col items-start gap-1 rounded-lg px-3 py-2.5 text-left transition-all',
                isActive
                  ? 'bg-background shadow-sm ring-1 ring-border'
                  : 'text-muted-foreground hover:bg-background/60',
              )}
            >
              <Icon className={cn('h-4 w-4', isActive ? tdef.iconColor : '')} />
              <span className={cn('text-sm font-medium', isActive && 'text-foreground')}>
                {t(tdef.labelKey)}
              </span>
            </button>
          );
        })}
      </div>

      {/* Header descrittivo della tab attiva */}
      <Card>
        <CardContent className="flex items-start gap-3 p-4">
          <div className={cn('mt-0.5 rounded-lg p-2', activeTab.iconBg)}>
            <ActiveIcon className={cn('h-4 w-4', activeTab.iconColor)} />
          </div>
          <div className="space-y-0.5">
            <h2 className="font-display text-lg font-medium leading-tight">
              {t(activeTab.labelKey)}
            </h2>
            <p className="text-xs text-muted-foreground">{t(activeTab.descriptionKey)}</p>
          </div>
        </CardContent>
      </Card>

      {/* Contenuti per tab — riusano le pagine esistenti, che restano
          raggiungibili anche dai link diretti (es. /admin/mail) per retro-
          compatibilità con bookmark e link esterni. */}
      <div>
        {tab === 'mail' && <AdminMailSettings />}
        {tab === 'qrcodes' && <AdminQrCodes />}
        {tab === 'messaging' && <AdminMessagingSettings />}
        {tab === 'display' && <AdminDisplayKiosk />}
        {tab === 'audit-log' && <AdminAuditLog />}
        {tab === 'backups' && <AdminBackups />}
      </div>
    </div>
  );
}
