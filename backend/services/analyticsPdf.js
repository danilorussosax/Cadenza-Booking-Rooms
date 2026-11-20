'use strict';

/**
 * Rendering PDF del report analytics (pdfkit, disegno a basso livello).
 *
 * Layout mirror della pagina /admin/analytics:
 *   - header con titolo "Statistiche di utilizzo" + range/timestamp
 *   - 4 KPI card colorate (emerald/amber/rose/sky) con valore grosso
 *   - heatmap 7×24 con scala colore rose (light → dark)
 *   - sparkline trend ultime 8 settimane
 *   - top 10 aule con barre orizzontali sky
 *   - top 10 utenti come lista con rank circolare
 *
 * Niente immagini esterne: il PDF è autocontenuto e leggero.
 * Interface: `writeAnalyticsPdf(data, range, out)` — `data` è la shape di
 * `gatherAnalytics` (services/analyticsMetrics.js), `out` uno stream scrivibile.
 */

const dayjs = require('dayjs');
dayjs.extend(require('dayjs/plugin/utc'));
const PDFDocument = require('pdfkit');
const institutionTime = require('../lib/institutionTime');

// =====================================================
// Helpers di rendering PDF (token grafici allineati alla UI)
// =====================================================

// Palette Tailwind che usa la pagina React. Colori scelti per replicare le
// card colorate (KpiCard → emerald/amber/rose/sky) e la heatmap rose-scale.
const PDF = {
  // Tonalità "soft" per sfondi card (Tailwind 100/50)
  bgEmeraldSoft: '#d1fae5',
  bgAmberSoft: '#fef3c7',
  bgRoseSoft: '#ffe4e6',
  bgSkySoft: '#e0f2fe',
  bgViolet50: '#f5f3ff',
  // Tonalità "solide" per badge/icone (Tailwind 600)
  emerald: '#059669',
  amber: '#d97706',
  rose: '#e11d48',
  sky: '#0284c7',
  violet: '#9333ea',
  // Foreground / muted (Tailwind slate)
  text: '#0f172a',
  textMuted: '#64748b',
  textSubtle: '#94a3b8',
  border: '#e2e8f0',
  borderSoft: '#f1f5f9',
  cardBg: '#ffffff',
  pageBg: '#fafafa',
};

// Scala monocromatica per heatmap (rose-50 … rose-700 — 8 step).
const HEATMAP_SCALE = [
  '#fff1f2', // 0 occupazione (assente)
  '#ffe4e6',
  '#fecdd3',
  '#fda4af',
  '#fb7185',
  '#f43f5e',
  '#e11d48',
  '#be123c',
];

function heatmapColor(value, max) {
  if (!max || value <= 0) return HEATMAP_SCALE[0];
  // Distribuzione lineare a 8 step (1..7 occupati, 0=vuoto).
  const idx = Math.min(7, Math.max(1, Math.ceil((value / max) * 7)));
  return HEATMAP_SCALE[idx];
}

// Rettangolo arrotondato + bordo + riempimento — primitiva "card" UI.
function drawCard(doc, x, y, w, h, { fill = PDF.cardBg, stroke = PDF.border, radius = 6 } = {}) {
  doc.save();
  doc.lineWidth(0.5).fillColor(fill).strokeColor(stroke);
  doc.roundedRect(x, y, w, h, radius).fillAndStroke(fill, stroke);
  doc.restore();
}

// Pill (etichetta arrotondata, testo centrato) — usata per il range data.
function drawPill(
  doc,
  x,
  y,
  label,
  { fill = PDF.borderSoft, color = PDF.text, font = 'Helvetica', size = 9 } = {},
) {
  doc.save();
  doc.font(font).fontSize(size);
  const padX = 6,
    padY = 3;
  const tw = doc.widthOfString(label);
  const w = tw + padX * 2;
  const h = size + padY * 2;
  doc
    .fillColor(fill)
    .roundedRect(x, y, w, h, h / 2)
    .fill();
  doc.fillColor(color).text(label, x + padX, y + padY, { lineBreak: false });
  doc.restore();
  return { w, h };
}

