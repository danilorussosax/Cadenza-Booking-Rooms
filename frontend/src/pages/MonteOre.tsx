import { useState } from 'react';
import { Clock, Send, AlertCircle } from 'lucide-react';
import type { MonteOreSchedule } from '@/api/monteOre';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import MonteOreGrid from '@/components/monteOre/MonteOreGrid';
import { ModuleDisabledCard } from '@/components/ModuleDisabledCard';
import {
  ProposalStatusAlerts,
  ProposalTopAlerts,
  StatusBadge,
} from '@/components/monteOre/page/ProposalAlerts';
import { ProposalSummaryCard } from '@/components/monteOre/page/ProposalSummaryCard';
import { ScheduleDialog } from '@/components/monteOre/page/ScheduleDialog';
import { ScheduleTable } from '@/components/monteOre/page/ScheduleTable';
import { useMonteOreProposal } from '@/components/monteOre/page/useMonteOreProposal';
import { isModuleDisabledError } from '@/lib/moduleFlags';

export default function MonteOre() {
  const [editing, setEditing] = useState<MonteOreSchedule | null>(null);
  const [adding, setAdding] = useState(false);

  const {
    targetYearQuery,
    proposalQuery,
    thresholdQuery,
    targetItem,
    yearUnavailable,
    targetYear,
    proposal,
    teacherActions,
    isEditable,
    isLocked,
    threshold,
    hasIndividualOverride,
    submitBlockers,
    canSubmit,
    updateMutation,
    removeMutation,
    submitMutation,
  } = useMonteOreProposal();

  if (targetYearQuery.isLoading || proposalQuery.isLoading) {
    return (
      <div className="mx-auto max-w-7xl space-y-4">
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  // Modulo "Monte Ore" disattivato dalla Direzione → backend ritorna 404
  // MODULE_DISABLED. Mostriamo un placeholder leggibile invece dell'alert
  // generico "errore non specificato".
  if (isModuleDisabledError(proposalQuery.error)) {
    return <ModuleDisabledCard moduleLabel="Monte Ore" />;
  }

  if (yearUnavailable) {
    return (
      <Alert>
        <AlertDescription>
          L’anno accademico non è ancora disponibile per la compilazione. Attendi la pubblicazione
          da parte dell’amministrazione.
        </AlertDescription>
      </Alert>
    );
  }

  if (!proposal) {
    return (
      <div className="mx-auto max-w-7xl">
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>Impossibile caricare la proposta.</AlertDescription>
        </Alert>
      </div>
    );
  }

  const submitDisabled =
    submitMutation.isPending ||
    updateMutation.isPending ||
    removeMutation.isPending ||
    thresholdQuery.isPending ||
    !canSubmit;
  const hasSchedules = proposal.schedules.length > 0;

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-display text-3xl font-medium inline-flex items-center gap-2">
            <Clock className="h-6 w-6 text-primary" />
            Monte ore
          </h1>
          <p className="text-sm text-muted-foreground">
            Compila la tua proposta annuale e inviala al coordinatore della didattica.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <StatusBadge status={proposal.status} />
          {proposal.status === 'draft' && hasSchedules && (
            <Button
              onClick={() => submitMutation.mutate()}
              disabled={submitDisabled}
              title={canSubmit ? undefined : submitBlockers[0]}
            >
              <Send className="h-4 w-4" />
              Invia al coordinatore
            </Button>
          )}
          {proposal.status === 'rejected' && hasSchedules && (
            <Button
              onClick={() => submitMutation.mutate()}
              disabled={submitDisabled}
              title={canSubmit ? undefined : submitBlockers[0]}
            >
              <Send className="h-4 w-4" />
              Reinvia
            </Button>
          )}
        </div>
      </header>

      <ProposalTopAlerts
        proposal={proposal}
        targetItem={targetItem}
        threshold={threshold}
        hasIndividualOverride={hasIndividualOverride}
        isEditable={isEditable}
        submitBlockers={submitBlockers}
      />

      <ProposalSummaryCard
        proposal={proposal}
        threshold={threshold}
        isLocked={isLocked}
        onUpdate={(patch) => updateMutation.mutate(patch)}
      />

      <ProposalStatusAlerts proposal={proposal} />

      <ScheduleTable
        schedules={proposal.schedules}
        isLocked={isLocked}
        onAdd={() => setAdding(true)}
        onEdit={setEditing}
        onRemove={(id) => removeMutation.mutate(id)}
      />

      {/* Sezione B: griglia annuale (solo se calendar configurato dall'admin) */}
      <MonteOreGrid
        actions={teacherActions}
        isPatternEmpty={proposal.schedules.length === 0}
        hoursMode={threshold?.mode}
        requestCount={proposal.requestCount}
        proposalId={proposal.id}
        minHoursOverride={threshold?.minHours ?? null}
        isOverriddenThreshold={threshold?.source === 'user_override'}
        academicYear={targetYear}
      />

      {/* Dialog: aggiungi/modifica riga */}
      <ScheduleDialog
        open={adding || editing !== null}
        onClose={() => {
          setAdding(false);
          setEditing(null);
        }}
        existing={editing}
        targetYear={targetYear}
      />
    </div>
  );
}
