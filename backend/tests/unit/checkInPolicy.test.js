'use strict';

/**
 * Unit test per lib/checkInPolicy.isCheckInRequired.
 *
 * Cascata da verificare:
 *   1. room.requireCheckIn esplicito (true/false) → vince sempre
 *   2. fallback: building.checkInDefault
 *   3. fallback ultimo: false
 */

const { isCheckInRequired } = require('../../lib/checkInPolicy');

describe('isCheckInRequired — cascata Building → Room', () => {
  it('room.requireCheckIn=true vince anche se building.checkInDefault=false', () => {
    const room = { requireCheckIn: true, building: { checkInDefault: false } };
    expect(isCheckInRequired(room)).toBe(true);
  });

  it('room.requireCheckIn=false vince anche se building.checkInDefault=true', () => {
    const room = { requireCheckIn: false, building: { checkInDefault: true } };
    expect(isCheckInRequired(room)).toBe(false);
  });

  it('room.requireCheckIn=null eredita building.checkInDefault=true', () => {
    const room = { requireCheckIn: null, building: { checkInDefault: true } };
    expect(isCheckInRequired(room)).toBe(true);
  });

  it('room.requireCheckIn=null eredita building.checkInDefault=false', () => {
    const room = { requireCheckIn: null, building: { checkInDefault: false } };
    expect(isCheckInRequired(room)).toBe(false);
  });

  it('room.requireCheckIn=null + building null → false (safer default)', () => {
    const room = { requireCheckIn: null, building: null };
    expect(isCheckInRequired(room)).toBe(false);
  });

  it('room=null → false (safer default)', () => {
    expect(isCheckInRequired(null)).toBe(false);
    expect(isCheckInRequired(undefined)).toBe(false);
  });

  it('parametro building (override) ha precedenza su room.building', () => {
    const room = { requireCheckIn: null, building: { checkInDefault: false } };
    // Caller passa esplicitamente un building diverso → vince quello passato.
    expect(isCheckInRequired(room, { checkInDefault: true })).toBe(true);
  });

  it('room.requireCheckIn=undefined si comporta come null (eredita)', () => {
    const room = { building: { checkInDefault: true } };
    expect(isCheckInRequired(room)).toBe(true);
  });
});
