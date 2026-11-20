// Rigenera tests/fixtures/i18nUnreferencedBaseline.json: chiavi (di qualsiasi
// profondita') non riferite dal codice e ammesse perche' potenzialmente
// dinamiche. Il test ratchet impedisce che l'insieme cresca; dopo una pulizia
// riesegui `node scripts/writeI18nBaseline.mjs` per restringerlo.
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { allKeys, findUnreferenced, readSources } from './i18nKeys.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const keys = findUnreferenced(readSources(), allKeys(), 1).sort();
writeFileSync(
  join(root, 'tests/fixtures/i18nUnreferencedBaseline.json'),
  JSON.stringify(keys, null, 2) + '\n',
);
console.log(keys.length, 'chiavi in baseline');
