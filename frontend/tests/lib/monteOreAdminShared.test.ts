import { describe, it, expect } from 'vitest';
import { resolveProposalThreshold } from '@/components/monteOre/admin/shared';
import type { MonteOreProposal } from '@/api/monteOre';

const proposal = (over: Partial<MonteOreProposal>): MonteOreProposal =>
  ({ minRequiredHoursSnapshot: null, user: null, ...over }) as MonteOreProposal;

describe('resolveProposalThreshold', () => {
  it('usa lo snapshot al submit, anche se uguale al CCNL (non personalizzata)', () => {
    const t = resolveProposalThreshold(proposal({ minRequiredHoursSnapshot: 324 }));
    expect(t).toMatchObject({ hours: 324, source: 'snapshot', isCustom: false });
  });

  it('marca personalizzata uno snapshot diverso dal CCNL', () => {
    const t = resolveProposalThreshold(proposal({ minRequiredHoursSnapshot: 240 }));
    expect(t).toMatchObject({ hours: 240, source: 'snapshot', isCustom: true });
  });

  it("applica l'override del docente se manca lo snapshot", () => {
    const t = resolveProposalThreshold(
      proposal({
        user: { monteOreAnnualHoursOverride: 200, contractType: 'supplente' },
      } as unknown as Partial<MonteOreProposal>),
    );
    expect(t).toMatchObject({
      hours: 200,
      source: 'override',
      isCustom: true,
      contractType: 'supplente',
    });
  });

  it('fallback al CCNL 324h', () => {
    expect(resolveProposalThreshold(proposal({}))).toMatchObject({
      hours: 324,
      source: 'ccnl',
      isCustom: false,
      contractType: null,
    });
  });
});
