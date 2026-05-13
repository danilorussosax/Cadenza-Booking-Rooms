/**
 * Helper di parsing della URL del Display kiosk per il "single-building mode".
 *
 * Tre sintassi accettate:
 *   /display?b=<slug>          ← classico
 *   /display?building=<slug>   ← verboso
 *   /display?<slug>            ← key boolean (no `=`), comoda da memorizzare
 *
 * Lo slug viene normalizzato a stringa lowercase senza accenti / spazi /
 * punteggiatura, e confrontato contro `Building.code` o, in fallback,
 * contro `Building.name` (stesso slugify).
 *
 * In `lib/displayUrl.ts` invece che inline nella pagina così è
 * facilmente testabile via vitest senza istanziare l'intera Display.
 */

/**
 * Normalizza una stringa in uno slug "stabile" (lowercase, no accenti, solo
 * alfanumerici). Idempotente. Esempi:
 *   "Sede Centrale"   → "sedecentrale"
 *   "Edificio NORD-1" → "edificionord1"
 *   "Süd"             → "sud"
 */
export function slugifyBuilding(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // toglie diacritici (accenti combinanti)
    .replace(/[^a-z0-9]+/g, '');
}

/**
 * Estrae lo slug del building dalla URL search string. Ritorna `null`
 * se nessuna delle tre sintassi è presente o se il valore è vuoto.
 *
 * @param search Tipicamente `window.location.search` (es. "?b=centrale"
 *               oppure "?centrale" o "?building=radar").
 */
export function parseDisplayBuildingSlug(search: string): string | null {
  // URLSearchParams accetta sia "foo=bar" sia "foo" (chiave senza valore).
  // Per "foo" Node/browser standard ritornano "" come valore.
  const params = new URLSearchParams(search);

  // 1) param espliciti — vincono sul fallback boolean
  const explicit = params.get('b') ?? params.get('building');
  if (explicit?.trim()) return slugifyBuilding(explicit);

  // 2) chiave-booleana: prendiamo la PRIMA chiave non vuota con valore vuoto.
  //    Ignoriamo "b" e "building" (già gestiti) per non confondere.
  for (const [key, val] of params.entries()) {
    if (!val && key.length > 0 && key !== 'b' && key !== 'building') {
      return slugifyBuilding(key);
    }
  }
  return null;
}

/**
 * Trova il building che matcha lo slug nella lista data. Strategia a 3 livelli:
 *
 *   1. **Match esatto su `code`** — vince sempre se trovato. Permette
 *      identificatori brevi sicuri tipo `?b=CENT`.
 *   2. **Match esatto su `name` normalizzato** — la stringa pulita del nome
 *      coincide con lo slug (es. `?b=sedecentrale` → "Sede Centrale").
 *   3. **Match per substring sul `name` normalizzato** — fallback friendly:
 *      `?centrale` matcha "Sede Centrale", `?radar` matcha "Sede Radar".
 *      Necessario perché l'utente che apre `/display?centrale` si aspetta
 *      intuitivamente che funzioni anche se il nome ufficiale è più lungo.
 *      In caso di ambiguità (più building contengono lo stesso substring),
 *      vince il primo nell'ordine fornito.
 *
 * Ritorna `null` se nessun match a nessuno dei 3 livelli.
 */
export function findBuildingBySlug<T extends { code?: string | null; name: string }>(
  buildings: readonly T[],
  slug: string,
): T | null {
  if (!slug) return null;
  // 1. Match esatto su code
  for (const b of buildings) {
    if (b.code && slugifyBuilding(b.code) === slug) return b;
  }
  // 2. Match esatto su name normalizzato
  for (const b of buildings) {
    if (slugifyBuilding(b.name) === slug) return b;
  }
  // 3. Substring match sul name (fallback friendly per slug parziali)
  for (const b of buildings) {
    if (slugifyBuilding(b.name).includes(slug)) return b;
  }
  return null;
}
