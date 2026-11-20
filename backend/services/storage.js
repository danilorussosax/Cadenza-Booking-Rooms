'use strict';

/**
 * Storage delle immagini caricate dagli utenti (cartella `backend/uploads`,
 * servita pubblicamente come `/storage/<file>`).
 *
 * Interfaccia:
 *   uploadsDir()                       cartella unica (creata se manca)
 *   dir                                stesso path, senza crearlo (backup/restore)
 *   saveImage(buf, profile, {id,...})  elabora (sharp) e salva, ritorna l'URL
 *   replaceImage(oldUrl, buf, profile, {id,...})  salva il nuovo, poi rimuove il vecchio
 *   removeStored(url)                  rimuove un file gestito; non lancia mai
 *   resolveStoredPath(url)             path assoluto sicuro o null
 *   isImageFormatError(err)            errore di decodifica sharp
 *   PROFILES                           profili nominati (vedi sotto)
 *   createStorage(dir)                 stessa interfaccia su un'altra cartella (test)
 *
 * Lo schema degli URL (`/storage/<file>`) e' quello gia' salvato nel DB:
 * nessuna migrazione.
 */

const fs = require('node:fs');
const path = require('node:path');
const logger = require('../lib/logger');

const URL_PREFIX = '/storage/';
const DEFAULT_DIR = path.join(__dirname, '..', 'uploads');

/**
 * Profili nominati. Le differenze fra profili sono un DATO consolidato (foto
 * aula/strumento 16:9 ritagliate, locandina verticale non ingrandita, logo e
 * foto profilo caricati dal client senza elaborazione): non vanno uniformate.
 * `maxBytes` e' il limite pre-elaborazione applicato da multer nelle route.
 */
const PROFILES = Object.freeze({
  room: Object.freeze({
    prefix: 'room',
    maxBytes: 8 * 1024 * 1024,
    resize: {
      width: 1200,
      height: 675,
      fit: 'cover',
      position: 'attention',
      withoutEnlargement: false,
    },
    webpQuality: 82,
  }),
  instrument: Object.freeze({
    prefix: 'instrument',
    maxBytes: 8 * 1024 * 1024,
    resize: { width: 1200, height: 675, fit: 'cover', position: 'attention' },
    webpQuality: 82,
  }),
  poster: Object.freeze({
    prefix: 'concert',
    maxBytes: 12 * 1024 * 1024,
    resize: { width: 1200, height: 1600, fit: 'inside', withoutEnlargement: true },
    webpQuality: 85,
  }),
  // Senza sharp: il file e' scritto da multer (diskStorage) con estensione
  // decisa dal MIME (profile) o da originalname (logo, per ammettere SVG).
  logo: Object.freeze({ prefix: 'institute', maxBytes: 2 * 1024 * 1024, raw: true }),
  profile: Object.freeze({ prefix: 'user', maxBytes: 2 * 1024 * 1024, raw: true }),
});

function isImageFormatError(err) {
  return Boolean(err && err.message && /sharp|input|unsupported/i.test(err.message));
}

function createStorage(dir = DEFAULT_DIR) {
  function uploadsDir() {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  function resolveStoredPath(url) {
    if (typeof url !== 'string' || !url.startsWith(URL_PREFIX)) return null;
    const rest = url.slice(URL_PREFIX.length);
    const file = path.basename(rest);
    if (!file || file === '.' || file === '..' || file !== rest || file.includes('\\')) return null;
    return path.join(dir, file);
  }

  /** @returns {Promise<boolean>} true se il file e' stato rimosso */
  async function removeStored(url) {
    const fp = resolveStoredPath(url);
    if (!fp) return false;
    try {
      await fs.promises.unlink(fp);
      return true;
    } catch (err) {
      if (err.code !== 'ENOENT') {
        logger.warn({ err: err.message, url, scope: 'storage' }, 'remove stored file failed');
      }
      return false;
    }
  }

  /** @returns {Promise<string>} URL `/storage/<prefix>-<id>-<ts>.webp` */
  async function saveImage(buffer, profile, { id, prefix } = {}) {
    if (!profile || profile.raw) throw new Error('saveImage: profilo con elaborazione richiesto');
    const processed = await require('sharp')(buffer)
      .rotate()
      .resize(profile.resize)
      .webp({ quality: profile.webpQuality })
      .toBuffer();
    const filename = `${prefix ?? profile.prefix}-${id}-${Date.now()}.webp`;
    await fs.promises.writeFile(path.join(uploadsDir(), filename), processed);
    return `${URL_PREFIX}${filename}`;
  }

  /** Salva il nuovo file e solo dopo rimuove il vecchio. */
  async function replaceImage(oldUrl, buffer, profile, opts) {
    const url = await saveImage(buffer, profile, opts);
    if (oldUrl !== url) await removeStored(oldUrl);
    return url;
  }

  return {
    dir,
    uploadsDir,
    resolveStoredPath,
    removeStored,
    saveImage,
    replaceImage,
  };
}

module.exports = { ...createStorage(), createStorage, PROFILES, isImageFormatError, URL_PREFIX };
