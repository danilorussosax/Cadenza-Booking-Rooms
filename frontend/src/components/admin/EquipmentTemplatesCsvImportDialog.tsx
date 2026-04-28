import { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, CheckCircle2, Download, FileUp, LoaderCircle } from 'lucide-react';
import { toast } from 'sonner';
import { structureApi } from '@/api/structure';
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

const SAMPLE_CSV = `Dotazione
Pianoforte verticale
Pianoforte a coda Steinway
Leggio metallico
Microfono Shure SM58
Mixer Yamaha MG12
Proiettore Epson
`;

interface ImportResult {
  rowsTotal: number;
  created: number;
  skipped: number;
  errors: { row: number; message: string }[];
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function EquipmentTemplatesCsvImportDialog({ open, onOpenChange }: Props) {
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
    mutationFn: () => structureApi.importEquipmentTemplates(csv),
    onSuccess: ({ result }) => {
      setResult(result);
      void qc.invalidateQueries({ queryKey: ['equipment-templates'] });
      toast.success(`Import completato · ${result.created} create, ${result.skipped} esistenti`);
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
    a.download = 'template-dotazioni.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[95vw] overflow-hidden sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Importa dotazioni da CSV</DialogTitle>
          <DialogDescription className="break-words">
            File CSV con <strong>una sola colonna</strong>: il nome della dotazione (uno per riga).
            L’header è opzionale (es. <code>Dotazione</code>, <code>Nome</code>). I nomi duplicati
            vengono ignorati.
          </DialogDescription>
        </DialogHeader>

        <div className="min-w-0 space-y-4">
          {serverError && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription className="break-words">{serverError}</AlertDescription>
            </Alert>
          )}

          {result && (
            <Alert variant="info">
              <CheckCircle2 className="h-4 w-4" />
              <AlertDescription>
                <p className="font-medium">Import completato</p>
                <ul className="mt-1 grid grid-cols-2 gap-x-4 text-xs">
                  <li>Righe processate: {result.rowsTotal}</li>
                  <li>Create: {result.created}</li>
                  <li>Esistenti (saltate): {result.skipped}</li>
                  <li>Errori: {result.errors.length}</li>
                </ul>
                {result.errors.length > 0 && (
                  <ul className="mt-2 list-disc pl-5 text-xs text-destructive">
                    {result.errors.slice(0, 6).map((e, i) => (
                      <li key={i} className="break-words">
                        Riga {e.row}: {e.message}
                      </li>
                    ))}
                  </ul>
                )}
              </AlertDescription>
            </Alert>
          )}

          <div className="grid min-w-0 gap-2">
            <Label>File CSV</Label>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => fileRef.current?.click()}
                disabled={importMutation.isPending}
                className="shrink-0"
              >
                <FileUp className="h-4 w-4" />
                {fileName ? 'Cambia file' : 'Seleziona file…'}
              </Button>
              {fileName && (
                <span
                  className="min-w-0 flex-1 truncate text-xs text-muted-foreground"
                  title={fileName}
                >
                  {fileName}
                </span>
              )}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={downloadTemplate}
                className="ml-auto shrink-0"
              >
                <Download className="h-4 w-4" />
                Scarica template
              </Button>
            </div>
            <Input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv,text/plain"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleFile(file);
              }}
            />
          </div>

          {csv && !result && (
            <div className="min-w-0 rounded-md border bg-muted/30 p-3 text-xs">
              <p className="mb-1 font-medium text-muted-foreground">Anteprima:</p>
              <pre className="max-h-32 overflow-auto whitespace-pre-wrap break-all font-mono text-[11px]">
                {csv.split('\n').slice(0, 8).join('\n')}
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
