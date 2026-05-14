import type { DragEvent } from 'react';
import { useCallback, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  AlertTriangle,
  CheckCircle2,
  FileSpreadsheet,
  Loader2,
  Upload,
  UploadCloud,
  X,
} from 'lucide-react';
import { monteOreAdminApi, type ImportExcelResponse } from '@/api/monteOre';
import { httpErrorMessage, HttpError } from '@/lib/api';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';

/** Limite hard-coded sul backend: 5 MB. Mostriamo errore client prima di
 * spedire payload inutilmente grandi. */
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const ACCEPTED_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const ACCEPTED_ATTR = `.xlsx,${ACCEPTED_MIME}`;

interface Props {
  open: boolean;
  onClose: () => void;
  /**
   * AA correntemente selezionato dalla pagina admin. Mostrato come info nel
   * dialog: il backend deduce l'AA dal file, quindi è puramente display-only.
   */
  academicYear?: string;
}

/** Formatta byte → KB/MB human readable. */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/**
 * Dialog admin per importare un file Excel monte ore pre-compilato.
 *
 * Stati interni (ordine):
 *   1. SELECT: utente seleziona/draga un .xlsx, decide overwrite, clicca Importa.
 *   2. SUBMITTING: chiamata in volo, bottoni disabilitati, spinner.
 *   3a. RESULT: successo → mostra pannello riepilogo (no chiusura automatica).
 *   3b. ERROR 404 (email non in DB) → alert destructive, possibile correggere
 *       file e riprovare.
 *   3c. ERROR 409 (proposta in stato non sovrascrivibile) → alert + checkbox
 *       "Forza sovrascrittura" che invia `?force=true` al retry.
 *   3d. Altri errori → alert generico.
 */
