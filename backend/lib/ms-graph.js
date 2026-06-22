'use strict';

/**
 * Helper Microsoft Graph (server-only) per il gate gruppi M365.
 * Porting di produzione_artistica_web/src/lib/server/ms-graph.ts.
 * Richiede lo scope delegato `GroupMember.Read.All` (consenso admin nel tenant)
 * per leggere i gruppi dell'utente loggato; `Group.Read.All` (delegato o app)
 * per elencare tutti i gruppi del tenant nella dropdown della vista admin.
 *
 * Usa la `fetch` globale di Node (>=18).
 */

/**
 * Ritorna i displayName (lowercase) dei GRUPPI di cui l'utente è membro.
 * Segue la paginazione `@odata.nextLink`. Ritorna `null` in caso di errore
 * (rete/permessi) → il chiamante applica una policy fail-closed.
 * @param {string} accessToken
 * @returns {Promise<string[] | null>}
 */
async function getUserGroupNames(accessToken) {
  if (!accessToken) return null;

  const names = [];
  let url = 'https://graph.microsoft.com/v1.0/me/memberOf?$select=id,displayName&$top=999';

  try {
    for (let page = 0; url && page < 20; page++) {
      const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
      if (!res.ok) return null;

      const data = await res.json();
      for (const obj of data.value ?? []) {
        if (obj['@odata.type'] === '#microsoft.graph.group' && obj.displayName) {
          names.push(String(obj.displayName).trim().toLowerCase());
        }
      }
      url = data['@odata.nextLink'];
    }
    return names;
  } catch {
    return null;
  }
}

/**
 * Token app-only (client_credentials) per chiamate Graph che non dipendono
 * dall'utente loggato (es. elenco gruppi del tenant). Richiede la permission
 * APPLICATIVA `Group.Read.All` con consenso admin. Ritorna `null` su errore.
 * @returns {Promise<string | null>}
 */
async function getAppOnlyToken(tenant, clientId, clientSecret) {
  if (!tenant || !clientId || !clientSecret) return null;
  try {
    const res = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        scope: 'https://graph.microsoft.com/.default',
        grant_type: 'client_credentials',
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.access_token ?? null;
  } catch {
    return null;
  }
}

/**
 * Elenca TUTTI i gruppi del tenant (`GET /groups`) per popolare la dropdown
 * della vista di allineamento. Segue la paginazione. Ritorna `null` su errore
 * (la UI ricade su input testo libero).
 * @param {string} accessToken
 * @returns {Promise<{id:string, displayName:string}[] | null>}
 */
async function listTenantGroups(accessToken) {
  if (!accessToken) return null;

  const groups = [];
  let url = 'https://graph.microsoft.com/v1.0/groups?$select=id,displayName&$top=999';

  try {
    for (let page = 0; url && page < 50; page++) {
      const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
      if (!res.ok) return null;

      const data = await res.json();
      for (const g of data.value ?? []) {
        if (g.id && g.displayName) groups.push({ id: g.id, displayName: g.displayName });
      }
      url = data['@odata.nextLink'];
    }
    groups.sort((a, b) => a.displayName.localeCompare(b.displayName, 'it'));
    return groups;
  } catch {
    return null;
  }
}

module.exports = { getUserGroupNames, getAppOnlyToken, listTenantGroups };
