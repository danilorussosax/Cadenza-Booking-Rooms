import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, CheckCircle2, Download, FileUp, LoaderCircle } from 'lucide-react';
import { toast } from 'sonner';
import { usersApi } from '@/api/users';
import { httpErrorMessage } from '@/lib/api';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

// Template CSV sintetico — è il minimo per partire (4 righe esempio +
// header). I dati sensibili (password) non sono mai in CSV: un nuovo
// utente importato riceve una password temporanea casuale che l'admin
// deve far resettare al primo login.
const SAMPLE_CSV = `Email;Cognome;Nome;Ruolo;Matricola;CodiceCorso;Stato;Attivo
mario.rossi@example.it;Rossi;Mario;studente;STU2026001;AFAM003;approved;si
laura.bianchi@example.it;Bianchi;Laura;docente;DOC42;;approved;si
giuseppe.verdi@example.it;Verdi;Giuseppe;studente;STU2026002;AFAM010;pending;si
`;

export function UsersCsvImportDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const qc = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [csv, setCsv] = useState('');
  const [fileName, setFileName] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [result, setResult] = useState<Awaited<ReturnType<typeof usersApi.importCsv>> | null>(null);

  const handleFile = async (file: File) => {
    setFileName(file.name);
    setCsv(await file.text());
    setResult(null);
    setServerError(null);
  };

  const importMutation = useMutation({
    mutationFn: () => usersApi.importCsv(csv),
    onSuccess: (data) => {
      setResult(data);
      void qc.invalidateQueries({ queryKey: ['users'] });
      toast.success(
        `Import completato · ${data.created} creati, ${data.updated} aggiornati${
          data.skipped > 0 ? `, ${data.skipped} saltati` : ''
        }`,
      );
    },
    onError: (err) => {
      setServerError(httpErrorMessage(err));
    },
  });

  const downloadTemplate = () => {
    const blob = new Blob(['﻿' + SAMPLE_CSV], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'template-utenti.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const reset = () => {
    setCsv('');
    setFileName(null);
    setResult(null);
    setServerError(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) reset();
      }}
    >
      <DialogContent className="max-w-[95vw] overflow-hidden sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Importa utenti da CSV</DialogTitle>
          <DialogDescription className="wrap-break-word">
            Carica un CSV con le colonne <strong>Email · Cognome · Nome · Ruolo</strong>{' '}
            (obbligatorie) più <em>Matricola · CodiceCorso · Stato · Attivo</em> (facoltative).
            Idempotente per email: gli utenti esistenti vengono aggiornati, i nuovi creati con una
            password temporanea casuale (l&rsquo;admin invita poi al reset).
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
                  <li>Righe lette: {result.parsed}</li>
                  <li>Creati: {result.created}</li>
                  <li>Aggiornati: {result.updated}</li>
                  <li>Saltati: {result.skipped}</li>
                </ul>
                {result.errors.length > 0 && (
                  <div className="mt-2 text-xs">
                    <p className="font-medium text-destructive">
                      {result.errors.length} riga/he con errori:
                    </p>
                    <ul className="mt-1 list-disc pl-5 text-destructive">
                      {result.errors.slice(0, 6).map((e, i) => (
                        <li key={i} className="wrap-break-word">
                          Riga {e.line}: {e.msg}
                        </li>
                      ))}
                      {result.errors.length > 6 && <li>… e altri {result.errors.length - 6}</li>}
                    </ul>
                  </div>
                )}
              </AlertDescription>
            </Alert>
          )}

          <div className="rounded-lg border border-dashed bg-muted/30 p-6 text-center">
            <FileUp className="mx-auto h-8 w-8 text-muted-foreground" />
            <p className="mt-2 break-all text-sm" title={fileName ?? undefined}>
              {fileName ? (
                <strong className="break-all">{fileName}</strong>
              ) : (
                'Trascina qui il CSV oppure'
              )}
            </p>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleFile(f);
              }}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-2"
              onClick={() => fileInputRef.current?.click()}
            >
              Scegli file
            </Button>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>
              Ruoli ammessi: <code>admin</code>, <code>docente</code>, <code>studente</code>. Stati:{' '}
              <code>pending</code>, <code>approved</code>, <code>rejected</code>.
            </span>
            <Button type="button" variant="ghost" size="sm" onClick={downloadTemplate}>
              <Download className="h-3.5 w-3.5" />
              Scarica template
            </Button>
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Annulla
          </Button>
          <Button
            type="button"
            onClick={() => {
              importMutation.mutate();
            }}
            disabled={!csv || importMutation.isPending}
          >
            {importMutation.isPending && <LoaderCircle className="h-4 w-4 animate-spin" />}
            Importa
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
