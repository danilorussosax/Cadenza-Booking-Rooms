'use strict';

/**
 * Smoke "module loadability": importa tutti i moduli services/* e middleware/*
 * per assicurare che siano sintatticamente validi e parsabili. Ha l'effetto
 * collaterale (voluto) di alzare la coverage degli statement top-level
 * (require di sub-moduli, dichiarazioni di costanti).
 *
 * Non sostituisce i test di logica — quelli vivono nei file dedicati.
 */

const fs = require('fs');
const path = require('path');

function listJsFiles(dir) {
  const out = [];
  const stack = [dir];
  while (stack.length) {
    const cur = stack.pop();
    const entries = fs.readdirSync(cur, { withFileTypes: true });
    for (const e of entries) {
      const full = path.join(cur, e.name);
      if (e.isDirectory()) stack.push(full);
      else if (e.isFile() && e.name.endsWith('.js')) out.push(full);
    }
  }
  return out;
}

describe('module loadability', () => {
  const ROOT = path.resolve(__dirname, '..', '..');
  const targets = [
    ...listJsFiles(path.join(ROOT, 'services')),
    ...listJsFiles(path.join(ROOT, 'middleware')),
    ...listJsFiles(path.join(ROOT, 'lib')),
  ];

  for (const f of targets) {
    const rel = path.relative(ROOT, f);
    it(`carica ${rel} senza throw`, () => {
      expect(() => require(f)).not.toThrow();
    });
  }
});