export function ImportExcelDialog({ open, onClose, academicYear }: Props) {
  const qc = useQueryClient();

  // File scelto (drag-drop o input). Null finché l'utente non seleziona.
  const [file, setFile] = useState<File | null>(null);
  const [overwrite, setOverwrite] = useState(true);
  // Risultato dell'ultimo import riuscito — quando valorizzato la UI mostra
  // il pannello "Esito" al posto del form.
  const [result, setResult] = useState<ImportExcelResponse | null>(null);
  // Errore last-call: HttpError per discriminare 404 / 409.
  const [error, setError] = useState<unknown>(null);
  // Visibile solo quando l'errore è 409: convertito in flag `force=true` al
  // retry, viene mostrato come opzione esplicita per consenso informato.
  const [forceOverwrite, setForceOverwrite] = useState(false);
  // Errore di validazione client (formato/dimensione) — separato perché non
  // rappresenta un fallimento di rete e non va loggato come HttpError.
  const [validationError, setValidationError] = useState<string | null>(null);
  // Drag highlight visivo della drop-zone.
  const [isDragging, setIsDragging] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  /**
   * Valida il File scelto (estensione + size). Chiama setState con messaggio
   * d'errore italiano o pulisce errori precedenti.
   */
  const pickFile = useCallback((f: File | null) => {
    setValidationError(null);
    setError(null);
    if (!f) {
      setFile(null);
      return;
    }
    const lower = f.name.toLowerCase();
    if (!lower.endsWith('.xlsx')) {
      setValidationError('Formato non valido: sono accettati solo file .xlsx.');
      setFile(null);
      return;
    }
    if (f.size > MAX_FILE_BYTES) {
      setValidationError(`File troppo grande (${formatBytes(f.size)}). Massimo 5 MB.`);
      setFile(null);
      return;
    }
    setFile(f);
  }, []);

  const resetAll = useCallback(() => {
    setFile(null);
    setOverwrite(true);
    setResult(null);
    setError(null);
    setForceOverwrite(false);
    setValidationError(null);
    setIsDragging(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, []);

  const handleClose = useCallback(() => {
    resetAll();
    onClose();
  }, [resetAll, onClose]);

  const importMutation = useMutation({
    mutationFn: ({ f, force }: { f: File; force: boolean }) =>
      monteOreAdminApi.importExcel(f, { overwrite, force }),
    onSuccess: (data) => {
      setResult(data);
      setError(null);
      // Mostra anche un toast: il pannello in-dialog cattura i dettagli, il
      // toast resta visibile dopo eventuale chiusura immediata.
      toast.success(
        `Import completato per ${data.user.fullName} (${data.summary.schedulesCreated} fasce)`,
      );
      void qc.invalidateQueries({ queryKey: ['monte-ore', 'proposals'] });
      void qc.invalidateQueries({ queryKey: ['monte-ore', 'academic-years'] });
      // I queryKey usati realmente dalla pagina admin (vedi MonteOre.tsx):
      void qc.invalidateQueries({ queryKey: ['admin', 'monte-ore'] });
    },
    onError: (err) => {
      setError(err);
    },
  });

  const handleSubmit = (force: boolean) => {
    if (!file) return;
    importMutation.mutate({ f: file, force });
  };

  // ---- helper per il render degli alert ----------------------------------
  const errorStatus = error instanceof HttpError ? error.status : error instanceof Error ? 0 : 0;
  // `hasError` come boolean evita che il narrowing di `error` (tipo `unknown`)
  // si propaghi come children JSX nei rami short-circuit `{error && (...)}`.
  const hasError = error != null;
  const isUserNotFound = errorStatus === 404;
  const isConflict = errorStatus === 409;
  const errorMessage = hasError ? httpErrorMessage(error) : null;

  // ---- handlers drag-and-drop --------------------------------------------
  const onDragOver = (e: DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    setIsDragging(true);
  };
  const onDragLeave = (e: DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    setIsDragging(false);
  };
  const onDrop = (e: DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    setIsDragging(false);
    // FileList.item() ritorna File | null in modo esplicito: evita di
    // mentire al type-checker su files[0] quando il drop è vuoto.
    const f = e.dataTransfer.files.item(0);
    pickFile(f);
  };

  // ---- render ------------------------------------------------------------
  const showResult = result !== null;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) handleClose();
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5 text-primary" />
            {showResult ? 'Import completato' : 'Importa monte ore da Excel'}
          </DialogTitle>
          <DialogDescription>
            {showResult ? (
              <>Riepilogo delle fasce create dall'import.</>
            ) : (
              <>
                Carica il file Excel pre-compilato (template scaricabile da{' '}
                <em>Calendario didattico</em>) per popolare in un colpo solo la proposta monte ore
                di un docente.
                {academicYear && (
                  <>
                    {' '}
                    AA corrente: <strong>{academicYear}</strong> (il backend lo legge comunque dal
                    file).
                  </>
                )}
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        {showResult ? (
          <ResultPanel
            result={result}
            onClose={handleClose}
            onImportAnother={() => {
              // Mantieni `overwrite` impostato, azzera il resto: utente vuole
              // importare un secondo file per un altro docente.
              setFile(null);
              setResult(null);
              setError(null);
              setForceOverwrite(false);
              setValidationError(null);
              if (fileInputRef.current) fileInputRef.current.value = '';
            }}
          />
        ) : (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              handleSubmit(false);
            }}
          >
            {/* Drop-zone + input nativo nascosto */}
            <label
              htmlFor="excel-file-input"
              onDragOver={onDragOver}
              onDragLeave={onDragLeave}
              onDrop={onDrop}
              className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-6 text-center transition-colors ${
                isDragging
                  ? 'border-primary bg-primary/10'
                  : file
                    ? 'border-primary/40 bg-primary/5'
                    : 'border-muted-foreground/30 hover:border-primary/50 hover:bg-muted/30'
              }`}
            >
              <input
                id="excel-file-input"
                ref={fileInputRef}
                type="file"
                accept={ACCEPTED_ATTR}
                className="sr-only"
                onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
              />
              {file ? (
                <>
                  <FileSpreadsheet className="h-8 w-8 text-primary" />
                  <p className="text-sm font-medium">{file.name}</p>
                  <p className="text-xs text-muted-foreground">{formatBytes(file.size)}</p>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="mt-1 text-xs"
                    onClick={(e) => {
                      e.preventDefault();
                      pickFile(null);
                    }}
                  >
                    <X className="h-3.5 w-3.5" />
                    Rimuovi file
                  </Button>
                </>
              ) : (
                <>
                  <UploadCloud className="h-8 w-8 text-muted-foreground" />
                  <p className="text-sm font-medium">Trascina qui il file .xlsx</p>
                  <p className="text-xs text-muted-foreground">
                    oppure <span className="text-primary underline">clicca per selezionarlo</span>
                  </p>
                  <p className="text-[11px] text-muted-foreground">Massimo 5 MB</p>
                </>
              )}
            </label>

            {validationError && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>{validationError}</AlertDescription>
              </Alert>
            )}

            {/* Overwrite toggle */}
            <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-dashed p-3 hover:bg-muted/30">
              <Checkbox
                checked={overwrite}
                onCheckedChange={(v) => setOverwrite(v === true)}
                className="mt-0.5"
              />
              <div>
                <p className="text-sm font-medium">Sovrascrivi proposta esistente</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Se il docente ha già una proposta in <em>bozza/inviata/rifiutata</em>, le sue
                  fasce vengono rimpiazzate da quelle del file. Se disattivato, l'import si ferma.
                </p>
              </div>
            </label>

            {/* Errore 404 — email non trovata */}
            {hasError && isUserNotFound && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>Email non trovata</AlertTitle>
                <AlertDescription>
                  {errorMessage}
                  <p className="mt-1 text-xs">
                    Verifica che l'email nel file corrisponda esattamente a quella di un utente
                    registrato.
                  </p>
                </AlertDescription>
              </Alert>
            )}

            {/* Errore 409 — conflitto stato proposta */}
            {hasError && isConflict && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>Proposta in stato non sovrascrivibile</AlertTitle>
                <AlertDescription>
                  {errorMessage}
                  <label className="mt-2 flex cursor-pointer items-start gap-2">
                    <Checkbox
                      checked={forceOverwrite}
                      onCheckedChange={(v) => setForceOverwrite(v === true)}
                      className="mt-0.5"
                    />
                    <span className="text-xs">
                      Forza sovrascrittura (anche su proposte <em>approvate/generate</em>). Le
                      prenotazioni già create non vengono rimosse: usare con cautela.
                    </span>
                  </label>
                </AlertDescription>
              </Alert>
            )}

            {/* Altri errori (400, 500, etc.) */}
            {hasError && !isUserNotFound && !isConflict && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>{errorMessage}</AlertDescription>
              </Alert>
            )}

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={handleClose}
                disabled={importMutation.isPending}
              >
                Annulla
              </Button>
              {hasError && isConflict ? (
                <Button
                  type="button"
                  onClick={() => handleSubmit(true)}
                  disabled={!file || !forceOverwrite || importMutation.isPending}
                >
                  {importMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Upload className="h-4 w-4" />
                  )}
                  Forza import
                </Button>
              ) : (
                <Button type="submit" disabled={!file || importMutation.isPending}>
                  {importMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Upload className="h-4 w-4" />
                  )}
                  {importMutation.isPending ? 'Importazione…' : 'Importa'}
                </Button>
              )}
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

/**
 * Sotto-pannello mostrato dentro lo stesso dialog dopo un import riuscito.
 * Non chiude automaticamente: l'admin sceglie se confermare o importare un
 * altro file.
 */
function ResultPanel({
  result,
  onClose,
  onImportAnother,
}: {
  result: ImportExcelResponse;
  onClose: () => void;
  onImportAnother: () => void;
}) {
  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-emerald-200 bg-emerald-50/50 p-4 dark:border-emerald-900 dark:bg-emerald-950/20">
        <div className="flex items-start gap-3">
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
          <div className="space-y-1 text-sm">
            <p className="font-medium text-emerald-900 dark:text-emerald-200">
              Proposta importata per {result.user.fullName}
            </p>
            <p className="text-xs text-emerald-800/80 dark:text-emerald-300/80">
              {result.user.email} · AA <strong>{result.proposal.academicYear}</strong>
            </p>
          </div>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg border bg-muted/20 p-3">
          <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
            Fasce create
          </Label>
          <p className="mt-1 font-display text-2xl font-medium tabular-nums">
            {result.summary.schedulesCreated}
          </p>
        </div>
        <div className="rounded-lg border bg-muted/20 p-3">
          <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
            Ore pattern settimanali
          </Label>
          <p className="mt-1 font-display text-2xl font-medium tabular-nums">
            {result.summary.totalHoursPattern.toFixed(1)}
            <span className="text-sm font-normal text-muted-foreground"> h</span>
          </p>
        </div>
      </div>

      {result.summary.warnings.length > 0 && (
        <Alert variant="warning">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>
            {result.summary.warnings.length} avviso
            {result.summary.warnings.length === 1 ? '' : 'i'}
          </AlertTitle>
          <AlertDescription>
            <ul className="mt-1 list-inside list-disc space-y-0.5 text-xs">
              {result.summary.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      <DialogFooter>
        <Button variant="outline" onClick={onImportAnother}>
          <Upload className="h-4 w-4" />
          Importa un altro file
        </Button>
        <Button onClick={onClose}>Chiudi</Button>
      </DialogFooter>
    </div>
  );
}

export default ImportExcelDialog;
