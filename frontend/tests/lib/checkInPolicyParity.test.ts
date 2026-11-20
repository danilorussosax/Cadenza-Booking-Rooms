import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  DEFAULT_CHECKIN_CONFIG,
  isCheckInRequired,
  phaseFor,
  windowFor,
} from '@/lib/checkInPolicy';

/** Parità con backend/lib/checkInPolicy.js: stessi input, stessi output. */
const backend = createRequire(import.meta.url)(
  resolve(__dirname, '../../../backend/lib/checkInPolicy.js'),
) as {
  isCheckInRequired: (room: unknown, building?: unknown) => boolean;
};

const flags = [true, false, null, undefined] as const;
const buildings = [{ checkInDefault: true }, { checkInDefault: false }, null, undefined] as const;

describe('isCheckInRequired — parità backend/frontend', () => {
  for (const requireCheckIn of flags) {
    for (const nested of buildings) {
      for (const explicit of buildings) {
        it(`requireCheckIn=${String(requireCheckIn)} nested=${JSON.stringify(nested)} explicit=${JSON.stringify(explicit)}`, () => {
          const room = { requireCheckIn, building: nested };
          const arg = explicit ?? null;
          expect(isCheckInRequired(room as never, arg)).toBe(backend.isCheckInRequired(room, arg));
        });
      }
    }
  }
});

describe('windowFor / phaseFor — parità backend/frontend', () => {
  const back = createRequire(import.meta.url)(
    resolve(__dirname, '../../../backend/lib/checkInPolicy.js'),
  ) as {
    thresholds: () => { earlyMinutes: number; graceMinutes: number };
    windowFor: (b: unknown) => { opensAt: Date; closesAt: Date };
    phaseFor: (b: unknown, now: Date) => string;
  };
  const booking = { startTime: '2026-05-20T10:00:00.000Z' };
  const start = new Date(booking.startTime).getTime();

  it('i default frontend coincidono con le soglie backend', () => {
    expect(DEFAULT_CHECKIN_CONFIG).toEqual(back.thresholds());
  });

  it('finestra identica', () => {
    expect(windowFor(booking, back.thresholds())).toEqual(back.windowFor(booking));
  });

  for (const offsetMin of [-5.001, -5, 0, 15, 15.001]) {
    it(`fase a start${offsetMin >= 0 ? '+' : ''}${offsetMin}min`, () => {
      const now = new Date(start + offsetMin * 60_000);
      expect(phaseFor(booking, back.thresholds(), now)).toBe(back.phaseFor(booking, now));
    });
  }
});
