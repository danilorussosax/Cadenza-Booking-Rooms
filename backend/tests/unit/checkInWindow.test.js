'use strict';

/**
 * Finestra di check-in e ghost-sweep: funzioni pure con `now` iniettato.
 * Default: early=5, grace=15 (vedi lib/config.js).
 */
const {
  thresholds,
  windowFor,
  phaseFor,
  candidateRange,
  ghostCutoff,
  isGhost,
} = require('../../lib/checkInPolicy');

const START = new Date('2026-05-20T10:00:00.000Z');
const at = (min) => new Date(START.getTime() + min * 60000);
const booking = (over = {}) => ({
  status: 'confirmed',
  startTime: START,
  checkedInAt: null,
  autoCancelledAt: null,
  room: { requireCheckIn: true },
  ...over,
});

describe('checkInPolicy — soglie e finestra', () => {
  it('default 5/15', () => {
    expect(thresholds()).toEqual({ earlyMinutes: 5, graceMinutes: 15 });
  });

  it('windowFor = [start-5, start+15]', () => {
    const w = windowFor(booking());
    expect(w.opensAt).toEqual(at(-5));
    expect(w.closesAt).toEqual(at(15));
  });

  it('phaseFor ai bordi (estremi inclusi)', () => {
    const b = booking();
    expect(phaseFor(b, at(-5.001))).toBe('too_early');
    expect(phaseFor(b, at(-5))).toBe('open');
    expect(phaseFor(b, at(0))).toBe('open');
    expect(phaseFor(b, at(15))).toBe('open');
    expect(phaseFor(b, at(15.001))).toBe('too_late');
  });

  it('accetta now come numero e come oggetto con toISOString', () => {
    expect(phaseFor(booking(), at(0).getTime())).toBe('open');
    expect(phaseFor(booking(), { toISOString: () => at(20).toISOString() })).toBe('too_late');
  });

  it('ghostCutoff e candidateRange derivano dalla grace', () => {
    expect(ghostCutoff(at(0))).toEqual(at(-15));
    const r = candidateRange(at(0));
    expect(r.from).toEqual(at(-15));
    expect(r.to).toEqual(at(24 * 60));
  });
});

describe('checkInPolicy.isGhost', () => {
  it('true solo a finestra chiusa, check-in richiesto, non già gestita', () => {
    expect(isGhost(booking(), at(15))).toBe(false);
    expect(isGhost(booking(), at(16))).toBe(true);
  });

  it('false se check-in non richiesto, già check-in-ata, auto-cancellata o non confermata', () => {
    expect(isGhost(booking({ room: { requireCheckIn: false } }), at(60))).toBe(false);
    expect(isGhost(booking({ checkedInAt: at(1) }), at(60))).toBe(false);
    expect(isGhost(booking({ autoCancelledAt: at(20) }), at(60))).toBe(false);
    expect(isGhost(booking({ status: 'cancelled' }), at(60))).toBe(false);
  });

  it('eredita Building.checkInDefault', () => {
    const room = { requireCheckIn: null, building: { checkInDefault: true } };
    expect(isGhost(booking({ room }), at(60))).toBe(true);
  });
});
