import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AlertCircle, Edit2, EyeOff, Lock, Plus, Trash2, Users } from 'lucide-react';
import { contractTypesApi, type ContractTypeUpsertPayload } from '@/api/contractTypes';
import type { ContractTypeRow } from '@/types';
import { httpErrorMessage } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { ContractTypeFormDialog } from '@/components/admin/ContractTypeFormDialog';
import { ImpactConfirmDialog } from '@/components/admin/ImpactConfirmDialog';

export function ContractTypesPanel() {
  const qc = useQueryClient();
  const [includeInactive, setIncludeInactive] = useState(false);
  const [editing, setEditing] = useState<ContractTypeRow | null>(null);
  const [creating, setCreating] = useState(false);
  const [pendingImpact, setPendingImpact] = useState<{
    row: ContractTypeRow;
    payload: ContractTypeUpsertPayload;
    usersAffectedCount: number;
  } | null>(null);

  const listQuery = useQuery({
    queryKey: ['contract-types', { includeInactive }],
    queryFn: () => contractTypesApi.list({ includeInactive }),
    staleTime: 30 * 1000,
  });

  const types = listQuery.data?.contractTypes ?? [];

  const createMutation = useMutation({
    mutationFn: (payload: ContractTypeUpsertPayload) => contractTypesApi.create(payload),
    onSuccess: async () => {
      toast.success('Tipologia creata');
      await qc.invalidateQueries({ queryKey: ['contract-types'] });
      setCreating(false);
    },
    onError: (err) => toast.error(httpErrorMessage(err)),
  });

  const updateMutation = useMutation({
    mutationFn: (args: { id: number; payload: ContractTypeUpsertPayload }) =>
      contractTypesApi.update(args.id, args.payload),
    onSuccess: async () => {
      toast.success('Tipologia aggiornata');
      await qc.invalidateQueries({ queryKey: ['contract-types'] });
      setEditing(null);
      setPendingImpact(null);
    },
    onError: async (err: unknown) => {
      // Server può rispondere 409 IMPACT_CONFIRM_REQUIRED → apriamo il dialog
      const errAny = err as {
        status?: number;
        data?: { code?: string; usersAffectedCount?: number };
      };
      if (errAny.status === 409 && errAny.data?.code === 'IMPACT_CONFIRM_REQUIRED' && editing) {
        // Recupera la lista impatto e mostra il dialog
        try {
          const impact = await contractTypesApi.impact(editing.id);
          setPendingImpact({
            row: editing,
            payload: pendingPayload.current ?? {},
            usersAffectedCount: impact.usersAffectedCount,
          });
        } catch {
          toast.error(httpErrorMessage(err));
        }
        return;
      }
      toast.error(httpErrorMessage(err));
    },
  });

  // Cache dell'ultimo payload tentato (per ri-inviarlo dopo conferma impatto)
  const pendingPayload = useMemo(() => ({ current: null as ContractTypeUpsertPayload | null }), []);

  const deleteMutation = useMutation({
    mutationFn: (id: number) => contractTypesApi.remove(id),
    onSuccess: async () => {
      toast.success('Tipologia rimossa');
      await qc.invalidateQueries({ queryKey: ['contract-types'] });
    },
    onError: (err) => toast.error(httpErrorMessage(err)),
  });

  const handleSave = (payload: ContractTypeUpsertPayload) => {
    if (editing) {
      pendingPayload.current = payload;
      updateMutation.mutate({ id: editing.id, payload });
    } else {
      createMutation.mutate(payload);
    }
  };

  const handleConfirmImpact = () => {
    if (!pendingImpact) return;
    updateMutation.mutate({
      id: pendingImpact.row.id,
      payload: { ...pendingImpact.payload, confirmedImpact: true },
    });
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
          <div>
            <CardTitle className="font-display text-xl">Tipologie contrattuali docenti</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              Gestisci i tipi di contratto disponibili (titolare, supplente, contratto orario,
              custom). Ogni tipo può avere una soglia di ore predefinita usata dal Monte Ore quando
              il singolo docente non ha un override individuale.
            </p>
          </div>
          <Button onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" />
            Nuova tipologia
          </Button>
        </CardHeader>
        <CardContent className="pt-0 sm:pt-0">
          <div className="mb-3 flex items-center gap-2">
            <Button
              size="sm"
              variant={includeInactive ? 'outline' : 'default'}
              onClick={() => setIncludeInactive(false)}
            >
              Solo attive
            </Button>
            <Button
              size="sm"
              variant={includeInactive ? 'default' : 'outline'}
              onClick={() => setIncludeInactive(true)}
            >
              <EyeOff className="h-3.5 w-3.5" />
              Mostra disattivate
            </Button>
          </div>

          {listQuery.isLoading ? (
            <Skeleton className="h-48 w-full" />
          ) : listQuery.isError ? (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{httpErrorMessage(listQuery.error)}</AlertDescription>
            </Alert>
          ) : types.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Nessuna tipologia configurata. Clicca "Nuova tipologia" per crearne una.
            </p>
          ) : (
            <>
              {/* Mobile (<sm): card stack */}
              <div className="space-y-2 sm:hidden">
                {types.map((ct) => (
                  <div
                    key={ct.id}
                    className={`rounded-md border bg-card p-3 ${ct.isActive ? '' : 'opacity-60'}`}
                  >
                    <div className="mb-2 flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono text-xs text-muted-foreground">{ct.code}</span>
                          {ct.isSystem && (
                            <Lock
                              className="h-3 w-3 text-muted-foreground"
                              aria-label="Tipo di sistema"
                            />
                          )}
                        </div>
                        <p className="font-medium leading-snug">{ct.label}</p>
                      </div>
                      <div className="flex shrink-0 gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setEditing(ct)}
                          aria-label={`Modifica ${ct.label}`}
                        >
                          <Edit2 className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={ct.isSystem || deleteMutation.isPending}
                          onClick={() => {
                            if (
                              confirm(
                                `Rimuovere "${ct.label}"? L'operazione è bloccata se ci sono docenti che usano questo tipo.`,
                              )
                            ) {
                              deleteMutation.mutate(ct.id);
                            }
                          }}
                          aria-label={`Elimina ${ct.label}`}
                          title={ct.isSystem ? 'Tipo di sistema: solo disattivabile' : 'Elimina'}
                        >
                          <Trash2 className="h-3.5 w-3.5 text-destructive" />
                        </Button>
                      </div>
                    </div>
                    <dl className="grid grid-cols-2 gap-2 text-xs">
                      <div>
                        <dt className="text-muted-foreground">Ore default</dt>
                        <dd className="tabular-nums">
                          {ct.defaultHours == null ? (
                            <span className="text-muted-foreground">—</span>
                          ) : (
                            <>
                              <strong>{ct.defaultHours}</strong>
                              <span className="ml-0.5 text-muted-foreground">h</span>
                            </>
                          )}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">Vincolo giorni</dt>
                        <dd>
                          {ct.bypassDayConstraintDefault ? (
                            <Badge variant="secondary" className="text-xs">
                              Esente 2-4 gg
                            </Badge>
                          ) : (
                            <span className="text-muted-foreground">Standard</span>
                          )}
                        </dd>
                      </div>
                    </dl>
                    <div className="mt-2">
                      {ct.isActive ? (
                        <Badge
                          variant="default"
                          className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-500/15 dark:text-emerald-400"
                        >
                          Attiva
                        </Badge>
                      ) : (
                        <Badge variant="outline">Disattiva</Badge>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {/* Desktop (≥sm): tabella classica */}
              <div className="hidden overflow-x-auto rounded-md border sm:block">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-xs uppercase tracking-wider text-muted-foreground">
                    <tr>
                      <th className="w-32 px-3 py-2 text-left font-medium">Codice</th>
                      <th className="px-3 py-2 text-left font-medium">Etichetta</th>
                      <th className="w-28 px-3 py-2 text-right font-medium">Ore default</th>
                      <th className="w-32 px-3 py-2 text-left font-medium">Vincolo giorni</th>
                      <th className="w-20 px-3 py-2 text-left font-medium">Stato</th>
                      <th className="w-24 px-3 py-2 text-right font-medium">Azioni</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {types.map((ct) => (
                      <tr key={ct.id} className={ct.isActive ? '' : 'opacity-60'}>
                        <td className="px-3 py-2 font-mono text-xs">
                          {ct.code}
                          {ct.isSystem && (
                            <Lock
                              className="ml-1 inline h-3 w-3 text-muted-foreground"
                              aria-label="Tipo di sistema"
                            />
                          )}
                        </td>
                        <td className="px-3 py-2 font-medium">{ct.label}</td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {ct.defaultHours == null ? (
                            <span className="text-muted-foreground">—</span>
                          ) : (
                            <>
                              <strong>{ct.defaultHours}</strong>
                              <span className="ml-0.5 text-xs text-muted-foreground">h</span>
                            </>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          {ct.bypassDayConstraintDefault ? (
                            <Badge variant="secondary" className="text-xs">
                              Esente 2-4 gg
                            </Badge>
                          ) : (
                            <span className="text-xs text-muted-foreground">Standard</span>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          {ct.isActive ? (
                            <Badge
                              variant="default"
                              className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-500/15 dark:text-emerald-400"
                            >
                              Attiva
                            </Badge>
                          ) : (
                            <Badge variant="outline">Disattiva</Badge>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex justify-end gap-1">
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => setEditing(ct)}
                              aria-label={`Modifica ${ct.label}`}
                            >
                              <Edit2 className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={ct.isSystem || deleteMutation.isPending}
                              onClick={() => {
                                if (
                                  confirm(
                                    `Rimuovere "${ct.label}"? L'operazione è bloccata se ci sono docenti che usano questo tipo.`,
                                  )
                                ) {
                                  deleteMutation.mutate(ct.id);
                                }
                              }}
                              aria-label={`Elimina ${ct.label}`}
                              title={
                                ct.isSystem ? 'Tipo di sistema: solo disattivabile' : 'Elimina'
                              }
                            >
                              <Trash2 className="h-3.5 w-3.5 text-destructive" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Alert>
        <Users className="h-4 w-4" />
        <AlertDescription className="text-xs">
          La <strong>cascata Monte Ore</strong> usa: 1) override individuale del docente · 2) ore
          default di questa tipologia · 3) impostazioni istituzionali per AA · 4) fallback CCNL
          324h. Quando modifichi le <strong>ore default</strong> di un tipo già in uso, il sistema
          mostra un dialog di conferma con la lista dei docenti impattati.
        </AlertDescription>
      </Alert>

      {(creating || editing) && (
        <ContractTypeFormDialog
          open={creating || !!editing}
          editing={editing}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSave={handleSave}
          saving={createMutation.isPending || updateMutation.isPending}
        />
      )}

      {pendingImpact && (
        <ImpactConfirmDialog
          contractType={pendingImpact.row}
          newDefaultHours={pendingImpact.payload.defaultHours ?? null}
          onCancel={() => setPendingImpact(null)}
          onConfirm={handleConfirmImpact}
          confirming={updateMutation.isPending}
        />
      )}
    </div>
  );
}
