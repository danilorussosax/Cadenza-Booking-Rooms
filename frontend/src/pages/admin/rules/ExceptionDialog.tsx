import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarRange, Clock, DoorOpen, LoaderCircle } from 'lucide-react';
import { toast } from 'sonner';
import { rulesApi, type OverlapBooking, type UpsertExceptionPayload } from '@/api/rules';
import { roomsApi } from '@/api/rooms';
import { httpErrorMessage } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type {
  BookingRuleException,
  BookingRuleExceptionKind,
  BookingRuleExceptionScope,
} from '@/types';
import { todayLocalIso } from '@/lib/date';
import { qk } from '@/lib/queryKeys';
import { invalidateRuleExceptions } from '@/lib/invalidation';
import {
  DAYS_LABELS,
  blankException,
  fromException,
  isPastOnlyRange,
  toggleDay,
  validateException,
  type ExceptionFormState,
} from '@/lib/ruleExceptions';
import { useTranslation } from 'react-i18next';

// =====================================================
// Dialog: crea/modifica eccezione
export function ExceptionDialog({
  open,
  existing,
  defaultRole,
  defaultRoomId,
  onClose,
  onSaved,
}: {
  open: boolean;
  existing: BookingRuleException | null;
  defaultRole: BookingRuleExceptionScope;
  defaultRoomId?: number;
  onClose: () => void;
  onSaved?: (saved: BookingRuleException, overlapping: OverlapBooking[]) => void;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [form, setForm] = useState<ExceptionFormState>(() =>
    existing ? fromException(existing) : blankException(defaultRole, defaultRoomId),
  );
  const [error, setError] = useState<string | null>(null);

  // Lista aule per il select "Aula" — caricata solo quando il dialog è aperto.
  const roomsQuery = useQuery({
    queryKey: qk.rooms.listAll(),
    queryFn: () => roomsApi.list(),
    enabled: open,
    staleTime: 5 * 60 * 1000,
  });
  // Ordino per Sede → Aula così l'admin distingue numeri ripetuti tra edifici.
  const rooms = [...(roomsQuery.data?.rooms ?? [])].sort((a, b) => {
    const ba = a.building?.name ?? '￿';
    const bb = b.building?.name ?? '￿';
    if (ba !== bb) return ba.localeCompare(bb, 'it');
    return a.name.localeCompare(b.name, 'it');
  });

  useEffect(() => {
    if (open) {
      setForm(existing ? fromException(existing) : blankException(defaultRole, defaultRoomId));
      setError(null);
    }
  }, [open, existing, defaultRole, defaultRoomId]);

  const mutation = useMutation({
    mutationFn: async (payload: UpsertExceptionPayload) => {
      const saved = existing
        ? await rulesApi.updateException(existing.id, payload)
        : await rulesApi.createException(payload);
      // Per i block carichiamo subito l'overlap così mostriamo il dialog
      // di follow-up senza un round-trip aggiuntivo lato chiamante.
      let overlapping: OverlapBooking[] = [];
      if (payload.kind === 'block') {
        try {
          const r = await rulesApi.previewOverlaps(payload);
          overlapping = r.overlapping;
        } catch {
          // Il preview è best-effort: se fallisce, salvo senza follow-up.
        }
      }
      return { saved: saved.exception, overlapping };
    },
    onSuccess: ({ saved, overlapping }) => {
      toast.success(
        existing ? t('toasts.rules.exception_updated') : t('toasts.rules.exception_created'),
      );
      void invalidateRuleExceptions(qc);
      onClose();
      onSaved?.(saved, overlapping);
    },
    onError: (err) => {
      setError(httpErrorMessage(err));
    },
  });

  const dayToggle = (d: number) => {
    setForm((f) => ({ ...f, daysOfWeek: toggleDay(f.daysOfWeek, d) }));
  };

  // Avviso "range tutto nel passato": un block con dateTo < oggi non
  // intercetterà mai prenotazioni future. Lo segnaliamo inline (non
  // bloccante: l'admin potrebbe avere un motivo storico/audit).
  const pastOnlyRange = isPastOnlyRange(form, todayLocalIso());

  const submit = () => {
    setError(null);
    const result = validateException(form);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    const payload = result.payload;
    mutation.mutate(payload);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{existing ? 'Modifica eccezione' : 'Nuova eccezione'}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="exc-name">Nome</Label>
            <Input
              id="exc-name"
              placeholder='Es. "Pausa pranzo", "Sospensione didattica"'
              value={form.name}
              onChange={(e) => {
                setForm((f) => ({ ...f, name: e.target.value }));
              }}
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Tipo</Label>
              <Select
                value={form.kind}
                onValueChange={(v) => {
                  setForm((f) => ({ ...f, kind: v as BookingRuleExceptionKind }));
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="block">Blocco totale</SelectItem>
                  <SelectItem value="time_window">Limite ore in finestra</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Si applica a</Label>
              <Select
                value={form.role}
                onValueChange={(v) => {
                  setForm((f) => ({ ...f, role: v as BookingRuleExceptionScope }));
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tutti i ruoli</SelectItem>
                  <SelectItem value="studente">Solo studenti</SelectItem>
                  <SelectItem value="docente">Solo docenti</SelectItem>
                  <SelectItem value="admin">Solo amministratori</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="flex items-center gap-1.5">
              <DoorOpen className="h-3.5 w-3.5 text-violet-600 dark:text-violet-400" />
              Aula
            </Label>
            <Select
              value={form.roomScope}
              onValueChange={(v) => {
                setForm((f) => ({ ...f, roomScope: v }));
              }}
            >
              <SelectTrigger>
                <SelectValue
                  placeholder={roomsQuery.isLoading ? 'Caricamento…' : 'Tutte le aule'}
                />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tutte le aule</SelectItem>
                {rooms.map((r) => (
                  <SelectItem key={r.id} value={String(r.id)}>
                    {r.building?.name ? `${r.building.name} · ${r.name}` : r.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground">
              Lascia "Tutte le aule" per applicare l'eccezione globalmente. Selezionando un'aula
              specifica, l'eccezione bloccherà o limiterà solo le prenotazioni di quell'aula.
            </p>
          </div>

          {form.kind === 'time_window' && (
            <div className="space-y-1.5">
              <Label htmlFor="exc-max">Ore massime nella finestra</Label>
              <Input
                id="exc-max"
                type="number"
                step="0.5"
                min="0.25"
                value={form.maxHoursInWindow}
                onChange={(e) => {
                  setForm((f) => ({ ...f, maxHoursInWindow: e.target.value }));
                }}
              />
              <p className="text-[11px] text-muted-foreground">
                Es. 1 = max 1h prenotabile complessivamente nella finestra oraria.
              </p>
            </div>
          )}

          <div className="space-y-2">
            <Label className="flex items-center gap-1.5">
              <CalendarRange className="h-3.5 w-3.5 text-indigo-600 dark:text-indigo-400" />
              Giorni della settimana
            </Label>
            <div className="flex flex-wrap gap-1">
              {DAYS_LABELS.map((label, idx) => {
                const isOn = form.daysOfWeek.includes(idx);
                return (
                  <button
                    type="button"
                    key={idx}
                    onClick={() => {
                      dayToggle(idx);
                    }}
                    className={`rounded-md border px-3 py-1 text-xs transition-colors ${
                      isOn
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'bg-background hover:bg-muted'
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
            <p className="text-[11px] text-muted-foreground">
              Lascia tutti i giorni deselezionati per applicare ogni giorno.
            </p>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Data specifica</Label>
              <label className="inline-flex items-center gap-2 text-xs text-muted-foreground">
                <Switch
                  checked={form.singleDate}
                  onCheckedChange={(v) => {
                    setForm((f) => ({
                      ...f,
                      singleDate: v,
                      dateTo: v ? '' : f.dateTo,
                    }));
                  }}
                />
                Data singola
              </label>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Input
                type="date"
                value={form.dateFrom}
                onChange={(e) => {
                  setForm((f) => ({ ...f, dateFrom: e.target.value }));
                }}
                placeholder="Data inizio"
              />
              {!form.singleDate && (
                <Input
                  type="date"
                  value={form.dateTo}
                  onChange={(e) => {
                    setForm((f) => ({ ...f, dateTo: e.target.value }));
                  }}
                  placeholder="Data fine"
                />
              )}
            </div>
            {pastOnlyRange && (
              <Alert variant="destructive" className="text-xs">
                <AlertDescription>
                  Il periodo selezionato è già passato: questa eccezione non bloccherà nessuna
                  prenotazione futura. Se vuoi annullare prenotazioni programmate, scegli un
                  intervallo che includa date a partire da oggi.
                </AlertDescription>
              </Alert>
            )}
          </div>

          <div className="space-y-2">
            <Label className="flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
              Fascia oraria
            </Label>
            <div className="grid gap-3 sm:grid-cols-2">
              <Input
                type="time"
                value={form.startTime}
                onChange={(e) => {
                  setForm((f) => ({ ...f, startTime: e.target.value }));
                }}
              />
              <Input
                type="time"
                value={form.endTime}
                onChange={(e) => {
                  setForm((f) => ({ ...f, endTime: e.target.value }));
                }}
              />
            </div>
            <p className="text-[11px] text-muted-foreground">
              Lascia vuoto per applicare l'eccezione all'intero giorno.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="exc-notes">Note (opzionale)</Label>
            <Textarea
              id="exc-notes"
              rows={2}
              value={form.notes}
              onChange={(e) => {
                setForm((f) => ({ ...f, notes: e.target.value }));
              }}
            />
          </div>

          <div className="flex items-center justify-between rounded-lg border bg-muted/30 p-3">
            <div>
              <p className="text-sm font-medium">Eccezione attiva</p>
              <p className="text-[11px] text-muted-foreground">
                Disattivala per disabilitarla senza eliminarla.
              </p>
            </div>
            <Switch
              checked={form.isActive}
              onCheckedChange={(v) => {
                setForm((f) => ({ ...f, isActive: v }));
              }}
            />
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Annulla
          </Button>
          <Button type="button" onClick={submit} disabled={mutation.isPending}>
            {mutation.isPending ? (
              <LoaderCircle className="h-4 w-4 animate-spin" />
            ) : existing ? (
              'Salva'
            ) : (
              'Crea eccezione'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
