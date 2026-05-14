'use strict';

/**
 * routes/docs.js — serve i manuali Markdown ed i loro screenshot dal
 * filesystem (`docs/`) per essere consumati dalle pagine in-app `/help/*`.
 *
 * Endpoints
 *   GET  /api/docs/:slug                — content del manuale (text/markdown)
 *   GET  /api/docs/:slug/screenshots/:f — singolo PNG dalla cartella screenshots
 *
 * Slug ammessi (whitelist): `admin`, `docente`, `studente`.
 *
 * Guard per ruolo:
 *   - `admin`    → solo admin
 *   - `docente`  → solo docente (e admin)
 *   - `studente` → solo studente (e admin)
 * Un docente NON vede il manuale studente e viceversa: contenuti diversi
 * per le rispettive funzioni dell'app. L'admin vede tutto.
 *
 * Anti path-traversal: il nome dello screenshot è ristretto a [a-z0-9._-]+\.png
 * e il path viene risolto e validato per stare dentro DOCS_DIR.
 */

const express = require('express');
const fs = require('fs');
const path = require('path');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

const DOCS_DIR = path.resolve(__dirname, '..', '..', 'docs');
const SCREENSHOTS_DIR = path.join(DOCS_DIR, 'screenshots');

// Mappa slug → { file, allowedRoles, title }.
// allowedRoles è il set di ruoli che possono leggere il manuale. admin è
// sempre presente in ogni elenco perché admin può leggere tutto.
const MANUALS = {
  admin: {
    file: 'MANUALE_ADMIN.md',
    allowedRoles: ['admin'],
    title: 'Manuale Amministratore',
  },
  docente: {
    file: 'MANUALE_DOCENTE.md',
    allowedRoles: ['admin', 'docente'],
    title: 'Manuale Docente',
  },
  studente: {
    file: 'MANUALE_STUDENTE.md',
    allowedRoles: ['admin', 'studente'],
    title: 'Manuale Studente',
  },
};

function isValidSlug(slug) {
  return Object.prototype.hasOwnProperty.call(MANUALS, slug);
}

function canRead(def, role) {
  return Array.isArray(def.allowedRoles) && def.allowedRoles.includes(role);
}

/**
 * GET /api/docs/:slug
 * Restituisce il contenuto markdown puro (text/markdown). Cache breve lato
 * client per ridurre il carico — il file è statico.
 */
router.get('/:slug', authenticate, async (req, res, next) => {
  try {
    const { slug } = req.params;
    if (!isValidSlug(slug)) {
      return res.status(404).json({ error: 'Manuale non trovato', code: 'NOT_FOUND' });
    }
    const def = MANUALS[slug];
    if (!canRead(def, req.user.role)) {
      return res
        .status(403)
        .json({ error: 'Manuale non disponibile per il tuo ruolo', code: 'FORBIDDEN' });
    }
    const filePath = path.join(DOCS_DIR, def.file);
    let content;
    try {
      content = await fs.promises.readFile(filePath, 'utf8');
    } catch {
      return res.status(404).json({ error: 'File manuale non disponibile', code: 'NOT_FOUND' });
    }
    res.set('Content-Type', 'text/markdown; charset=utf-8');
    // Cache 5 min — l'admin che pubblica un fix al manuale lo vede entro 5 min.
    res.set('Cache-Control', 'private, max-age=300');
    return res.send(content);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/docs/screenshots/:file     (NO AUTH — pubblico)
 * GET /api/docs/:slug/screenshots/:file (NO AUTH — pubblico, slug ignorato)
 *
 * Serve uno screenshot dalla cartella docs/screenshots/. Gli `<img>` HTML
 * non possono passare l'header Authorization, quindi questa rotta è
 * volutamente pubblica. Gli screenshot mostrano la UI generica della
 * piattaforma e non contengono informazioni sensibili (no dati personali
 * né credenziali).
 *
 * Whitelist a regex contro path-traversal; risolto path e verificato che
 * resti dentro SCREENSHOTS_DIR.
 */
const sendScreenshot = (req, res, next) => {
  try {
    const file = req.params.file;
    if (!/^[a-z0-9._-]+\.png$/i.test(file)) {
      return res.status(400).json({ error: 'Filename non valido' });
    }
    const full = path.resolve(SCREENSHOTS_DIR, file);
    if (!full.startsWith(SCREENSHOTS_DIR + path.sep)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    if (!fs.existsSync(full)) {
      return res.status(404).json({ error: 'Screenshot non trovato' });
    }
    res.set('Cache-Control', 'public, max-age=86400'); // 1 giorno
    return res.sendFile(full);
  } catch (err) {
    next(err);
  }
};
router.get('/screenshots/:file', sendScreenshot);
router.get('/:slug/screenshots/:file', sendScreenshot);

/**
 * GET /api/docs (no slug) → elenco dei manuali disponibili per l'utente
 * corrente. Utile alla UI per costruire un menu/landing.
 */
router.get('/', authenticate, async (req, res) => {
  const items = Object.entries(MANUALS)
    .filter(([, def]) => canRead(def, req.user.role))
    .map(([slug, def]) => ({ slug, title: def.title }));
  res.json({ manuals: items });
});

module.exports = router;