function drawHeader(doc, range) {
  const { width } = doc.page;
  const margin = doc.page.margins.left;
  const x = margin,
    y = margin;
  // Titolo principale (font display-like via Helvetica-Bold).
  doc.fillColor(PDF.text).font('Helvetica-Bold').fontSize(22).text('Statistiche di utilizzo', x, y);
  // Sottotitolo
  doc
    .font('Helvetica')
    .fontSize(10)
    .fillColor(PDF.textMuted)
    .text('Cadenza — report analytics', x, y + 28);

  // Pill range (in alto a destra). Usiamo l'en-dash `–` invece di `→` perché
  // il font Helvetica standard di pdfkit non ha il glifo arrow Unicode (U+2192)
  // e lo renderizza come carattere mancante.
  const rangeLabel = `${dayjs(range.from).format('DD MMM YYYY')} – ${dayjs(range.to).format('DD MMM YYYY')}`;
  doc.font('Helvetica-Bold').fontSize(9);
  const pillW = doc.widthOfString(rangeLabel) + 16;
  drawPill(doc, width - margin - pillW, y, rangeLabel, { fill: PDF.bgRoseSoft, color: PDF.rose });
  // Generato (sotto la pill)
  doc
    .font('Helvetica')
    .fontSize(8)
    .fillColor(PDF.textSubtle)
    .text(
      `Generato il ${institutionTime.inInstitute().format('DD/MM/YYYY HH:mm')}`,
      width - margin - 200,
      y + 22,
      {
        width: 200,
        align: 'right',
      },
    );

  return y + 50;
}

function drawKpiRow(doc, summary, yStart) {
  const margin = doc.page.margins.left;
  const usable = doc.page.width - margin * 2;
  const gap = 8;
  const cardW = (usable - gap * 3) / 4;
  const cardH = 70; // alta abbastanza per ospitare label su 2 righe + valore

  // Label volutamente brevi per non andare a capo dentro la card 4-col su A4.
  // La pagina React ha label più lunghe perché ha più larghezza disponibile.
  const cards = [
    {
      label: 'Confermate',
      value: String(summary.confirmedBookings),
      bg: PDF.bgEmeraldSoft,
      accent: PDF.emerald,
    },
    {
      label: 'Auto-cancellate',
      value: String(summary.ghostedBookings),
      bg: PDF.bgAmberSoft,
      accent: PDF.amber,
    },
    {
      label: 'No-show rate',
      value: `${summary.noShowRatePct}%`,
      bg: PDF.bgRoseSoft,
      accent: PDF.rose,
    },
    {
      label: 'Totale create',
      value: String(summary.totalCreated),
      bg: PDF.bgSkySoft,
      accent: PDF.sky,
    },
  ];

  cards.forEach((c, i) => {
    const x = margin + i * (cardW + gap);
    drawCard(doc, x, yStart, cardW, cardH);
    // Quadratino accento a sinistra (icona stilizzata: rettangolo soft + dot)
    doc.save();
    doc
      .fillColor(c.bg)
      .roundedRect(x + 10, yStart + 14, 32, 32, 6)
      .fill();
    doc
      .fillColor(c.accent)
      .circle(x + 26, yStart + 30, 6)
      .fill();
    doc.restore();
    // Label uppercase (no characterSpacing → non spezza in 2 righe la
    // dicitura "Auto-cancellate" su card stretta 122pt).
    doc
      .font('Helvetica')
      .fontSize(7)
      .fillColor(PDF.textMuted)
      .text(c.label.toUpperCase(), x + 50, yStart + 16, { width: cardW - 58, lineBreak: false });
    // Valore — più grande e basso, sotto la label, font display.
    doc
      .font('Helvetica-Bold')
      .fontSize(22)
      .fillColor(PDF.text)
      .text(c.value, x + 50, yStart + 30, { width: cardW - 58, lineBreak: false });
  });
  return yStart + cardH + 12;
}

