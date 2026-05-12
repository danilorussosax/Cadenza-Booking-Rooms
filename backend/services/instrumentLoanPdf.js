'use strict';

/**
 * Generazione modulo PDF di consegna / restituzione strumento.
 * Usa pdfkit, streamato direttamente sulla response (no buffer).
 *
 * Layout A4:
 *   - Header con logo istituto (se presente su disco) + nome + città
 *   - Titolo: "Modulo di consegna in prestito" / "Modulo di restituzione"
 *   - Box "Strumento" (nome, codice, marca/modello, S/N, condizione)
 *   - Box "Consegnatario" (nome, cognome, matricola, email)
 *   - Box "Periodo" (dal — al, durata in giorni, status)
 *   - Box "Note"
 *   - Due aree firma in fondo (Consegnatario / Responsabile inventario) + data
 *   - Footer con copyright istituto
 */

const PDFDocument = require('pdfkit');
const path = require('path');
const fs = require('fs');
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');
require('dayjs/locale/it');
dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.locale('it');

const DEFAULT_TZ = 'Europe/Rome';

const UPLOADS_DIR = path.join(__dirname, '..', 'uploads');

const FAMILY_LABEL = {
  archi: 'Archi',
  fiati_legni: 'Fiati - legni',
  fiati_ottoni: 'Fiati - ottoni',
  tastiere: 'Tastiere',
  percussioni: 'Percussioni',
  corde: 'Corde',
  voce: 'Voce',
  elettronica: 'Elettronica',
  altro: 'Altro',
};

const CONDITION_LABEL = {
  ottimo: 'Ottimo',
  buono: 'Buono',
  discreto: 'Discreto',
  da_riparare: 'Da riparare',
  fuori_uso: 'Fuori uso',
};

const STATUS_LABEL = {
  requested: 'Richiesto',
  active: 'Attivo',
  returned: 'Restituito',
  overdue: 'Scaduto',
  rejected: 'Rifiutato',
};

function durationDays(fromDate, toDate) {
  const days = dayjs(toDate).diff(dayjs(fromDate), 'day') + 1;
  return Math.max(0, days);
}

// Risolve il path assoluto di un asset salvato in /storage/<file>
function resolveStoragePath(url) {
  if (!url || typeof url !== 'string') return null;
  if (!url.startsWith('/storage/')) return null;
  const file = path.basename(url);
  const fp = path.join(UPLOADS_DIR, file);
  return fs.existsSync(fp) ? fp : null;
}

function drawSectionTitle(doc, text) {
  doc.moveDown(0.6);
  doc
    .fillColor('#3762aa')
    .fontSize(11)
    .font('Helvetica-Bold')
    .text(text.toUpperCase(), { characterSpacing: 1 });
  doc.fillColor('#0f172a').font('Helvetica').fontSize(11);
  // Linea separatrice
  const y = doc.y + 2;
  doc
    .strokeColor('#e2e8f0')
    .lineWidth(0.5)
    .moveTo(doc.page.margins.left, y)
    .lineTo(doc.page.width - doc.page.margins.right, y)
    .stroke();
  doc.moveDown(0.4);
}

function drawKeyValue(doc, label, value) {
  if (value === undefined || value === null || value === '') return;
  const left = doc.page.margins.left;
  const labelWidth = 130;
  const startY = doc.y;
  doc
    .fillColor('#6b7a90')
    .font('Helvetica')
    .fontSize(9)
    .text(String(label).toUpperCase(), left, startY, { width: labelWidth, characterSpacing: 0.5 });
  doc
    .fillColor('#0f172a')
    .font('Helvetica')
    .fontSize(11)
    .text(String(value), left + labelWidth, startY, {
      width: doc.page.width - doc.page.margins.right - left - labelWidth,
    });
  doc.moveDown(0.2);
}

