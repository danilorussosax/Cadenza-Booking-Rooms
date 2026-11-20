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
// Tetto di `?limit=` su /audit-log/verify-integrity (senza limit: scansione completa).
const MAX_VERIFY_LIMIT = 1_000_000;

/**
 * Politica unica di parsing dei parametri numerici di paginazione.
 *
 *   - assente / non numerico / array  → `def`
 *   - 0                               → `def` (come il vecchio `Number(x) || def`)
 *   - decimali                        → floor (`2.7` → 2)
 *   - < `min` (negativi, o 0.x)       → `def` se `belowMin: 'default'`,
 *                                       altrimenti `min` (clamp, default)
 *   - > `max`                         → `max`
 *
 * `def` può essere `undefined` (nessun valore → il chiamante decide, es.
 * scansione completa). `max` assente = nessun tetto.
 *
 * @param {unknown} raw
 * @param {object} [opts]
 * @param {number} [opts.def]
 * @param {number} [opts.min=1]
 * @param {number} [opts.max]
 * @param {'clamp'|'default'} [opts.belowMin='clamp']
 * @returns {number|undefined}
 */
function parseIntParam(raw, { def, min = 1, max = Infinity, belowMin = 'clamp' } = {}) {
  if (typeof raw !== 'string' && typeof raw !== 'number') return def;
  const n = Number.parseFloat(raw);
  if (!Number.isFinite(n) || n === 0) return def;
  let v = Math.floor(n);
  if (v < min) {
    if (belowMin === 'default') return def;
    v = min;
  }
  return v > max ? max : v;
}

/** Limite di righe: vedi {@link parseIntParam} per la politica. */
function parseLimit(raw, opts = {}) {
  // `def: undefined` esplicito è un default valido (nessun limite impostato).
  const def = 'def' in opts ? opts.def : DEFAULT_LIMIT;
  return parseIntParam(raw, {
    def,
    min: opts.min ?? 1,
    max: opts.max ?? MAX_LIMIT,
    belowMin: opts.belowMin,
  });
}

/**
 * Paginazione a pagine (`page`/`pageSize`, base 1) per le route che
 * rispondono con `{ page, pageSize, total… }` invece degli header.
 *
 * @returns {{ page: number, pageSize: number, offset: number }}
 */
function parsePageParams(query, { defaultPageSize = 50, maxPageSize = 200 } = {}) {
  const page = parseIntParam(query?.page, { def: 1, min: 1 });
  const pageSize = parseLimit(query?.pageSize, { def: defaultPageSize, max: maxPageSize });
  return { page, pageSize, offset: (page - 1) * pageSize };
}

/**
 * Estrae limit/offset da req.query con clamp e default.
 * (<= 0 → default, come prima.)
 *
 * @param {object} query - tipicamente req.query
 * @param {object} [opts]
 * @param {number} [opts.defaultLimit] - limit usato quando non specificato
 * @param {number} [opts.maxLimit] - cap superiore (anti DoS via ?limit=999999)
 * @returns {{ limit: number, offset: number }}
 */
function parsePagination(query, opts = {}) {
  const limit = parseLimit(query?.limit, {
    def: opts.defaultLimit ?? DEFAULT_LIMIT,
    max: opts.maxLimit ?? MAX_LIMIT,
    belowMin: 'default',
  });

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
  parseIntParam,
  parseLimit,
  parsePageParams,
  setPaginationHeaders,
  DEFAULT_LIMIT,
  MAX_LIMIT,
  MAX_VERIFY_LIMIT,
};
