import { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, CheckCircle2, Download, FileUp, LoaderCircle } from 'lucide-react';
import { toast } from 'sonner';
import { coursesApi } from '@/api/courses';
import { httpErrorMessage } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

const SAMPLE_CSV = `SAD;Denominazione
DCPL34;Pianoforte
DCSL52;Violino
DCMC35;Composizione
DCSL07;Canto
`;

interface ImportResult {
  rowsTotal: number;
  created: number;
  updated: number;
  unchanged?: number;
  restored?: number;
  errors: { row: number; message: string }[];
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CoursesCsvImportDialog({ open, onOpenChange }: Props) {
  const qc = useQueryClient();
  const [csv, setCsv] = useState('');
  const [fileName, setFileName] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setCsv('');
      setFileName(null);
      setServerError(null);
      setResult(null);
    }
  }, [open]);

  const handleFile = async (file: File) => {
    setFileName(file.name);
    setCsv(await file.text());
    setResult(null);
  };

  const importMutation = useMutation({
    mutationFn: () => coursesApi.importCsv(csv),
    onSuccess: ({ result }) => {
      setResult(result);
      void qc.invalidateQueries({ queryKey: ['courses'] });
      toast.success(`Import completato · ${result.created} creati, ${result.updated} aggiornati`);
    },
    onError: (err) => {
      setServerError(httpErrorMessage(err));
    },
  });

  const downloadTemplate = () => {
    const blob = new Blob([SAMPLE_CSV], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'template-corsi.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Importa corsi da CSV</DialogTitle>
          <DialogDescription>
            Carica un file CSV con due colonne: <strong>SAD</strong> (codice) e{' '}
            <strong>Denominazione</strong>. L’operazione è idempotente: i corsi esistenti vengono
            aggiornati per codice.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {serverError && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{serverError}</AlertDescription>
            </Alert>
          )}

          {result && (
            <Alert variant="info">
              <CheckCircle2 className="h-4 w-4" />
              <AlertDescription>
                <p className="font-medium">Import completato</p>
                <ul className="mt-1 grid grid-cols-2 gap-x-4 text-xs">
                  <li>Righe processate: {result.rowsTotal}</li>
                  <li>Corsi creati: {result.created}</li>
                  <li>Corsi aggiornati: {result.updated}</li>
                  {result.unchanged !== undefined && result.unchanged > 0 && (
                    <li>Già aggiornati (no-op): {result.unchanged}</li>
                  )}
                  {result.restored !== undefined && result.restored > 0 && (
                    <li>Corsi ripristinati: {result.restored}</li>
                  )}
                  <li>Errori: {result.errors.length}</li>
                </ul>
                {result.errors.length > 0 && (
                  <div className="mt-2 text-xs">
                    <p className="font-medium text-destructive">Righe non importate:</p>
                    <ul className="mt-1 list-disc pl-5 text-destructive">
                      {result.errors.slice(0, 8).map((e, i) => (
                        <li key={i}>
                          Riga {e.row}: {e.message}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </AlertDescription>
            </Alert>
          )}

          <div className="grid gap-2">
            <Label>File CSV</Label>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => fileRef.current?.click()}
                disabled={importMutation.isPending}
              >
                <FileUp className="h-4 w-4" />
                {fileName ? 'Cambia file' : 'Seleziona file…'}
              </Button>
              {fileName && <span className="text-xs text-muted-foreground">{fileName}</span>}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={downloadTemplate}
                className="ml-auto"
              >
                <Download className="h-4 w-4" />
                Scarica template
              </Button>
            </div>
            <Input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleFile(file);
              }}
            />
            <p className="text-xs text-muted-foreground">
              Separatore auto-rilevato: <code>;</code>, <code>,</code> o tab. Eventuali colonne
              extra sono ignorate.
            </p>
          </div>

          {csv && !result && (
            <div className="rounded-md border bg-muted/30 p-3 text-xs">
              <p className="mb-1 font-medium text-muted-foreground">Anteprima (prime righe):</p>
              <pre className="max-h-32 overflow-auto whitespace-pre-wrap font-mono text-[11px]">
                {csv.split('\n').slice(0, 6).join('\n')}
              </pre>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              onOpenChange(false);
            }}
            disabled={importMutation.isPending}
          >
            Chiudi
          </Button>
          <Button
            type="button"
            disabled={!csv || importMutation.isPending}
            onClick={() => {
              importMutation.mutate();
            }}
          >
            {importMutation.isPending ? (
              <LoaderCircle className="h-4 w-4 animate-spin" />
            ) : (
              <>
                <FileUp className="h-4 w-4" />
                Importa
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
