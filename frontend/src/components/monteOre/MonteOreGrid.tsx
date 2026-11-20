import { useTranslation } from 'react-i18next';
import { AmendmentEditor } from './AmendmentEditor';
import { CalendarRange, RefreshCcw, AlertCircle, CalendarPlus } from 'lucide-react';
import type { MonteOreTeacherActions } from '@/api/monteOre';
import { isHoursTargetMet, progressPercent } from '@/lib/monteOreGrid';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AmendmentList } from './grid/AmendmentList';
import { PeriodSelector } from './grid/PeriodSelector';
import { SlotMoveDialog } from './grid/SlotMoveDialog';
import { useMonteOreGridData } from './grid/useMonteOreGridData';
import { WeekTable } from './grid/WeekTable';

interface Props {
  requestCount?: number;
  proposalId?: number;
  /** Azioni consentite al docente, calcolate dal server (`proposal.workflow`). */
  actions: MonteOreTeacherActions;
  isPatternEmpty: boolean;
  /**
   * Soglia ore annue applicabile al docente. Se valorizzata, sostituisce
   * `settings.minRequiredHours` (soglia istituzionale) — usato per docenti
   * con override individuale (contratto orario, supplenti, part-time).
   * Quando null/undefined si ricade sulla soglia istituzionale.
   */
  hoursMode?: 'minimum' | 'exact' | 'maximum';
  minHoursOverride?: number | null;
  /** True se la soglia mostrata viene da override individuale: cambia la label. */
  isOverriddenThreshold?: boolean;
  /**
   * AA target del docente. Quando valorizzato viene propagato come `?year=`
   * a tutte le query (calendar / slots / amendments). Se omesso il backend
   * cade sull'AA corrente, compatibilità retro.
   */
  academicYear?: string;
}

/**
 * Sezione B — griglia settimanale di pianificazione monte ore.
 * Renderizza tante righe quante sono le settimane del calendario didattico
 * (al netto delle sospensioni full_week che vengono nascoste a monte).
 * Ogni cella Lun-Sab mostra le ore previste per il pattern del giorno;
 * un click attiva/disattiva quella occorrenza.
 */