function drawHeatmap(doc, heatmap, yStart) {
  const margin = doc.page.margins.left;
  const usable = doc.page.width - margin * 2;
  // titleH abbastanza grande da contenere title (13pt) + subtitle (8pt) + gap
  // SENZA che il sottostante header ore (sopra la prima riga della grid)
  // si sovrapponga alla riga del sottotitolo.
  const titleH = 44;
  const cellH = 14;
  const labelW = 36; // colonna label giorni
  const cardH = titleH + 12 + 7 * cellH + 14; // spazio header ore + righe + padding

  drawCard(doc, margin, yStart, usable, cardH);
  // Titolo + sottotitolo
  doc
    .font('Helvetica-Bold')
    .fontSize(13)
    .fillColor(PDF.text)
    .text('Heatmap occupazione (giorni × ore)', margin + 14, yStart + 10);
  doc
    .font('Helvetica')
    .fontSize(8)
    .fillColor(PDF.textMuted)
    .text('Tonalità intensa = più prenotazioni in quella fascia', margin + 14, yStart + 28);

  const innerX = margin + 14 + labelW;
  // Riserva 12pt SOPRA la prima riga di celle per le label ore (non
  // sovrappongono più il sottotitolo che termina ~yStart+38).
  const innerY = yStart + titleH + 12;
  const cellW = (usable - 28 - labelW) / 24;
  const max = Math.max(0, ...heatmap.flat().map((c) => c.count));

  // Header ore (00..23): mostriamo ogni 3h per leggibilità senza sovrapposizioni.
  doc.font('Helvetica').fontSize(6).fillColor(PDF.textSubtle);
  for (let h = 0; h < 24; h++) {
    if (h % 3 === 0) {
      doc.text(String(h).padStart(2, '0'), innerX + h * cellW, innerY - 9, {
        width: cellW,
        align: 'left',
        lineBreak: false,
      });
    }
  }
  // Etichette giorni
  const dayShort = ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom'];
  for (let d = 0; d < 7; d++) {
    doc
      .font('Helvetica')
      .fontSize(7)
      .fillColor(PDF.textMuted)
      .text(dayShort[d], margin + 14, innerY + d * cellH + 3, {
        width: labelW - 4,
        align: 'left',
        lineBreak: false,
      });
    for (let h = 0; h < 24; h++) {
      const cell = heatmap[d][h] ?? { count: 0, hours: 0 };
      doc
        .fillColor(heatmapColor(cell.count, max))
        .rect(innerX + h * cellW, innerY + d * cellH, cellW - 0.6, cellH - 0.6)
        .fill();
    }
  }
  return yStart + cardH + 10;
}

function drawTrend(doc, trend, yStart) {
  const margin = doc.page.margins.left;
  const usable = doc.page.width - margin * 2;
  const cardH = 110;
  drawCard(doc, margin, yStart, usable, cardH);

  doc
    .font('Helvetica-Bold')
    .fontSize(13)
    .fillColor(PDF.text)
    .text('Trend ultime 8 settimane', margin + 14, yStart + 10);
  doc
    .font('Helvetica')
    .fontSize(8)
    .fillColor(PDF.textMuted)
    .text('Ore prenotate aggregate per inizio settimana', margin + 14, yStart + 26);

  if (trend.length === 0) {
    doc
      .font('Helvetica-Oblique')
      .fontSize(9)
      .fillColor(PDF.textSubtle)
      .text('Nessuna prenotazione nel periodo.', margin + 14, yStart + 50);
    return yStart + cardH + 10;
  }

  const innerX = margin + 30;
  const innerY = yStart + 42;
  const innerW = usable - 50;
  const innerH = 50;
  const max = Math.max(1, ...trend.map((p) => p.hours));
  const stepX = trend.length > 1 ? innerW / (trend.length - 1) : 0;

  // Asse Y "fittizio" (linea grigia in basso)
  doc
    .save()
    .strokeColor(PDF.borderSoft)
    .lineWidth(0.6)
    .moveTo(innerX, innerY + innerH)
    .lineTo(innerX + innerW, innerY + innerH)
    .stroke()
    .restore();

  // Linea trend (viola — coerente con la pagina Recharts che usa #a855f7)
  doc.save().strokeColor(PDF.violet).lineWidth(1.5);
  trend.forEach((p, i) => {
    const x = innerX + i * stepX;
    const y = innerY + (innerH - (p.hours / max) * innerH);
    if (i === 0) doc.moveTo(x, y);
    else doc.lineTo(x, y);
  });
  doc.stroke().restore();

  // Punti + label X (data) ogni 2 step
  trend.forEach((p, i) => {
    const x = innerX + i * stepX;
    const y = innerY + (innerH - (p.hours / max) * innerH);
    doc.save().fillColor(PDF.violet).circle(x, y, 2.2).fill().restore();
    if (trend.length <= 8 || i % 2 === 0) {
      doc
        .font('Helvetica')
        .fontSize(6)
        .fillColor(PDF.textSubtle)
        .text(dayjs.utc(p.weekStart).format('DD MMM'), x - 14, innerY + innerH + 4, {
          width: 28,
          align: 'center',
          lineBreak: false,
        });
    }
  });

  return yStart + cardH + 10;
}

