'use strict';

const { DataTypes } = require('sequelize');

/**
 * Monte Ore — configurazione globale dell'istituto.
 *
 * Singleton de facto: una riga per istituto. Contiene:
 *   - calendario didattico (date inizio/fine lezioni)
 *   - finestra di inserimento (range in cui i docenti possono editare)
 *   - soglia minima ore (default 324)
 *   - limite modifiche annue per docente (default 3)
 *
 * L'anno accademico va dal 1° novembre al 31 ottobre dell'anno successivo
 * (vincolo contrattuale Conservatorio). I campi `lessonsStartDate` e
 * `lessonsEndDate` definiscono il periodo effettivo di lezione DENTRO
 * questo range — usato per filtrare le settimane nella griglia docente.
 */
module.exports = (sequelize) => {
  const MonteOreSettings = sequelize.define(
    'MonteOreSettings',
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      instituteId: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      academicYear: {
        // Etichetta "2025/2026" — un'unica riga di settings per AA.
        type: DataTypes.STRING(16),
        allowNull: false,
      },
      // Periodo accademico (1 nov → 31 ott dell'anno successivo).
      // Calcolato dall'AA all'init, ma editabile per casi particolari.
      academicYearStart: { type: DataTypes.DATEONLY, allowNull: false },
      academicYearEnd: { type: DataTypes.DATEONLY, allowNull: false },
      // Periodo effettivo di lezione (es. 3 nov → 10 ott). All'interno di
      // questo range il sistema genera la griglia settimanale per il docente.
      lessonsStartDate: { type: DataTypes.DATEONLY, allowNull: false },
      lessonsEndDate: { type: DataTypes.DATEONLY, allowNull: false },
      // Finestra in cui i docenti possono inserire/modificare il proprio
      // monte ore. Fuori da questa finestra la pagina /monte-ore è in
      // sola lettura (anche per le proposte in 'draft').
      submissionWindowStart: { type: DataTypes.DATEONLY, allowNull: false },
      submissionWindowEnd: { type: DataTypes.DATEONLY, allowNull: false },
      // Soglia minima di ore richieste per validare il monte ore.
      minRequiredHours: {
        type: DataTypes.FLOAT,
        allowNull: false,
        defaultValue: 324,
      },
      // Numero massimo di richieste di variazione che un docente può
      // inviare durante l'AA dopo l'approvazione iniziale.
      maxAmendmentsPerYear: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 3,
      },
      // Override admin: se true, questo è l'AA che i docenti vedono per
      // l'inserimento del monte ore (anche fuori dalla finestra di submission
      // automatica). Vincolo applicativo + UNIQUE INDEX parziale: al più
      // una riga con questo flag=true per istituto.
      isActiveForTeachers: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      // Vincoli giornalieri configurabili (Z2/Z3 del Regolamento Tchaikovsky
      // 2019, Art. 2). Le soglie variano fra istituti e nel tempo, quindi
      // vivono qui per-AA invece di essere hardcoded. NULL = vincolo
      // disabilitato (comportamento legacy pre-v1.14).
      maxHoursPerDay: {
        type: DataTypes.FLOAT,
        allowNull: true,
        validate: { min: 1, max: 24 },
      },
      dailyBreakAfterHours: {
        type: DataTypes.FLOAT,
        allowNull: true,
        validate: { min: 1, max: 24 },
      },
      dailyBreakMinutes: {
        type: DataTypes.INTEGER,
        allowNull: true,
        validate: { min: 1, max: 480 },
      },
    },
    {
      tableName: 'monte_ore_settings',
      paranoid: false,
      indexes: [
        {
          fields: ['instituteId', 'academicYear'],
          unique: true,
          name: 'monte_ore_settings_inst_year_uq',
        },
      ],
      validate: {
        // I due campi della pausa formano un'unità logica: senza la durata
        // minima la soglia "dopo X ore" non ha senso, e viceversa. Una sola
        // valorizzazione produrrebbe un vincolo non applicabile.
        breakConfigCoherence() {
          const a = this.dailyBreakAfterHours;
          const b = this.dailyBreakMinutes;
          if ((a == null) !== (b == null)) {
            throw new Error(
              "I campi 'dailyBreakAfterHours' e 'dailyBreakMinutes' devono essere entrambi vuoti o entrambi valorizzati",
            );
          }
        },
      },
    },
  );

  return MonteOreSettings;
};
