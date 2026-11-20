import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, Clock, DoorOpen, Pencil, Plus, Trash2, Users as UsersIcon } from 'lucide-react';
import { toast } from 'sonner';
import { rulesApi, type OverlapBooking } from '@/api/rules';
import { httpErrorMessage } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import type { BookingRuleException, BookingRuleExceptionScope } from '@/types';
import { qk } from '@/lib/queryKeys';
import { invalidateRuleExceptions } from '@/lib/invalidation';
import { exceptionSummary, roleLabel } from '@/lib/ruleExceptions';

import { ExceptionDialog } from './ExceptionDialog';
import { OverlapDialog } from './OverlapDialog';
import { useTranslation } from 'react-i18next';

/**
 * `role` opzionale: se omesso, mostra TUTTE le eccezioni (admin only —
 * comportamento gestito da rulesApi.listExceptions / route backend).
 * Il default per il dialog di creazione è 'all' quando si è in vista globale.
 */
export function ExceptionsSection({
  role,
  roomId,
}: {
  role?: BookingRuleExceptionScope;
  roomId?: number;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [editing, setEditing] = useState<BookingRuleException | null>(null);
  const [creating, setCreating] = useState(false);
  // Stato del dialog "sovrapposizioni storiche": mostrato dopo il salvataggio
  // di un'eccezione kind='block' che intercetta prenotazioni preesistenti.
  const [overlapState, setOverlapState] = useState<{
    exception: BookingRuleException;
    overlapping: OverlapBooking[];
  } | null>(null);

  const query = useQuery({
    queryKey: qk.rules.exceptionsFor(role ?? 'every', roomId ?? 'every'),
    queryFn: () => rulesApi.listExceptions({ role, roomId }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => rulesApi.deleteException(id),
    onSuccess: () => {
      toast.success(t('toasts.rules.exception_deleted'));
      void invalidateRuleExceptions(qc);
    },
    onError: (err) => toast.error(httpErrorMessage(err)),
  });

  const exceptions = query.data?.exceptions ?? [];

  return (
    <div className="space-y-3 border-t pt-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Eccezioni
          </p>
          <p className="text-xs text-muted-foreground">
            Blocchi e limitazioni aggiuntive su giorni o fasce orarie specifici. Si applicano in
            aggiunta alle regole sopra.
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          onClick={() => {
            setCreating(true);
          }}
        >
          <Plus className="h-4 w-4" />
          Aggiungi eccezione
        </Button>
      </div>

      {query.isLoading ? (
        <Skeleton className="h-24 w-full" />
      ) : exceptions.length === 0 ? (
        <div className="rounded-lg border border-dashed bg-muted/30 px-4 py-6 text-center text-sm text-muted-foreground">
          Nessuna eccezione configurata.
        </div>
      ) : (
        <ul className="space-y-2">
          {exceptions.map((exc) => (
            <li
              key={exc.id}
              className="flex flex-col gap-2 rounded-lg border bg-background p-3 sm:flex-row sm:items-start sm:justify-between"
            >
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  {exc.kind === 'block' ? (
                    <Badge variant="destructive" className="gap-1">
                      <Ban className="h-3 w-3" />
                      Blocco
                    </Badge>
                  ) : (
                    <Badge variant="secondary" className="gap-1">
                      <Clock className="h-3 w-3" />
                      Max {exc.maxHoursInWindow}h
                    </Badge>
                  )}
                  <Badge variant={exc.role === 'all' ? 'default' : 'muted'} className="gap-1">
                    <UsersIcon className="h-3 w-3" />
                    {exc.role === 'all' ? 'Tutti' : roleLabel(exc.role)}
                  </Badge>
                  {exc.roomId != null && (
                    <Badge
                      variant="muted"
                      className="gap-1 border-violet-300 bg-violet-50 text-violet-700 dark:border-violet-500/40 dark:bg-violet-500/10 dark:text-violet-300"
                    >
                      <DoorOpen className="h-3 w-3" />
                      {exc.room?.name ?? `Aula #${exc.roomId}`}
                    </Badge>
                  )}
                  {!exc.isActive && <Badge variant="muted">Disattivata</Badge>}
                  <p className="text-sm font-medium">{exc.name}</p>
                </div>
                <p className="text-xs text-muted-foreground">{exceptionSummary(exc)}</p>
                {exc.notes && <p className="text-xs text-muted-foreground italic">{exc.notes}</p>}
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  title="Modifica"
                  onClick={() => {
                    setEditing(exc);
                  }}
                  className="text-blue-600 hover:bg-blue-50 hover:text-blue-700 dark:text-blue-400 dark:hover:bg-blue-500/10"
                >
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  title="Elimina"
                  className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                  onClick={() => {
                    if (
                      window.confirm(t('toasts.rules.exception_delete_confirm', { name: exc.name }))
                    ) {
                      deleteMutation.mutate(exc.id);
                    }
                  }}
                  disabled={deleteMutation.isPending}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <ExceptionDialog
        open={creating || !!editing}
        existing={editing}
        defaultRole={role ?? 'all'}
        defaultRoomId={roomId}
        onClose={() => {
          setCreating(false);
          setEditing(null);
        }}
        onSaved={(saved, overlapping) => {
          if (saved.kind === 'block' && overlapping.length > 0) {
            setOverlapState({ exception: saved, overlapping });
          }
        }}
      />

      <OverlapDialog
        state={overlapState}
        onClose={() => {
          setOverlapState(null);
        }}
        onCancelled={() => {
          void invalidateRuleExceptions(qc);
        }}
      />
    </div>
  );
}
