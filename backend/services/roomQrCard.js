'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const QRCode = require('qrcode');
const sharp = require('sharp');
const logger = require('../lib/logger');

const FONT_DIR = path.join(__dirname, '..', 'assets', 'fonts');
// Il VPS può non avere font di sistema: la stampa deve essere riproducibile.
if (!process.env.FONTCONFIG_FILE) process.env.FONTCONFIG_FILE = path.join(FONT_DIR, 'fonts.conf');
const FONT_FILE = path.join(FONT_DIR, 'Inter.ttf');
const UPLOADS_DIR = path.join(__dirname, '..', 'uploads');
const CARD_WIDTH = 1400;
const CARD_HEIGHT = 2000;
const QR_SIZE = 920;
const QR_LEFT = 240;
const QR_TOP = 500;

function escapeMarkup(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Nessun fetch remoto: loghi caricati in storage o incorporati come data URL. */
async function loadInstituteLogo(logoUrl) {
  if (!logoUrl || typeof logoUrl !== 'string') return null;
  const data = logoUrl.match(/^data:image\/(?:png|jpeg|webp|svg\+xml);base64,([A-Za-z0-9+/=\s]+)$/);
  if (data) {
    if (data[1].length > 4 * 1024 * 1024) return null;
    return Buffer.from(data[1], 'base64');
  }
  let storageUrl = logoUrl;
  if (/^https?:\/\//.test(logoUrl) && process.env.FRONTEND_URL) {
    const url = new URL(logoUrl);
    if (url.origin !== new URL(process.env.FRONTEND_URL).origin) return null;
    storageUrl = url.pathname;
  }
  const file = storageUrl.match(/^\/storage\/([A-Za-z0-9][A-Za-z0-9._-]*)$/)?.[1];
  if (!file) return null;
  return fs.readFile(path.join(UPLOADS_DIR, file));
}

function cardDetails(room, graceMinutes) {
  const institute = room.building?.institute;
  return {
    institute: institute?.legalName || institute?.name || 'Conservatorio',
    building: room.building?.name || 'Sede',
    room: /^\d+[A-Za-z]?$/.test(room.name) ? `Aula ${room.name}` : room.name,
    code: `Codice aula: ${room.code || 'non assegnato'}`,
    warning:
      'Ricorda di effettuare il check-in entro\n' +
      `${graceMinutes} ${graceMinutes === 1 ? 'minuto' : 'minuti'} dall’inizio della prenotazione\n` +
      'per non perdere la prenotazione.',
  };
}

async function textLayer(
  text,
  { left, top, width, height, size, bold = false, color = '#172b43', align = 'centre' },
) {
  let rendered;
  // Adatta nomi lunghi senza troncare la denominazione o sovrapporre il QR.
  for (let fontSize = size; fontSize >= 16; fontSize -= 2) {
    rendered = await sharp({
      text: {
        text: `<span foreground="${color}" weight="${bold ? 'bold' : 'normal'}">${escapeMarkup(text)}</span>`,
        font: `Inter ${fontSize}`,
        fontfile: FONT_FILE,
        width,
        rgba: true,
        align,
        wrap: 'word-char',
      },
    })
      .png()
      .toBuffer({ resolveWithObject: true });
    if (rendered.info.height <= height) break;
  }
  if (rendered.info.height > height) throw new Error('Testo troppo lungo per il cartello QR');
  return {
    input: rendered.data,
    left: left + (align === 'left' ? 0 : Math.round((width - rendered.info.width) / 2)),
    top: top + Math.round((height - rendered.info.height) / 2),
  };
}

async function buildRoomQrCard({
  url,
  room,
  graceMinutes = Math.max(1, Number(process.env.GHOST_GRACE_MINUTES) || 15),
}) {
  const details = cardDetails(room, graceMinutes);
  const frame =
    Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${CARD_WIDTH}" height="${CARD_HEIGHT}">
    <rect width="1400" height="2000" fill="white"/>
    <rect x="28" y="28" width="1344" height="1944" rx="52" fill="white" stroke="#172b43" stroke-width="5"/>
    <line x1="170" y1="1460" x2="1230" y2="1460" stroke="#cbd5e1" stroke-width="2"/>
    <rect x="90" y="1760" width="1220" height="175" rx="26" fill="#fff8e8" stroke="#cba54a" stroke-width="2"/>
    <path d="M175 1797 L132 1872 L218 1872 Z" fill="#f4c24d" stroke="#765619" stroke-width="3" stroke-linejoin="round"/>
  </svg>`);
  const qr = await QRCode.toBuffer(url, {
    type: 'png',
    width: QR_SIZE,
    margin: 4,
    errorCorrectionLevel: 'M',
  });
  const layers = [{ input: qr, left: QR_LEFT, top: QR_TOP }];
  try {
    const logo = await loadInstituteLogo(room.building?.institute?.logoUrl);
    if (logo) {
      const normalized = await sharp(logo, { limitInputPixels: 20_000_000, density: 144 })
        .resize(480, 220, { fit: 'inside' })
        .png()
        .toBuffer({ resolveWithObject: true });
      layers.push({
        input: normalized.data,
        left: Math.round((CARD_WIDTH - normalized.info.width) / 2),
        top: 90 + Math.round((220 - normalized.info.height) / 2),
      });
    }
  } catch (_err) {
    logger.warn(
      { scope: 'roomQrCard', roomId: room.id },
      'Logo non disponibile per il cartello QR',
    );
  }
  layers.push(
    ...(await Promise.all([
      textLayer(details.institute, {
        left: 120,
        top: 330,
        width: 1160,
        height: 140,
        size: 50,
        bold: true,
      }),
      textLayer(details.building, { left: 120, top: 1480, width: 1160, height: 75, size: 34 }),
      textLayer(details.room, {
        left: 120,
        top: 1570,
        width: 1160,
        height: 85,
        size: 50,
        bold: true,
      }),
      textLayer(details.code, { left: 120, top: 1670, width: 1160, height: 55, size: 32 }),
      textLayer(details.warning, {
        left: 260,
        top: 1785,
        width: 1020,
        height: 125,
        size: 34,
        color: '#57431d',
        align: 'left',
      }),
      textLayer('!', {
        left: 150,
        top: 1820,
        width: 50,
        height: 48,
        size: 48,
        bold: true,
        color: '#57431d',
      }),
    ])),
  );
  return sharp(frame)
    .composite(layers)
    .withMetadata({ density: 300 })
    .png({ compressionLevel: 9 })
    .toBuffer();
}

module.exports = {
  buildRoomQrCard,
  cardDetails,
  loadInstituteLogo,
  CARD_WIDTH,
  CARD_HEIGHT,
  QR_SIZE,
  QR_LEFT,
  QR_TOP,
};