function drawTopRooms(doc, topRooms, yStart) {
  const margin = doc.page.margins.left;
  const usable = doc.page.width - margin * 2;
  const cardW = (usable - 10) / 2;
  const rows = Math.min(10, topRooms.length);
  const cardH = 38 + Math.max(rows, 1) * 16 + 10;

  drawCard(doc, margin, yStart, cardW, cardH);
  doc
    .font('Helvetica-Bold')
    .fontSize(13)
    .fillColor(PDF.text)
    .text('Top 10 aule', margin + 14, yStart + 10);
  doc
    .font('Helvetica')
    .fontSize(8)
    .fillColor(PDF.textMuted)
    .text('Per ore prenotate nel periodo', margin + 14, yStart + 26);

  if (topRooms.length === 0) {
    doc
      .font('Helvetica-Oblique')
      .fontSize(9)
      .fillColor(PDF.textSubtle)
      .text('Nessuna prenotazione nel periodo.', margin + 14, yStart + 50);
    return cardH;
  }

  const max = Math.max(1, ...topRooms.map((r) => r.hours));
  const labelW = 80;
  const barAreaX = margin + 14 + labelW + 6;
  const barAreaW = cardW - (14 + labelW + 6 + 50);
  const baseY = yStart + 40;
  topRooms.slice(0, 10).forEach((r, i) => {
    const y = baseY + i * 16;
    // Label aula (truncata visualmente da pdfkit con ellipsis quando overflow)
    doc
      .font('Helvetica')
      .fontSize(8)
      .fillColor(PDF.text)
      .text(`${r.name}`, margin + 14, y + 2, { width: labelW, ellipsis: true, lineBreak: false });
    // Bar background
    doc
      .fillColor(PDF.borderSoft)
      .rect(barAreaX, y + 2, barAreaW, 9)
      .fill();
    // Bar fill (sky)
    const w = (r.hours / max) * barAreaW;
    doc
      .fillColor(PDF.sky)
      .rect(barAreaX, y + 2, w, 9)
      .fill();
    // Valore ore
    doc
      .font('Helvetica-Bold')
      .fontSize(8)
      .fillColor(PDF.text)
      .text(`${r.hours} h`, barAreaX + barAreaW + 4, y + 2, { width: 40, lineBreak: false });
  });
  return cardH;
}

