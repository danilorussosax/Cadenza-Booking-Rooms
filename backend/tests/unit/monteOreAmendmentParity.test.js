'use strict';

/**
 * Parità backend/frontend sulle variazioni del monte ore.
 *
 * La stessa fixture (`tests/fixtures/monteOreAmendmentParity.json`) è letta da
 * qui e da `frontend/tests/lib/monteOreProjectionParity.test.ts`: ogni caso
 * dichiara le ore attese (o `null` se la variazione va rifiutata). Così
 * `applyOperations` (autorità) e `projectMonteOreHours` (stima client)
 * non possono divergere in silenzio.
 */

const cases = require('../fixtures/monteOreAmendmentParity.json');
const { applyOperations } = require('../../services/monteOreWorkflowService');
const { activeMinutes } = require('../../services/monteOrePlanRules');

const plan = {
  proposal: { validFrom: '2000-01-01', validTo: '2100-12-31' },
  settings: null,
  suspensions: [],
};

function backendHours(slots, operations) {
  try {
    const result = applyOperations(plan, slots, operations);
    return activeMinutes(result.slots) / 60;
  } catch (e) {
    if (!e.code) throw e;
    return null;
  }
}

describe('applyOperations — fixture di parità con il client', () => {
  it.each(cases)('$name', ({ slots, operations, expectedHours }) => {
    expect(backendHours(slots, operations)).toBe(expectedHours);
  });
});
