import { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, CheckCircle2, Download, FileUp, LoaderCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { instrumentsApi } from '@/api/instruments';
import { httpErrorMessage } from '@/lib/api';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface ImportResult {
  rowsTotal: number;
  created: number;
  updated: number;
  skipped: number;
  errors: { row: number; message: string }[];
}

const SAMPLE_CSV = `code;name;family;brand;model;serialNumber;condition;isLoanable;notes
INV-001;Violino 4/4;archi;Stentor;Student II;SN-12345;buono;si;Custodia rigida inclusa
INV-002;Pianoforte verticale;tastiere;Yamaha;U3;Y-9988;ottimo;no;Solo uso interno
INV-003;Sax contralto;fiati_legni;Selmer;Mark VI;SVI-4477;da_riparare;no;Tampone Re# da sostituire
`;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function InstrumentsCsvImportDialog({ open, onOpenChange }: Props) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [csv, setCsv] = useState('');
  const [fileName, setFileName] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);

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
    setServerError(null);
  };

  const importMutation = useMutation({
    mutationFn: () => instrumentsApi.importCsv(csv),
    onSuccess: ({ result }) => {
      setResult(result);
      void qc.invalidateQueries({ queryKey: ['instruments'] });
      void qc.invalidateQueries({ queryKey: ['admin', 'instruments'] });
      toast.success(
        `${result.created + result.updated} strumenti · ${result.created} creati · ${result.updated} aggiornati`,
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
    a.download = 'template-instruments.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('admin.instruments.import_dialog.title')}</DialogTitle>
          <DialogDescription>{t('admin.instruments.import_dialog.description')}</DialogDescription>
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
                <p className="font-medium">{t('admin.instruments.import_dialog.result_title')}</p>
                <ul className="mt-1 grid grid-cols-2 gap-x-4 text-xs">
                  <li>
                    {t('admin.instruments.import_dialog.row_total')}: {result.rowsTotal}
                  </li>
                  <li>
                    {t('admin.instruments.import_dialog.created')}: {result.created}
                  </li>
                  <li>
                    {t('admin.instruments.import_dialog.updated')}: {result.updated}
                  </li>
                  <li>
                    {t('admin.instruments.import_dialog.skipped')}: {result.skipped}
                  </li>
                </ul>
                {result.errors.length > 0 && (
                  <div className="mt-2 text-xs">
                    <p className="font-medium text-destructive">
                      {t('admin.instruments.import_dialog.errors_label')} {result.errors.length}
                    </p>
                    <ul className="mt-1 list-disc pl-5 text-destructive">
                      {result.errors.slice(0, 6).map((e, i) => (
                        <li key={i}>
                          #{e.row}: {e.message}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </AlertDescription>
            </Alert>
          )}

          <div className="grid gap-2">
            <Label>CSV</Label>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => fileRef.current?.click()}
                disabled={importMutation.isPending}
              >
                <FileUp className="h-4 w-4" />
                {fileName
                  ? t('admin.instruments.import_dialog.change_file')
                  : t('admin.instruments.import_dialog.select_file')}
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
                {t('admin.instruments.import_dialog.download_template')}
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
              {t('admin.instruments.import_dialog.supported_columns')}
            </p>
          </div>

          {csv && !result && (
            <div className="rounded-md border bg-muted/30 p-3 text-xs">
              <p className="mb-1 font-medium text-muted-foreground">
                {t('admin.instruments.import_dialog.preview_label')}
              </p>
              <pre className="max-h-32 overflow-auto whitespace-pre-wrap font-mono text-[11px]">
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
            {t('admin.instruments.import_dialog.close')}
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
                {t('admin.instruments.import_dialog.submit')}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