export default function MonteOreGrid({
  hoursMode = 'minimum',
  requestCount = 0,
  actions,
  isPatternEmpty,
  minHoursOverride,
  isOverriddenThreshold,
  academicYear,
}: Props) {
  const { t } = useTranslation();
  const {
    calendarQuery,
    slotsQuery,
    amendmentsQuery,
    regenerateMutation,
    toggleMutation,
    selectMutation,
    slotsByDate,
    activeTotal,
    requestOpen,
    setRequestOpen,
    period,
    setPeriod,
    movingSlot,
    setMovingSlot,
    handleToggle,
    handleRequestMove,
    editable,
  } = useMonteOreGridData(academicYear, actions);
  // Spostamenti consentiti solo dopo approvazione (in draft il docente
  // edita direttamente il pattern, senza amendment workflow).
  const allowMove = actions.requestAmendment;
  const onRequestMoveProp = allowMove ? handleRequestMove : undefined;

  if (calendarQuery.isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Griglia annuale</CardTitle>
        </CardHeader>
        <CardContent className="pt-0 sm:pt-0">
          <Skeleton className="h-64 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (calendarQuery.isError) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <CalendarRange className="h-5 w-5 text-muted-foreground" />
            Griglia annuale
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0 sm:pt-0">
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              Il coordinatore non ha ancora configurato il calendario didattico per quest'anno. Una
              volta pubblicato, qui apparirà la griglia settimana × giorno per pianificare le ore.
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  if (!calendarQuery.data) return null;
  const settings = calendarQuery.data.settings;
  const weeks = calendarQuery.data.weeks;
  // Se l'admin ha impostato una deroga per questo docente (override
  // personalizzato), usiamo quella soglia. Altrimenti la soglia istituzionale.
  const minRequired = minHoursOverride ?? settings.minRequiredHours;
  const progress = progressPercent(activeTotal, minRequired);
  const slots = slotsQuery.data?.slots ?? [];
  const slotsCount = slots.length;
  const hasPendingPattern = isPatternEmpty;
  const amendments = amendmentsQuery.data?.amendments;
  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div>
          <CardTitle className="text-lg flex items-center gap-2">
            <CalendarRange className="h-5 w-5 text-primary" />
            Griglia annuale
          </CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">
            Calendario didattico {settings.lessonsStartDate} → {settings.lessonsEndDate}. Clicca le
            celle per <strong>aggiungerle</strong> al tuo monte ore — il totale si somma man mano.
            Le celle rosse sono festività (non selezionabili).
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <div className="text-right">
            <div className="font-display text-2xl font-medium tabular-nums">
              {activeTotal.toFixed(1)}{' '}
              <span className="text-sm text-muted-foreground">/ {minRequired} h</span>
            </div>
            <div className="h-1.5 w-40 overflow-hidden rounded-full bg-muted">
              <div
                className={`h-full ${isHoursTargetMet(hoursMode, activeTotal, minRequired) ? 'bg-emerald-500' : 'bg-primary'}`}
                style={{ width: `${progress}%` }}
              />
            </div>
            {isOverriddenThreshold && (
              <p className="mt-1 text-[10px] uppercase tracking-wider text-muted-foreground">
                soglia personalizzata
              </p>
            )}
          </div>
          {actions.editPattern && !hasPendingPattern && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => regenerateMutation.mutate(false)}
              disabled={regenerateMutation.isPending}
            >
              <RefreshCcw className="h-4 w-4" />
              Rigenera dalla Sezione A
            </Button>
          )}
          {actions.requestAmendment && (
            <Button size="sm" variant="outline" onClick={() => setRequestOpen(true)}>
              <CalendarPlus className="h-4 w-4" />
              Richiedi nuovo giorno
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3 pt-0 sm:pt-0">
        {allowMove && (
          <div className="space-y-2 rounded-lg border p-3">
            <p className="text-sm font-medium">
              {t('monteWorkflow.budget', {
                used: requestCount,
                max: settings.maxAmendmentsPerYear,
                remaining: Math.max(0, settings.maxAmendmentsPerYear - requestCount),
              })}
            </p>
            <p className="text-xs text-muted-foreground">{t('monteWorkflow.budgetHelp')}</p>
            <Button
              onClick={() => setRequestOpen(true)}
              disabled={requestCount >= settings.maxAmendmentsPerYear}
            >
              {t('monteWorkflow.request')}
            </Button>
          </div>
        )}
        {actions.selectDates && (
          <PeriodSelector
            period={period}
            onChange={setPeriod}
            isPending={selectMutation.isPending}
            onSelect={(isActive) => selectMutation.mutate(isActive)}
          />
        )}
        {requestOpen && (
          <AmendmentEditor
            academicYear={academicYear}
            slots={slots}
            onClose={() => setRequestOpen(false)}
          />
        )}

        {hasPendingPattern && (
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              Compila prima il pattern settimanale nella Sezione A, poi clicca "Rigenera dalla
              Sezione A" per popolare la griglia.
            </AlertDescription>
          </Alert>
        )}
        {!hasPendingPattern && slotsCount === 0 && actions.editPattern && (
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              Hai modificato il pattern: clicca "Rigenera dalla Sezione A" per applicare le
              modifiche alla griglia.
            </AlertDescription>
          </Alert>
        )}
        {actions.requestAmendment && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted/20 px-3 py-2">
            <p className="text-xs text-muted-foreground">
              Per <strong>sostituire</strong> un giorno con un altro dello stesso pattern
              settimanale, inserisci cancellazione e recupero nella stessa richiesta. Per giorni o
              orari <strong>fuori pattern</strong>, invia una richiesta al coordinatore.
            </p>
            <Button size="sm" variant="default" onClick={() => setRequestOpen(true)}>
              <CalendarPlus className="h-4 w-4" />
              Richiedi nuovo giorno
            </Button>
          </div>
        )}

        {weeks.length > 0 && (
          <WeekTable
            weeks={weeks}
            slotsByDate={slotsByDate}
            onToggle={handleToggle}
            onRequestMove={onRequestMoveProp}
            disabled={toggleMutation.isPending || !editable}
          />
        )}

        {amendments && amendments.length > 0 && <AmendmentList amendments={amendments} />}
      </CardContent>
      {movingSlot && (
        <SlotMoveDialog slot={movingSlot} allSlots={slots} onClose={() => setMovingSlot(null)} />
      )}
    </Card>
  );
}
