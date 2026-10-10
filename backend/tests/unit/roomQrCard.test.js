'use strict';

const sharp = require('sharp');
const QRCode = require('qrcode');
const {
  buildRoomQrCard,
  cardDetails,
  loadInstituteLogo,
  CARD_WIDTH,
  CARD_HEIGHT,
  QR_SIZE,
  QR_LEFT,
  QR_TOP,
} = require('../../services/roomQrCard');

const room = {
  id: 1,
  name: '1',
  code: 'P1',
  building: {
    name: 'Sede centrale',
    institute: { name: 'Conservatorio', legalName: 'Conservatorio Nino Rota' },
  },
};

describe('Cartello QR per aula', () => {
  it('riporta denominazione, sede, aula, codice e intervallo effettivo', () => {
    expect(cardDetails(room, 27)).toEqual({
      institute: 'Conservatorio Nino Rota',
      building: 'Sede centrale',
      room: 'Aula 1',
      code: 'Codice aula: P1',
      warning:
        'Ricorda di effettuare il check-in entro\n27 minuti dall’inizio della prenotazione\nper non perdere la prenotazione.',
    });
    expect(cardDetails(room, 1).warning).toContain('1 minuto dall’inizio');
  });

  it('genera un cartello a 300 dpi, conserva ogni pixel del QR e centra il logo', async () => {
    const logo = await sharp({
      create: { width: 24, height: 24, channels: 3, background: '#0050c8' },
    })
      .png()
      .toBuffer();
    const branded = structuredClone(room);
    branded.building.institute.logoUrl = `data:image/png;base64,${logo.toString('base64')}`;
    const url = 'https://aule.example/check-in/room/1?t=1234567890abcdef';
    const card = await buildRoomQrCard({ url, room: branded, graceMinutes: 27 });
    const metadata = await sharp(card).metadata();
    expect(metadata).toMatchObject({
      width: CARD_WIDTH,
      height: CARD_HEIGHT,
      density: 300,
      format: 'png',
    });
    const cropped = await sharp(card)
      .extract({ left: QR_LEFT, top: QR_TOP, width: QR_SIZE, height: QR_SIZE })
      .removeAlpha()
      .raw()
      .toBuffer();
    const original = await QRCode.toBuffer(url, {
      type: 'png',
      width: QR_SIZE,
      margin: 4,
      errorCorrectionLevel: 'M',
    });
    expect(cropped.equals(await sharp(original).removeAlpha().raw().toBuffer())).toBe(true);
    const center = await sharp(card)
      .extract({ left: 700, top: 200, width: 1, height: 1 })
      .removeAlpha()
      .raw()
      .toBuffer();
    expect([...center]).toEqual([0, 80, 200]);
    const corner = await sharp(card)
      .extract({ left: 28, top: 28, width: 1, height: 1 })
      .removeAlpha()
      .raw()
      .toBuffer();
    expect([...corner]).toEqual([255, 255, 255]);
  });

  it('gestisce nomi lunghi e caratteri markup senza invadere il QR', async () => {
    const long = structuredClone(room);
    long.name = 'Aula & <Pianoforte> '.repeat(5).slice(0, 100);
    long.building.name = 'Sede centrale & distaccata '.repeat(5).slice(0, 100);
    long.building.institute.legalName = 'Conservatorio di Musica “Nino Rota” & Dipartimento '
      .repeat(6)
      .slice(0, 255);
    const png = await buildRoomQrCard({ url: 'https://aule.example/check-in/room/1', room: long });
    expect((await sharp(png).metadata()).height).toBe(CARD_HEIGHT);
  });

  it('gestisce logo assente e non legge percorsi esterni allo storage', async () => {
    expect(await loadInstituteLogo(null)).toBeNull();
    expect(await loadInstituteLogo('/storage/../../.env')).toBeNull();
    expect(await loadInstituteLogo('file:///etc/passwd')).toBeNull();
    expect(await loadInstituteLogo('https://remote.example/logo.png')).toBeNull();
    expect(cardDetails({ ...room, code: null }, 15).code).toBe('Codice aula: non assegnato');
  });
});
