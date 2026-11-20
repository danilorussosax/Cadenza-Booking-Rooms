import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { QuotasManager } from '@/components/admin/QuotasManager';
import { LoanQuotasManager } from '@/components/admin/LoanQuotasManager';
import { Card, CardContent } from '@/components/ui/card';
import type { Role } from '@/types';

import { ROLES, MACRO_TABS, type MacroTab } from './rules/constants';
import { RuleEditor } from './rules/RuleEditor';
import { ExceptionsTopLevel } from './rules/ExceptionsTopLevel';

export default function AdminRules() {
  const { t } = useTranslation();
  const [macroTab, setMacroTab] = useState<MacroTab>('roles');
  const [roleTab, setRoleTab] = useState<Role>('studente');

  const activeTab = MACRO_TABS.find((tdef) => tdef.value === macroTab) ?? MACRO_TABS[0];
  const ActiveIcon = activeTab.icon;

  return (
    <div className="space-y-6">
      <header className="space-y-1.5">
        <h1 className="font-display text-3xl font-medium">Regole di prenotazione</h1>
        <p className="text-sm text-muted-foreground">
          Imposta i limiti per ciascun ruolo e configura le quote dinamiche per aule e prestiti.
        </p>
      </header>

      {/* Strip macro a 4 tab — versione "tab principali con titolo dentro".
          Render manuale (no shadcn TabsList sottile): card grandi con
          icona+colore per dare prominenza a ciascuna macro-area. */}
      <div className="grid gap-2 rounded-xl border bg-muted/30 p-1.5 sm:grid-cols-2 lg:grid-cols-4">
        {MACRO_TABS.map((tdef) => {
          const Icon = tdef.icon;
          const isActive = tdef.value === macroTab;
          return (
            <button
              key={tdef.value}
              type="button"
              onClick={() => {
                setMacroTab(tdef.value);
              }}
              className={`flex items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-center transition-all ${
                isActive
                  ? 'bg-background shadow-xs ring-1 ring-border'
                  : 'text-muted-foreground hover:bg-background/60'
              }`}
            >
              <Icon className={`h-4 w-4 ${isActive ? tdef.iconColor : ''}`} />
              <span className={`text-sm font-medium ${isActive ? 'text-foreground' : ''}`}>
                {t(tdef.labelKey)}
              </span>
            </button>
          );
        })}
      </div>

      {/* Header descrittivo della macro tab attiva (il "titolo dentro" che
          chiede l'utente: ogni tab ha la sua intestazione contestuale). */}
      <Card>
        <CardContent className="flex items-center gap-3 p-4 sm:p-6">
          <div className={`rounded-lg p-2 ${activeTab.iconBg}`}>
            <ActiveIcon className={`h-4 w-4 ${activeTab.iconColor}`} />
          </div>
          <div className="space-y-0.5">
            <h2 className="font-display text-lg font-medium leading-tight">
              {t(activeTab.labelKey)}
            </h2>
            <p className="text-xs text-muted-foreground">{t(activeTab.descriptionKey)}</p>
          </div>
        </CardContent>
      </Card>

      {/* Contenuti per macro tab */}
      {macroTab === 'roles' && (
        <div className="space-y-4">
          {/* Toggle ruolo prominente: 3 button affiancati grandi al posto
              della inner tabs sottile. Le tab "per ruolo" diventano
              chiaramente più visibili come da richiesta. */}
          <div className="grid gap-2 sm:grid-cols-3">
            {ROLES.map((r) => {
              const RIcon = r.icon;
              const isActive = r.value === roleTab;
              return (
                <button
                  key={r.value}
                  type="button"
                  onClick={() => {
                    setRoleTab(r.value);
                  }}
                  className={`flex items-center gap-2 rounded-lg border px-4 py-3 text-left transition-all ${
                    isActive
                      ? 'border-primary bg-primary/5 ring-1 ring-primary/20'
                      : 'bg-background hover:border-primary/40'
                  }`}
                >
                  <RIcon className={`h-4 w-4 ${r.iconColor}`} />
                  <span className="text-sm font-medium">{r.label}</span>
                </button>
              );
            })}
          </div>

          <RuleEditor role={roleTab} help={ROLES.find((r) => r.value === roleTab)?.help ?? ''} />
        </div>
      )}

      {macroTab === 'quotas' && <QuotasManager />}
      {macroTab === 'loan-quotas' && <LoanQuotasManager />}
      {macroTab === 'exceptions' && <ExceptionsTopLevel />}
    </div>
  );
}
