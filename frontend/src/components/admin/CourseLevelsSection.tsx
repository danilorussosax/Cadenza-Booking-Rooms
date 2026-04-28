import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'framer-motion';
import { GraduationCap, Pencil, Plus, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { courseLevelsApi } from '@/api/courseLevels';
import { httpErrorMessage } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Checkbox } from '@/components/ui/checkbox';
import { CourseLevelFormDialog } from './CourseLevelFormDialog';
import { ConfirmDeleteDialog } from './ConfirmDeleteDialog';
import type { CourseLevelEntity } from '@/types';

export function CourseLevelsSection() {
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [editTarget, setEditTarget] = useState<CourseLevelEntity | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CourseLevelEntity | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [bulkConfirm, setBulkConfirm] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());

  const query = useQuery({
    queryKey: ['course-levels'],
    queryFn: () => courseLevelsApi.list(),
  });

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const items = query.data?.levels ?? [];

  const visibleIds = useMemo(() => items.map((i) => i.id), [items]);
  const visibleSelectedCount = visibleIds.filter((id) => selected.has(id)).length;
  const allVisibleSelected = visibleIds.length > 0 && visibleSelectedCount === visibleIds.length;
  const someVisibleSelected = visibleSelectedCount > 0 && !allVisibleSelected;

  const toggleOne = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAllVisible = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) for (const id of visibleIds) next.delete(id);
      else for (const id of visibleIds) next.add(id);
      return next;
    });
  };

  const clearSelection = () => {
    setSelected(new Set());
  };

  const deleteMutation = useMutation({
    mutationFn: (id: number) => courseLevelsApi.remove(id),
    onSuccess: () => {
      toast.success('Livello eliminato');
      void qc.invalidateQueries({ queryKey: ['course-levels'] });
      setDeleteTarget(null);
    },
    onError: (err) => {
      setDeleteError(httpErrorMessage(err));
    },
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: () => courseLevelsApi.bulkDelete(Array.from(selected)),
    onSuccess: ({ deleted }) => {
      toast.success(`${deleted} ${deleted === 1 ? 'livello eliminato' : 'livelli eliminati'}`);
      void qc.invalidateQueries({ queryKey: ['course-levels'] });
      setBulkConfirm(false);
      clearSelection();
    },
    onError: (err) => {
      setBulkError(httpErrorMessage(err));
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-display text-xl font-semibold">Catalogo livelli</h2>
          <p className="text-xs text-muted-foreground">
            Definisce i livelli di studio disponibili (Triennio, Biennio, Master, …) usati nei corsi
            e nei filtri.
          </p>
        </div>
        <Button
          onClick={() => {
            setCreating(true);
          }}
        >
          <Plus className="h-4 w-4" />
          Nuovo livello
        </Button>
      </div>

      <AnimatePresence initial={false}>
        {selected.size > 0 && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.18 }}
            className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-primary/30 bg-primary/5 px-4 py-2.5"
          >
            <p className="text-sm">
              <span className="font-semibold">{selected.size}</span>{' '}
              {selected.size === 1 ? 'livello selezionato' : 'livelli selezionati'}
            </p>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={clearSelection}>
                <X className="h-4 w-4" />
                Deseleziona
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => {
                  setBulkError(null);
                  setBulkConfirm(true);
                }}
              >
                <Trash2 className="h-4 w-4" />
                Elimina selezionati
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/50 text-left text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="w-10 px-4 py-3">
                  <Checkbox
                    checked={
                      allVisibleSelected ? true : someVisibleSelected ? 'indeterminate' : false
                    }
                    onCheckedChange={toggleAllVisible}
                    aria-label="Seleziona tutti i livelli"
                  />
                </th>
                <th className="w-20 px-4 py-3 font-medium">Ord.</th>
                <th className="px-4 py-3 font-medium">Codice</th>
                <th className="px-4 py-3 font-medium">Nome visualizzato</th>
                <th className="px-4 py-3 text-right font-medium">Azioni</th>
              </tr>
            </thead>
            <tbody>
              {query.isLoading &&
                [0, 1, 2].map((i) => (
                  <tr key={i} className="border-b last:border-0">
                    <td className="px-4 py-3" colSpan={5}>
                      <Skeleton className="h-8 w-full" />
                    </td>
                  </tr>
                ))}
              {!query.isLoading && items.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-12 text-center">
                    <GraduationCap className="mx-auto mb-2 h-8 w-8 text-muted-foreground" />
                    <p className="text-sm font-medium">Nessun livello</p>
                    <p className="text-xs text-muted-foreground">
                      Crea il primo livello di studio.
                    </p>
                  </td>
                </tr>
              )}
              {items.map((lvl) => {
                const isSelected = selected.has(lvl.id);
                return (
                  <motion.tr
                    key={lvl.id}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className={`border-b last:border-0 ${isSelected ? 'bg-primary/5' : ''}`}
                  >
                    <td className="px-4 py-3">
                      <Checkbox
                        checked={isSelected}
                        onCheckedChange={() => {
                          toggleOne(lvl.id);
                        }}
                        aria-label={`Seleziona ${lvl.name}`}
                      />
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{lvl.sortOrder}</td>
                    <td className="px-4 py-3 font-mono text-xs uppercase">{lvl.code}</td>
                    <td className="px-4 py-3 font-medium">{lvl.name}</td>
                    <td className="px-4 py-3 text-right">
                      <div className="inline-flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          title="Modifica"
                          onClick={() => {
                            setEditTarget(lvl);
                          }}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          title="Elimina"
                          onClick={() => {
                            setDeleteError(null);
                            setDeleteTarget(lvl);
                          }}
                          className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </td>
                  </motion.tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <CourseLevelFormDialog open={creating} onOpenChange={setCreating} />
      <CourseLevelFormDialog
        open={!!editTarget}
        onOpenChange={(o) => !o && setEditTarget(null)}
        level={editTarget}
      />
      <ConfirmDeleteDialog
        open={!!deleteTarget}
        onOpenChange={(o) => {
          if (!o) {
            setDeleteTarget(null);
            setDeleteError(null);
          }
        }}
        title={`Eliminare il livello "${deleteTarget?.name}"?`}
        description="I corsi che riferiscono questo livello continueranno a esistere ma il codice non sarà più valido nel catalogo."
        loading={deleteMutation.isPending}
        error={deleteError}
        onConfirm={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
      />
      <ConfirmDeleteDialog
        open={bulkConfirm}
        onOpenChange={(o) => {
          if (!o) {
            setBulkConfirm(false);
            setBulkError(null);
          }
        }}
        title={`Eliminare ${selected.size} ${selected.size === 1 ? 'livello' : 'livelli'}?`}
        description="I corsi che riferiscono questi livelli continueranno a esistere ma i codici non saranno più presenti nel catalogo."
        confirmLabel={`Elimina ${selected.size}`}
        loading={bulkDeleteMutation.isPending}
        error={bulkError}
        onConfirm={() => {
          bulkDeleteMutation.mutate();
        }}
      />
    </div>
  );
}
