import { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, CheckCircle2, Download, FileUp, LoaderCircle } from 'lucide-react';
import { toast } from 'sonner';
import { structureApi, type CsvImportResult } from '@/api/structure';
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

const SAMPLE_CSV = `edificio;piano;aula;codice_edificio;indirizzo;codice_aula;capienza;tipo_aula;prenotabile;attrezzatura;tipo_attrezzatura;marca;modello;quantita
Palazzo Storico;Piano Terra;Aula Verdi;PS;Via Roma 1;A01;25;classe;si;Pianoforte verticale;pianoforte;Yamaha;U3;1
Palazzo Storico;Piano Terra;Aula Verdi;PS;Via Roma 1;A01;25;classe;si;Leggio;leggio;;;5
Palazzo Storico;Primo Piano;Sala Concerti;PS;Via Roma 1;SC1;120;aula_concerti;si;Pianoforte a coda;pianoforte_a_coda;Steinway;D-274;1
`;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  instituteId: number;
  instituteName: string;
}

export function CsvImportDialog({ open, onOpenChange, instituteId, instituteName }: Props) {
  const qc = useQueryClient();
  const [csv, setCsv] = useState('');
  const [fileName, setFileName] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [result, setResult] = useState<CsvImportResult | null>(null);
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
    mutationFn: () => structureApi.import({ instituteId, csv }),
    onSuccess: ({ result }) => {
      setResult(result);
      void qc.invalidateQueries({ queryKey: ['institutes'] });
      // Import CSV può creare/aggiornare aule in massa: invalidiamo tutte le
      // viste che mostrano codici aula (Dashboard, Display kiosk, ecc.).
      void qc.invalidateQueries({ queryKey: ['rooms'] });
      void qc.invalidateQueries({ queryKey: ['public'] });
      toast.success(
        `Import completato · ${result.roomsCreated + result.roomsUpdated} aule, ${
          result.equipmentCreated + result.equipmentUpdated
        } strumenti`,
      );
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
    a.download = 'template-struttura.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[95vw] overflow-hidden sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Importa struttura da CSV</DialogTitle>
          <DialogDescription className="wrap-break-word">
            Carica un file CSV per popolare edifici, aule e strumentazione di{' '}
            <strong>{instituteName}</strong>. L’operazione è idempotente: i record esistenti vengono
            aggiornati per nome.
          </DialogDescription>
        </DialogHeader>

        <div className="min-w-0 space-y-4">
          {serverError && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription className="wrap-break-word">{serverError}</AlertDescription>
            </Alert>
          )}

          {result && (
            <Alert variant="info">
              <CheckCircle2 className="h-4 w-4" />
              <AlertDescription>
                <p className="font-medium">Import completato</p>
                <ul className="mt-1 grid grid-cols-2 gap-x-4 text-xs">
                  <li>Edifici creati: {result.buildingsCreated}</li>
                  <li>Edifici aggiornati: {result.buildingsUpdated}</li>
                  <li>Aule create: {result.roomsCreated}</li>
                  <li>Aule aggiornate: {result.roomsUpdated}</li>
                  <li>Strumenti creati: {result.equipmentCreated}</li>
                  <li>Strumenti aggiornati: {result.equipmentUpdated}</li>
                </ul>
                {result.errors.length > 0 && (
                  <div className="mt-2 text-xs">
                    <p className="font-medium text-destructive">
                      {result.errors.length} riga/he con errori:
                    </p>
                    <ul className="mt-1 list-disc pl-5 text-destructive">
                      {result.errors.slice(0, 6).map((e, i) => (
                        <li key={i} className="wrap-break-word">
                          Riga {e.row}: {e.message}
                        </li>
                      ))}
                      {result.errors.length > 6 && <li>… e altri {result.errors.length - 6}</li>}
                    </ul>
                  </div>
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
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleFile(file);
              }}
            />
            <p className="text-xs text-muted-foreground">
              Colonne richieste: <code>edificio</code>, <code>piano</code>, <code>aula</code>.
              Colonne supportate per attrezzatura: <code>attrezzatura</code>,{' '}
              <code>tipo_attrezzatura</code>, <code>marca</code>, <code>modello</code>,{' '}
              <code>quantita</code>.
            </p>
          </div>

          {csv && !result && (
            <div className="min-w-0 rounded-md border bg-muted/30 p-3 text-xs">
              <p className="mb-1 font-medium text-muted-foreground">Anteprima (prime righe):</p>
              {/* `break-all` + `overflow-auto` per gestire CSV con righe lunghe
                  senza spazi (es. nomi di file/dati con `;` come separatore):
                  rompe a livello carattere quando il word-wrap non basta. */}
              <pre className="max-h-32 overflow-auto whitespace-pre-wrap break-all font-mono text-[11px]">
                {csv.split('\n').slice(0, 5).join('\n')}
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
