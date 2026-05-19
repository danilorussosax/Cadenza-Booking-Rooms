'use strict';

const crypto = require('crypto');
const { DataTypes } = require('sequelize');

/**
 * Audit log delle azioni admin sull'app — APPEND-ONLY.
 *
 * Niente `paranoid` (le righe non si cancellano: il valore probatorio
 * dipende dalla loro immutabilità). Niente `updatedAt` necessario:
 * gli aggiornamenti non sono permessi (solo INSERT lato app).
 *
 * Campi:
 *   - actorId: User.id che ha eseguito l'azione (nullable per azioni
 *     pre-auth o sistema, anche se in pratica l'audit è auth-only)
 *   - action: HTTP method (POST/PUT/DELETE/PATCH) — riassume l'intent
 *   - targetType: nome canonico dell'entità ('user', 'booking', 'room', …)
 *     derivato dal path. Convenzione singolare lowercase.
 *   - targetId: id numerico dall'URL (`:id`) se presente
 *   - payload: req.body sanitizzato (password redacted) — JSON
 *   - response: subset della response (id creato/eliminato) — JSON
 *   - ip / userAgent: per investigation trail
 *   - statusCode: HTTP status finale (200, 201, 204, …)
 *
 * Index pensati per la pagina admin /admin/audit-log:
 *   - createdAt DESC: ordinamento default
 *   - actorId: filtro "azioni di X"
 *   - targetType + targetId: storia di una singola entità
 *   - action: filtro per tipo
 */
module.exports = (sequelize) => {
  const AuditLog = sequelize.define(
    'AuditLog',
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      actorId: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      action: {
        type: DataTypes.STRING(16),
        allowNull: false,
      },
      targetType: {
        type: DataTypes.STRING(48),
        allowNull: false,
      },
      targetId: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      path: {
        // Path completo della richiesta — utile per ricostruzione e debug
        type: DataTypes.STRING(255),
        allowNull: false,
      },
      statusCode: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      payload: {
        type: DataTypes.JSON,
        allowNull: true,
      },
      response: {
        type: DataTypes.JSON,
        allowNull: true,
      },
      ip: {
        type: DataTypes.STRING(64),
        allowNull: true,
      },
      userAgent: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
      // Hash-chain di integrità (tamper-evidence per compliance PA).
      // rowHash  = SHA-256( canonicalString(record) + '|' + prevHash )
      // prevHash = rowHash della riga precedente (per createdAt, id) o NULL
      //            per la prima riga della tabella.
      // Una modifica/cancellazione spezza la catena dalla riga toccata in poi
      // e viene rilevata da `verifyAuditIntegrity()`.
      // Nullable per non rompere le righe legacy create prima della migration.
      rowHash: {
        type: DataTypes.STRING(64),
        allowNull: true,
      },
      prevHash: {
        type: DataTypes.STRING(64),
        allowNull: true,
      },
    },
    {
      tableName: 'audit_log',
      paranoid: false,
      // L'app usa createdAt come timestamp dell'azione. updatedAt non serve
      // per un append-only ma Sequelize lo crea di default; lo manteniamo
      // a null/uguale a createdAt, costo trascurabile e semplifica i tooling.
      indexes: [
        { fields: ['createdAt'] },
        { fields: ['actorId'] },
        { fields: ['targetType', 'targetId'] },
        { fields: ['action'] },
        // Hot path "azioni di un utente nel tempo": senza l'indice composito
        // il planner scansiona l'indice actorId e poi filesort su createdAt.
        { fields: ['actorId', 'createdAt'] },
      ],
    },
  );

  /**
   * Stringa canonica del record audit. NON include id (auto-incrementato a
   * insert) e createdAt (assegnato dal DB) per garantire che la stessa
   * azione produca sempre la stessa hash a parità di payload. Include
   * invece tutti i campi semantici dell'azione.
   *
   * Stable JSON ordering: serializza le chiavi dell'oggetto in ordine
   * alfabetico così l'hash non dipende dall'ordine di inserimento delle
   * proprietà nel payload.
   */
  AuditLog.canonicalString = function canonicalString(record) {
    const parts = [
      String(record.actorId ?? ''),
      String(record.action ?? ''),
      String(record.targetType ?? ''),
      String(record.targetId ?? ''),
      String(record.path ?? ''),
      String(record.statusCode ?? ''),
      stableStringify(record.payload),
      stableStringify(record.response),
      String(record.ip ?? ''),
      String(record.userAgent ?? ''),
    ];
    return parts.join('|');
  };

  AuditLog.computeRowHash = function computeRowHash(record, prevHash) {
    const input = AuditLog.canonicalString(record) + '|' + (prevHash || '');
    return crypto.createHash('sha256').update(input).digest('hex');
  };

  // Hook beforeCreate: legge l'ultimo rowHash della catena e calcola il
  // proprio. Wrapped in una transazione esterna quando possibile (vedi
  // services/auditIntegrity per la verifica); l'audit middleware oggi
  // inserisce senza tx, accettando che con scritture rigorosamente
  // concorrenti possa esserci un raro mis-link → la verify lo segnala
  // come `chain_gap` (non come tampering).
  AuditLog.addHook('beforeCreate', async (instance, options) => {
    const last = await AuditLog.findOne({
      attributes: ['rowHash'],
      where: {},
      order: [
        ['createdAt', 'DESC'],
        ['id', 'DESC'],
      ],
      transaction: options.transaction,
    });
    const prev = last?.rowHash || null;
    instance.prevHash = prev;
    instance.rowHash = AuditLog.computeRowHash(instance.toJSON(), prev);
  });

  return AuditLog;
};

/**
 * Serializzazione JSON stabile: ordina le chiavi alfabeticamente in modo
 * ricorsivo. Necessario perché `JSON.stringify({a:1,b:2})` ≠
 * `JSON.stringify({b:2,a:1})` ma le due strutture sono semanticamente
 * identiche — non vogliamo che l'hash dipenda dall'ordine.
 */
function stableStringify(value) {
  if (value === null || value === undefined) return 'null';
  if (typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
  const keys = Object.keys(value).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + stableStringify(value[k])).join(',') + '}';
}
