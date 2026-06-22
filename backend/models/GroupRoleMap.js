'use strict';

const { DataTypes } = require('sequelize');

/**
 * Mapping editabile gruppo M365 → ruolo Cadenza (Decisione #4).
 * Source of truth della risoluzione ruolo al login M365: se la tabella è vuota,
 * `lib/group-role-map.js` ricade sui nomi gruppo di OAuthSettings con le priorità
 * di default (direzione→admin 1, amministrazione→admin 2, docenti→docente 4,
 * studenti→studente 5) → comportamento invariato finché l'admin non personalizza.
 *
 * Per-app: questa tabella è SOLO Cadenza (Opera ha la sua `GroupRoleMap` Prisma).
 * I Consigli non influenzano Cadenza, quindi niente overlay/deny: ogni riga assegna
 * un ruolo valido e vince la priority più bassa.
 */
module.exports = (sequelize) => {
  const GroupRoleMap = sequelize.define(
    'GroupRoleMap',
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      // Object id del gruppo Entra (dalla dropdown Graph /groups). Opzionale:
      // la risoluzione avviene per `groupDisplayName` (i nomi arrivano da /me/memberOf).
      groupId: {
        type: DataTypes.STRING(200),
        allowNull: true,
      },
      groupDisplayName: {
        type: DataTypes.STRING(200),
        allowNull: false,
      },
      role: {
        type: DataTypes.ENUM('admin', 'docente', 'studente'),
        allowNull: false,
      },
      priority: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 100,
      },
    },
    { tableName: 'group_role_maps' },
  );

  return GroupRoleMap;
};
