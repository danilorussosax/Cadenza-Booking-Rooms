'use strict';

const { DataTypes } = require('sequelize');

/**
 * Catalogo configurabile dei tipi di prenotazione (gap #7 EasyRoom parity).
 *
 * Layer di metadata sopra il vincolo ENUM `Booking.type`. L'admin può
 * personalizzare label / color / icon / sortOrder / defaultDurationMinutes /
 * description / isActive senza ricompilare. I 5 tipi seed (`isSystem=true`)
 * sono protetti da delete; nuovi tipi richiedono una migration formale del
 * tipo ENUM su `bookings.type` (multi-DB) che non viene esposta via API
 * self-service in questa release.
 *
 * Pattern d'uso lato backend:
 *   - Validation: `Booking.type` resta ENUM hard-coded. Nessun cambio runtime.
 *   - Display: il frontend chiama `GET /api/booking-types` per ottenere
 *     label/color/icon e renderizza la dropdown / i badge.
 */
module.exports = (sequelize) => {
  const BookingTypeCatalog = sequelize.define(
    'BookingTypeCatalog',
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      // Codice stabile: combacia con `Booking.type` (5 valori ENUM legacy).
      // UNIQUE per impedire duplicati. Lowercase + underscore convention.
      code: {
        type: DataTypes.STRING(40),
        allowNull: false,
        unique: true,
        validate: {
          is: {
            args: /^[a-z][a-z0-9_]{1,39}$/,
            msg: 'code deve essere lowercase con _ (max 40 char, inizia con lettera)',
          },
        },
      },
      // Label umano-leggibile mostrata in UI. Editabile dall'admin per
      // ridenominare (es. "Studio individuale" → "Studio in autonomia").
      label: {
        type: DataTypes.STRING(100),
        allowNull: false,
      },
      // Hex color #RRGGBB usato per badge + bordo block calendar. Default
      // sensato seed; admin lo personalizza per allinearsi al brand.
      color: {
        type: DataTypes.STRING(7),
        allowNull: false,
        defaultValue: '#3b82f6',
        validate: {
          is: {
            args: /^#[0-9a-fA-F]{6}$/,
            msg: 'color deve essere formato #RRGGBB',
          },
        },
      },
      // Nome icona lucide-react (es. 'BookOpen', 'Mic', 'Music'). Il frontend
      // resolve dinamicamente via lookup. Default 'Calendar'.
      icon: {
        type: DataTypes.STRING(40),
        allowNull: false,
        defaultValue: 'Calendar',
      },
      // Ordine in dropdown (0 = primo). Permette all'admin di mettere
      // "lezione" prima di "studio individuale" se il flusso più frequente
      // del Conservatorio è l'inserimento lezione.
      sortOrder: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      // Toggle visibilità nella dropdown utente. I record `isSystem=true`
      // possono essere disattivati ma non eliminati.
      isActive: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      // True per i 5 default seed: protetti da DELETE, ma label/color/...
      // restano editabili. Senza questo flag un admin distratto poteva
      // cancellare 'lezione' lasciando booking esistenti orfane di catalog.
      isSystem: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      // Pre-fill della durata nel BookingFormDialog quando si seleziona
      // questo tipo. Es: 'concerto' → 120 min, 'lezione' → 60 min,
      // 'studio_individuale' → 60 min. Null = nessun pre-fill.
      defaultDurationMinutes: {
        type: DataTypes.INTEGER,
        allowNull: true,
        validate: { min: 5, max: 1440 },
      },
      // Descrizione opzionale mostrata come tooltip / help text nel form.
      description: {
        type: DataTypes.STRING(500),
        allowNull: true,
      },
    },
    {
      tableName: 'booking_type_catalog',
      // Soft-delete attivo: cancellare un tipo (non system) marca deletedAt;
      // le booking esistenti che riferiscono a `code` continuano a funzionare
      // perché Booking.type è solo un ENUM string indipendente dalla FK.
      paranoid: true,
      indexes: [
        { fields: ['code'], unique: true },
        { fields: ['sortOrder'] },
        { fields: ['isActive'] },
      ],
    },
  );

  return BookingTypeCatalog;
};
