'use strict';

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

  return AuditLog;
};
