import { GraduationCap } from 'lucide-react';
import type { MonteOreProposal, MonteOreThresholdResponse } from '@/api/monteOre';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { isHoursTargetMet } from '@/lib/monteOreGrid';

interface ProposalSummaryCardProps {
  proposal: MonteOreProposal;
  threshold: MonteOreThresholdResponse | undefined;
  isLocked: boolean;
  onUpdate: (patch: { validFrom?: string; validTo?: string; notes?: string | null }) => void;
}

/** Riepilogo AA: range di validità, ore totali vs soglia, note al coordinatore. */
export function ProposalSummaryCard({
  proposal,
  threshold,
  isLocked,
  onUpdate,
}: ProposalSummaryCardProps) {
  const targetMet =
    threshold !== undefined &&
    isHoursTargetMet(threshold.mode ?? 'minimum', proposal.totalHoursPlanned, threshold.minHours);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <GraduationCap className="h-5 w-5 text-primary" />
          Anno accademico {proposal.academicYear}
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-3 pt-0 sm:pt-0">
        <div>
          <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
            Inizio validità
          </Label>
          <Input
            type="date"
            defaultValue={proposal.validFrom}
            disabled={isLocked}
            onBlur={(e) => {
              if (e.target.value && e.target.value !== proposal.validFrom) {
                onUpdate({ validFrom: e.target.value });
              }
            }}
          />
        </div>
        <div>
          <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
            Fine validità
          </Label>
          <Input
            type="date"
            defaultValue={proposal.validTo}
            disabled={isLocked}
            onBlur={(e) => {
              if (e.target.value && e.target.value !== proposal.validTo) {
                onUpdate({ validTo: e.target.value });
              }
            }}
          />
        </div>
        <div>
          <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
            Ore totali (calcolate)
          </Label>
          {threshold ? (
            <div>
              <p className="font-display text-2xl font-medium tabular-nums leading-tight">
                <span
                  className={
                    targetMet
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : 'text-amber-600 dark:text-amber-400'
                  }
                >
                  {proposal.totalHoursPlanned.toFixed(1)}
                </span>
                <span className="text-muted-foreground"> / {threshold.minHours} h</span>
              </p>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                {targetMet
                  ? '✓ Piano conforme al contratto'
                  : `Obiettivo${threshold.mode === 'maximum' ? ' massimo' : ''}: ${threshold.minHours} h`}
                {threshold.source === 'user_override' && ' · soglia personalizzata'}
              </p>
            </div>
          ) : (
            <p className="font-display text-2xl font-medium tabular-nums">
              {proposal.totalHoursPlanned.toFixed(1)} h
            </p>
          )}
        </div>
        <div className="sm:col-span-3">
          <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
            Note al coordinatore (opzionale)
          </Label>
          <Textarea
            rows={3}
            placeholder="Eventuali esigenze, vincoli particolari, richieste sull'aula…"
            defaultValue={proposal.notes ?? ''}
            disabled={isLocked}
            onBlur={(e) => {
              if ((proposal.notes ?? '') !== e.target.value) {
                onUpdate({ notes: e.target.value || null });
              }
            }}
          />
        </div>
      </CardContent>
    </Card>
  );
}
