'use strict';

const { DataTypes } = require('sequelize');

/**
 * Quote dinamiche per risorsa — "Fair usage" stile ASIMUT.
 *
 * Estende le `BookingRule` (cap globale per ruolo) consentendo limiti più
 * granulari per *categoria di risorsa*: tipologia di aula (es. "max 2h/sett
 * in aula_concerti per gli studenti") oppure tipo di strumentazione
 * presente in aula (es. "max 4h/sett in stanze con pianoforte_a_coda").
 *
 * Logica di applicazione (vedi services/bookingValidator.js):
 *   1. Si recuperano tutte le quote `isActive=true` con `role` corrispondente
 *      all'utente.
 *   2. Per la booking richiesta si determina quali quote "matchano" lo scope
 *      della stanza (roomType → room.type; equipmentType → room.equipment ha
 *      almeno un elemento di quel type; global → sempre).
 *   3. Per ciascuna quota matching si sommano le ore già usate dall'utente
 *      sulle altre stanze che ricadono nello stesso scope, in: settimana
 *      ISO corrente (lun→dom) e giorno corrente.
 *   4. Se l'aggiunta della booking supera `maxHoursPerWeek` o
 *      `maxHoursPerDay`, errore `QUOTA_EXCEEDED_<scope>` (vedi error mapper).
 *
 * Convenzioni:
 *   - `maxHoursPerWeek = 0` → cap settimanale disattivato
 *   - `maxHoursPerDay  = 0` → cap giornaliero disattivato
 *   - almeno uno dei due deve essere > 0 (validazione lato route)
 *   - per `scopeKind = 'global'`, `scopeValue` è ignorato (convenzionalmente
 *     stringa vuota o `*`); il vincolo UNIQUE composito mantiene una sola
 *     riga "global" per ruolo.
 */
module.exports = (sequelize) => {
  const BookingQuota = sequelize.define(
    'BookingQuota',
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      role: {
        type: DataTypes.ENUM('admin', 'docente', 'studente'),
        allowNull: false,
      },
      scopeKind: {
        // - roomType       → tipo aula (room.type)
        // - equipmentType  → equipment in aula
        // - room           → singola aula (scopeValue = roomId numerico)
        // - building       → tutto un edificio (scopeValue = buildingId numerico)
        // - global         → qualsiasi prenotazione
        type: DataTypes.ENUM('roomType', 'equipmentType', 'room', 'building', 'global'),
        allowNull: false,
      },
      // Per scopeKind='global' usiamo '*' come "marker" perché il vincolo
      // UNIQUE composito non gestisce NULL in modo deterministico su SQLite.
      scopeValue: {
        type: DataTypes.STRING(80),
        allowNull: false,
        defaultValue: '*',
      },
      maxHoursPerWeek: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
        validate: { min: 0 },
      },
      maxHoursPerDay: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
        validate: { min: 0 },
      },
      // ===== Estensioni granulari (step 3) =====
      // Cap mensile (mese di calendario in cui cade l'inizio della booking).
      // 0 = disattivato.
      maxHoursPerMonth: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
        validate: { min: 0 },
      },
      // Cap su numero di prenotazioni nello scope (oltre alle ore).
      // Conteggio settimanale ISO. 0 = disattivato.
      maxBookings: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
        validate: { min: 0 },
      },
      // Giorni della settimana in cui la quota è attiva (0=domenica .. 6=sabato).
      // Array vuoto = sempre attiva (default).
      daysOfWeek: {
        type: DataTypes.JSON,
        allowNull: false,
        defaultValue: [],
      },
      // Fascia oraria HH:mm in cui la quota è attiva. Se entrambi NULL = sempre.
      // Se la booking non interseca la fascia, la quota non si applica.
      timeFrom: {
        type: DataTypes.STRING(5),
        allowNull: true,
      },
      timeTo: {
        type: DataTypes.STRING(5),
        allowNull: true,
      },
      isActive: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
    },
    {
      tableName: 'booking_quotas',
      paranoid: true,
      indexes: [
        { fields: ['role', 'isActive'] },
        { fields: ['scopeKind', 'scopeValue'] },
        // Una sola riga per (ruolo + scope) — evita config duplicate.
        // Caveat su Postgres con paranoid: il vincolo include i record
        // soft-deleted; se serve "ricreare" una quota cancellata, occorre
        // prima `restore()` la riga oppure usare un partial unique index
        // con WHERE deletedAt IS NULL (gestibile via SQL manuale).
        {
          name: 'booking_quotas_role_scope_unique',
          fields: ['role', 'scopeKind', 'scopeValue'],
          unique: true,
        },
      ],
    },
  );

  return BookingQuota;
};
