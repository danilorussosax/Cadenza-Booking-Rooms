'use strict';

/**
 * Helper di sanitizzazione input — anti mass-assignment.
 *
 * Pattern:
 *   const updates = pickAllowed(req.body, ['name', 'email', 'isActive']);
 *   await user.update(updates);
 *
 * Filtra il body lasciando solo le chiavi esplicitamente whitelistate. Tutto
 * il resto viene scartato silenziosamente — gli attaccanti non sapranno se
 * un campo è stato rifiutato o non esiste.
 *
 * Variante con coercizione di tipo per casi tipici (boolean, integer, ENUM):
 *   const updates = pickAllowed(req.body, {
 *     name: 'string',
 *     email: { type: 'string', maxLength: 190 },
 *     courseId: { type: 'integer', nullable: true },
 *     isActive: 'boolean',
 *     role: { type: 'enum', values: ['admin', 'docente', 'studente'] },
 *     status: { type: 'enum', values: ['pending', 'approved', 'rejected'] },
 *   });
 *
 * Comportamento:
 *   - chiavi non in spec → SCARTATE (silenziose)
 *   - tipo invalido      → THROW ValidationError {status: 400, code: 'VALIDATION_FAILED'}
 *   - null su nullable   → consentito; null su non-nullable → scartato
 */

class ValidationError extends Error {
  constructor(message, code = 'VALIDATION_FAILED', field = null) {
    super(message);
    this.status = 400;
    this.code = code;
    this.field = field;
  }
}

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/**
 * Coerce un singolo valore secondo lo spec del campo.
 * @returns { value, skip } — `skip:true` se il valore va omesso (es. null su non-nullable)
 */
function coerceField(name, raw, spec) {
  // Spec stringa shortcut: 'string' | 'integer' | 'boolean' | 'date' | 'json'
  const cfg = typeof spec === 'string' ? { type: spec } : spec;
  const { type, nullable = false, maxLength, min, max, values } = cfg;

  // null handling
  if (raw === null || raw === undefined) {
    if (raw === undefined) return { skip: true };
    if (nullable) return { value: null };
    return { skip: true };
  }

  switch (type) {
    case 'string': {
      if (typeof raw !== 'string') {
        throw new ValidationError(`Campo "${name}" deve essere stringa`, 'INVALID_TYPE', name);
      }
      const v = maxLength != null ? raw.slice(0, maxLength) : raw;
      return { value: v };
    }
    case 'integer': {
      const n = typeof raw === 'number' ? raw : Number(raw);
      if (!Number.isFinite(n) || !Number.isInteger(n)) {
        throw new ValidationError(`Campo "${name}" deve essere intero`, 'INVALID_TYPE', name);
      }
      if (min != null && n < min) {
        throw new ValidationError(`Campo "${name}" minimo ${min}`, 'OUT_OF_RANGE', name);
      }
      if (max != null && n > max) {
        throw new ValidationError(`Campo "${name}" massimo ${max}`, 'OUT_OF_RANGE', name);
      }
      return { value: n };
    }
    case 'float': {
      const n = typeof raw === 'number' ? raw : Number(raw);
      if (!Number.isFinite(n)) {
        throw new ValidationError(`Campo "${name}" deve essere numero`, 'INVALID_TYPE', name);
      }
      if (min != null && n < min) {
        throw new ValidationError(`Campo "${name}" minimo ${min}`, 'OUT_OF_RANGE', name);
      }
      if (max != null && n > max) {
        throw new ValidationError(`Campo "${name}" massimo ${max}`, 'OUT_OF_RANGE', name);
      }
      return { value: n };
    }
    case 'boolean': {
      if (typeof raw === 'boolean') return { value: raw };
      if (raw === 'true') return { value: true };
      if (raw === 'false') return { value: false };
      throw new ValidationError(`Campo "${name}" deve essere boolean`, 'INVALID_TYPE', name);
    }
    case 'date': {
      // Accettiamo string ISO, Date instance, o timestamp number.
      const d = raw instanceof Date ? raw : new Date(raw);
      if (Number.isNaN(d.getTime())) {
        throw new ValidationError(`Campo "${name}" data non valida`, 'INVALID_TYPE', name);
      }
      return { value: d };
    }
    case 'enum': {
      if (!Array.isArray(values) || values.length === 0) {
        throw new Error(`pickAllowed: spec "${name}" enum richiede 'values: []'`);
      }
      if (!values.includes(raw)) {
        throw new ValidationError(
          `Valore "${raw}" non valido per "${name}". Ammessi: ${values.join(', ')}`,
          'INVALID_ENUM',
          name,
        );
      }
      return { value: raw };
    }
    case 'json':
      // Permissivo: accetta qualunque oggetto/array/scalar JSON-serializzabile.
      return { value: raw };
    case 'any':
      return { value: raw };
    default:
      throw new Error(`pickAllowed: tipo "${type}" non supportato per "${name}"`);
  }
}

/**
 * Filtra `body` lasciando solo i campi whitelistati.
 *
 * @param {object} body - tipicamente `req.body`
 * @param {string[] | object} allowed - array di chiavi (no coerce) o oggetto spec
 * @returns {object} oggetto pulito
 */
function pickAllowed(body, allowed) {
  if (!isPlainObject(body)) return {};
  const out = {};

  if (Array.isArray(allowed)) {
    // Modalità "lista chiavi" — pass-through senza coerce, solo filtraggio.
    for (const key of allowed) {
      if (Object.prototype.hasOwnProperty.call(body, key)) {
        out[key] = body[key];
      }
    }
    return out;
  }

  if (!isPlainObject(allowed)) {
    throw new Error('pickAllowed: secondo arg deve essere array o oggetto spec');
  }

  // Modalità "spec con coerce + validazione"
  for (const [key, spec] of Object.entries(allowed)) {
    if (!Object.prototype.hasOwnProperty.call(body, key)) continue;
    const { value, skip } = coerceField(key, body[key], spec);
    if (!skip) out[key] = value;
  }
  return out;
}

module.exports = { pickAllowed, ValidationError };
