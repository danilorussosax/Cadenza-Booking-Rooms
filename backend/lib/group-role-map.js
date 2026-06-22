'use strict';

/**
 * Risoluzione gruppo M365 → ruolo Cadenza (Decisione #4).
 * Source of truth = tabella `group_role_maps`; se vuota si ricade sui nomi gruppo
 * di OAuthSettings con le priorità di default → comportamento invariato finché
 * l'admin non personalizza il mapping da UI.
 *
 * Condiviso tra services/users/findOrCreate (login) e routes/usersOverview
 * (anteprima ruolo). I Consigli non influenzano Cadenza: ogni regola assegna un
 * ruolo valido, vince la priority più bassa.
 */

/**
 * Regole di default derivate dai nomi gruppo configurati in OAuthSettings.
 * @param {object} settings - riga OAuthSettings (o oggetto con i nomi gruppo).
 * @returns {{groupDisplayName:string, role:'admin'|'docente'|'studente', priority:number}[]}
 */
function defaultRulesFromSettings(settings) {
  const s = settings || {};
  const rules = [
    { groupDisplayName: s.groupDirezione || 'Direzione', role: 'admin', priority: 1 },
    { groupDisplayName: s.groupAmministrazione || 'Amministrazione', role: 'admin', priority: 2 },
    { groupDisplayName: s.groupDocenti || 'Docenti', role: 'docente', priority: 4 },
    { groupDisplayName: s.groupStudenti || 'Studenti', role: 'studente', priority: 5 },
  ];
  return rules.filter((r) => r.groupDisplayName && String(r.groupDisplayName).trim() !== '');
}

/**
 * Carica le regole dal DB (GroupRoleMap); se la tabella è vuota usa i default
 * dai nomi gruppo. Best-effort: su errore DB ricade sui default.
 * @param {object} settings - riga OAuthSettings.
 * @returns {Promise<{groupDisplayName:string, role:string, priority:number}[]>}
 */
async function loadCadenzaRules(settings) {
  try {
    const { GroupRoleMap } = require('../models');
    const rows = await GroupRoleMap.findAll({ order: [['priority', 'ASC']] });
    if (rows && rows.length > 0) {
      return rows.map((r) => ({
        groupDisplayName: r.groupDisplayName,
        role: r.role,
        priority: r.priority,
      }));
    }
  } catch {
    // tabella non ancora creata / errore → default
  }
  return defaultRulesFromSettings(settings);
}

/**
 * Applica le regole ai gruppi M365 dell'utente: vince la priority più bassa tra
 * le regole il cui gruppo è presente. Ritorna il ruolo Cadenza o `null`.
 * @param {string[]} groupNames - displayName gruppi M365 (qualsiasi case).
 * @param {{groupDisplayName:string, role:string, priority:number}[]} rules
 * @returns {'admin'|'docente'|'studente'|null}
 */
function resolveCadenzaRole(groupNames, rules) {
  if (!Array.isArray(groupNames) || groupNames.length === 0) return null;
  const set = new Set(groupNames.map((g) => String(g).trim().toLowerCase()));
  const matched = (rules || [])
    .filter(
      (r) =>
        r.groupDisplayName &&
        String(r.groupDisplayName).trim() !== '' &&
        set.has(String(r.groupDisplayName).trim().toLowerCase()),
    )
    .sort((a, b) => a.priority - b.priority);
  return matched.length > 0 ? matched[0].role : null;
}

module.exports = { defaultRulesFromSettings, loadCadenzaRules, resolveCadenzaRole };
