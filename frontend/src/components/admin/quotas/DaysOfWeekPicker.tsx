import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { Label } from '@/components/ui/label';
// =====================================================
// Picker giorni della settimana — toggle multi-selezione (0=dom .. 6=sab).
// Array vuoto = "tutti i giorni" (semantica del backend), così l'utente
// non deve toggleare 7 giorni ogni volta.
// =====================================================
const DOW_LABELS: { value: number; label: string }[] = [
  { value: 1, label: 'Lun' },
  { value: 2, label: 'Mar' },
  { value: 3, label: 'Mer' },
  { value: 4, label: 'Gio' },
  { value: 5, label: 'Ven' },
  { value: 6, label: 'Sab' },
  { value: 0, label: 'Dom' },
];

export function DaysOfWeekPicker({
  value,
  onChange,
}: {
  value: number[];
  onChange: (v: number[]) => void;
}) {
  const { t } = useTranslation();
  const toggle = (d: number) => {
    if (value.includes(d)) onChange(value.filter((x) => x !== d));
    else onChange([...value, d].sort());
  };
  return (
    <div className="space-y-2">
      <Label>{t('admin.quotas.field.days_of_week')}</Label>
      <div className="flex flex-wrap gap-1">
        {DOW_LABELS.map((d) => {
          const active = value.includes(d.value);
          return (
            <button
              key={d.value}
              type="button"
              onClick={() => {
                toggle(d.value);
              }}
              className={cn(
                'min-w-[44px] rounded-md border px-2.5 py-1 text-xs font-medium transition-colors',
                active
                  ? 'border-primary bg-primary/10 text-foreground'
                  : 'bg-background text-muted-foreground hover:border-primary/40',
              )}
            >
              {d.label}
            </button>
          );
        })}
      </div>
      <p className="text-[11px] text-muted-foreground">
        {t('admin.quotas.field.days_of_week_help')}
      </p>
    </div>
  );
}
