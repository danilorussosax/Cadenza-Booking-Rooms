'use strict';

// Guardia di equivalenza dello split di routes/structure.js in sotto-router:
// la tabella (metodo + path + numero di middleware, in ordine di registrazione)
// deve restare identica alla fixture catturata prima del refactor.
const expected = require('../fixtures/structureRoutes.json');

function flatten(router, out = []) {
  for (const layer of router.stack) {
    if (layer.route) {
      const methods = Object.keys(layer.route.methods).join(',').toUpperCase();
      out.push(`${methods} ${layer.route.path} mw=${layer.route.stack.length}`);
    } else if (layer.handle?.stack) {
      flatten(layer.handle, out);
    } else {
      out.push(`USE ${layer.name}`);
    }
  }
  return out;
}

describe('routes/structure: tabella delle route', () => {
  it('coincide con la fixture pre-split (stesso ordine, metodi, path, middleware)', () => {
    expect(flatten(require('../../routes/structure'))).toEqual(expected);
  });
});
