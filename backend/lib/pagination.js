'use strict';

/**
 * Pagination helper uniforme per le list-routes.
 *
 * Pattern d'uso:
 *
 *   const { limit, offset } = parsePagination(req.query);
 *   const { rows, count } = await User.findAndCountAll({
 *     where: ...,
 *     limit,
 *     offset,
 *     order: [['lastName', 'ASC']],
 *   });
 *   setPaginationHeaders(res, count, limit, offset);
 *   res.json({ users: rows.map(...) });
 *
 * Default: limit=100, offset=0. Massimi: limit=500, offset=100000.
 * Sovrascrivibile per route specifiche tramite secondo argomento.
 *
 * Esposto:
 *   - X-Total-Count: numero totale di record corrispondenti al filtro
 *   - X-Limit: limite effettivamente applicato (post-clamp)
 *   - X-Offset: offset effettivamente applicato
 *
 * I client possono usare questi header per costruire la UI di pagination
 * senza dover indovinare se ci sono altre pagine.
 */

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;
const MAX_OFFSET = 100_000;

/**
 * Estrae limit/offset da req.query con clamp e default.
 *
 * @param {object} query - tipicamente req.query
 * @param {object} [opts]
 * @param {number} [opts.defaultLimit] - limit usato quando non specificato
 * @param {number} [opts.maxLimit] - cap superiore (anti DoS via ?limit=999999)
 * @returns {{ limit: number, offset: number }}
 */
function parsePagination(query, opts = {}) {
  const defaultLimit = opts.defaultLimit ?? DEFAULT_LIMIT;
  const maxLimit = opts.maxLimit ?? MAX_LIMIT;

  let limit = Number.parseInt(query?.limit, 10);
  if (!Number.isFinite(limit) || limit <= 0) limit = defaultLimit;
  if (limit > maxLimit) limit = maxLimit;

  let offset = Number.parseInt(query?.offset, 10);
  if (!Number.isFinite(offset) || offset < 0) offset = 0;
  if (offset > MAX_OFFSET) offset = MAX_OFFSET;

  return { limit, offset };
}

/**
 * Imposta gli header di paginazione standard sulla response.
 * @param {object} res - Express Response
 * @param {number} totalCount - count totale (es. da findAndCountAll)
 * @param {number} limit
 * @param {number} offset
 */
function setPaginationHeaders(res, totalCount, limit, offset) {
  res.setHeader('X-Total-Count', String(totalCount));
  res.setHeader('X-Limit', String(limit));
  res.setHeader('X-Offset', String(offset));
  // Header espliciti devono essere CORS-exposti per essere leggibili dal
  // browser quando l'app è servita da un origin diverso (es. dev server :5173).
  // L'app principale è same-origin, ma in dev / kiosk può non esserlo.
  res.setHeader('Access-Control-Expose-Headers', 'X-Total-Count, X-Limit, X-Offset');
}

module.exports = {
  parsePagination,
  setPaginationHeaders,
  DEFAULT_LIMIT,
  MAX_LIMIT,
};