function drawSignatureBoxes(doc, kind) {
  doc.moveDown(2);
  const left = doc.page.margins.left;
  const right = doc.page.width - doc.page.margins.right;
  const totalWidth = right - left;
  const gap = 24;
  const boxWidth = (totalWidth - gap) / 2;
  const boxHeight = 90;
  const top = doc.y;

  const labelLeft = kind === 'return' ? 'Restituente' : 'Consegnatario';
  const labelRight = kind === 'return' ? 'Responsabile (riconsegna)' : 'Responsabile (consegna)';

  // Box sinistro
  doc.strokeColor('#cbd5e1').lineWidth(0.7).rect(left, top, boxWidth, boxHeight).stroke();
  doc
    .fillColor('#6b7a90')
    .font('Helvetica')
    .fontSize(8)
    .text(`Firma ${labelLeft}`.toUpperCase(), left + 8, top + 6, { characterSpacing: 0.5 });

  // Box destro
  doc
    .strokeColor('#cbd5e1')
    .lineWidth(0.7)
    .rect(left + boxWidth + gap, top, boxWidth, boxHeight)
    .stroke();
  doc
    .fillColor('#6b7a90')
    .font('Helvetica')
    .fontSize(8)
    .text(`Firma ${labelRight}`.toUpperCase(), left + boxWidth + gap + 8, top + 6, {
      characterSpacing: 0.5,
    });

  // Sotto i box: data
  doc.fillColor('#0f172a').font('Helvetica').fontSize(9);
  const dateY = top + boxHeight + 6;
  doc.text('Data ___________________________', left, dateY);
  doc.text('Data ___________________________', left + boxWidth + gap, dateY);

  doc.y = dateY + 18;
}

