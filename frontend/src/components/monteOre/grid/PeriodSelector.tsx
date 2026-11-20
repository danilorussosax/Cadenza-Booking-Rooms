import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import type { PeriodSelection } from './useMonteOreGridData';

interface PeriodSelectorProps {
  period: PeriodSelection;
  onChange: (next: PeriodSelection) => void;
  isPending: boolean;
  onSelect: (isActive: boolean) => void;
}

/** Selezione di un periodo (date + giorno) da attivare/disattivare in blocco. */
export function PeriodSelector({ period, onChange, isPending, onSelect }: PeriodSelectorProps) {
  const { t } = useTranslation();
  const incomplete = !period.from || !period.to || isPending;
  return (
    <div className="flex flex-wrap items-end gap-2 rounded-lg border p-3">
      <label className="text-sm">
        {t('monteWorkflow.start')}
        <input
          aria-label={t('monteWorkflow.start')}
          type="date"
          className="block rounded border bg-background p-2"
          value={period.from}
          onChange={(e) => onChange({ ...period, from: e.target.value })}
        />
      </label>
      <label className="text-sm">
        {t('monteWorkflow.end')}
        <input
          aria-label={t('monteWorkflow.end')}
          type="date"
          className="block rounded border bg-background p-2"
          value={period.to}
          onChange={(e) => onChange({ ...period, to: e.target.value })}
        />
      </label>
      <select
        aria-label={t('monteWorkflow.selectPeriod')}
        className="rounded border bg-background p-2"
        value={period.day}
        onChange={(e) => onChange({ ...period, day: e.target.value })}
      >
        <option value="">{t('monteWorkflow.allDays')}</option>
        {[1, 2, 3, 4, 5, 6].map((d) => (
          <option key={d} value={d}>
            {['', 'Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab'][d]}
          </option>
        ))}
      </select>
      <Button disabled={incomplete} onClick={() => onSelect(true)}>
        {t('monteWorkflow.activate')}
      </Button>
      <Button variant="outline" disabled={incomplete} onClick={() => onSelect(false)}>
        {t('monteWorkflow.deactivate')}
      </Button>
    </div>
  );
}
