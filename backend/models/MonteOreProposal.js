'use strict';

const { DataTypes } = require('sequelize');

/**
 * Monte Ore — proposta annuale di un docente per le ore di didattica
 * (lezioni, prove, studio individuale) da svolgersi in determinate aule.
 *
 * Workflow:
 *   draft        → stato iniziale; il docente compila righe schedule
 *   submitted    → il docente ha inviato la proposta al coordinatore
 *   approved     → il coordinatore ha approvato (può ancora modificare le aule
 *                  prima di generare le prenotazioni)
 *   rejected     → coordinator ha rifiutato (con motivo)
 *   generated    → le prenotazioni ricorrenti sono state create dal sistema
 *
 * Ogni proposta riferisce un anno accademico (`academicYear` come stringa
 * libera tipo "2025/2026") e una validità temporale (`validFrom`/`validTo`)
 * usata dal generatore di Booking ricorrenti per delimitare il loop.
 *
 * Soft-disable degli orphan: paranoid=false. Il dataset annuale è snello
 * e va conservato per audit/storia dei consuntivi didattici.
 */
module.exports = (sequelize) => {
  const MonteOreProposal = sequelize.define(
    'MonteOreProposal',
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      userId: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      academicYear: {
        // Etichetta libera "2025/2026" — utile in UI, non parsata
        type: DataTypes.STRING(16),
        allowNull: false,
      },
      validFrom: {
        // Data inizio validità (es. 2025-09-15). Il generator booking parte da qui.
        type: DataTypes.DATEONLY,
        allowNull: false,
      },
      validTo: {
        // Data fine validità (es. 2026-06-30).
        type: DataTypes.DATEONLY,
        allowNull: false,
      },
      totalHoursRequested: {
        // Ore totali richieste — calcolate dal docente o sommate dalle righe
        type: DataTypes.FLOAT,
        allowNull: false,
        defaultValue: 0,
      },
      notes: {
        // Note del docente (eventuali esigenze, vincoli particolari)
        type: DataTypes.TEXT,
        allowNull: true,
      },
      status: {
        type: DataTypes.ENUM('draft', 'submitted', 'approved', 'rejected', 'generated'),
        allowNull: false,
        defaultValue: 'draft',
      },
      submittedAt: { type: DataTypes.DATE, allowNull: true },
      approvedAt: { type: DataTypes.DATE, allowNull: true },
      rejectedAt: { type: DataTypes.DATE, allowNull: true },
      generatedAt: { type: DataTypes.DATE, allowNull: true },
      approverId: {
        // Admin/coordinator che ha approvato/rifiutato/generato
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      rejectionReason: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      coordinatorNotes: {
        // Note del coordinatore (es. modifiche fatte prima di approvare)
        type: DataTypes.TEXT,
        allowNull: true,
      },
      // Snapshot dell'esito di generate-bookings: { created, skipped, errors }.
      // Permette all'admin di rivedere a posteriori cosa è stato creato e cosa
      // è stato saltato (giorni in conflitto, festività, ecc.).
      generationSummary: {
        type: DataTypes.JSON,
        allowNull: true,
      },
      // ---- Campi della Sezione A (parametri pattern settimanale) ----
      // Numero di giorni lavorativi a settimana (vincolo contrattuale: 2-4)
      workingDaysCount: {
        type: DataTypes.INTEGER,
        allowNull: true,
        validate: { min: 2, max: 5 },
      },
      // ---- Validazione 324h ----
      // Snapshot della soglia minima al momento del submit (presa da
      // MonteOreSettings.minRequiredHours), così la validazione resta stabile
      // anche se la settings cambia in futuro.
      minRequiredHoursSnapshot: {
        type: DataTypes.FLOAT,
        allowNull: true,
      },
      // Ore totali EFFETTIVAMENTE pianificate cliccando le celle della
      // griglia settimanale (sezione B), distinto da `totalHoursRequested`
      // che è il calcolo teorico dal pattern.
      totalHoursPlanned: {
        type: DataTypes.FLOAT,
        allowNull: false,
        defaultValue: 0,
      },
      // ---- Tracciamento modifiche post-approval ----
      amendmentCount: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      // Flag impostato dall'admin (o automaticamente quando cambia
      // contratto/ore del docente in corso d'anno): il docente deve
      // rivedere e ri-inviare la proposta perché i presupposti su cui
      // era stata approvata non sono più validi. Banner in UI docente.
      requiresRevalidation: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      revalidationReason: {
        type: DataTypes.STRING(500),
        allowNull: true,
      },
      // ---- Origine della proposta ----
      // 'user'         → creata dal docente via UI (default storico)
      // 'admin_import' → importata dall'admin via Excel "Monte Ore" — tracciata
      //                  dai campi `importedAt` / `importedById` / `importSourceRef`.
      source: {
        type: DataTypes.ENUM('user', 'admin_import'),
        allowNull: false,
        defaultValue: 'user',
      },
      importedAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      // Riferimento logico all'admin importatore (no FK constraint — segue il
      // pattern di User.contractType).
      importedById: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      // Nome del file Excel originale (es. "monteore-mario-rossi.xlsx").
      importSourceRef: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
    },
    {
      tableName: 'monte_ore_proposals',
      paranoid: false,
      indexes: [
        { fields: ['userId'] },
        { fields: ['status'] },
        { fields: ['academicYear'] },
        // Un docente può avere UNA proposta per anno accademico (UPSERT logico)
        {
          fields: ['userId', 'academicYear'],
          unique: true,
          name: 'monte_ore_proposals_user_year_uq',
        },
        // Filtra rapidamente le proposte importate (admin) in stato submitted.
        { fields: ['source', 'status'], name: 'monte_ore_proposals_source_status' },
      ],
    },
  );

  return MonteOreProposal;
};
