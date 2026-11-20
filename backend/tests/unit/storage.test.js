'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const sharp = require('sharp');
const { createStorage, PROFILES, isImageFormatError } = require('../../services/storage');

let dir;
let storage;

async function png(w, h) {
  return sharp({ create: { width: w, height: h, channels: 3, background: '#c33' } })
    .png()
    .toBuffer();
}

beforeEach(() => {
  dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'storage-')), 'uploads');
  storage = createStorage(dir);
});

afterEach(() => {
  fs.rmSync(path.dirname(dir), { recursive: true, force: true });
});

describe('storage', () => {
  it('uploadsDir crea la cartella e il default coincide con backend/uploads', () => {
    expect(fs.existsSync(dir)).toBe(false);
    expect(storage.uploadsDir()).toBe(dir);
    expect(fs.existsSync(dir)).toBe(true);
    expect(require('../../services/storage').dir).toBe(path.join(__dirname, '..', '..', 'uploads'));
  });

  it('saveImage: nome <prefisso>-<id>-<ts>.webp e URL /storage/', async () => {
    const url = await storage.saveImage(await png(100, 100), PROFILES.room, { id: 7 });
    expect(url).toMatch(/^\/storage\/room-7-\d+\.webp$/);
    const meta = await sharp(storage.resolveStoredPath(url)).metadata();
    expect(meta.format).toBe('webp');
  });

  it('profili: foto 16:9 ritagliata (anche ingrandita), locandina inside senza ingrandire', async () => {
    const small = await png(300, 300);
    const room = await storage.saveImage(small, PROFILES.room, { id: 1 });
    const inst = await storage.saveImage(small, PROFILES.instrument, { id: 1 });
    const poster = await storage.saveImage(small, PROFILES.poster, { id: 1 });
    expect(inst).toMatch(/^\/storage\/instrument-1-/);
    expect(poster).toMatch(/^\/storage\/concert-1-/);
    const dim = async (u) => {
      const m = await sharp(storage.resolveStoredPath(u)).metadata();
      return [m.width, m.height];
    };
    expect(await dim(room)).toEqual([1200, 675]);
    expect(await dim(inst)).toEqual([1200, 675]);
    expect(await dim(poster)).toEqual([300, 300]);
    expect(PROFILES.poster.maxBytes).toBe(12 * 1024 * 1024);
    expect(PROFILES.room.maxBytes).toBe(8 * 1024 * 1024);
    expect(PROFILES.poster.webpQuality).toBe(85);
    expect(PROFILES.room.webpQuality).toBe(82);
  });

  it('saveImage rifiuta profili raw e segnala immagini non valide', async () => {
    await expect(storage.saveImage(Buffer.from('x'), PROFILES.logo, { id: 1 })).rejects.toThrow();
    const err = await storage
      .saveImage(Buffer.from('not an image'), PROFILES.room, { id: 1 })
      .catch((e) => e);
    expect(isImageFormatError(err)).toBe(true);
  });

  it('replaceImage salva il nuovo e rimuove il vecchio', async () => {
    const buf = await png(50, 50);
    const first = await storage.saveImage(buf, PROFILES.poster, { id: 2, prefix: 'a' });
    const second = await storage.replaceImage(first, buf, PROFILES.poster, { id: 2, prefix: 'b' });
    expect(fs.existsSync(storage.resolveStoredPath(first))).toBe(false);
    expect(fs.existsSync(storage.resolveStoredPath(second))).toBe(true);
  });

  it('removeStored: ENOENT silenzioso, non lancia mai, ignora URL esterni', async () => {
    const url = await storage.saveImage(await png(10, 10), PROFILES.poster, { id: 3 });
    expect(await storage.removeStored(url)).toBe(true);
    expect(await storage.removeStored(url)).toBe(false); // ENOENT
    expect(await storage.removeStored('https://x.test/storage/a.webp')).toBe(false);
    expect(await storage.removeStored(null)).toBe(false);
    // errore diverso da ENOENT (e' una cartella): loggato, non lanciato
    fs.mkdirSync(path.join(dir, 'adir'));
    await expect(storage.removeStored('/storage/adir')).resolves.toBe(false);
  });

  it('resolveStoredPath rifiuta path traversal e prefissi errati', () => {
    expect(storage.resolveStoredPath('/storage/a.webp')).toBe(path.join(dir, 'a.webp'));
    for (const bad of [
      '/storage/../secret',
      '/storage/..',
      '/storage/a/b.webp',
      '/storage/',
      '/storage/..\\x',
      '/other/a.webp',
      'a.webp',
      undefined,
      42,
    ]) {
      expect(storage.resolveStoredPath(bad)).toBeNull();
    }
  });
});
