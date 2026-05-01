'use strict';

/**
 * GET /api/app-icons
 *
 * Restituisce la lista dei file PNG presenti in `frontend/public/logo-app/`.
 * Sono le icone selezionabili dall'utente nel pannello *Profilo → Icona app*.
 *
 * Per aggiungere una nuova icona basta droppare un file `.png` (o `.svg`)
 * nella cartella, senza riavviare l'app: il listing è sempre filesystem-fresh.
 *
 * Endpoint pubblico (no auth): è solo metadata di asset statici già serviti
 * dal middleware static. Niente PII, niente write.
 */

const express = require('express');
const path = require('path');
const fs = require('fs');

const router = express.Router();

// L'endpoint `/logo-app/*` è servito direttamente da
// `frontend/public/logo-app/` (vedi app.js — static mount con priorità su
// dist). Quindi il listing legge esattamente la stessa cartella, garantendo
// 1:1 fra ciò che l'API riporta e ciò che il browser può scaricare.
const LOGO_APP_DIR = path.resolve(__dirname, '..', '..', 'frontend', 'public', 'logo-app');

const ALLOWED_EXT = new Set(['.png', '.svg', '.webp', '.jpg', '.jpeg']);

function listIcons() {
  let names;
  try {
    names = fs.readdirSync(LOGO_APP_DIR);
  } catch {
    return [];
  }

  const items = [];
  for (const name of names.sort()) {
    if (name.startsWith('.')) continue; // .DS_Store ecc.
    const ext = path.extname(name).toLowerCase();
    if (!ALLOWED_EXT.has(ext)) continue;
    const full = path.join(LOGO_APP_DIR, name);
    let stat = null;
    try {
      stat = fs.statSync(full);
    } catch {
      continue;
    }
    if (!stat.isFile()) continue; // skip sottocartelle
    items.push({
      name, // es. "cadenza.png"
      url: `/logo-app/${name}`, // path servito dallo static
      size: stat.size,
      mtime: new Date(stat.mtimeMs).toISOString(),
    });
  }
  return items;
}

router.get('/', (req, res) => {
  res.set('Cache-Control', 'public, max-age=60'); // listing rinfrescato ogni minuto
  res.json({ icons: listIcons() });
});

module.exports = router;
