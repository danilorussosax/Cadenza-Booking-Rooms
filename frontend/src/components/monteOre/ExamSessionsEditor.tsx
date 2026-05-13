import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { GraduationCap, Pencil, Plus, Save, Trash2, X } from 'lucide-react';
import { monteOreAdminApi, type ExamSessionPayload, type MonteOreSuspension } from '@/api/monteOre';
import { httpErrorMessage } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';

interface Props {
  academicYear: string;
}

type EditorMode = { kind: 'add' } | { kind: 'edit'; session: MonteOreSuspension } | null;

/**
 * Editor delle sessioni d'esame (suspensions con `category='exam_session'`).
 * Si appoggia ai 4 endpoint admin `/api/admin/monte-ore/exam-sessions*`.
 * Tutte le mutazioni invalidano `['examSessions', academicYear]`.
 */
export function ExamSessionsEditor({ academicYear }: Props) {
  const qc = useQueryClient();
  const [editor, setEditor] = useState<EditorMode>(null);

  const listQuery = useQuery({
    queryKey: ['examSessions', academicYear],
    queryFn: () => monteOreAdminApi.listExamSessions(academicYear),
    enabled: !!academicYear,
  });

  const removeMutation = useMutation({
    mutationFn: (id: number) => monteOreAdminApi.deleteExamSession(id),
    onSuccess: () => {
      toast.success('Sessione eliminata');
      void qc.invalidateQueries({ queryKey: ['examSessions', academicYear] });
    },
    onError: (err) => toast.error(httpErrorMessage(err)),
  });

  const sessions = listQuery.data?.examSessions ?? [];

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div>
          <CardTitle className="text-lg flex items-center gap-2">
            <GraduationCap className="h-5 w-5 text-primary" />
            Sessioni d'esame
          </CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">
            Periodi di esame: bloccano l'inserimento di lezioni nelle giornate coperte (suspension
            con categoria <code>exam_session</code>).
          </p>
        </div>
        <Button size="sm" onClick={() => setEditor({ kind: 'add' })}>
          <Plus className="h-4 w-4" />
          Aggiungi sessione
        </Button>
      </CardHeader>
      <CardContent>
        {listQuery.isLoading ? (
          <Skeleton className="h-32 w-full" />
        ) : sessions.length === 0 ? (
          <div className="rounded-lg border border-dashed bg-muted/20 px-4 py-8 text-center text-sm text-muted-foreground">
            Nessuna sessione d'esame configurata per l'AA {academicYear}.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b text-left text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-3 py-2">Nome</th>
                  <th className="px-3 py-2">Dal</th>
                  <th className="px-3 py-2">Al</th>
                  <th className="px-3 py-2">Note</th>
                  <th className="px-3 py-2 text-right">Azioni</th>
                </tr>
              </thead>
              <tbody>
                {sessions.map((s) => (
                  <tr key={s.id} className="border-b last:border-0 align-top">
                    <td className="px-3 py-2 font-medium">{s.name}</td>
                    <td className="px-3 py-2 tabular-nums">{s.dateFrom}</td>
                    <td className="px-3 py-2 tabular-nums">{s.dateTo}</td>
                    <td className="px-3 py-2 text-xs text-muted-foreground max-w-[260px]">
                      {s.notes ?? <span className="italic text-muted-foreground/60">—</span>}
                    </td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setEditor({ kind: 'edit', session: s })}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => {
                          if (confirm(`Eliminare la sessione "${s.name}"?`)) {
                            removeMutation.mutate(s.id);
                          }
                        }}
                        className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>

      {editor && (
        <ExamSessionDialog
          academicYear={academicYear}
          mode={editor}
          onClose={() => setEditor(null)}
        />
      )}
    </Card>
  );
}

interface DialogProps {
  academicYear: string;
  mode: { kind: 'add' } | { kind: 'edit'; session: MonteOreSuspension };
  onClose: () => void;
}

function ExamSessionDialog({ academicYear, mode, onClose }: DialogProps) {
  const qc = useQueryClient();
  const isEdit = mode.kind === 'edit';
  const existing = isEdit ? mode.session : null;

  const [form, setForm] = useState<ExamSessionPayload>({
    academicYear,
    name: existing?.name ?? '',
    dateFrom: existing?.dateFrom ?? '',
    dateTo: existing?.dateTo ?? '',
    notes: existing?.notes ?? '',
  });

  const saveMutation = useMutation({
    mutationFn: () => {
      if (isEdit && existing) {
        return monteOreAdminApi.updateExamSession(existing.id, {
          name: form.name,
          dateFrom: form.dateFrom,
          dateTo: form.dateTo,
          notes: form.notes,
        });
      }
      return monteOreAdminApi.createExamSession(form);
    },
    onSuccess: () => {
      toast.success(isEdit ? 'Sessione aggiornata' : 'Sessione creata');
      void qc.invalidateQueries({ queryKey: ['examSessions', academicYear] });
      onClose();
    },
    onError: (err) => toast.error(httpErrorMessage(err)),
  });

  const canSubmit =
    form.name.trim().length > 0 && !!form.dateFrom && !!form.dateTo && form.dateFrom <= form.dateTo;

  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <GraduationCap className="h-5 w-5 text-primary" />
            {isEdit ? "Modifica sessione d'esame" : "Nuova sessione d'esame"}
          </DialogTitle>
          <DialogDescription>AA {academicYear}</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (canSubmit) saveMutation.mutate();
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="es-name">Nome</Label>
            <Input
              id="es-name"
              value={form.name}
              placeholder="Sessione invernale"
              maxLength={120}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              required
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="es-from">Dal</Label>
              <Input
                id="es-from"
                type="date"
                value={form.dateFrom}
                onChange={(e) => setForm((f) => ({ ...f, dateFrom: e.target.value }))}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="es-to">Al</Label>
              <Input
                id="es-to"
                type="date"
                value={form.dateTo}
                onChange={(e) => setForm((f) => ({ ...f, dateTo: e.target.value }))}
                required
              />
            </div>
          </div>
          {form.dateFrom && form.dateTo && form.dateFrom > form.dateTo && (
            <p className="text-xs text-destructive">
              La data di fine deve essere uguale o successiva alla data di inizio.
            </p>
          )}
          <div className="space-y-2">
            <Label htmlFor="es-notes">Note (opzionale)</Label>
            <Textarea
              id="es-notes"
              rows={2}
              maxLength={500}
              value={form.notes ?? ''}
              placeholder="Es. ammessi solo esami orali in Aula Magna"
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value || null }))}
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={saveMutation.isPending}
            >
              <X className="h-4 w-4" />
              Annulla
            </Button>
            <Button type="submit" disabled={!canSubmit || saveMutation.isPending}>
              <Save className="h-4 w-4" />
              {isEdit ? 'Salva' : 'Crea'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default ExamSessionsEditor;
