import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import {
  BookOpen,
  BookOpenCheck,
  Download,
  FileUp,
  GraduationCap,
  Pencil,
  Plus,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { coursesApi } from '@/api/courses';
import { courseLevelsApi } from '@/api/courseLevels';
import { httpErrorMessage } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { CourseFormDialog } from '@/components/admin/CourseFormDialog';
import { ConfirmDeleteDialog } from '@/components/admin/ConfirmDeleteDialog';
import { CoursesCsvImportDialog } from '@/components/admin/CoursesCsvImportDialog';
import { CourseLevelsSection } from '@/components/admin/CourseLevelsSection';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { Course } from '@/types';

export default function AdminCourses() {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [levelFilter, setLevelFilter] = useState<string>('all');
  const [activeFilter, setActiveFilter] = useState<string>('all');
  const [editTarget, setEditTarget] = useState<Course | null>(null);
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Course | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [bulkConfirm, setBulkConfirm] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());

  const query = useQuery({
    queryKey: ['courses', 'all'],
    queryFn: () => coursesApi.listAll(),
  });

  const levelsQuery = useQuery({
    queryKey: ['course-levels'],
    queryFn: () => courseLevelsApi.list(),
    staleTime: 60_000,
  });
  const levels = levelsQuery.data?.levels ?? [];
  const levelLabel = (code: string) => levels.find((l) => l.code === code)?.name ?? code;

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (query.data?.courses ?? [])
      .filter((c) => activeFilter === 'all' || (activeFilter === 'true' ? c.isActive : !c.isActive))
      .filter((c) => levelFilter === 'all' || c.levels.includes(levelFilter))
      .filter(
        (c) => !term || c.code.toLowerCase().includes(term) || c.name.toLowerCase().includes(term),
      );
  }, [query.data, search, levelFilter, activeFilter]);

  // Selection helpers (only over currently visible/filtered rows)
  const visibleIds = useMemo(() => filtered.map((c) => c.id), [filtered]);
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
      if (allVisibleSelected) {
        for (const id of visibleIds) next.delete(id);
      } else {
        for (const id of visibleIds) next.add(id);
      }
      return next;
    });
  };

  const clearSelection = () => {
    setSelected(new Set());
  };

  const deleteMutation = useMutation({
    mutationFn: (id: number) => coursesApi.remove(id),
    onSuccess: () => {
      toast.success('Corso eliminato');
      void qc.invalidateQueries({ queryKey: ['courses'] });
      setDeleteTarget(null);
    },
    onError: (err) => {
      setDeleteError(httpErrorMessage(err));
    },
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: () => coursesApi.bulkDelete(Array.from(selected)),
    onSuccess: ({ deleted }) => {
      toast.success(`${deleted} ${deleted === 1 ? 'corso eliminato' : 'corsi eliminati'}`);
      void qc.invalidateQueries({ queryKey: ['courses'] });
      setBulkConfirm(false);
      clearSelection();
    },
    onError: (err) => {
      setBulkError(httpErrorMessage(err));
    },
  });

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <header className="space-y-1.5">
        <h1 className="font-display text-3xl font-medium">Corsi di studio</h1>
        <p className="text-sm text-muted-foreground">
          Gestisci il catalogo dei corsi (SAD), i livelli supportati e l'import da CSV.
        </p>
      </header>

      <Tabs defaultValue="corsi" className="w-full">
        <TabsList>
          <TabsTrigger value="corsi" className="gap-1.5">
            <BookOpen className="h-3.5 w-3.5" />
            Corsi
          </TabsTrigger>
          <TabsTrigger value="livelli" className="gap-1.5">
            <GraduationCap className="h-3.5 w-3.5" />
            Livelli
          </TabsTrigger>
        </TabsList>

        <TabsContent value="livelli">
          <CourseLevelsSection />
        </TabsContent>

        <TabsContent value="corsi" className="space-y-6">
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                const a = document.createElement('a');
                a.href = coursesApi.exportCsvUrl();
                a.download = `corsi-${new Date().toISOString().slice(0, 10)}.csv`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
              }}
              title="Scarica corsi in CSV"
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
              Nuovo corso
            </Button>
          </div>

          <Card>
            <CardContent className="grid gap-3 p-4 md:grid-cols-[1fr_auto_auto]">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                  }}
                  placeholder="Cerca per codice o nome…"
                  className="pl-9"
                />
              </div>
              <Select value={levelFilter} onValueChange={setLevelFilter}>
                <SelectTrigger className="md:w-44">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tutti i livelli</SelectItem>
                  {levels.map((l) => (
                    <SelectItem key={l.id} value={l.code}>
                      {l.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={activeFilter} onValueChange={setActiveFilter}>
                <SelectTrigger className="md:w-44">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tutti gli stati</SelectItem>
                  <SelectItem value="true">Attivi</SelectItem>
                  <SelectItem value="false">Disattivati</SelectItem>
                </SelectContent>
              </Select>
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
                  {selected.size === 1 ? 'corso selezionato' : 'corsi selezionati'}
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
                        aria-label="Seleziona tutti i corsi visibili"
                      />
                    </th>
                    <th className="px-4 py-3 font-medium">Codice</th>
                    <th className="px-4 py-3 font-medium">Denominazione</th>
                    <th className="px-4 py-3 font-medium">Livelli</th>
                    <th className="px-4 py-3 font-medium">Stato</th>
                    <th className="px-4 py-3 text-right font-medium">Azioni</th>
                  </tr>
                </thead>
                <tbody>
                  {query.isLoading &&
                    [0, 1, 2].map((i) => (
                      <tr key={i} className="border-b last:border-0">
                        <td className="px-4 py-3" colSpan={6}>
                          <Skeleton className="h-8 w-full" />
                        </td>
                      </tr>
                    ))}
                  {!query.isLoading && filtered.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-4 py-12 text-center">
                        <BookOpenCheck className="mx-auto mb-2 h-8 w-8 text-muted-foreground" />
                        <p className="text-sm font-medium">Nessun corso trovato</p>
                        <p className="text-xs text-muted-foreground">
                          Modifica i filtri, importa da CSV o aggiungi un nuovo corso.
                        </p>
                      </td>
                    </tr>
                  )}
                  {filtered.map((c) => {
                    const isSelected = selected.has(c.id);
                    return (
                      <motion.tr
                        key={c.id}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        className={`border-b last:border-0 ${isSelected ? 'bg-primary/5' : ''}`}
                      >
                        <td className="px-4 py-3">
                          <Checkbox
                            checked={isSelected}
                            onCheckedChange={() => {
                              toggleOne(c.id);
                            }}
                            aria-label={`Seleziona ${c.name}`}
                          />
                        </td>
                        <td className="px-4 py-3 font-mono text-xs uppercase">{c.code}</td>
                        <td className="px-4 py-3">
                          <p className="font-medium">{c.name}</p>
                          {c.department && (
                            <p className="text-xs text-muted-foreground">{c.department}</p>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap gap-1">
                            {c.levels.length === 0 && (
                              <span className="text-xs text-muted-foreground">—</span>
                            )}
                            {c.levels.map((lvl) => (
                              <Badge key={lvl} variant="secondary">
                                {levelLabel(lvl)}
                              </Badge>
                            ))}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <Badge variant={c.isActive ? 'success' : 'muted'}>
                            {c.isActive ? 'Attivo' : 'Disattivato'}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="inline-flex items-center gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              title="Modifica"
                              onClick={() => {
                                setEditTarget(c);
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
                                setDeleteTarget(c);
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
        </TabsContent>
      </Tabs>

      <CourseFormDialog open={creating} onOpenChange={setCreating} />
      <CourseFormDialog
        open={!!editTarget}
        onOpenChange={(o) => !o && setEditTarget(null)}
        course={editTarget}
      />
      <CoursesCsvImportDialog open={importing} onOpenChange={setImporting} />
      <ConfirmDeleteDialog
        open={!!deleteTarget}
        onOpenChange={(o) => {
          if (!o) {
            setDeleteTarget(null);
            setDeleteError(null);
          }
        }}
        title={`Eliminare il corso "${deleteTarget?.name}"?`}
        description="Gli utenti associati al corso non saranno eliminati ma resteranno senza riferimento."
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
        title={`Eliminare ${selected.size} ${selected.size === 1 ? 'corso' : 'corsi'}?`}
        description="Verranno rimossi definitivamente. Gli utenti associati resteranno senza riferimento."
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
