import { useEffect, useState } from 'react';
import { Lock } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import type { ContractTypeRow } from '@/types';
import type { ContractTypeUpsertPayload } from '@/api/contractTypes';

interface Props {
  open: boolean;
  editing: ContractTypeRow | null;
  onClose: () => void;
  onSave: (payload: ContractTypeUpsertPayload) => void;
  saving: boolean;
}

function slugify(label: string): string {
  return label
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
}

export function ContractTypeFormDialog({ open, editing, onClose, onSave, saving }: Props) {
  const [label, setLabel] = useState(editing?.label ?? '');
  const [code, setCode] = useState(editing?.code ?? '');
  const [defaultHoursEnabled, setDefaultHoursEnabled] = useState(editing?.defaultHours != null);
  const [defaultHours, setDefaultHours] = useState<string>(
    editing?.defaultHours != null ? String(editing.defaultHours) : '',
  );
  const [bypassDay, setBypassDay] = useState(editing?.bypassDayConstraintDefault ?? false);
  const [isActive, setIsActive] = useState(editing?.isActive ?? true);
  const [sortOrder, setSortOrder] = useState<string>(String(editing?.sortOrder ?? 0));
  const [notes, setNotes] = useState(editing?.notes ?? '');

  // Auto-slug del code dal label se non si sta editando (CREATE mode).
  // In EDIT il code è immutabile.
  useEffect(() => {
    if (!editing) {
      setCode(slugify(label));
    }
  }, [label, editing]);

  const isEdit = !!editing;
  const isSystem = editing?.isSystem ?? false;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({
      ...(isEdit ? {} : { code: code || slugify(label) }),
      label: label.trim(),
      defaultHours: defaultHoursEnabled ? Number(defaultHours) : null,
      bypassDayConstraintDefault: bypassDay,
      isActive,
      sortOrder: Number(sortOrder) || 0,
      notes: notes.trim() || null,
    });
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? `Modifica tipologia "${editing.label}"` : 'Nuova tipologia contrattuale'}
          </DialogTitle>
          <DialogDescription>
            {isEdit
              ? 'Modifica etichetta, ore default e altre proprietà. Il codice è immutabile.'
              : 'Aggiungi un nuovo tipo contrattuale (es. "Borsa di studio 100h", "Distacco sindacale").'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          {/* Etichetta */}
          <div className="space-y-1.5">
            <Label htmlFor="ct-label">Etichetta *</Label>
            <Input
              id="ct-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Es. Titolare di cattedra"
              maxLength={80}
              required
              autoFocus
            />
          </div>

          {/* Code */}
          <div className="space-y-1.5">
            <Label htmlFor="ct-code" className="flex items-center gap-1.5">
              Codice
              {isEdit && <Lock className="h-3 w-3 text-muted-foreground" />}
            </Label>
            <Input
              id="ct-code"
              value={code}
              onChange={(e) => !isEdit && setCode(e.target.value.toLowerCase())}
              disabled={isEdit}
              placeholder="auto-generato dal label"
              maxLength={40}
              pattern="[a-z0-9_]+"
              className="font-mono text-xs"
            />
            <p className="text-xs text-muted-foreground">
              {isEdit
                ? 'Il codice non è modificabile dopo la creazione (preserva il riferimento dei docenti già assegnati).'
                : "Slug stabile auto-generato dall'etichetta. Solo a-z, 0-9, _ — max 40 caratteri."}
            </p>
          </div>

          {/* Ore default */}
          <div className="space-y-2 rounded-lg border p-3">
            <div className="flex items-center justify-between">
              <Label htmlFor="ct-hours-toggle" className="cursor-pointer">
                Soglia di ore predefinita
              </Label>
              <Switch
                id="ct-hours-toggle"
                checked={defaultHoursEnabled}
                onCheckedChange={setDefaultHoursEnabled}
              />
            </div>
            {defaultHoursEnabled && (
              <div className="flex items-center gap-2">
                <Input
                  id="ct-hours"
                  type="number"
                  min={0}
                  max={1500}
                  step={0.5}
                  value={defaultHours}
                  onChange={(e) => setDefaultHours(e.target.value)}
                  placeholder="es. 324"
                  className="max-w-[120px]"
                />
                <span className="text-sm text-muted-foreground">ore/anno</span>
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              Se valorizzata, viene usata come default per i docenti di questo tipo (a meno che non
              abbiano un override individuale). Se vuota, la soglia ricade sulle impostazioni
              istituzionali per anno accademico.
            </p>
          </div>

          {/* Bypass vincolo giorni */}
          <div className="flex items-start justify-between gap-3 rounded-lg border p-3">
            <div className="flex-1">
              <Label htmlFor="ct-bypass" className="cursor-pointer">
                Esente dal vincolo 2-4 giorni/settimana
              </Label>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Per contratti orari brevi che possono concentrare le lezioni in 1 giorno.
              </p>
            </div>
            <Switch id="ct-bypass" checked={bypassDay} onCheckedChange={setBypassDay} />
          </div>

          {/* Sort + Active */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="ct-sort">Ordine in lista</Label>
              <Input
                id="ct-sort"
                type="number"
                min={0}
                value={sortOrder}
                onChange={(e) => setSortOrder(e.target.value)}
              />
            </div>
            <div className="flex items-end justify-between gap-3 rounded-lg border p-3">
              <Label htmlFor="ct-active" className="cursor-pointer">
                Attiva
              </Label>
              <Switch id="ct-active" checked={isActive} onCheckedChange={setIsActive} />
            </div>
          </div>

          {/* Note */}
          <div className="space-y-1.5">
            <Label htmlFor="ct-notes">Note interne (opzionale)</Label>
            <Textarea
              id="ct-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Es. CCNL art. X, riferimenti normativi..."
              maxLength={500}
              rows={2}
            />
          </div>

          {isSystem && (
            <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
              Questo è un tipo di sistema: può essere modificato e disattivato, ma non eliminato.
            </p>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
              Annulla
            </Button>
            <Button type="submit" disabled={saving || !label.trim()}>
              {saving ? 'Salvataggio…' : isEdit ? 'Salva modifiche' : 'Crea tipologia'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
