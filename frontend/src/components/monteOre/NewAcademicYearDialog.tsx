import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CalendarPlus, Info } from 'lucide-react';
import {
  monteOreAdminApi,
  type AcademicYearBootstrapMode,
  type AcademicYearOption,
} from '@/api/monteOre';
import { httpErrorMessage } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const AA_REGEX = /^\d{4}\/\d{4}$/;

/**
 * Validazione client-side del formato AA "YYYY/YYYY" con secondo anno = primo + 1.
 * Replica la validazione backend (`/api/admin/monte-ore/academic-years` 400).
 */
function validateAcademicYear(input: string): { ok: boolean; error?: string } {
  if (!input) return { ok: false, error: "Indica l'anno accademico." };
  if (!AA_REGEX.test(input)) {
    return { ok: false, error: 'Formato non valido (atteso "YYYY/YYYY").' };
  }
  const [a, b] = input.split('/').map(Number);
  if (b !== a + 1) {
    return {
      ok: false,
      error: 'Il secondo anno deve essere il primo + 1 (es. 2026/2027).',
    };
  }
  return { ok: true };
}

interface Props {
  open: boolean;
  onClose: () => void;
  /**
   * Lista completa degli AA già esistenti, usata per popolare il select
   * "AA precedente" in mode=from_previous e per pre-compilare l'AA candidato.
   */
  existingYears: AcademicYearOption[];
  /** AA suggerito da pre-compilare (es. il primo AA con `canCreateNew=true`). */
  suggestedYear?: string;
  /** Callback dopo creazione riuscita (per selezionare il nuovo AA, ecc.). */
  onCreated?: (academicYear: string) => void;
}

