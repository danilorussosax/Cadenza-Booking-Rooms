import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'framer-motion';
import { Cog, Download, FileUp, Pencil, Plus, Search, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { EQUIPMENT_TYPE_OPTIONS, structureApi } from '@/api/structure';
import { httpErrorMessage } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { EquipmentTemplateFormDialog } from './EquipmentTemplateFormDialog';
import { EquipmentTemplatesCsvImportDialog } from './EquipmentTemplatesCsvImportDialog';
import { ConfirmDeleteDialog } from './ConfirmDeleteDialog';
import type { EquipmentTemplate } from '@/types';

const TYPE_LABEL: Record<string, string> = Object.fromEntries(
  EQUIPMENT_TYPE_OPTIONS.map((o) => [o.value, o.label]),
);

export function EquipmentTemplatesSection() {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
  const [editTarget, setEditTarget] = useState<EquipmentTemplate | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<EquipmentTemplate | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [bulkConfirm, setBulkConfirm] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());

  const query = useQuery({
    queryKey: ['equipment-templates'],
    queryFn: () => structureApi.listEquipmentTemplates(),
  });

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (query.data?.templates ?? []).filter(
      (t) => !term || t.name.toLowerCase().includes(term),
    );
  }, [query.data, search]);

  const visibleIds = useMemo(() => filtered.map((t) => t.id), [filtered]);
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
    mutationFn: (id: number) => structureApi.deleteEquipmentTemplate(id),
    onSuccess: () => {
      toast.success('Dotazione eliminata');
      void qc.invalidateQueries({ queryKey: ['equipment-templates'] });
      setDeleteTarget(null);
    },
    onError: (err) => {
      setDeleteError(httpErrorMessage(err));
    },
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: () => structureApi.bulkDeleteEquipmentTemplates(Array.from(selected)),
    onSuccess: ({ deleted }) => {
      toast.success(`${deleted} ${deleted === 1 ? 'dotazione eliminata' : 'dotazioni eliminate'}`);
      void qc.invalidateQueries({ queryKey: ['equipment-templates'] });
      setBulkConfirm(false);
      clearSelection();
    },
    onError: (err) => {
      setBulkError(httpErrorMessage(err));
    },
  });

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-display text-xl font-semibold">Catalogo dotazioni</h2>
          <p className="text-xs text-muted-foreground">
            Elenco riusabile di attrezzature. Si può selezionare dal catalogo quando aggiungi una
            dotazione a un’aula.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={async () => {
              try {
                const blob = await structureApi.downloadEquipmentTemplatesCsv();
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `dotazioni-${new Date().toISOString().slice(0, 10)}.csv`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
              } catch (err) {
                toast.error(httpErrorMessage(err));
              }
            }}
            title="Scarica catalogo dotazioni in CSV"
          >
            <Download className="h-4 w-4" />
            Esporta CSV
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              setImporting(true);
            }}
          >
            <FileUp className="h-4 w-4" />
            Importa CSV
          </Button>
          <Button
            onClick={() => {
              setCreating(true);
            }}
          >
            <Plus className="h-4 w-4" />
            Nuova dotazione
          </Button>
        </div>
      </div>

      {/* Search */}
      <Card>
        <CardContent className="p-4 sm:p-6">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
              }}
              placeholder="Cerca dotazione…"
              className="pl-9"
            />
          </div>
        </CardContent>
      </Card>

      {/* Bulk action bar */}
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
              {selected.size === 1 ? 'dotazione selezionata' : 'dotazioni selezionate'}
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
                Elimina selezionate
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Mobile (<sm): card stack — più leggibile su touchscreen ridotti
       * di una tabella con scroll orizzontale (skill rule mobile-first +
       * `data-table` adaptive). */}
      <div className="space-y-2 sm:hidden">
        {query.isLoading && [0, 1, 2].map((i) => <Skeleton key={i} className="h-20 w-full" />)}
        {!query.isLoading && filtered.length === 0 && (
          <Card>
            <CardContent className="flex flex-col items-center gap-2 py-10 text-center">
              <Cog className="h-8 w-8 text-muted-foreground" />
              <p className="text-sm font-medium">Nessuna dotazione</p>
              <p className="text-xs text-muted-foreground">
                Importa da CSV o aggiungi una dotazione manualmente.
              </p>
            </CardContent>
          </Card>
        )}
        {filtered.map((t) => {
          const isSelected = selected.has(t.id);
          return (
            <Card key={t.id} className={isSelected ? 'border-primary/50 bg-primary/5' : undefined}>
              <CardContent className="flex items-start gap-3 p-3">
                <Checkbox
                  checked={isSelected}
                  onCheckedChange={() => {
                    toggleOne(t.id);
                  }}
                  aria-label={`Seleziona ${t.name}`}
                  className="mt-1"
                />
                <div className="flex-1 space-y-1">
                  <p className="font-medium leading-snug">{t.name}</p>
                  <Badge variant="secondary">{TYPE_LABEL[t.type] ?? t.type}</Badge>
                </div>
                <div className="flex shrink-0 gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    title="Modifica"
                    onClick={() => {
                      setEditTarget(t);
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
                      setDeleteTarget(t);
                    }}
                    className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Desktop (≥sm): tabella classica */}
      <Card className="hidden sm:block">
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
                    aria-label="Seleziona tutte"
                  />
                </th>
                <th className="px-4 py-3 font-medium">Nome</th>
                <th className="px-4 py-3 font-medium">Tipologia</th>
                <th className="px-4 py-3 text-right font-medium">Azioni</th>
              </tr>
            </thead>
            <tbody>
              {query.isLoading &&
                [0, 1, 2].map((i) => (
                  <tr key={i} className="border-b last:border-0">
                    <td className="px-4 py-3" colSpan={4}>
                      <Skeleton className="h-8 w-full" />
                    </td>
                  </tr>
                ))}
              {!query.isLoading && filtered.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-12 text-center">
                    <Cog className="mx-auto mb-2 h-8 w-8 text-muted-foreground" />
                    <p className="text-sm font-medium">Nessuna dotazione</p>
                    <p className="text-xs text-muted-foreground">
                      Importa da CSV o aggiungi una dotazione manualmente.
                    </p>
                  </td>
                </tr>
              )}
              {filtered.map((t) => {
                const isSelected = selected.has(t.id);
                return (
                  <motion.tr
                    key={t.id}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className={`border-b last:border-0 ${isSelected ? 'bg-primary/5' : ''}`}
                  >
                    <td className="px-4 py-3">
                      <Checkbox
                        checked={isSelected}
                        onCheckedChange={() => {
                          toggleOne(t.id);
                        }}
                        aria-label={`Seleziona ${t.name}`}
                      />
                    </td>
                    <td className="px-4 py-3 font-medium">{t.name}</td>
                    <td className="px-4 py-3">
                      <Badge variant="secondary">{TYPE_LABEL[t.type] ?? t.type}</Badge>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="inline-flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          title="Modifica"
                          onClick={() => {
                            setEditTarget(t);
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
                            setDeleteTarget(t);
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

      <EquipmentTemplateFormDialog open={creating} onOpenChange={setCreating} />
      <EquipmentTemplateFormDialog
        open={!!editTarget}
        onOpenChange={(o) => !o && setEditTarget(null)}
        template={editTarget}
      />
      <EquipmentTemplatesCsvImportDialog open={importing} onOpenChange={setImporting} />
      <ConfirmDeleteDialog
        open={!!deleteTarget}
        onOpenChange={(o) => {
          if (!o) {
            setDeleteTarget(null);
            setDeleteError(null);
          }
        }}
        title={`Eliminare la dotazione "${deleteTarget?.name}"?`}
        description="L’elemento sarà rimosso dal catalogo. Le attrezzature già assegnate alle aule non saranno modificate."
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
        title={`Eliminare ${selected.size} ${selected.size === 1 ? 'dotazione' : 'dotazioni'}?`}
        description="Solo le voci del catalogo. Le attrezzature già assegnate restano intatte."
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
