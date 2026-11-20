import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { projectMonteOreHours } from '@/lib/monteOreProjection';
import type { AmendmentOperation, MonteOreSlot } from '@/api/monteOre';

/**
 * Parità con backend/services/monteOreWorkflowService.js (applyOperations):
 * stessa fixture di backend/tests/unit/monteOreAmendmentParity.test.js, che
 * dichiara le ore attese (null = variazione rifiutata dal backend).
 */
interface ParityCase {
  name: string;
  slots: unknown[];
  operations: unknown[];
  expectedHours: number | null;
}

const cases = JSON.parse(
  readFileSync(
    resolve(__dirname, '../../../backend/tests/fixtures/monteOreAmendmentParity.json'),
    'utf8',
  ),
) as ParityCase[];

describe('projectMonteOreHours — parità con applyOperations del backend', () => {
  it.each(cases)('$name', ({ slots, operations, expectedHours }) => {
    expect(projectMonteOreHours(slots as MonteOreSlot[], operations as AmendmentOperation[])).toBe(
      expectedHours,
    );
  });
});