export function NewAcademicYearDialog({
  open,
  onClose,
  existingYears,
  suggestedYear,
  onCreated,
}: Props) {
  const qc = useQueryClient();
  const [academicYear, setAcademicYear] = useState(suggestedYear ?? '');
  const [mode, setMode] = useState<AcademicYearBootstrapMode>('default');
  const [previousYear, setPreviousYear] = useState<string>('');
  const [overwrite, setOverwrite] = useState(false);

  // Re-inizializza il form ogni volta che il dialog si apre con una proposta
  // di AA diversa (utente cambia voce nel selettore).
  const resetForm = () => {
    setAcademicYear(suggestedYear ?? '');
    setMode('default');
    setPreviousYear('');
    setOverwrite(false);
  };

  const validation = useMemo(() => validateAcademicYear(academicYear), [academicYear]);

  const preview = useMemo(() => {
    if (!validation.ok) return null;
    const [a, b] = academicYear.split('/').map(Number);
    return { startYear: a, endYear: b };
  }, [academicYear, validation.ok]);

  // Solo AA esistenti = candidati validi per "da AA precedente".
  const previousYearOptions = existingYears.filter((y) => y.hasSettings);

  const createMutation = useMutation({
    mutationFn: () =>
      monteOreAdminApi.createAcademicYear({
        academicYear,
        mode,
        previousYear: mode === 'from_previous' ? previousYear || null : null,
        overwrite,
      }),
    onSuccess: (data) => {
      const created = data.suspensionsCreated;
      const skipped = data.suspensionsSkipped;
      toast.success(
        `AA ${academicYear} creato — ${created} sospensioni inserite` +
          (skipped > 0 ? `, ${skipped} saltate (già presenti)` : ''),
      );
      void qc.invalidateQueries({ queryKey: ['monte-ore', 'academic-years'] });
      void qc.invalidateQueries({ queryKey: ['admin', 'monte-ore'] });
      onCreated?.(academicYear);
      resetForm();
      onClose();
    },
    onError: (err) => {
      toast.error(httpErrorMessage(err));
    },
  });

  const canSubmit =
    validation.ok && (mode === 'default' || !!previousYear) && !createMutation.isPending;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          resetForm();
          onClose();
        }
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarPlus className="h-5 w-5 text-primary" />
            Crea nuovo anno accademico
          </DialogTitle>
          <DialogDescription>
            Inizializza calendario didattico, finestra inserimento e festività per l'AA scelto.
          </DialogDescription>
        </DialogHeader>

        <form
          className="space-y-5"
          onSubmit={(e) => {
            e.preventDefault();
            if (canSubmit) createMutation.mutate();
          }}
        >
          {/* Campo AA + preview */}
          <div className="space-y-2">
            <Label htmlFor="aa-input">Anno accademico</Label>
            <Input
              id="aa-input"
              value={academicYear}
              placeholder="2026/2027"
              autoComplete="off"
              maxLength={9}
              onChange={(e) => setAcademicYear(e.target.value.trim())}
              aria-invalid={academicYear !== '' && !validation.ok}
            />
            {academicYear !== '' && !validation.ok && (
              <p className="text-xs text-destructive">{validation.error}</p>
            )}
            {preview && (
              <p className="text-xs text-muted-foreground">
                Calendario: <strong>1 novembre {preview.startYear}</strong> →{' '}
                <strong>31 ottobre {preview.endYear}</strong>
              </p>
            )}
          </div>

          {/* Mode radio */}
          <div className="space-y-2">
            <Label>Origine dati</Label>
            <div className="grid gap-2">
              <label
                className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors ${
                  mode === 'default' ? 'border-primary bg-primary/5' : 'hover:bg-muted/30'
                }`}
              >
                <input
                  type="radio"
                  name="mode"
                  value="default"
                  checked={mode === 'default'}
                  onChange={() => setMode('default')}
                  className="mt-1 h-4 w-4 accent-primary"
                />
                <div>
                  <p className="text-sm font-medium">Default (festività deterministiche)</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Crea le festività canoniche del calendario italiano (1 nov, 8 dic, Natale,
                    Pasqua, 25 apr, 1 mag, 2 giu) + chiusure standard.
                  </p>
                </div>
              </label>
              <label
                className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors ${
                  mode === 'from_previous' ? 'border-primary bg-primary/5' : 'hover:bg-muted/30'
                }`}
              >
                <input
                  type="radio"
                  name="mode"
                  value="from_previous"
                  checked={mode === 'from_previous'}
                  onChange={() => setMode('from_previous')}
                  className="mt-1 h-4 w-4 accent-primary"
                  disabled={previousYearOptions.length === 0}
                />
                <div className="flex-1">
                  <p className="text-sm font-medium">
                    Da AA precedente (clona personalizzate +1 anno)
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Copia le sospensioni custom (es. ponti, recuperi) dall'AA scelto e ne fa
                    scorrere le date di un anno.
                  </p>
                  {previousYearOptions.length === 0 && (
                    <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
                      Nessun AA precedente disponibile da cui clonare.
                    </p>
                  )}
                </div>
              </label>
            </div>
          </div>

          {/* Select AA precedente (visibile solo se mode=from_previous) */}
          {mode === 'from_previous' && previousYearOptions.length > 0 && (
            <div className="space-y-2">
              <Label htmlFor="prev-aa">AA precedente da cui clonare</Label>
              <Select value={previousYear} onValueChange={setPreviousYear}>
                <SelectTrigger id="prev-aa">
                  <SelectValue placeholder="— scegli AA —" />
                </SelectTrigger>
                <SelectContent>
                  {previousYearOptions.map((y) => (
                    <SelectItem key={y.academicYear} value={y.academicYear}>
                      {y.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Overwrite */}
          <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-dashed p-3 hover:bg-muted/30">
            <Checkbox
              checked={overwrite}
              onCheckedChange={(v) => setOverwrite(v === true)}
              className="mt-0.5"
            />
            <div>
              <p className="text-sm font-medium">Sovrascrivi impostazioni esistenti</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Se l'AA è già stato creato, ne reimposta date di calendario e finestra inserimento
                ai default e ri-applica le festività deterministiche. Le proposte e gli amendment
                già presenti non vengono toccati.
              </p>
            </div>
          </label>

          {createMutation.error ? (
            <Alert variant="destructive">
              <Info className="h-4 w-4" />
              <AlertDescription>{httpErrorMessage(createMutation.error)}</AlertDescription>
            </Alert>
          ) : null}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                resetForm();
                onClose();
              }}
              disabled={createMutation.isPending}
            >
              Annulla
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              <CalendarPlus className="h-4 w-4" />
              {createMutation.isPending ? 'Creazione…' : 'Crea AA'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default NewAcademicYearDialog;
