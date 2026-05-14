'use strict';

const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const Room = sequelize.define(
    'Room',
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      buildingId: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      name: {
        type: DataTypes.STRING(200),
        allowNull: false,
      },
      code: {
        type: DataTypes.STRING(50),
        allowNull: true,
      },
      floor: {
        type: DataTypes.STRING(100),
        allowNull: false,
      },
      capacity: {
        type: DataTypes.INTEGER,
        defaultValue: 1,
      },
      type: {
        // Tipologia: studio individuale, sala prove, aula concerti, classe, ecc.
        type: DataTypes.ENUM(
          'studio',
          'sala_prove',
          'aula_concerti',
          'classe',
          'aula_didattica',
          'altro',
        ),
        defaultValue: 'studio',
      },
      // Restrizioni accesso: se settato, solo i ruoli elencati possono prenotare.
      // Se vuoto, tutti i ruoli possono (rispettando le regole)
      allowedRoles: {
        type: DataTypes.JSON,
        defaultValue: ['admin', 'docente', 'studente'],
      },
      // Solo iscritti a determinati corsi possono prenotare? (lista ID corsi, vuoto = tutti)
      allowedCourseIds: {
        type: DataTypes.JSON,
        defaultValue: [],
      },
      isBookable: {
        type: DataTypes.BOOLEAN,
        defaultValue: true,
      },
      // Toggle check-in QR per aula con cascata Building → Room:
      //   - NULL       → eredita Building.checkInDefault (impostazione generale)
      //   - true/false → override esplicito su questa aula
      // Quando il valore risolto (vedi backend/lib/checkInPolicy.js) è false:
      //   - lo scheduler ghost-cancel NON cancella le booking di questa aula
      //     anche se l'utente non ha effettuato il check-in
      //   - la UI nasconde badge "senza check-in" e card "Check-in richiesto"
      //   - il pulsante "Stampa QR aula" viene nascosto
      // Default null: l'aula eredita dall'edificio (che a sua volta default
      // false → "tutte le aule senza check-in" come stato iniziale).
      requireCheckIn: {
        type: DataTypes.BOOLEAN,
        allowNull: true,
        defaultValue: null,
      },
      // Toggle "high-impact": quando true, le prenotazioni di non-admin nascono
      // con status='pending_approval' e devono essere approvate o rifiutate da
      // un admin prima di diventare 'confirmed'. Tipico per sale concerti,
      // auditorium, sale di rappresentanza. Default false: aule normali.
      requiresApproval: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      notes: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      // URL pubblico della foto dell'aula (formato `/storage/room-{id}-{ts}.webp`).
      // Le immagini caricate vengono ridimensionate server-side in 16:9 a 1200x675
      // (mantenendo l'aspect ratio con object-fit:cover) per garantire un layout
      // uniforme nella pagina /rooms.
      photoUrl: {
        type: DataTypes.STRING(500),
        allowNull: true,
      },
      // Token segreto per il QR-code di check-in. Codificato nell'URL del QR
      // (es. /check-in/room/:id?t=<qrToken>) e validato lato server quando
      // l'utente conferma la presenza. Rigenerare il token invalida tutti i
      // QR fisici stampati prima — caso d'uso: stampa di un nuovo QR per
      // un'aula la cui copia precedente è stata fotografata o esposta.
      // Hex 32 char (16 bytes random) — collisione trascurabile.
      qrToken: {
        type: DataTypes.STRING(64),
        allowNull: true,
        unique: true,
      },
    },
    {
      tableName: 'rooms',
      paranoid: true,
    },
  );

  return Room;
};
