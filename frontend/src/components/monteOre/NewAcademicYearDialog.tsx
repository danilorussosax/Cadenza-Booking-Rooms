import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  monteOreAdminApi,
  type AcademicYearOption,
  type AcademicYearPreview,
  type BootstrapAcademicYearPayload,
  type MonteOreSettings,
} from '@/api/monteOre';
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

interface Props {
  open: boolean;
  onClose: () => void;
  existingYears: AcademicYearOption[];
  suggestedYear?: string;
  onCreated?: (year: string) => void;
}

const dateFields = [
  ['lessonsStartDate', 'Inizio lezioni'],
  ['lessonsEndDate', 'Fine lezioni'],
  ['submissionWindowStart', 'Apertura invio'],
  ['submissionWindowEnd', 'Chiusura invio'],
] as const;

export function NewAcademicYearDialog(props: Props) {
  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
    >
      {props.open && <YearForm {...props} />}
    </Dialog>
  );
}

function YearForm({ existingYears, suggestedYear, onClose, onCreated }: Props) {
  const qc = useQueryClient();
  const [payload, setPayload] = useState<BootstrapAcademicYearPayload>({
    academicYear: suggestedYear ?? '',
    mode: 'default',
    copyRules: true,
    copyCalendar: true,
    copyCustom: true,
    copyExamSessions: true,
  });
  const [preview, setPreview] = useState<AcademicYearPreview | null>(null);
  const [reviewed, setReviewed] = useState(false);
  const [step, setStep] = useState(1);
  const year = payload.academicYear;
  const [start, end] = year.split('/').map(Number);
  const valid = /^\d{4}\/\d{4}$/.test(year) && start >= 1900 && end === start + 1;
  const exists = existingYears.some((y) => y.academicYear === year && y.hasSettings);
  const sources = existingYears.filter((y) => y.hasSettings && y.academicYear < year);
  const previewMut = useMutation({
    mutationFn: () => monteOreAdminApi.previewAcademicYear(payload),
    onSuccess: (data) => {
      setPreview(data);
      setReviewed(true);
      setStep(2);
    },
  });
  const createMut = useMutation({
    mutationFn: (publish: boolean) =>
      monteOreAdminApi.createAcademicYear({ ...payload, settings: preview?.settings, publish }),
    onSuccess: (data) => {
      void qc.invalidateQueries({ queryKey: ['monte-ore'] });
      void qc.invalidateQueries({ queryKey: ['admin', 'monte-ore'] });
      toast.success(
        data.settings.status === 'published'
          ? `AA ${year} pubblicato`
          : `AA ${year} salvato in bozza`,
      );
      onCreated?.(year);
      onClose();
    },
  });
  const pending = previewMut.isPending || createMut.isPending;
  const change = (patch: Partial<BootstrapAcademicYearPayload>) => {
    setPayload((p) => ({ ...p, ...patch }));
    setReviewed(false);
  };
  const changeSetting = (key: keyof MonteOreSettings, value: string | number) => {
    if (!preview) return;
    setPreview({ ...preview, settings: { ...preview.settings, [key]: value } });
    setPayload((p) => ({ ...p, settings: { ...preview.settings, [key]: value } }));
    setReviewed(false);
  };
  const error = previewMut.error ?? createMut.error;
  return (
    <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle>Crea nuovo anno accademico</DialogTitle>
        <DialogDescription>
          {step === 1
            ? '1. Scegli anno e origine dei dati'
            : '2. Controlla il calendario e salva o pubblica'}
        </DialogDescription>
      </DialogHeader>
      <fieldset disabled={pending} className="space-y-4 min-w-0">
        {step === 1 ? (
          <>
            <Label htmlFor="aa-input">Anno accademico</Label>
            <Input
              id="aa-input"
              value={year}
              placeholder="2026/2027"
              maxLength={9}
              onChange={(e) => change({ academicYear: e.target.value.trim(), settings: undefined })}
            />
            {year && !valid && (
              <p className="text-sm text-destructive">
                Formato non valido: usa YYYY/YYYY, con il secondo anno uguale al primo + 1.
              </p>
            )}
            {exists && (
              <p className="text-sm text-destructive">
                Questo anno esiste già. Modificalo dal calendario didattico.
              </p>
            )}
            <Label htmlFor="year-origin">Origine dati</Label>
            <select
              id="year-origin"
              className="w-full rounded-md border bg-background p-2"
              value={payload.mode}
              onChange={(e) =>
                change({
                  mode: e.target.value as 'default' | 'from_previous',
                  previousYear: sources[0]?.academicYear,
                  settings: undefined,
                })
              }
            >
              <option value="default">Configurazione standard</option>
              <option value="from_previous" disabled={!sources.length}>
                Copia da un anno precedente
              </option>
            </select>
            {payload.mode === 'from_previous' && (
              <>
                <Label htmlFor="previous-year">Anno da cui copiare</Label>
                <select
                  id="previous-year"
                  className="w-full rounded-md border bg-background p-2"
                  value={payload.previousYear ?? ''}
                  onChange={(e) => change({ previousYear: e.target.value, settings: undefined })}
                >
                  <option value="" disabled>
                    Scegli un anno
                  </option>
                  {sources.map((s) => (
                    <option key={s.academicYear} value={s.academicYear}>
                      {s.academicYear}
                    </option>
                  ))}
                </select>
                {(
                  [
                    ['copyRules', 'Regole: soglia ore, variazioni e vincoli giornalieri'],
                    ['copyCalendar', 'Periodo lezioni e finestra di invio'],
                    ['copyCustom', 'Sospensioni personalizzate'],
                    ['copyExamSessions', 'Sessioni d’esame'],
                  ] as const
                ).map(([key, label]) => (
                  <label key={key} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={payload[key]}
                      onChange={(e) => change({ [key]: e.target.checked, settings: undefined })}
                    />
                    {label}
                  </label>
                ))}
              </>
            )}
            <p className="text-sm text-muted-foreground">
              Le sei sospensioni standard sono ricalcolate: Immacolata, Natale, Pasqua, 25 aprile, 1
              maggio e 2 giugno. Potrai aggiungere altre chiusure dal calendario.
            </p>
          </>
        ) : (
          preview && (
            <>
              <p className="font-medium">
                AA {year} · {preview.settings.academicYearStart} →{' '}
                {preview.settings.academicYearEnd}
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                {dateFields.map(([key, label]) => (
                  <div key={key}>
                    <Label htmlFor={key}>{label}</Label>
                    <Input
                      id={key}
                      type="date"
                      value={preview.settings[key]}
                      onChange={(e) => changeSetting(key, e.target.value)}
                    />
                  </div>
                ))}
                <div>
                  <Label htmlFor="year-hours">Soglia minima ore</Label>
                  <Input
                    id="year-hours"
                    type="number"
                    min={0}
                    step={0.5}
                    value={preview.settings.minRequiredHours}
                    onChange={(e) => changeSetting('minRequiredHours', Number(e.target.value))}
                  />
                </div>
                <div>
                  <Label htmlFor="year-amendments">Max variazioni annue</Label>
                  <Input
                    id="year-amendments"
                    type="number"
                    min={0}
                    value={preview.settings.maxAmendmentsPerYear}
                    onChange={(e) => changeSetting('maxAmendmentsPerYear', Number(e.target.value))}
                  />
                </div>
              </div>
              <p className="text-sm">
                Limite giornaliero: {preview.settings.maxHoursPerDay ?? 'non impostato'} ore. Pausa:{' '}
                {preview.settings.dailyBreakMinutes ?? 'non impostata'} min dopo{' '}
                {preview.settings.dailyBreakAfterHours ?? '—'} ore.
              </p>
              <div className="rounded-md border p-3 text-sm space-y-1">
                <p className="font-medium">Sospensioni previste ({preview.suspensions.length})</p>
                {preview.suspensions.map((s, i) => (
                  <p key={`${s.name}-${i}`}>
                    {s.name}: {s.dateFrom} → {s.dateTo}
                  </p>
                ))}
              </div>
              {reviewed && (
                <p className="text-sm">
                  Giorni senza sospensioni (lun–sab):{' '}
                  {[1, 2, 3, 4, 5, 6].map((d) => preview.availableDays[d]).join(' · ')}. Il
                  conteggio non include disponibilità delle aule e vincoli del piano.
                </p>
              )}
              {preview.warnings.map((w) => (
                <Alert key={w}>
                  <AlertDescription>{w}</AlertDescription>
                </Alert>
              ))}
              <p className="text-sm text-muted-foreground">
                La bozza resta riservata all’amministrazione. Pubblicare rende l’anno disponibile
                secondo le date di invio; non apre automaticamente la finestra.
              </p>
            </>
          )
        )}
      </fieldset>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{httpErrorMessage(error)}</AlertDescription>
        </Alert>
      )}
      <DialogFooter className="gap-2">
        <Button variant="outline" onClick={onClose} disabled={pending}>
          Annulla
        </Button>
        {step === 2 && (
          <Button
            variant="outline"
            disabled={pending}
            onClick={() => {
              setStep(1);
              setReviewed(false);
            }}
          >
            Indietro
          </Button>
        )}
        {step === 1 || !reviewed ? (
          <Button
            disabled={
              pending ||
              !valid ||
              exists ||
              (payload.mode === 'from_previous' &&
                !sources.some((s) => s.academicYear === payload.previousYear))
            }
            onClick={() => previewMut.mutate()}
          >
            {pending ? 'Verifica…' : step === 1 ? 'Controlla anteprima' : 'Aggiorna anteprima'}
          </Button>
        ) : (
          <>
            <Button variant="outline" disabled={pending} onClick={() => createMut.mutate(false)}>
              Salva bozza
            </Button>
            <Button disabled={pending} onClick={() => createMut.mutate(true)}>
              Pubblica anno
            </Button>
          </>
        )}
      </DialogFooter>
    </DialogContent>
  );
}
export default NewAcademicYearDialog;