function drawTopUsers(doc, topUsers, yStart, leftEdge, cardW) {
  const rows = Math.min(10, topUsers.length);
  const cardH = 38 + Math.max(rows, 1) * 16 + 10;

  drawCard(doc, leftEdge, yStart, cardW, cardH);
  doc
    .font('Helvetica-Bold')
    .fontSize(13)
    .fillColor(PDF.text)
    .text('Top 10 utenti', leftEdge + 14, yStart + 10);
  doc
    .font('Helvetica')
    .fontSize(8)
    .fillColor(PDF.textMuted)
    .text('Anonimo nei report condivisi — uso interno admin', leftEdge + 14, yStart + 26);

  if (topUsers.length === 0) {
    doc
      .font('Helvetica-Oblique')
      .fontSize(9)
      .fillColor(PDF.textSubtle)
      .text('Nessuna prenotazione nel periodo.', leftEdge + 14, yStart + 50);
    return cardH;
  }

  const baseY = yStart + 40;
  topUsers.slice(0, 10).forEach((u, i) => {
    const y = baseY + i * 16;
    // Pallino numerico rank (cerchio violet soft)
    doc
      .fillColor(PDF.bgViolet50)
      .circle(leftEdge + 22, y + 7, 7)
      .fill();
    doc
      .font('Helvetica-Bold')
      .fontSize(8)
      .fillColor(PDF.violet)
      .text(String(i + 1), leftEdge + 17, y + 4, { width: 12, align: 'center', lineBreak: false });
    // Nome + ruolo
    const fullName = `${u.lastName ?? ''} ${u.firstName ?? ''}`.trim() || '—';
    doc
      .font('Helvetica')
      .fontSize(8)
      .fillColor(PDF.text)
      .text(fullName, leftEdge + 36, y + 1, {
        width: cardW - 36 - 60,
        ellipsis: true,
        lineBreak: false,
      });
    doc
      .font('Helvetica')
      .fontSize(6)
      .fillColor(PDF.textMuted)
      .text(`${u.matricola ? u.matricola + ' · ' : ''}${u.role ?? ''}`, leftEdge + 36, y + 9, {
        width: cardW - 36 - 60,
        ellipsis: true,
        lineBreak: false,
      });
    // Ore
    doc
      .font('Helvetica-Bold')
      .fontSize(8)
      .fillColor(PDF.text)
      .text(`${u.hours} h`, leftEdge + cardW - 60, y + 4, {
        width: 50,
        align: 'right',
        lineBreak: false,
      });
  });
  return cardH;
}

function drawFooter(doc) {
  const { width, height } = doc.page;
  const margin = doc.page.margins.left;
  // Posiziono il footer DENTRO l'area di stampa (sopra il margine inferiore).
  // Con `height - margin + 4` pdfkit considerava il y oltre il margine e
  // creava una nuova pagina; con `height - margin - 14` resta sicuro nella
  // pagina 1.
  doc
    .font('Helvetica')
    .fontSize(7)
    .fillColor(PDF.textSubtle)
    .text(
      'Documento generato automaticamente da Cadenza — uso interno.',
      margin,
      height - margin - 14,
      {
        width: width - margin * 2,
        align: 'center',
        lineBreak: false,
      },
    );
}

function renderAnalyticsPdf(doc, data, range) {
  let y = drawHeader(doc, range);
  y = drawKpiRow(doc, data.summary, y);
  y = drawHeatmap(doc, data.heatmap, y);
  y = drawTrend(doc, data.trend, y);
  // Due card affiancate (top rooms + top users), allineate verticalmente.
  const margin = doc.page.margins.left;
  const usable = doc.page.width - margin * 2;
  const cardW = (usable - 10) / 2;
  drawTopRooms(doc, data.topRooms, y);
  drawTopUsers(doc, data.topUsers, y, margin + cardW + 10, cardW);
  // Le altezze dei due blocchi non vengono accumulate in `y` perché al
  // momento non c'è contenuto sotto; se in futuro si estende il PDF
  // ripristinare il calcolo `y += Math.max(heightRooms, heightUsers) + 10`.
  drawFooter(doc);
}

/** Crea il documento A4, lo collega a `out`, disegna il report e lo chiude. */
function writeAnalyticsPdf(data, range, out) {
  const doc = new PDFDocument({ size: 'A4', margin: 32, autoFirstPage: true });
  doc.pipe(out);
  renderAnalyticsPdf(doc, data, range);
  doc.end();
  return doc;
}

module.exports = { writeAnalyticsPdf, renderAnalyticsPdf, heatmapColor };
