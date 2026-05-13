'use strict';

const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const Building = sequelize.define(
    'Building',
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
      name: {
        type: DataTypes.STRING(200),
        allowNull: false,
      },
      code: {
        type: DataTypes.STRING(50),
        allowNull: true,
      },
      address: {
        type: DataTypes.STRING(300),
        allowNull: true,
      },
      floors: {
        // Lista dei piani disponibili (es. ["Piano Terra","Primo Piano","Secondo Piano"])
        type: DataTypes.JSON,
        allowNull: false,
        defaultValue: ['Piano Terra'],
      },
      description: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      // Configurazione del kiosk pubblico /display.
      // Se displayEnabled=false, l'edificio NON entra nella rotazione.
      // displayIntervalSec è la durata di visualizzazione di questo edificio
      // prima di passare al successivo (default 30 secondi).
      displayEnabled: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      displayIntervalSec: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 30,
      },
      // Finestra (giorni) entro cui i concerti vengono inclusi nella rotazione
      // /display di questo edificio: i concerti con startTime tra "ora" e
      // "ora + N giorni" diventano slide. 0 = funzione disattivata per l'edificio.
      displayConcertsDays: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 30,
      },
      // Toggle on/off della rotazione concerti per questo edificio. Se false
      // i concerti non vengono mostrati indipendentemente da days/count.
      displayConcertsEnabled: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      // Numero massimo di concerti da mostrare (più imminenti per data) sul
      // display. 0 = nessun limite (solo finestra giorni).
      displayConcertsCount: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      // Durata (secondi) di ciascuna slide concerto nel kiosk. Clamp [5, 600].
      displayConcertsIntervalSec: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 15,
      },
      // Master toggle per la rotazione delle prenotazioni di questo edificio
      // sul kiosk pubblico. Quando false, le slide della tabella prenotazioni
      // dell'edificio non vengono inserite nella rotazione (l'edificio resta
      // comunque "abilitato" per altri scopi, p.es. poter essere selezionato
      // a livello tabella).
      displayBookingsEnabled: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      // Toggle on/off della rotazione annunci sul kiosk per questo edificio.
      // Quando false gli annunci non entrano nelle slide indipendentemente
      // dagli altri parametri.
      displayAnnouncementsEnabled: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      // Numero massimo di annunci da mostrare nella rotazione del kiosk.
      // 0 = nessun limite. Default 5.
      displayAnnouncementsCount: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 5,
      },
      // Durata (secondi) di ciascuna slide annuncio nel kiosk. Clamp [5, 600].
      displayAnnouncementsIntervalSec: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 12,
      },
      // Se true, vengono mostrati solo gli annunci con isPinned=true.
      // Utile quando l'admin vuole evidenziare solo le comunicazioni critiche.
      displayAnnouncementsPinnedOnly: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      // Modalità di visualizzazione della tabella prenotazioni nel kiosk
      // pubblico per questo edificio:
      //   - 'weekly'  → matrice aule × giorni Lun-Sab con slot 30' (default storico)
      //   - 'daily'   → matrice aule × orari del giorno corrente, replica della
      //                 "Griglia oggi" del foglio Excel. Più informativa per
      //                 la portineria all'inizio della giornata.
      // Configurabile per singolo edificio così la sede principale può
      // mostrare la settimana e una sede più piccola/turistica solo l'oggi.
      displayViewMode: {
        type: DataTypes.ENUM('weekly', 'daily'),
        allowNull: false,
        defaultValue: 'weekly',
      },
    },
    {
      tableName: 'buildings',
      paranoid: true,
    },
  );

  return Building;
};
