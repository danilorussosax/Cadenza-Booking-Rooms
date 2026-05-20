'use strict';

/**
 * requestContext — middleware Express che mette in un AsyncLocalStorage
 * (`als`) i dati della richiesta in corso. I sotto-sistemi che eseguono
 * I/O fuori dal ciclo classico request → handler → response (in
 * particolare l'hook `logging` di Sequelize, che non vede il `req`) possono
 * leggere il contesto via `getRequestContext()` senza passare oggetti in
 * giro.
 *
 * Cosa portiamo dentro:
 *   - requestId: id univoco generato dal pino-http upstream (o random qui se assente)
 *   - method, route (path montato, no params query)
 *   - userId: req.user?.id, valorizzato dopo `authenticate` se presente
 *
 * Niente PII: niente email/matricole/IP. Per quello esistono già i log Pino
 * normali.
 *
 * Vita: il middleware avvolge il `next()` dentro `als.run(...)`. Tutto ciò
 * che viene fatto in async dentro la stessa request vede il contesto.
 * Quando la response chiude, il contesto si chiude da solo (no leak).
 */

const { AsyncLocalStorage } = require('node:async_hooks');
const crypto = require('node:crypto');

const als = new AsyncLocalStorage();

function requestContextMiddleware(req, res, next) {
  const ctx = {
    requestId: req.id || req.headers?.['x-request-id'] || crypto.randomBytes(8).toString('hex'),
    method: req.method,
    // Usiamo req.originalUrl perché alle middleware "deep" come Sequelize
    // logging il `req.route.path` non è ancora valorizzato. Strip-piamo la
    // query string per non polluire l'aggregazione per route.
    route: typeof req.originalUrl === 'string' ? req.originalUrl.split('?')[0] : null,
    userId: null,
  };

  // L'utente viene popolato DOPO authenticate(). Aggiorniamo il riferimento
  // shallow: il middleware authenticate setta req.user prima della catena
  // route handler, e l'als ritorna sempre lo STESSO oggetto. Lo aggiorniamo
  // mutando.
  als.run(ctx, () => {
    const origNext = next;
    // Patch leggera: ad ogni `next()` (incluso quello dopo authenticate)
    // sincronizziamo userId se diventato disponibile.
    const sync = () => {
      if (!ctx.userId && req.user?.id) ctx.userId = req.user.id;
    };
    res.on('finish', sync);
    sync();
    origNext();
  });
}

function getRequestContext() {
  return als.getStore() || null;
}

module.exports = {
  requestContextMiddleware,
  getRequestContext,
};
