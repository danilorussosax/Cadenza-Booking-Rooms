import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  ArrowDown,
  ArrowUp,
  BookOpen,
  Calendar,
  Eye,
  EyeOff,
  GraduationCap,
  LoaderCircle,
  Mic,
  Music,
  Save,
  Tag,
} from 'lucide-react';
import { bookingTypesApi, type BookingTypeUpdatePayload } from '@/api/bookingTypes';
import { httpErrorMessage } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { BookingTypeCatalog } from '@/types';

// Mappa ICON → componente lucide-react. Chi rinomina l'icona via Save deve
// scegliere da questo set per garantire il render. Aggiungere icone qui se
// servono nuove categorie tematiche.
const ICON_OPTIONS = [
  { value: 'GraduationCap', component: GraduationCap, label: 'Lezione' },
  { value: 'BookOpen', component: BookOpen, label: 'Studio' },
  { value: 'Mic', component: Mic, label: 'Microfono' },
  { value: 'Music', component: Music, label: 'Musica' },
  { value: 'Calendar', component: Calendar, label: 'Calendario' },
  { value: 'Tag', component: Tag, label: 'Etichetta' },
] as const;

function IconByName({ name, className }: { name: string; className?: string }) {
  const found = ICON_OPTIONS.find((o) => o.value === name);
  const Comp = found?.component ?? Calendar;
  return <Comp className={className ?? 'h-4 w-4'} />;
}

export default function AdminBookingTypes() {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ['booking-types', 'admin'],
    queryFn: () => bookingTypesApi.listAdmin(),
  });

  const types = query.data?.types ?? [];

  return (
    <div className="space-y-6">
      <header className="space-y-1.5">
        <h1 className="font-display text-3xl font-medium">Tipi prenotazione</h1>
        <p className="text-sm text-muted-foreground">
          Personalizza label, colori, icone e ordine dei tipi disponibili nelle prenotazioni. I 5
          tipi base sono protetti dall'eliminazione ma puoi disattivarli e modificarli.
        </p>
      </header>

      <Alert>
        <Tag className="h-4 w-4" />
        <AlertDescription>
          In questa release i 5 tipi sono fissi (richiesta migration formale per aggiungerne). Puoi
          modificare label, colori, icone, ordine e durata default. Disattivare un tipo lo nasconde
          dalla dropdown utente ma le prenotazioni esistenti restano intatte.
        </AlertDescription>
      </Alert>

      {query.isLoading ? (
        <div className="space-y-3">
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-32 w-full" />
          ))}
        </div>
      ) : (
        <div className="space-y-3">
          {types.map((t, idx) => (
            <BookingTypeCard
              key={t.code}
              type={t}
              prevCode={types[idx - 1]?.code ?? null}
              nextCode={types[idx + 1]?.code ?? null}
              onUpdate={async (payload) => {
                try {
                  await bookingTypesApi.update(t.code, payload);
                  toast.success(`Tipo "${t.label}" aggiornato`);
                  void qc.invalidateQueries({ queryKey: ['booking-types'] });
                } catch (err) {
                  toast.error(httpErrorMessage(err));
                }
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function BookingTypeCard({
  type,
  prevCode,
  nextCode,
  onUpdate,
}: {
  type: BookingTypeCatalog;
  prevCode: string | null;
  nextCode: string | null;
  onUpdate: (payload: BookingTypeUpdatePayload) => Promise<void>;
}) {
  const [label, setLabel] = useState(type.label);
  const [color, setColor] = useState(type.color);
  const [icon, setIcon] = useState(type.icon);
  const [defaultDur, setDefaultDur] = useState(
    type.defaultDurationMinutes != null ? String(type.defaultDurationMinutes) : '',
  );
  const [description, setDescription] = useState(type.description ?? '');
  const [saving, setSaving] = useState(false);

  const dirty =
    label !== type.label ||
    color !== type.color ||
    icon !== type.icon ||
    String(type.defaultDurationMinutes ?? '') !== defaultDur ||
    (type.description ?? '') !== description;

  const handleSave = async () => {
    setSaving(true);
    try {
      await onUpdate({
        label: label.trim() || type.label,
        color,
        icon,
        defaultDurationMinutes: defaultDur ? Number(defaultDur) : null,
        description: description.trim() || null,
      });
    } finally {
      setSaving(false);
    }
  };

  const moveMutation = useMutation({
    mutationFn: (delta: number) => onUpdate({ sortOrder: Math.max(0, type.sortOrder + delta) }),
  });

  const toggleActiveMutation = useMutation({
    mutationFn: (newActive: boolean) => onUpdate({ isActive: newActive }),
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg"
            style={{ backgroundColor: color + '20', color }}
          >
            <IconByName name={icon} className="h-5 w-5" />
          </span>
          <div>
            <CardTitle className="font-display text-lg flex items-center gap-2">
              {type.label}
              {type.isSystem && (
                <Badge variant="secondary" className="text-[10px]">
                  base
                </Badge>
              )}
              {!type.isActive && (
                <Badge variant="muted" className="text-[10px]">
                  disattivato
                </Badge>
              )}
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              <code className="text-[11px]">{type.code}</code> · ordine {type.sortOrder}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="icon"
            disabled={!prevCode || moveMutation.isPending}
            onClick={() => moveMutation.mutate(-1)}
            title="Sposta su"
          >
            <ArrowUp className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            disabled={!nextCode || moveMutation.isPending}
            onClick={() => moveMutation.mutate(1)}
            title="Sposta giù"
          >
            <ArrowDown className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            disabled={toggleActiveMutation.isPending}
            onClick={() => toggleActiveMutation.mutate(!type.isActive)}
            title={type.isActive ? 'Disattiva' : 'Attiva'}
          >
            {type.isActive ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 pt-0 sm:pt-0">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor={`label-${type.code}`}>Etichetta visibile</Label>
            <Input
              id={`label-${type.code}`}
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              maxLength={100}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`color-${type.code}`}>Colore</Label>
            <div className="flex items-center gap-2">
              <Input
                id={`color-${type.code}`}
                type="color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                className="w-16 cursor-pointer"
              />
              <Input
                value={color}
                onChange={(e) => setColor(e.target.value)}
                placeholder="#3b82f6"
                pattern="#[0-9a-fA-F]{6}"
                className="flex-1 font-mono text-sm"
              />
            </div>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>Icona</Label>
            <Select value={icon} onValueChange={setIcon}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ICON_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    <span className="inline-flex items-center gap-2">
                      <o.component className="h-4 w-4" />
                      {o.label}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor={`dur-${type.code}`}>Durata default (minuti)</Label>
            <Input
              id={`dur-${type.code}`}
              type="number"
              min={5}
              max={1440}
              step={5}
              value={defaultDur}
              onChange={(e) => setDefaultDur(e.target.value)}
              placeholder="es. 60 (lascia vuoto se non vuoi pre-fill)"
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor={`desc-${type.code}`}>Descrizione (tooltip nel form)</Label>
          <Textarea
            id={`desc-${type.code}`}
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={500}
            placeholder="Descrizione opzionale mostrata come help text"
          />
        </div>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Switch
              checked={type.isActive}
              disabled={toggleActiveMutation.isPending}
              onCheckedChange={(v) => toggleActiveMutation.mutate(v)}
              aria-label="Attivo"
            />
            <span className="text-sm text-muted-foreground">
              {type.isActive ? 'Visibile nelle prenotazioni' : 'Nascosto'}
            </span>
          </div>
          <Button onClick={handleSave} disabled={!dirty || saving}>
            {saving ? (
              <LoaderCircle className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            Salva modifiche
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
