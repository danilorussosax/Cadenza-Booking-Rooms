import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { isCheckInRequired } from '@/lib/checkInPolicy';

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