function buildInstrumentLoanPdf({ res, loan, institute, kind = 'delivery' }) {
  // Timezone dell'istituto: usata per tutti i timestamp DATE (returnedAt,
  // "documento generato il"). I DATEONLY (fromDate/toDate) non hanno
  // componente oraria e sono safe senza .tz(). Senza questa conversione
  // su VPS UTC il "Documento generato il 23:00" della sera (ora locale)
  // veniva stampato come "21:00" del fuso UTC.
  const tz = institute?.timezone || DEFAULT_TZ;
  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: 56, left: 56, right: 56, bottom: 56 },
    info: {
      Title: `Prestito strumento #${loan.id}`,
      Author: institute?.name || 'Cadenza',
    },
  });
  doc.pipe(res);

  const isReturn = kind === 'return';

  // ============ HEADER ============
  const headerY = doc.y;
  const logoPath = resolveStoragePath(institute?.logoUrl);
  if (logoPath) {
    try {
      doc.image(logoPath, doc.page.margins.left, headerY, { width: 48, height: 48, fit: [48, 48] });
    } catch {
      // ignore (es. SVG non supportato da pdfkit) — proseguiamo senza logo
    }
  }
  const headerTextX = doc.page.margins.left + 60;
  doc
    .fillColor('#3762aa')
    .fontSize(13)
    .font('Helvetica-Bold')
    .text(institute?.name || 'Cadenza', headerTextX, headerY + 4);
  if (institute?.city) {
    doc
      .fillColor('#6b7a90')
      .fontSize(10)
      .font('Helvetica')
      .text(institute.city, headerTextX, doc.y);
  }
  // Riallinea Y sotto al blocco header
  doc.y = headerY + 60;

  doc
    .fillColor('#0f172a')
    .fontSize(18)
    .font('Helvetica-Bold')
    .text(isReturn ? 'Modulo di restituzione strumento' : 'Modulo di consegna in prestito', {
      align: 'left',
    });
  doc
    .fillColor('#6b7a90')
    .fontSize(9)
    .font('Helvetica')
    .text(
      `Documento generato il ${dayjs().tz(tz).format('DD/MM/YYYY · HH:mm')} · Prestito #${loan.id}`,
    );
  doc.moveDown(0.6);

  // ============ STRUMENTO ============
  drawSectionTitle(doc, 'Strumento');
  const i = loan.instrument || {};
  drawKeyValue(doc, 'Nome', i.name || '—');
  if (i.code) drawKeyValue(doc, 'Codice', i.code);
  drawKeyValue(doc, 'Famiglia', FAMILY_LABEL[i.family] || i.family || '—');
  if (i.brand || i.model)
    drawKeyValue(doc, 'Marca / modello', [i.brand, i.model].filter(Boolean).join(' · '));
  if (i.serialNumber) drawKeyValue(doc, 'N. di serie', i.serialNumber);
  drawKeyValue(doc, 'Condizione', CONDITION_LABEL[i.condition] || i.condition || '—');

  // ============ CONSEGNATARIO ============
  drawSectionTitle(doc, isReturn ? 'Restituente' : 'Consegnatario');
  const u = loan.user || {};
  drawKeyValue(doc, 'Nome', `${u.firstName || ''} ${u.lastName || ''}`.trim() || '—');
  if (u.matricola) drawKeyValue(doc, 'Matricola', u.matricola);
  if (u.email) drawKeyValue(doc, 'Email', u.email);

  // ============ PERIODO ============
  drawSectionTitle(doc, 'Periodo prestito');
  drawKeyValue(doc, 'Dal', dayjs(loan.fromDate).format('dddd D MMMM YYYY'));
  drawKeyValue(doc, 'Al', dayjs(loan.toDate).format('dddd D MMMM YYYY'));
  drawKeyValue(doc, 'Durata prevista', `${durationDays(loan.fromDate, loan.toDate)} giorni`);
  drawKeyValue(doc, 'Stato', STATUS_LABEL[loan.status] || loan.status || '—');
  if (loan.returnedAt)
    drawKeyValue(doc, 'Restituito il', dayjs(loan.returnedAt).tz(tz).format('DD/MM/YYYY · HH:mm'));
  if (loan.approver) {
    const approverName = `${loan.approver.firstName || ''} ${loan.approver.lastName || ''}`.trim();
    if (approverName) drawKeyValue(doc, 'Approvato da', approverName);
  }

  // ============ NOTE ============
  if (loan.notes && String(loan.notes).trim()) {
    drawSectionTitle(doc, 'Note');
    doc
      .fillColor('#0f172a')
      .font('Helvetica')
      .fontSize(10)
      .text(String(loan.notes), {
        width: doc.page.width - doc.page.margins.left - doc.page.margins.right,
      });
  }

  // ============ DICHIARAZIONE / FIRME ============
  drawSectionTitle(doc, 'Dichiarazione');
  const declarationDelivery =
    `Il sottoscritto dichiara di ricevere in prestito lo strumento sopra descritto, ` +
    `impegnandosi a custodirlo con cura, a non cederlo a terzi e a restituirlo nei tempi indicati ` +
    `nello stato di conservazione in cui è stato consegnato. Eventuali danni dovranno essere ` +
    `tempestivamente segnalati al responsabile dell'inventario.`;
  const declarationReturn =
    `Il sottoscritto dichiara di restituire lo strumento sopra descritto. ` +
    `Il responsabile dell'inventario, controfirmando, conferma la presa in carico e la verifica ` +
    `dello stato di conservazione.`;
  doc
    .fillColor('#374151')
    .font('Helvetica')
    .fontSize(9)
    .text(isReturn ? declarationReturn : declarationDelivery, {
      width: doc.page.width - doc.page.margins.left - doc.page.margins.right,
      align: 'justify',
    });

  drawSignatureBoxes(doc, kind);

  // ============ FOOTER ============
  const footerY = doc.page.height - doc.page.margins.bottom + 18;
  doc
    .fillColor('#9aa5b4')
    .fontSize(8)
    .font('Helvetica')
    .text(
      institute?.copyright || `© ${dayjs().tz(tz).year()} ${institute?.name || 'Cadenza'}`,
      doc.page.margins.left,
      footerY,
      {
        width: doc.page.width - doc.page.margins.left - doc.page.margins.right,
        align: 'center',
      },
    );

  doc.end();
}

module.exports = { buildInstrumentLoanPdf };
