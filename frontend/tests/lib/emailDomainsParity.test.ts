import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { parseAllowedDomains } from '@/lib/emailDomains';

/** Parità con backend/lib/emailDomainPolicy.js: stessi input, stessi output. */
const backend = createRequire(import.meta.url)(
  resolve(__dirname, '../../../backend/lib/emailDomainPolicy.js'),
) as { parseAllowedDomains: (raw: unknown) => string[] };

const inputs: unknown[] = [
  '',
  ' ',
  null,
  undefined,
  42,
  'unimi.it',
  'UNIMI.it',
  '@unimi.it',
  '@@unimi.it',
  '@',
  'a.it,b.it',
  'a.it, b.it ; c.it',
  'a.it;;b.it,,c.it',
  '  a.it  \n\t b.it  ',
  'a.it a.it A.IT @a.it',
  ',a.it,',
  'studenti.unimi.it, docenti.unimi.it',
  'x.it,@y.it;Z.IT  w.it',
];

describe('parseAllowedDomains — parità backend/frontend', () => {
  for (const raw of inputs) {
    it(`input ${JSON.stringify(raw)}`, () => {
      expect(parseAllowedDomains(raw as string)).toEqual(backend.parseAllowedDomains(raw));
    });
  }
});
