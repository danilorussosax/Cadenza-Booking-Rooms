import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  LoaderCircle,
  Save,
  Plus,
  Trash2,
  Users as UsersIcon,
  RefreshCw,
  ListChecks,
  ShieldCheck,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { oauthSettingsApi } from '@/api/oauthSettings';
import {
  groupRoleMapApi,
  usersOverviewApi,
  type GroupRoleMapRule,
  type TenantGroup,
  type UserOverviewRow,
  type CadenzaRole,
} from '@/api/groupRoleMap';

const ROLES: CadenzaRole[] = ['admin', 'docente', 'studente'];
const SELECT_CLS =
  'h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring';

const STATO_BADGE: Record<UserOverviewRow['stato'], { label: string; cls: string }> = {
  allineato: { label: '✓ allineato', cls: 'bg-emerald-100 text-emerald-800' },
  disallineato: { label: '⚠ disallineato', cls: 'bg-amber-100 text-amber-800' },
  non_mappato: { label: '— non mappato', cls: 'bg-muted text-muted-foreground' },
};

interface GateForm {
  groupGateEnabled: boolean;
  groupStudenti: string;
  groupDocenti: string;
  groupAmministrazione: string;
  groupDirezione: string;
}

export function OAuthGroupGateSection() {
  const [gate, setGate] = useState<GateForm | null>(null);
  const [savingGate, setSavingGate] = useState(false);

  const [rules, setRules] = useState<GroupRoleMapRule[]>([]);
  const [tenantGroups, setTenantGroups] = useState<TenantGroup[] | null>(null);
  const [loadingMap, setLoadingMap] = useState(true);
  const [savingMap, setSavingMap] = useState(false);

  const [users, setUsers] = useState<UserOverviewRow[] | null>(null);
  const [loadingUsers, setLoadingUsers] = useState(true);

  useEffect(() => {
    oauthSettingsApi
      .get()
      .then(({ settings: s }) =>
        setGate({
          groupGateEnabled: s.groupGateEnabled,
          groupStudenti: s.groupStudenti,
          groupDocenti: s.groupDocenti,
          groupAmministrazione: s.groupAmministrazione,
          groupDirezione: s.groupDirezione,
        }),
      )
      .catch(() => toast.error('Errore nel caricamento delle impostazioni gate'));
  }, []);

  useEffect(() => {
    groupRoleMapApi
      .get()
      .then((d) => {
        setRules(d.rules);
        setTenantGroups(d.tenantGroups);
      })
      .catch(() => toast.error('Errore nel caricamento del mapping'))
      .finally(() => setLoadingMap(false));
  }, []);

  const loadUsers = useCallback(() => {
    setLoadingUsers(true);
    usersOverviewApi
      .list()
      .then((d) => setUsers(d.users))
      .catch(() => toast.error('Errore nel caricamento utenti'))
      .finally(() => setLoadingUsers(false));
  }, []);

  useEffect(() => loadUsers(), [loadUsers]);

  const setGateField = <K extends keyof GateForm>(k: K, v: GateForm[K]) =>
    setGate((g) => (g ? { ...g, [k]: v } : g));

  const saveGate = async () => {
    if (!gate) return;
    setSavingGate(true);
    try {
      const { restartRequired } = await oauthSettingsApi.update(gate);
      toast.success(
        restartRequired
          ? 'Salvato. Riavvio richiesto per applicare lo scope OAuth.'
          : 'Impostazioni gate salvate.',
      );
    } catch {
      toast.error('Errore nel salvataggio del gate');
    } finally {
      setSavingGate(false);
    }
  };

  const updateRule = (i: number, patch: Partial<GroupRoleMapRule>) =>
    setRules((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const addRule = () =>
    setRules((rs) => [
      ...rs,
      { groupId: null, groupDisplayName: '', role: 'docente', priority: 100 },
    ]);
  const removeRule = (i: number) => setRules((rs) => rs.filter((_, idx) => idx !== i));

  const saveMap = async () => {
    if (rules.some((r) => !r.groupDisplayName.trim())) {
      toast.error('Ogni riga deve avere un gruppo');
      return;
    }
    setSavingMap(true);
    try {
      await groupRoleMapApi.update(rules);
      toast.success('Mapping salvato — attivo al prossimo login');
      loadUsers();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Errore nel salvataggio del mapping');
    } finally {
      setSavingMap(false);
    }
  };

  const realign = async (email: string) => {
    try {
      await usersOverviewApi.realign(email);
      toast.success(`Ruolo riallineato per ${email}`);
      loadUsers();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Errore nel riallineamento');
    }
  };

  return (
    <Card className="mt-3">
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-3 font-display text-lg">
          <span className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-blue-600 dark:text-blue-400" />
            Gate gruppi Microsoft 365
          </span>
          {gate?.groupGateEnabled ? (
            <Badge variant="secondary">Attivo</Badge>
          ) : (
            <Badge variant="muted">Disattivo</Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6 pt-0 sm:pt-0">
        {/* Toggle + nomi gruppo (seed) */}
        {gate && (
          <div className="space-y-3">
            <div className="flex items-center justify-between rounded-md border p-3">
              <div className="space-y-0.5">
                <Label className="text-sm font-medium">Abilita gate gruppi</Label>
                <p className="text-xs text-muted-foreground">
                  Dopo il login M365 il ruolo è derivato dai gruppi (priority più bassa vince).
                  Cambiare questo toggle richiede un riavvio (cambia lo scope OAuth). Le credenziali
                  email restano sempre attive.
                </p>
              </div>
              <Switch
                checked={gate.groupGateEnabled}
                onCheckedChange={(v) => setGateField('groupGateEnabled', v)}
                aria-label="Abilita gate gruppi M365"
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {(
                [
                  ['groupDirezione', 'Direzione → admin (prio 1)'],
                  ['groupAmministrazione', 'Amministrazione → admin (prio 2)'],
                  ['groupDocenti', 'Docenti → docente (prio 4)'],
                  ['groupStudenti', 'Studenti → studente (prio 5)'],
                ] as [keyof GateForm, string][]
              ).map(([k, label]) => (
                <div key={k} className="space-y-1.5">
                  <Label>{label}</Label>
                  <Input
                    value={String(gate[k])}
                    disabled={!gate.groupGateEnabled}
                    onChange={(e) => setGateField(k, e.target.value)}
                  />
                </div>
              ))}
            </div>
            <div className="flex justify-end">
              <Button type="button" size="sm" onClick={saveGate} disabled={savingGate}>
                {savingGate ? (
                  <LoaderCircle className="h-4 w-4 animate-spin" />
                ) : (
                  <Save className="h-4 w-4" />
                )}
                Salva gate
              </Button>
            </div>
          </div>
        )}

        {/* Parte A — tabella mapping editabile */}
        <div className="border-t pt-5">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="flex items-center gap-2 font-semibold">
              <ListChecks className="h-4 w-4 text-primary" /> Allineamento gruppi ↔ ruoli
            </h3>
            <Button size="sm" onClick={saveMap} disabled={savingMap}>
              {savingMap ? (
                <LoaderCircle className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              Salva mapping
            </Button>
          </div>
          <p className="mb-3 text-xs text-muted-foreground">
            Mapping fine gruppo M365 → ruolo Cadenza (vince la priority più bassa). Se vuoto si
            usano i nomi gruppo sopra.
            {tenantGroups === null && (
              <span className="mt-1 block text-amber-700 dark:text-amber-400">
                ⚠ Elenco gruppi del tenant non disponibile (manca il consenso{' '}
                <code className="font-mono">Group.Read.All</code> o le credenziali Microsoft):
                inserisci il nome a mano.
              </span>
            )}
          </p>

          {loadingMap ? (
            <div className="flex justify-center py-6">
              <LoaderCircle className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="px-2 py-2 font-medium">Gruppo M365</th>
                    <th className="px-2 py-2 font-medium">Ruolo</th>
                    <th className="px-2 py-2 font-medium">Priority</th>
                    <th className="px-2 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {rules.map((r, i) => (
                    <tr key={i} className="border-b align-middle">
                      <td className="px-2 py-2">
                        {tenantGroups ? (
                          <select
                            className={SELECT_CLS}
                            value={r.groupId ?? ''}
                            onChange={(e) => {
                              const g = tenantGroups.find((t) => t.id === e.target.value);
                              updateRule(i, {
                                groupId: g?.id ?? null,
                                groupDisplayName: g?.displayName ?? '',
                              });
                            }}
                          >
                            <option value="">— seleziona —</option>
                            {tenantGroups.map((g) => (
                              <option key={g.id} value={g.id}>
                                {g.displayName}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <Input
                            value={r.groupDisplayName}
                            onChange={(e) =>
                              updateRule(i, { groupDisplayName: e.target.value, groupId: null })
                            }
                            placeholder="displayName gruppo"
                          />
                        )}
                      </td>
                      <td className="px-2 py-2">
                        <select
                          className={SELECT_CLS}
                          value={r.role}
                          onChange={(e) => updateRule(i, { role: e.target.value as CadenzaRole })}
                        >
                          {ROLES.map((role) => (
                            <option key={role} value={role}>
                              {role}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-2 py-2">
                        <Input
                          type="number"
                          min={1}
                          className="w-20"
                          value={r.priority}
                          onChange={(e) => updateRule(i, { priority: Number(e.target.value) || 1 })}
                        />
                      </td>
                      <td className="px-2 py-2 text-right">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => removeRule(i)}
                          title="Rimuovi"
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                  {rules.length === 0 && (
                    <tr>
                      <td colSpan={4} className="px-2 py-4 text-center text-muted-foreground">
                        Nessuna regola — verranno usati i nomi gruppo di default.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          <Button size="sm" variant="outline" onClick={addRule} className="mt-3 gap-1.5">
            <Plus className="h-4 w-4" /> Aggiungi regola
          </Button>
        </div>

        {/* Parte B — utenti reali */}
        <div className="border-t pt-5">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="flex items-center gap-2 font-semibold">
              <UsersIcon className="h-4 w-4 text-primary" /> Utenti e ruolo risolto
            </h3>
            <Button size="sm" variant="outline" onClick={loadUsers} className="gap-1.5">
              <RefreshCw className="h-3.5 w-3.5" /> Aggiorna
            </Button>
          </div>

          {loadingUsers ? (
            <div className="flex justify-center py-6">
              <LoaderCircle className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="px-2 py-2 font-medium">Utente</th>
                    <th className="px-2 py-2 font-medium">Gruppi M365</th>
                    <th className="px-2 py-2 font-medium">Ruolo (DB)</th>
                    <th className="px-2 py-2 font-medium">Ruolo risolto</th>
                    <th className="px-2 py-2 font-medium">Stato</th>
                    <th className="px-2 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {(users ?? []).map((u) => (
                    <tr key={u.email} className="border-b align-top">
                      <td className="px-2 py-2">
                        <div className="font-medium">{u.nome}</div>
                        <div className="text-xs text-muted-foreground">{u.email}</div>
                      </td>
                      <td className="px-2 py-2 text-xs">
                        {u.m365Groups.length ? (
                          u.m365Groups.join(', ')
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-2 py-2">{u.role}</td>
                      <td className="px-2 py-2">
                        {u.roleRisolto ?? <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="px-2 py-2">
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs ${STATO_BADGE[u.stato].cls}`}
                        >
                          {STATO_BADGE[u.stato].label}
                        </span>
                      </td>
                      <td className="px-2 py-2 text-right">
                        {u.stato === 'disallineato' && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => realign(u.email)}
                            title="Forza riallineamento"
                          >
                            <RefreshCw className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                  {users?.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-2 py-4 text-center text-muted-foreground">
                        Nessun utente.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
