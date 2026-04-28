import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Eye, FileText, LoaderCircle, RotateCcw, Save, Variable } from 'lucide-react';
import { toast } from 'sonner';
import { mailTemplatesApi, type MailTemplate } from '@/api/mailTemplates';
import { httpErrorMessage } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';

interface Props {
  template: MailTemplate;
  availableVariables: string[];
}

export function MailTemplateEditor({ template, availableVariables }: Props) {
  const qc = useQueryClient();
  const [subject, setSubject] = useState(template.subject);
  const [bodyHtml, setBodyHtml] = useState(template.bodyHtml);
  const [isEnabled, setIsEnabled] = useState(template.isEnabled);
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [previewSubject, setPreviewSubject] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setSubject(template.subject);
    setBodyHtml(template.bodyHtml);
    setIsEnabled(template.isEnabled);
  }, [template]);

  const dirty =
    subject !== template.subject ||
    bodyHtml !== template.bodyHtml ||
    isEnabled !== template.isEnabled;

  const saveMutation = useMutation({
    mutationFn: () => mailTemplatesApi.update(template.kind, { subject, bodyHtml, isEnabled }),
    onSuccess: () => {
      toast.success(`Template "${template.label}" salvato`);
      void qc.invalidateQueries({ queryKey: ['admin', 'mail-templates'] });
    },
    onError: (err) => {
      setError(httpErrorMessage(err));
    },
  });

  const resetMutation = useMutation({
    mutationFn: () => mailTemplatesApi.reset(template.kind),
    onSuccess: ({ template: t }) => {
      setSubject(t.subject);
      setBodyHtml(t.bodyHtml);
      setIsEnabled(t.isEnabled);
      toast.success('Template ripristinato ai valori di default');
      void qc.invalidateQueries({ queryKey: ['admin', 'mail-templates'] });
    },
    onError: (err) => {
      setError(httpErrorMessage(err));
    },
  });

  const previewMutation = useMutation({
    mutationFn: () => mailTemplatesApi.preview(template.kind, { subject, bodyHtml }),
    onSuccess: (res) => {
      setPreviewSubject(res.subject);
      setPreviewHtml(res.bodyHtml);
    },
    onError: (err) => {
      setError(httpErrorMessage(err));
    },
  });

  const insertVar = (varName: string) => {
    const placeholder = `{{${varName}}}`;
    setBodyHtml((b) => b + placeholder);
    toast.success(`Aggiunto ${placeholder}`);
  };

  const variablesUsed = useMemo(
    () =>
      availableVariables.filter(
        (v) => bodyHtml.includes(`{{${v}}}`) || subject.includes(`{{${v}}}`),
      ),
    [availableVariables, bodyHtml, subject],
  );

  return (
    <div className="space-y-4">
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Stato attivo */}
      <div className="flex items-center justify-between rounded-lg border bg-muted/30 p-3">
        <div>
          <p className="text-sm font-medium">Email attiva</p>
          <p className="text-xs text-muted-foreground">
            Disattivando, le notifiche di tipo "{template.label}" non saranno inviate.
          </p>
        </div>
        <Switch checked={isEnabled} onCheckedChange={setIsEnabled} />
      </div>

      {/* Subject */}
      <div className="space-y-2">
        <Label>Oggetto</Label>
        <Input
          value={subject}
          onChange={(e) => {
            setSubject(e.target.value);
          }}
          placeholder="Oggetto email (può contenere {{var}})"
        />
      </div>

      {/* Body */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label>Corpo HTML</Label>
          <span className="text-[11px] text-muted-foreground">
            {bodyHtml.length} caratteri · {variablesUsed.length} variabili usate
          </span>
        </div>
        <Textarea
          value={bodyHtml}
          onChange={(e) => {
            setBodyHtml(e.target.value);
          }}
          rows={14}
          className="font-mono text-xs"
          placeholder="<html>…</html>"
          spellCheck={false}
        />
      </div>

      {/* Variabili disponibili */}
      <div className="space-y-2 rounded-lg border bg-muted/30 p-3">
        <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <Variable className="h-3.5 w-3.5" />
          Variabili disponibili (clicca per inserire nel corpo)
        </p>
        <div className="flex flex-wrap gap-1">
          {availableVariables.map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => {
                insertVar(v);
              }}
              className="rounded-md border bg-background px-1.5 py-0.5 font-mono text-[10px] transition-colors hover:border-primary hover:bg-primary/5"
              title="Inserisci nel corpo"
            >
              {`{{${v}}}`}
            </button>
          ))}
        </div>
        <p className="text-[10px] text-muted-foreground">
          Sintassi avanzata: <code>{'{{#if booking.purpose}}…{{/if}}'}</code> per blocchi
          condizionali; <code>{'{{!html.var}}'}</code> per HTML raw (usare con cautela).
        </p>
      </div>

      {/* Action bar */}
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button
          type="button"
          variant="ghost"
          onClick={() => {
            resetMutation.mutate();
          }}
          disabled={resetMutation.isPending}
          className="text-muted-foreground"
        >
          {resetMutation.isPending ? (
            <LoaderCircle className="h-4 w-4 animate-spin" />
          ) : (
            <RotateCcw className="h-4 w-4" />
          )}
          Ripristina default
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            previewMutation.mutate();
          }}
          disabled={previewMutation.isPending}
        >
          {previewMutation.isPending ? (
            <LoaderCircle className="h-4 w-4 animate-spin" />
          ) : (
            <Eye className="h-4 w-4" />
          )}
          Anteprima
        </Button>
        <Button
          type="button"
          onClick={() => {
            setError(null);
            saveMutation.mutate();
          }}
          disabled={!dirty || saveMutation.isPending}
        >
          {saveMutation.isPending ? (
            <LoaderCircle className="h-4 w-4 animate-spin" />
          ) : (
            <Save className="h-4 w-4" />
          )}
          Salva
        </Button>
      </div>

      {/* Preview */}
      {previewHtml !== null && (
        <div className="space-y-2 rounded-lg border bg-card p-3">
          <div className="flex items-center justify-between">
            <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <FileText className="h-3.5 w-3.5" />
              Anteprima con dati di esempio
            </p>
            <Badge variant="muted">contesto: Mario Rossi · Aula Verdi</Badge>
          </div>
          <div className="rounded border bg-muted/30 px-3 py-2 text-xs">
            <span className="font-medium text-muted-foreground">Oggetto: </span>
            <span>{previewSubject}</span>
          </div>
          <div className="overflow-hidden rounded border bg-white">
            <iframe
              title="Anteprima email"
              srcDoc={previewHtml}
              className="h-[420px] w-full border-0"
              sandbox=""
            />
          </div>
        </div>
      )}
    </div>
  );
}
