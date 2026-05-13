'use strict';

/**
 * Wrapper di import per Stryker.
 *
 * Stryker passa `--related` a vitest, che chiede a Vitest "trovami i test
 * che importano questo file mutato". Le nostre suite integration usano
 * supertest contro l'app Express → i moduli core sono raggiunti
 * indirettamente, non con `require()` esplicito. Vitest non li vede.
 *
 * Questo file importa esplicitamente i moduli mutati così che Stryker
 * sappia esattamente quali test rieseguire per ogni mutazione.
 *
 * Test di smoke: ognuno verifica solo che l'export sia presente.
 */

const bookingValidator = require('../../services/bookingValidator');
const monteOreSlotService = require('../../services/monteOreSlotService');
const moduleGuard = require('../../middleware/moduleGuard');
const serializableTx = require('../../lib/serializableTx');
const sanitize = require('../../lib/sanitize');

describe('Stryker imports — moduli core', () => {
  it('services/bookingValidator esporta validateBooking', () => {
    expect(typeof bookingValidator.validateBooking).toBe('function');
  });
  it('services/monteOreSlotService esporta le funzioni chiave', () => {
    expect(typeof monteOreSlotService.classifyAmendment).toBe('function');
    expect(typeof monteOreSlotService.syncBookingForSlot).toBe('function');
    expect(typeof monteOreSlotService.regenerateSlotsFromPattern).toBe('function');
  });
  it('middleware/moduleGuard esporta requireModuleEnabled', () => {
    expect(typeof moduleGuard.requireModuleEnabled).toBe('function');
    expect(typeof moduleGuard.invalidateModuleCache).toBe('function');
  });
  it('lib/serializableTx esporta withSerializableRetry', () => {
    expect(typeof serializableTx.withSerializableRetry).toBe('function');
    expect(typeof serializableTx.isRetryableError).toBe('function');
  });
  it('lib/sanitize esporta funzioni di sanitizzazione', () => {
    expect(typeof sanitize).toBe('object');
  });
});
