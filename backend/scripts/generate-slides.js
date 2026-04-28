'use strict';

/**
 * generate-slides.js
 *
 * Genera `docs/slides-presentazione.pdf` — presentazione 16:9 in stile
 * Claude design (palette cream / clay / sage, tipografia editoriale serif).
 *
 * Riproduce con mockup vettoriali ad alta fedeltà alcune schermate reali
 * del software (Dashboard, Vista settimanale, Form prenotazione, Analytics,
 * Display kiosk) — sono ricostruzioni in pdfkit dei componenti React reali.
 *
 * Uso:
 *   npm run slides --prefix backend
 *   open docs/slides-presentazione.pdf
 *
 * Tipografia:
 *   - Titoli hero/slide: Helvetica-Bold (editorial serif)
 *   - Body / UI mock:    Helvetica (sans, identica al software)
 *
 * Slide (16):
 *   01 Cover                       (hero)
 *   02 Il problema oggi
 *   03 Tre pilastri
 *   04 Screen — Dashboard
 *   05 PRIMA: pomeriggio in segreteria
 *   06 DOPO: con Aula Book
 *   07 Screen — Vista settimanale
 *   08 Screen — Form prenotazione
 *   09 Conflitti impossibili
 *   10 Screen — Analytics dashboard
 *   11 I numeri di un anno
 *   12 Screen — Display kiosk
 *   13 Sicurezza & SSO
 *   14 Costi & infrastruttura
 *   15 Integrazioni pronte
 *   16 Closing
 */

const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

const W = 1280;
const H = 720;

// Logo ufficiale dell'app — PNG 512×512 con sfondo navy + nota musicale
// + calendario "AULE" + pianoforte. Esiste in `frontend/public/icon-512.png`
// (è anche il favicon/PWA icon del software). Caricato una sola volta in
// memoria e riutilizzato da `logoMark()` in cover, closing, footer e mockup.
const LOGO_PATH = path.join(__dirname, '..', '..', 'frontend', 'public', 'icon-512.png');
const LOGO_AVAILABLE = fs.existsSync(LOGO_PATH);

// Palette esattamente allineata ai token Tailwind della web app
// (vedi backend/routes/analytics.js e frontend/tailwind.config.js).
// Niente cream, niente clay: white background, slate text, multi-accent
// emerald/sky/amber/rose/violet. È la stessa identità visiva del software.
const C = {
  bg: '#fafafa', // pageBg
  card: '#ffffff', // cardBg
  cardSoft: '#f8fafc', // slate-50
  text: '#0f172a', // slate-900
  textMuted: '#64748b', // slate-500
  textSubtle: '#94a3b8', // slate-400
  textInverse: '#f8fafc',
  border: '#e2e8f0', // slate-200
  borderSoft: '#f1f5f9', // slate-100
  // Accent primario brand (rose, come live indicator del kiosk)
  brand: '#e11d48', // rose-600
  brandDark: '#be123c', // rose-700
  brandSoft: '#ffe4e6', // rose-100
  // Tonalità Tailwind 600 / 100 — corrispondono ai BOOKING_TYPE_STYLES
  emerald: '#059669',
  emeraldSoft: '#d1fae5',
  amber: '#d97706',
  amberSoft: '#fef3c7',
  rose: '#e11d48',
  roseSoft: '#ffe4e6',
  sky: '#0284c7',
  skySoft: '#e0f2fe',
  violet: '#9333ea',
  violetSoft: '#f5f3ff',
  slateDeep: '#0f172a', // slate-900 — sfondo "notte" cover/closing
  // Alias retrocompatibili (lo script li usa in vari punti)
  clay: '#0284c7',
  clayDark: '#0369a1',
  claySoft: '#e0f2fe',
  clayLight: '#f0f9ff',
  sage: '#059669',
  sageSoft: '#d1fae5',
  honey: '#d97706',
  honeySoft: '#fef3c7',
  terracotta: '#e11d48',
  terraSoft: '#ffe4e6',
  dusty: '#0284c7',
  dustySoft: '#e0f2fe',
  slate: '#475569',
};

// Scala heatmap rose (8 step) — identica al software (analytics.js)
const HEATMAP = [
  '#fff1f2',
  '#ffe4e6',
  '#fecdd3',
  '#fda4af',
  '#fb7185',
  '#f43f5e',
  '#e11d48',
  '#be123c',
];

// =============================================
// Primitive grafiche
// =============================================

function bgFill(doc, color = C.bg) {
  doc.save();
  doc.rect(0, 0, W, H).fill(color);
  doc.restore();
}

function thinDivider(doc, x, y, w, color = C.border) {
  doc.save();
  doc
    .strokeColor(color)
    .lineWidth(0.6)
    .moveTo(x, y)
    .lineTo(x + w, y)
    .stroke();
  doc.restore();
}

function card(
  doc,
  x,
  y,
  w,
  h,
  { fill = C.card, stroke = C.border, radius = 14, lineWidth = 0.8 } = {},
) {
  doc.save();
  doc.lineWidth(lineWidth).fillColor(fill).strokeColor(stroke);
  doc.roundedRect(x, y, w, h, radius).fillAndStroke(fill, stroke);
  doc.restore();
}

function softShadow(doc, x, y, w, h, radius = 14) {
  // Pdfkit non ha blur nativo: simuliamo con 3 rect concentrici molto trasparenti
  doc.save();
  doc.opacity(0.04).fillColor('#000');
  doc.roundedRect(x + 2, y + 4, w, h, radius).fill();
  doc.opacity(0.06);
  doc.roundedRect(x + 1, y + 2, w, h, radius).fill();
  doc.opacity(1).restore();
}

function pill(
  doc,
  x,
  y,
  label,
  {
    fill = C.borderSoft,
    color = C.text,
    font = 'Helvetica-Bold',
    size = 10,
    padX = 12,
    padY = 6,
  } = {},
) {
  doc.save();
  doc.font(font).fontSize(size);
  const tw = doc.widthOfString(label);
  const w = tw + padX * 2;
  const h = size + padY * 2 - 1;
  doc
    .fillColor(fill)
    .roundedRect(x, y, w, h, h / 2)
    .fill();
  doc.fillColor(color).text(label, x + padX, y + padY, { lineBreak: false });
  doc.restore();
  return { w, h };
}

function logoMark(doc, cx, cy, size = 56, _color = null) {
  // Embed del logo ufficiale Aula Book (icon-512.png — il favicon/PWA icon
  // del software). Il parametro `color` è ignorato perché il logo PNG ha la
  // sua identità cromatica fissa (navy + oro + nota musicale crema). Se il
  // file non è disponibile ricadiamo su un cerchio rose come placeholder.
  if (LOGO_AVAILABLE) {
    doc.image(LOGO_PATH, cx - size / 2, cy - size / 2, { width: size, height: size });
    return;
  }
  // Fallback minimale (non dovrebbe mai scattare in pratica)
  doc.save();
  doc
    .fillColor(C.brand)
    .circle(cx, cy, size / 2)
    .fill();
  doc.restore();
}

function slideTitle(doc, title, kicker, { color = C.clay } = {}) {
  // Kicker (etichetta uppercase letter-spaced sopra il titolo)
  if (kicker) {
    doc
      .fillColor(color)
      .font('Helvetica-Bold')
      .fontSize(11)
      .text(kicker, 64, 60, { characterSpacing: 2, lineBreak: false });
  }
  doc
    .fillColor(C.text)
    .font('Helvetica-Bold')
    .fontSize(40)
    .text(title, 64, kicker ? 80 : 64, { lineBreak: false });
  // Sottilissima linea accent
  doc.save();
  doc
    .fillColor(color)
    .rect(64, kicker ? 132 : 116, 40, 3)
    .fill();
  doc.restore();
}

function footer(doc, pageNum, total, { color = C.clay } = {}) {
  doc.save();
  thinDivider(doc, 64, H - 44, W - 128);
  // Sx: brand
  logoMark(doc, 76, H - 26, 18, color);
  doc
    .font('Helvetica-Bold')
    .fontSize(10)
    .fillColor(C.text)
    .text('Aula Book', 96, H - 30, { lineBreak: false });
  doc
    .font('Helvetica')
    .fontSize(10)
    .fillColor(C.textMuted)
    .text(
      '  ·  Presentazione per direttori e responsabili didattica',
      96 + doc.widthOfString('Aula Book'),
      H - 30,
      { lineBreak: false },
    );
  // Dx: numero
  doc
    .font('Helvetica')
    .fontSize(10)
    .fillColor(C.textSubtle)
    .text(`${String(pageNum).padStart(2, '0')} / ${total}`, W - 88, H - 30, {
      width: 40,
      align: 'right',
      lineBreak: false,
    });
  doc.restore();
}

// =============================================
// Icone Lucide — stessi path SVG usati da `lucide-react` nel frontend.
// Renderizzate come stroke 2pt, line-cap round, su viewBox 24×24.
// Il caller passa (x, y) = top-left, `size` = lato in pt, `color` = stroke.
//
// Path data presi dalle icone Lucide ufficiali (lucide.dev):
//   Zap, ShieldCheck, BarChart3, Users, CalendarDays, KeyRound,
//   ClipboardList, Lock, LayoutDashboard, Building2, UserRound, Music4
// =============================================

function _iconWrap(doc, x, y, size, color, draw) {
  const s = size / 24;
  doc.save();
  doc.translate(x, y).scale(s);
  doc.lineWidth(2).strokeColor(color).lineCap('round').lineJoin('round').fillColor(color);
  draw();
  doc.restore();
}

function iconBolt(doc, x, y, size, color) {
  // Lucide Zap
  _iconWrap(doc, x, y, size, color, () => {
    doc.path('M13 2 L3 14 L12 14 L11 22 L21 10 L12 10 L13 2 Z').stroke();
  });
}

function iconShield(doc, x, y, size, color) {
  // Lucide ShieldCheck
  _iconWrap(doc, x, y, size, color, () => {
    doc
      .path(
        'M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z',
      )
      .stroke();
    doc.path('M9 12 l2 2 4-4').stroke();
  });
}

function iconChart(doc, x, y, size, color) {
  // Lucide BarChart3
  _iconWrap(doc, x, y, size, color, () => {
    doc.path('M3 3v16a2 2 0 0 0 2 2h16').stroke();
    doc.path('M18 17V9').stroke();
    doc.path('M13 17V5').stroke();
    doc.path('M8 17v-3').stroke();
  });
}

function iconUsers(doc, x, y, size, color) {
  // Lucide Users
  _iconWrap(doc, x, y, size, color, () => {
    doc.path('M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2').stroke();
    doc.circle(9, 7, 4).stroke();
    doc.path('M22 21v-2a4 4 0 0 0-3-3.87').stroke();
    doc.path('M16 3.13a4 4 0 0 1 0 7.75').stroke();
  });
}

function iconCalendar(doc, x, y, size, color) {
  // Lucide CalendarDays
  _iconWrap(doc, x, y, size, color, () => {
    doc.roundedRect(3, 4, 18, 18, 2).stroke();
    doc.path('M16 2v4').stroke();
    doc.path('M3 10h18').stroke();
    doc.path('M8 2v4').stroke();
    // dots della griglia (i "giorni")
    doc.circle(8, 14, 0.5).fill();
    doc.circle(12, 14, 0.5).fill();
    doc.circle(16, 14, 0.5).fill();
    doc.circle(8, 18, 0.5).fill();
    doc.circle(12, 18, 0.5).fill();
  });
}

function iconKey(doc, x, y, size, color) {
  // Lucide KeyRound
  _iconWrap(doc, x, y, size, color, () => {
    doc
      .path(
        'M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 0 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z',
      )
      .stroke();
    doc.circle(16.5, 7.5, 0.6).fill();
  });
}

function iconClipboard(doc, x, y, size, color) {
  // Lucide ClipboardList
  _iconWrap(doc, x, y, size, color, () => {
    doc.roundedRect(8, 2, 8, 4, 1).stroke();
    doc.path('M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2').stroke();
    doc.path('M12 11h4').stroke();
    doc.path('M12 16h4').stroke();
    doc.circle(8, 11, 0.6).fill();
    doc.circle(8, 16, 0.6).fill();
  });
}

function iconLock(doc, x, y, size, color) {
  // Lucide Lock
  _iconWrap(doc, x, y, size, color, () => {
    doc.roundedRect(3, 11, 18, 11, 2).stroke();
    doc.path('M7 11V7a5 5 0 0 1 10 0v4').stroke();
  });
}

function iconLayoutDashboard(doc, x, y, size, color) {
  // Lucide LayoutDashboard
  _iconWrap(doc, x, y, size, color, () => {
    doc.roundedRect(3, 3, 7, 9, 1).stroke();
    doc.roundedRect(14, 3, 7, 5, 1).stroke();
    doc.roundedRect(14, 12, 7, 9, 1).stroke();
    doc.roundedRect(3, 16, 7, 5, 1).stroke();
  });
}

function iconBuilding(doc, x, y, size, color) {
  // Lucide Building2
  _iconWrap(doc, x, y, size, color, () => {
    doc.path('M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z').stroke();
    doc.path('M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2').stroke();
    doc.path('M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2').stroke();
    doc.path('M10 6h4').stroke();
    doc.path('M10 10h4').stroke();
    doc.path('M10 14h4').stroke();
    doc.path('M10 18h4').stroke();
  });
}

function iconUserRound(doc, x, y, size, color) {
  // Lucide UserRound
  _iconWrap(doc, x, y, size, color, () => {
    doc.circle(12, 8, 5).stroke();
    doc.path('M20 21a8 8 0 0 0-16 0').stroke();
  });
}

// Mini-grafici riusabili
function miniHeatmap(doc, x, y, w, h) {
  const cellW = w / 24,
    cellH = h / 7;
  doc.save();
  for (let d = 0; d < 7; d++) {
    for (let hh = 0; hh < 24; hh++) {
      let v = 0;
      if (d < 6) {
        if (hh >= 9 && hh <= 12) v = Math.max(0, 6 - Math.abs(10.5 - hh) * 1.2);
        else if (hh >= 14 && hh <= 18) v = Math.max(0, 6 - Math.abs(16 - hh));
      }
      const idx = Math.min(7, Math.max(0, Math.round(v)));
      doc
        .fillColor(HEATMAP[idx])
        .rect(x + hh * cellW, y + d * cellH, cellW - 1, cellH - 1)
        .fill();
    }
  }
  doc.restore();
}

function miniBars(doc, x, y, items, maxW = 220, accent = C.clay, rowH = 18) {
  const max = Math.max(...items.map((i) => i.value));
  doc.save();
  items.forEach((it, i) => {
    const yy = y + i * rowH;
    doc
      .fillColor(C.text)
      .font('Helvetica')
      .fontSize(9)
      .text(it.label, x, yy + 3, { width: 90, lineBreak: false });
    doc
      .fillColor(C.borderSoft)
      .rect(x + 96, yy + 4, maxW, 8)
      .fill();
    doc
      .fillColor(accent)
      .rect(x + 96, yy + 4, (it.value / max) * maxW, 8)
      .fill();
    doc
      .fillColor(C.textMuted)
      .font('Helvetica')
      .fontSize(8)
      .text(`${it.value}h`, x + 96 + maxW + 6, yy + 3, { lineBreak: false });
  });
  doc.restore();
}

function miniTrend(doc, x, y, w, h, points, accent = C.clay) {
  const max = Math.max(...points);
  const stepX = points.length > 1 ? w / (points.length - 1) : 0;
  doc.save();
  // Area sotto la linea (riempimento soft)
  doc.fillColor(accent).opacity(0.1);
  doc.moveTo(x, y + h);
  points.forEach((p, i) => {
    const px = x + i * stepX;
    const py = y + h - (p / max) * h;
    doc.lineTo(px, py);
  });
  doc
    .lineTo(x + (points.length - 1) * stepX, y + h)
    .closePath()
    .fill();
  doc.opacity(1);
  // Linea
  doc.strokeColor(accent).lineWidth(1.6);
  points.forEach((p, i) => {
    const px = x + i * stepX;
    const py = y + h - (p / max) * h;
    if (i === 0) doc.moveTo(px, py);
    else doc.lineTo(px, py);
  });
  doc.stroke();
  // Punti
  points.forEach((p, i) => {
    const px = x + i * stepX;
    const py = y + h - (p / max) * h;
    doc.fillColor(accent).circle(px, py, 2.6).fill();
  });
  doc.restore();
}

const TOTAL = 16;

// =============================================
// SLIDE 01 — Cover
// =============================================

function slideCover(doc) {
  bgFill(doc, C.slateDeep);

  // Ornamenti — cerchi decorativi grandi e morbidi (vibe editoriale)
  doc.save();
  doc
    .fillColor(C.clay)
    .opacity(0.18)
    .circle(W - 160, 180, 280)
    .fill();
  doc
    .fillColor(C.honey)
    .opacity(0.1)
    .circle(180, H - 120, 320)
    .fill();
  doc.opacity(1).restore();

  // Brand in alto
  logoMark(doc, 100, 110, 60, C.clay);
  doc
    .fillColor(C.bg)
    .font('Helvetica-Bold')
    .fontSize(32)
    .text('Aula Book', 144, 90, { lineBreak: false });
  doc
    .fillColor('#bdb6a8')
    .font('Helvetica')
    .fontSize(13)
    .text('Sistema di prenotazione aule per il conservatorio', 144, 134, { lineBreak: false });

  // Hero sentence — lettering serif su 3 righe
  doc
    .fillColor(C.bg)
    .font('Helvetica-Bold')
    .fontSize(70)
    .text('Meno carta.', 100, 270, { lineBreak: false });
  doc
    .fillColor(C.clay)
    .font('Helvetica-Bold')
    .fontSize(70)
    .text('Zero doppie prenotazioni.', 100, 348, { lineBreak: false });
  doc
    .fillColor(C.bg)
    .font('Helvetica-Bold')
    .fontSize(70)
    .text("Tutto in un'unica vista.", 100, 426, { lineBreak: false });

  // Subtitle
  doc
    .fillColor('#bdb6a8')
    .font('Helvetica')
    .fontSize(15)
    .text('Una presentazione per direttori e responsabili della didattica', 100, 528, {
      lineBreak: false,
    });

  // Footer minimal
  doc
    .font('Helvetica')
    .fontSize(10)
    .fillColor('#7e776a')
    .text(
      new Date().toLocaleDateString('it-IT', { year: 'numeric', month: 'long', day: 'numeric' }),
      100,
      H - 60,
      { lineBreak: false },
    );
  doc.text('Conservatorio · uso interno', W - 240, H - 60, {
    width: 180,
    align: 'right',
    lineBreak: false,
  });
}

// =============================================
// SLIDE 02 — Il problema oggi
// =============================================

function slideProblema(doc) {
  bgFill(doc);
  slideTitle(doc, 'Come si gestiscono oggi le aule?', 'IL PROBLEMA', { color: C.terracotta });
  doc
    .fillColor(C.textMuted)
    .font('Helvetica')
    .fontSize(15)
    .text('Quattro problemi che ogni segreteria di conservatorio conosce bene.', 64, 152, {
      lineBreak: false,
    });

  const pains = [
    {
      n: '01',
      title: 'Foglio Excel condiviso',
      body: 'Lo apre uno alla volta. Le modifiche si sovrascrivono. Nessuno sa quale sia "l\'ultima versione".',
      tone: C.honey,
      soft: C.honeySoft,
    },
    {
      n: '02',
      title: 'Doppie prenotazioni',
      body: 'Due classi nella stessa aula alle 15:00. Litigi, lezioni saltate, telefonate furiose alla direzione.',
      tone: C.terracotta,
      soft: C.terraSoft,
    },
    {
      n: '03',
      title: 'Telefonate alla segreteria',
      body: '"Posso avere l\'aula 102 giovedì?" — 15 chiamate al giorno. La segreteria non fa altro.',
      tone: C.dusty,
      soft: C.dustySoft,
    },
    {
      n: '04',
      title: 'Nessuna statistica',
      body: 'Quale aula è più richiesta? Quanto è satura? Decisioni didattiche prese "a sentimento".',
      tone: C.clay,
      soft: C.claySoft,
    },
  ];

  const colW = 560,
    rowH = 200,
    gapX = 32,
    gapY = 24;
  const startX = 64,
    startY = 200;
  pains.forEach((p, i) => {
    const col = i % 2,
      row = Math.floor(i / 2);
    const x = startX + col * (colW + gapX);
    const y = startY + row * (rowH + gapY);
    softShadow(doc, x, y, colW, rowH);
    card(doc, x, y, colW, rowH);
    // Numero romano serif gigante a sx
    doc.fillColor(p.soft).rect(x, y, 4, rowH).fill();
    doc
      .fillColor(p.tone)
      .font('Helvetica-Bold')
      .fontSize(56)
      .text(p.n, x + 26, y + 32, { lineBreak: false });
    // Titolo + body
    doc
      .fillColor(C.text)
      .font('Helvetica-Bold')
      .fontSize(22)
      .text(p.title, x + 130, y + 36, { width: colW - 154, lineBreak: false });
    doc
      .fillColor(C.textMuted)
      .font('Helvetica')
      .fontSize(13)
      .text(p.body, x + 130, y + 76, { width: colW - 154, lineGap: 4 });
  });

  footer(doc, 2, TOTAL, { color: C.terracotta });
}

// =============================================
// SLIDE 03 — Tre pilastri
// =============================================

function slideSoluzione(doc) {
  bgFill(doc);
  slideTitle(doc, 'La soluzione, in una frase.', 'LA RISPOSTA', { color: C.clay });

  // Pull quote serif gigante
  doc
    .fillColor(C.text)
    .font('Helvetica-Bold')
    .fontSize(34)
    .text('Aula Book è il sistema unico per', 64, 200, { width: W - 128, align: 'center' });
  doc
    .fillColor(C.clay)
    .font('Helvetica-Bold')
    .fontSize(56)
    .text('prenotare · monitorare · decidere.', 64, 250, { width: W - 128, align: 'center' });

  const pillars = [
    {
      title: 'Prenotazione in 30 secondi',
      body: 'Click su slot libero, conferma. Fatto, dal cellulare in qualunque momento.',
      tone: C.dusty,
      soft: C.dustySoft,
      icon: iconBolt,
    },
    {
      title: 'Conflitti impossibili',
      body: 'Tre livelli di protezione: UI, validatore, vincolo a livello database PostgreSQL.',
      tone: C.sage,
      soft: C.sageSoft,
      icon: iconShield,
    },
    {
      title: 'Statistiche live',
      body: 'Heatmap di occupazione, top aule, trend settimanali. Tutto in tempo reale.',
      tone: C.clay,
      soft: C.claySoft,
      icon: iconChart,
    },
  ];
  const colW = 360,
    gapX = 32;
  const totalW = pillars.length * colW + (pillars.length - 1) * gapX;
  const startX = (W - totalW) / 2;
  const yy = 400;
  pillars.forEach((p, i) => {
    const x = startX + i * (colW + gapX);
    softShadow(doc, x, yy, colW, 220);
    card(doc, x, yy, colW, 220);
    // Icon tile
    doc
      .fillColor(p.soft)
      .roundedRect(x + 28, yy + 28, 56, 56, 12)
      .fill();
    p.icon(doc, x + 44, yy + 44, 24, p.tone);
    // Titolo
    doc
      .fillColor(C.text)
      .font('Helvetica-Bold')
      .fontSize(20)
      .text(p.title, x + 28, yy + 102, { width: colW - 56 });
    // Body
    doc
      .fillColor(C.textMuted)
      .font('Helvetica')
      .fontSize(13)
      .text(p.body, x + 28, yy + 138, { width: colW - 56, lineGap: 4 });
  });

  footer(doc, 3, TOTAL);
}

// =============================================
// SLIDE 04 — Screen mockup: DASHBOARD
// =============================================

function slideScreenDashboard(doc) {
  bgFill(doc);
  slideTitle(doc, 'Dashboard utente', "SCHERMATA · l'app dal punto di vista di un docente");

  // Browser chrome (rendering "screenshot")
  const fx = 64,
    fy = 175,
    fw = W - 128,
    fh = 480;
  softShadow(doc, fx, fy, fw, fh, 12);
  card(doc, fx, fy, fw, fh, { fill: C.card, radius: 12 });

  // Browser top bar
  doc.fillColor(C.borderSoft).rect(fx, fy, fw, 32).fill();
  doc
    .fillColor('#fa7268')
    .circle(fx + 18, fy + 16, 5)
    .fill();
  doc
    .fillColor('#febd2e')
    .circle(fx + 36, fy + 16, 5)
    .fill();
  doc
    .fillColor('#28c940')
    .circle(fx + 54, fy + 16, 5)
    .fill();
  doc
    .fillColor(C.card)
    .roundedRect(fx + 80, fy + 8, fw - 160, 16, 3)
    .fill();
  doc
    .fillColor(C.textSubtle)
    .font('Helvetica')
    .fontSize(8)
    .text('aulabook.tuo-conservatorio.it/dashboard', fx + 88, fy + 12, { lineBreak: false });

  // Sidebar
  const sx = fx,
    sy = fy + 32,
    swid = 200,
    sh = fh - 32;
  doc.fillColor(C.cardSoft).rect(sx, sy, swid, sh).fill();
  // Logo nella sidebar
  logoMark(doc, sx + 24, sy + 26, 22, C.clay);
  doc
    .fillColor(C.text)
    .font('Helvetica-Bold')
    .fontSize(15)
    .text('Aula Book', sx + 44, sy + 18, { lineBreak: false });
  // Nav items — icone Lucide identiche a quelle usate dalla sidebar reale
  // del software (vedi `frontend/src/components/layout/AppLayout.tsx`).
  const nav = [
    { lbl: 'Dashboard', icon: iconLayoutDashboard, active: true },
    { lbl: 'Prenota aula', icon: iconCalendar },
    { lbl: 'Le mie', icon: iconClipboard },
    { lbl: 'Aule', icon: iconBuilding },
    { lbl: 'Strumenti', icon: iconBolt },
    { lbl: 'Profilo', icon: iconUserRound },
  ];
  let ny = sy + 70;
  nav.forEach((n) => {
    if (n.active) {
      doc
        .fillColor(C.claySoft)
        .roundedRect(sx + 12, ny - 4, swid - 24, 28, 6)
        .fill();
      n.icon(doc, sx + 24, ny + 2, 14, C.clayDark);
      doc
        .fillColor(C.clayDark)
        .font('Helvetica-Bold')
        .fontSize(11)
        .text(n.lbl, sx + 46, ny + 4, { lineBreak: false });
    } else {
      n.icon(doc, sx + 24, ny + 2, 14, C.textMuted);
      doc
        .fillColor(C.textMuted)
        .font('Helvetica')
        .fontSize(11)
        .text(n.lbl, sx + 46, ny + 4, { lineBreak: false });
    }
    ny += 32;
  });

  // Main content area
  const mx = sx + swid + 24,
    my = sy + 24,
    mw = fw - swid - 48;
  // Greeting
  doc
    .fillColor(C.text)
    .font('Helvetica-Bold')
    .fontSize(22)
    .text('Buongiorno, prof. Rossi', mx, my, { lineBreak: false });
  doc
    .fillColor(C.textMuted)
    .font('Helvetica')
    .fontSize(11)
    .text('Lunedì 28 aprile · ecco lo stato delle tue prenotazioni', mx, my + 32, {
      lineBreak: false,
    });

  // KPI tiles (2×2)
  const tiles = [
    {
      lbl: 'Prossima',
      val: 'Gio 31',
      sub: 'Aula 102 · 14:00–17:00',
      tone: C.dusty,
      soft: C.dustySoft,
    },
    { lbl: 'Questa settimana', val: '6h', sub: 'su 30h ammesse', tone: C.sage, soft: C.sageSoft },
    {
      lbl: 'Confermate',
      val: '12',
      sub: 'attive nei prossimi 30gg',
      tone: C.clay,
      soft: C.claySoft,
    },
    {
      lbl: 'In attesa',
      val: '1',
      sub: 'sala concerti · pending',
      tone: C.honey,
      soft: C.honeySoft,
    },
  ];
  const tw = (mw - 24) / 2,
    th = 70;
  tiles.forEach((t, i) => {
    const tx = mx + (i % 2) * (tw + 24);
    const ty = my + 70 + Math.floor(i / 2) * (th + 12);
    card(doc, tx, ty, tw, th, { fill: C.card });
    doc
      .fillColor(t.soft)
      .roundedRect(tx + 12, ty + 14, 42, 42, 8)
      .fill();
    doc
      .fillColor(t.tone)
      .circle(tx + 33, ty + 35, 6)
      .fill();
    doc
      .fillColor(C.textSubtle)
      .font('Helvetica')
      .fontSize(8)
      .text(t.lbl.toUpperCase(), tx + 64, ty + 14, { characterSpacing: 0.5 });
    doc
      .fillColor(C.text)
      .font('Helvetica-Bold')
      .fontSize(20)
      .text(t.val, tx + 64, ty + 26, { lineBreak: false });
    doc
      .fillColor(C.textMuted)
      .font('Helvetica')
      .fontSize(9)
      .text(t.sub, tx + 64, ty + 50, { lineBreak: false });
  });

  // "Prossime prenotazioni" block (sotto le KPI)
  const ux = mx,
    uy = my + 230,
    uw = mw,
    uh = 220;
  card(doc, ux, uy, uw, uh);
  doc
    .fillColor(C.text)
    .font('Helvetica-Bold')
    .fontSize(15)
    .text('Le tue prenotazioni in arrivo', ux + 16, uy + 14, { lineBreak: false });
  thinDivider(doc, ux + 16, uy + 40, uw - 32);
  const upc = [
    { d: 'GIO 31', r: 'Aula 102', t: '14:00 – 17:00', k: 'Lezione', c: C.dusty },
    { d: 'VEN 1', r: 'Sala 5', t: '10:00 – 12:00', k: 'Studio', c: C.sage },
    { d: 'LUN 4', r: 'Auditorium', t: '20:00 – 22:00', k: 'Concerto', c: C.terracotta },
    { d: 'MER 6', r: 'Aula 103', t: '15:00 – 17:00', k: 'Prova', c: C.honey },
  ];
  upc.forEach((u, i) => {
    const ry = uy + 50 + i * 38;
    doc
      .fillColor(C.cardSoft)
      .rect(ux + 16, ry, uw - 32, 30)
      .fill();
    doc
      .fillColor(C.text)
      .font('Helvetica-Bold')
      .fontSize(10)
      .text(u.d, ux + 28, ry + 10, { width: 60, lineBreak: false });
    doc
      .fillColor(C.text)
      .font('Helvetica-Bold')
      .fontSize(11)
      .text(u.r, ux + 92, ry + 10, { width: 100, lineBreak: false });
    doc
      .fillColor(C.textMuted)
      .font('Helvetica')
      .fontSize(10)
      .text(u.t, ux + 200, ry + 10, { width: 110, lineBreak: false });
    // Type pill
    pill(doc, ux + 320, ry + 6, u.k, {
      fill: u.c,
      color: C.bg,
      font: 'Helvetica-Bold',
      size: 8,
      padX: 8,
      padY: 4,
    });
    doc
      .fillColor(C.clay)
      .font('Helvetica-Bold')
      .fontSize(10)
      .text('apri', ux + uw - 60, ry + 10, { width: 30, align: 'right', lineBreak: false });
  });

  // Annotazione fuori dal frame
  doc
    .fillColor(C.textMuted)
    .font('Helvetica-Oblique')
    .fontSize(11)
    .text('(ricostruzione vettoriale dei componenti React reali del software)', 64, 670, {
      lineBreak: false,
    });

  footer(doc, 4, TOTAL);
}

// =============================================
// SLIDE 05 — PRIMA: pomeriggio in segreteria
// =============================================

function slidePrima(doc) {
  bgFill(doc);
  slideTitle(doc, 'Lunedì, 15:00. Telefono in segreteria.', 'OGGI · senza Aula Book', {
    color: C.terracotta,
  });

  const steps = [
    { time: '15:00', txt: "Prof. Rossi: «Posso avere l'aula 102 giovedì alle 16?»" },
    { time: '15:01', txt: 'Segreteria apre Excel sul desktop, naviga 4 cartelle.' },
    { time: '15:03', txt: 'Cerca "102", non trova nulla. Apre il foglio del mese precedente.' },
    { time: '15:05', txt: 'Squilla un altro telefono — secondo docente in attesa.' },
    { time: '15:06', txt: 'Trova lo slot, ma non sa se è già stato confermato a qualcun altro.' },
    { time: '15:08', txt: 'Risponde: «Mi spiace prof, le richiamo dopo aver verificato.»' },
  ];
  let yy = 200;
  steps.forEach((s, i) => {
    doc
      .fillColor(C.terracotta)
      .circle(98, yy + 10, 6)
      .fill();
    if (i < steps.length - 1) {
      doc.save();
      doc
        .strokeColor(C.terracotta)
        .lineWidth(1.5)
        .opacity(0.4)
        .moveTo(98, yy + 18)
        .lineTo(98, yy + 60)
        .stroke();
      doc.restore();
    }
    doc
      .fillColor(C.terracotta)
      .font('Helvetica-Bold')
      .fontSize(13)
      .text(s.time, 50, yy + 4, { width: 44, lineBreak: false });
    doc
      .fillColor(C.text)
      .font('Helvetica')
      .fontSize(15)
      .text(s.txt, 120, yy + 4, { width: 600, lineGap: 2 });
    yy += 60;
  });

  // Verdetto card a destra (serif gigante)
  card(doc, 800, 200, 416, 360, { fill: C.terraSoft, stroke: C.terracotta });
  doc
    .fillColor(C.terracotta)
    .font('Helvetica-Bold')
    .fontSize(120)
    .text("8'", 824, 230, { lineBreak: false });
  doc
    .fillColor(C.text)
    .font('Helvetica-Bold')
    .fontSize(22)
    .text('per UNA richiesta', 824, 380, { width: 380 });
  doc
    .fillColor(C.text)
    .font('Helvetica')
    .fontSize(13)
    .text(
      'Moltiplicato per circa 15 chiamate al giorno = 2 ore di segreteria al giorno bruciate per il telefono.',
      824,
      420,
      { width: 380, lineGap: 3 },
    );
  doc
    .fillColor(C.terracotta)
    .font('Helvetica-Bold')
    .fontSize(13)
    .text("120 ore l'anno.", 824, 510, { width: 380 });

  footer(doc, 5, TOTAL, { color: C.terracotta });
}

// =============================================
// SLIDE 06 — DOPO: con Aula Book
// =============================================

function slideDopo(doc) {
  bgFill(doc);
  slideTitle(doc, 'Lunedì, 15:00. Niente telefono.', 'CON AULA BOOK', { color: C.sage });

  const steps = [
    { time: '15:00:00', txt: 'Prof. Rossi apre Aula Book sul cellulare.' },
    {
      time: '15:00:08',
      txt: 'Vede in tempo reale: aula 102 giovedì 14–17 occupata, 17–19 libera.',
    },
    { time: '15:00:18', txt: 'Trascina sullo slot libero per scegliere la durata.' },
    {
      time: '15:00:25',
      txt: 'Click "Conferma". L\'aula è prenotata. Email automatica al docente.',
    },
  ];
  let yy = 220;
  steps.forEach((s, i) => {
    doc
      .fillColor(C.sage)
      .circle(124, yy + 10, 6)
      .fill();
    if (i < steps.length - 1) {
      doc.save();
      doc
        .strokeColor(C.sage)
        .lineWidth(1.5)
        .opacity(0.4)
        .moveTo(124, yy + 18)
        .lineTo(124, yy + 76)
        .stroke();
      doc.restore();
    }
    doc
      .fillColor(C.sage)
      .font('Helvetica-Bold')
      .fontSize(13)
      .text(s.time, 64, yy + 4, { width: 56, lineBreak: false });
    doc
      .fillColor(C.text)
      .font('Helvetica')
      .fontSize(16)
      .text(s.txt, 144, yy + 2, { width: 600, lineGap: 3 });
    yy += 76;
  });

  // Big "30 secondi"
  card(doc, 800, 200, 416, 360, { fill: C.sageSoft, stroke: C.sage });
  doc
    .fillColor(C.sage)
    .font('Helvetica-Bold')
    .fontSize(140)
    .text('30"', 824, 220, { lineBreak: false });
  doc
    .fillColor(C.text)
    .font('Helvetica-Bold')
    .fontSize(22)
    .text('end-to-end', 824, 400, { width: 380 });
  doc
    .fillColor(C.text)
    .font('Helvetica')
    .fontSize(13)
    .text(
      'Dalla domanda alla conferma. Senza alzare il telefono. Con conferma scritta nella mail del docente e nel calendario.',
      824,
      432,
      { width: 380, lineGap: 3 },
    );
  doc
    .fillColor(C.sage)
    .font('Helvetica-Bold')
    .fontSize(13)
    .text('Segreteria libera per le cose che contano.', 824, 520, { width: 380 });

  footer(doc, 6, TOTAL, { color: C.sage });
}

// =============================================
// SLIDE 07 — Screen mockup: VISTA SETTIMANALE
// =============================================

function slideScreenWeekly(doc) {
  bgFill(doc);
  slideTitle(doc, 'Vista settimanale aule × giorni', 'SCHERMATA · il cuore del software');

  const fx = 64,
    fy = 175,
    fw = W - 128,
    fh = 480;
  softShadow(doc, fx, fy, fw, fh, 12);
  card(doc, fx, fy, fw, fh);

  // Toolbar
  const tx = fx + 16,
    ty = fy + 16;
  pill(doc, tx, ty, '< Settimana precedente', {
    fill: C.borderSoft,
    color: C.text,
    size: 9,
    padX: 10,
    padY: 5,
  });
  pill(doc, tx + 162, ty, 'Settimana corrente', {
    fill: C.claySoft,
    color: C.clayDark,
    size: 9,
    padX: 10,
    padY: 5,
  });
  pill(doc, tx + 280, ty, 'Settimana successiva >', {
    fill: C.borderSoft,
    color: C.text,
    size: 9,
    padX: 10,
    padY: 5,
  });
  doc
    .fillColor(C.text)
    .font('Helvetica-Bold')
    .fontSize(16)
    .text('28 aprile – 3 maggio 2026', tx + 460, ty + 4, { lineBreak: false });
  // Filter pill destro
  pill(doc, fx + fw - 220, ty, 'Edificio: Sede centrale', {
    fill: C.dustySoft,
    color: C.dusty,
    size: 9,
    padX: 10,
    padY: 5,
  });

  // Grid header
  const gx = fx + 16,
    gy = fy + 70,
    gw = fw - 32,
    gh = fh - 86;
  const days = ['Lun 28', 'Mar 29', 'Mer 30', 'Gio 1', 'Ven 2', 'Sab 3'];
  const labelW = 80;
  const dayW = (gw - labelW) / days.length;
  // Header riga 1: nomi giorni
  doc.fillColor(C.cardSoft).rect(gx, gy, gw, 26).fill();
  doc
    .fillColor(C.text)
    .font('Helvetica-Bold')
    .fontSize(9)
    .text('AULA', gx + 8, gy + 9, { width: labelW - 16, characterSpacing: 0.6, lineBreak: false });
  days.forEach((d, i) => {
    const x = gx + labelW + i * dayW;
    doc
      .fillColor(C.text)
      .font('Helvetica-Bold')
      .fontSize(10)
      .text(d, x, gy + 8, { width: dayW, align: 'center', lineBreak: false });
  });
  // Header riga 2: ore (00..23 ogni 3)
  const gy2 = gy + 26;
  doc.fillColor(C.borderSoft).rect(gx, gy2, gw, 18).fill();
  for (let h = 8; h <= 19; h++) {
    if (h % 3 === 0 || h === 8) {
      days.forEach((_, di) => {
        const x = gx + labelW + di * dayW + ((h - 8) / 12) * dayW;
        doc
          .fillColor(C.textSubtle)
          .font('Helvetica')
          .fontSize(7)
          .text(String(h).padStart(2, '0'), x, gy2 + 5, { width: 16, lineBreak: false });
      });
    }
  }

  // Aule rows con prenotazioni realistic
  const rooms = [
    {
      name: 'A.101 P.terra',
      bookings: [
        [0, 0.2, 0.42, C.dusty, 'Prof. Rossi'],
        [0, 0.55, 0.85, C.sage, 'Stud'],
        [2, 0.3, 0.6, C.clay, 'Prof. M. Bianchi'],
        [4, 0.1, 0.5, C.honey, 'Prova'],
      ],
    },
    {
      name: 'A.102 P.terra',
      bookings: [
        [1, 0.15, 0.45, C.dusty, 'Prof. Verdi'],
        [3, 0.4, 0.7, C.terracotta, 'Concerto Bach'],
        [5, 0.2, 0.4, C.sage, 'Stud'],
      ],
    },
    {
      name: 'A.103 P.terra',
      bookings: [
        [0, 0.25, 0.55, C.dusty, 'Prof. Conti'],
        [2, 0.1, 0.3, C.sage, 'Stud'],
        [3, 0.55, 0.85, C.honey, 'Prova quart.'],
      ],
    },
    {
      name: 'Sala 5 P.1°',
      bookings: [
        [1, 0.4, 0.8, C.clay, 'Direzione'],
        [4, 0.3, 0.6, C.terracotta, 'Saggio cl. 3°'],
      ],
    },
    {
      name: 'Sala 6 P.1°',
      bookings: [
        [0, 0.1, 0.3, C.honey, 'Prova'],
        [2, 0.4, 0.7, C.dusty, 'Prof. Greco'],
        [4, 0.55, 0.95, C.sage, 'Stud'],
      ],
    },
    { name: 'Auditorium', bookings: [[3, 0.2, 0.6, C.terracotta, 'Concerto Mozart']] },
  ];
  const rowH = (gh - 44) / rooms.length;
  rooms.forEach((r, i) => {
    const ry = gy2 + 18 + i * rowH;
    if (i % 2 === 0) doc.fillColor('#fbfaf3').rect(gx, ry, gw, rowH).fill();
    // Label
    doc
      .fillColor(C.text)
      .font('Helvetica-Bold')
      .fontSize(11)
      .text(r.name, gx + 8, ry + rowH / 2 - 5, { width: labelW - 12, lineBreak: false });
    // Bordi celle giorno
    days.forEach((_, di) => {
      const x = gx + labelW + di * dayW;
      doc
        .strokeColor(C.borderSoft)
        .lineWidth(0.5)
        .moveTo(x, ry)
        .lineTo(x, ry + rowH)
        .stroke();
    });
    // Prenotazioni
    r.bookings.forEach((b) => {
      const [day, s, e, col, label] = b;
      const x = gx + labelW + day * dayW + s * dayW;
      const w = (e - s) * dayW;
      doc
        .fillColor(col)
        .roundedRect(x + 1, ry + 4, w - 2, rowH - 8, 3)
        .fill();
      // Label dentro
      doc
        .fillColor(C.bg)
        .font('Helvetica-Bold')
        .fontSize(8)
        .text(label, x + 4, ry + rowH / 2 - 4, {
          width: w - 8,
          align: 'center',
          ellipsis: true,
          lineBreak: false,
        });
    });
  });

  // Ora corrente (linea verticale rosa)
  const todayCol = 0;
  const nowX = gx + labelW + todayCol * dayW + 0.4 * dayW;
  doc.save();
  doc
    .strokeColor(C.terracotta)
    .lineWidth(1.4)
    .opacity(0.85)
    .moveTo(nowX, gy2 + 18)
    .lineTo(nowX, gy + gh)
    .stroke();
  doc
    .fillColor(C.terracotta)
    .circle(nowX, gy2 + 18, 3)
    .fill();
  doc.opacity(1).restore();

  // Legenda sotto
  const ly = fy + fh + 16;
  doc
    .fillColor(C.textMuted)
    .font('Helvetica')
    .fontSize(10)
    .text('Tipologia:', 64, ly, { lineBreak: false });
  const legend = [
    { l: 'Studio', c: C.sage },
    { l: 'Lezione', c: C.dusty },
    { l: 'Prova', c: C.honey },
    { l: 'Concerto', c: C.terracotta },
    { l: 'Direzione', c: C.clay },
  ];
  let lx = 130;
  legend.forEach((it) => {
    doc
      .fillColor(it.c)
      .rect(lx, ly + 1, 10, 10)
      .fill();
    doc
      .fillColor(C.text)
      .font('Helvetica')
      .fontSize(10)
      .text(it.l, lx + 16, ly, { lineBreak: false });
    lx += doc.widthOfString(it.l) + 38;
  });

  footer(doc, 7, TOTAL);
}

// =============================================
// SLIDE 08 — Screen mockup: FORM DI PRENOTAZIONE
// =============================================

function slideScreenForm(doc) {
  bgFill(doc);
  slideTitle(doc, 'Form di prenotazione', 'SCHERMATA · creazione in 5 campi');

  // Backdrop oscurato (tipico di una modale)
  doc.save();
  doc
    .fillColor('#000')
    .opacity(0.18)
    .rect(64, 175, W - 128, 480)
    .fill();
  doc.opacity(1).restore();

  // Sotto al backdrop, mostriamo "scuro" il calendario
  const bx = 64,
    by = 175,
    bw = W - 128,
    bh = 480;
  card(doc, bx, by, bw, bh, { fill: '#3a342f', stroke: '#3a342f' });

  // Modal centrato
  const mw = 560,
    mh = 460,
    mx = (W - mw) / 2,
    my = (H - mh) / 2 + 20;
  softShadow(doc, mx, my, mw, mh, 12);
  card(doc, mx, my, mw, mh);

  // Header modal
  doc
    .fillColor(C.text)
    .font('Helvetica-Bold')
    .fontSize(22)
    .text('Nuova prenotazione', mx + 24, my + 22, { lineBreak: false });
  doc
    .fillColor(C.textMuted)
    .font('Helvetica')
    .fontSize(11)
    .text("Verifica la disponibilità e conferma per bloccare l'aula.", mx + 24, my + 56, {
      lineBreak: false,
    });
  doc
    .fillColor(C.textSubtle)
    .font('Helvetica')
    .fontSize(20)
    .text('×', mx + mw - 36, my + 18, { lineBreak: false });
  thinDivider(doc, mx + 24, my + 80, mw - 48);

  // Form fields
  const fy = my + 96,
    fx = mx + 24,
    fwid = mw - 48;

  // Aula
  doc
    .fillColor(C.textMuted)
    .font('Helvetica')
    .fontSize(10)
    .text('Aula', fx, fy, { lineBreak: false });
  doc
    .fillColor(C.card)
    .strokeColor(C.border)
    .lineWidth(0.8)
    .roundedRect(fx, fy + 16, fwid, 32, 6)
    .fillAndStroke(C.card, C.border);
  doc
    .fillColor(C.text)
    .font('Helvetica')
    .fontSize(11)
    .text('Aula 102 · Sede centrale · Piano terra', fx + 12, fy + 26, { lineBreak: false });
  doc
    .fillColor(C.textSubtle)
    .font('Helvetica')
    .fontSize(10)
    .text('v', fx + fwid - 16, fy + 26, { lineBreak: false });

  // Inizio + Fine (2 colonne)
  const half = (fwid - 16) / 2;
  doc
    .fillColor(C.textMuted)
    .font('Helvetica')
    .fontSize(10)
    .text('Inizio', fx, fy + 64, { lineBreak: false });
  doc
    .fillColor(C.card)
    .strokeColor(C.border)
    .lineWidth(0.8)
    .roundedRect(fx, fy + 80, half, 32, 6)
    .fillAndStroke(C.card, C.border);
  doc
    .fillColor(C.text)
    .font('Helvetica')
    .fontSize(11)
    .text('giovedì 1 maggio · 14:00', fx + 12, fy + 90, { lineBreak: false });

  doc
    .fillColor(C.textMuted)
    .font('Helvetica')
    .fontSize(10)
    .text('Fine', fx + half + 16, fy + 64, { lineBreak: false });
  doc
    .fillColor(C.card)
    .strokeColor(C.border)
    .lineWidth(0.8)
    .roundedRect(fx + half + 16, fy + 80, half, 32, 6)
    .fillAndStroke(C.card, C.border);
  doc
    .fillColor(C.text)
    .font('Helvetica')
    .fontSize(11)
    .text('giovedì 1 maggio · 17:00', fx + half + 28, fy + 90, { lineBreak: false });

  // Tipo
  doc
    .fillColor(C.textMuted)
    .font('Helvetica')
    .fontSize(10)
    .text('Tipo di attività', fx, fy + 128, { lineBreak: false });
  doc
    .fillColor(C.card)
    .strokeColor(C.border)
    .lineWidth(0.8)
    .roundedRect(fx, fy + 144, fwid, 32, 6)
    .fillAndStroke(C.card, C.border);
  // pill colorato dentro
  doc
    .fillColor(C.dusty)
    .circle(fx + 18, fy + 160, 5)
    .fill();
  doc
    .fillColor(C.text)
    .font('Helvetica')
    .fontSize(11)
    .text('Lezione', fx + 30, fy + 154, { lineBreak: false });
  doc
    .fillColor(C.textSubtle)
    .font('Helvetica')
    .fontSize(10)
    .text('v', fx + fwid - 16, fy + 154, { lineBreak: false });

  // Titolo
  doc
    .fillColor(C.textMuted)
    .font('Helvetica')
    .fontSize(10)
    .text('Titolo (opzionale)', fx, fy + 192, { lineBreak: false });
  doc
    .fillColor(C.card)
    .strokeColor(C.border)
    .lineWidth(0.8)
    .roundedRect(fx, fy + 208, fwid, 32, 6)
    .fillAndStroke(C.card, C.border);
  doc
    .fillColor(C.text)
    .font('Helvetica-Oblique')
    .fontSize(11)
    .fillColor(C.textMuted)
    .text('Studio repertorio Bach con classe 3°', fx + 12, fy + 218, { lineBreak: false });

  // Note (textarea)
  doc
    .fillColor(C.textMuted)
    .font('Helvetica')
    .fontSize(10)
    .text('Note (opzionale)', fx, fy + 256, { lineBreak: false });
  doc
    .fillColor(C.card)
    .strokeColor(C.border)
    .lineWidth(0.8)
    .roundedRect(fx, fy + 272, fwid, 50, 6)
    .fillAndStroke(C.card, C.border);

  // Footer modal: pulsanti
  thinDivider(doc, mx + 24, my + mh - 64, mw - 48);
  // Pulsante secondario
  doc
    .fillColor(C.card)
    .strokeColor(C.border)
    .lineWidth(0.8)
    .roundedRect(mx + 24, my + mh - 48, 100, 32, 6)
    .fillAndStroke(C.card, C.border);
  doc
    .fillColor(C.text)
    .font('Helvetica')
    .fontSize(11)
    .text('Annulla', mx + 24, my + mh - 38, { width: 100, align: 'center', lineBreak: false });
  // Pulsante primario CLAY
  doc
    .fillColor(C.clay)
    .roundedRect(mx + mw - 158, my + mh - 48, 134, 32, 6)
    .fill();
  doc
    .fillColor(C.bg)
    .font('Helvetica-Bold')
    .fontSize(11)
    .text('Conferma prenotazione', mx + mw - 158, my + mh - 38, {
      width: 134,
      align: 'center',
      lineBreak: false,
    });

  footer(doc, 8, TOTAL);
}

// =============================================
// SLIDE 09 — Conflitti impossibili
// =============================================

function slideConflitti(doc) {
  bgFill(doc);
  slideTitle(doc, 'Doppie prenotazioni? Tecnicamente impossibili.', 'COME FUNZIONA · 3 livelli', {
    color: C.sage,
  });
  doc
    .fillColor(C.textMuted)
    .font('Helvetica')
    .fontSize(14)
    .text(
      'Tre layer indipendenti di protezione: anche se uno fallisce, gli altri tengono.',
      64,
      152,
      { lineBreak: false },
    );

  const layers = [
    {
      title: 'Interfaccia in tempo reale',
      body: 'Lo studente vede gli slot già occupati colorati. Non può nemmeno cliccare su uno slot in conflitto. La UI non mostra mai informazioni stale.',
      tone: C.dusty,
      soft: C.dustySoft,
    },
    {
      title: 'Validatore applicativo',
      body: 'La richiesta passa per una transazione SQL ad isolamento SERIALIZABLE: due prenotazioni concorrenti vengono ordinate, la seconda riceve un errore "BOOKING_CONFLICT".',
      tone: C.honey,
      soft: C.honeySoft,
    },
    {
      title: 'Vincolo a livello database',
      body: 'PostgreSQL ha un EXCLUDE constraint con btree_gist su (roomId, time-range). Anche con un bug applicativo, il database FISICAMENTE rifiuta la sovrapposizione.',
      tone: C.sage,
      soft: C.sageSoft,
    },
  ];

  let yy = 200;
  layers.forEach((l, i) => {
    softShadow(doc, 64, yy, W - 128, 110);
    card(doc, 64, yy, W - 128, 110);
    doc.fillColor(l.soft).rect(64, yy, 6, 110).fill();
    // Numero serif gigante
    doc
      .fillColor(l.tone)
      .font('Helvetica-Bold')
      .fontSize(46)
      .text(String(i + 1).padStart(2, '0'), 92, yy + 28, { lineBreak: false });
    // Titolo + body
    doc
      .fillColor(C.text)
      .font('Helvetica-Bold')
      .fontSize(20)
      .text(l.title, 196, yy + 26, { width: W - 280 });
    doc
      .fillColor(C.textMuted)
      .font('Helvetica')
      .fontSize(13)
      .text(l.body, 196, yy + 56, { width: W - 280, lineGap: 4 });
    yy += 130;
  });

  // Quote box scura
  const qy = yy + 6;
  card(doc, 64, qy, W - 128, 56, { fill: C.slateDeep, stroke: C.slateDeep });
  doc
    .fillColor(C.bg)
    .font('Helvetica-Oblique')
    .fontSize(15)
    .text(
      '"Anche con un errore di codice, il database stesso rifiuta la sovrapposizione. È il livello di sicurezza che usano le banche per i conti correnti."',
      88,
      qy + 18,
      { width: W - 176 },
    );

  footer(doc, 9, TOTAL, { color: C.sage });
}

// =============================================
// SLIDE 10 — Screen mockup: ANALYTICS DASHBOARD
// =============================================

function slideScreenAnalytics(doc) {
  bgFill(doc);
  slideTitle(doc, 'Statistiche di utilizzo', 'SCHERMATA · admin · decisioni informate');

  const fx = 64,
    fy = 175,
    fw = W - 128,
    fh = 480;
  softShadow(doc, fx, fy, fw, fh, 12);
  card(doc, fx, fy, fw, fh);

  // Browser bar
  doc.fillColor(C.borderSoft).rect(fx, fy, fw, 28).fill();
  doc
    .fillColor('#fa7268')
    .circle(fx + 16, fy + 14, 4)
    .fill();
  doc
    .fillColor('#febd2e')
    .circle(fx + 32, fy + 14, 4)
    .fill();
  doc
    .fillColor('#28c940')
    .circle(fx + 48, fy + 14, 4)
    .fill();
  doc
    .fillColor(C.card)
    .roundedRect(fx + 72, fy + 6, fw - 144, 16, 3)
    .fill();
  doc
    .fillColor(C.textSubtle)
    .font('Helvetica')
    .fontSize(8)
    .text('aulabook.tuo-conservatorio.it/admin/analytics', fx + 80, fy + 10, { lineBreak: false });

  // Inner content area
  const ix = fx + 24,
    iy = fy + 48,
    iw = fw - 48;

  // Title bar (titolo + range pill)
  doc
    .fillColor(C.text)
    .font('Helvetica-Bold')
    .fontSize(20)
    .text('Statistiche di utilizzo', ix, iy, { lineBreak: false });
  doc
    .fillColor(C.textMuted)
    .font('Helvetica')
    .fontSize(10)
    .text('Aula Book · report analytics', ix, iy + 28, { lineBreak: false });
  pill(doc, ix + iw - 200, iy + 4, '29 mar – 28 apr 2026', {
    fill: C.claySoft,
    color: C.clayDark,
    size: 10,
    padX: 12,
    padY: 6,
  });
  doc
    .fillColor(C.textSubtle)
    .font('Helvetica')
    .fontSize(8)
    .text('Generato il 28/04 · 16:08', ix + iw - 200, iy + 28, {
      width: 200,
      align: 'right',
      lineBreak: false,
    });

  // 4 KPI mini
  const ky = iy + 58,
    kgap = 12;
  const kw = (iw - kgap * 3) / 4,
    kh = 64;
  const kpis = [
    { v: '142', l: 'CONFERMATE', tone: C.sage, soft: C.sageSoft },
    { v: '12', l: 'AUTO-CANCELLATE', tone: C.honey, soft: C.honeySoft },
    { v: '7,8%', l: 'NO-SHOW RATE', tone: C.terracotta, soft: C.terraSoft },
    { v: '154', l: 'TOTALE CREATE', tone: C.dusty, soft: C.dustySoft },
  ];
  kpis.forEach((k, i) => {
    const x = ix + i * (kw + kgap);
    card(doc, x, ky, kw, kh);
    doc
      .fillColor(k.soft)
      .roundedRect(x + 10, ky + 14, 36, 36, 7)
      .fill();
    doc
      .fillColor(k.tone)
      .circle(x + 28, ky + 32, 6)
      .fill();
    doc
      .fillColor(C.textSubtle)
      .font('Helvetica')
      .fontSize(7)
      .text(k.l, x + 54, ky + 14, { width: kw - 64, characterSpacing: 0.4 });
    doc
      .fillColor(C.text)
      .font('Helvetica-Bold')
      .fontSize(20)
      .text(k.v, x + 54, ky + 26, { width: kw - 64, lineBreak: false });
  });

  // Heatmap card
  const hy = ky + kh + 16,
    hh = 200;
  card(doc, ix, hy, 580, hh);
  doc
    .fillColor(C.text)
    .font('Helvetica-Bold')
    .fontSize(15)
    .text('Heatmap occupazione (giorni × ore)', ix + 16, hy + 12, { lineBreak: false });
  doc
    .fillColor(C.textMuted)
    .font('Helvetica')
    .fontSize(9)
    .text('Tonalità intensa = più prenotazioni in quella fascia', ix + 16, hy + 32, {
      lineBreak: false,
    });
  miniHeatmap(doc, ix + 60, hy + 56, 504, 130);
  // Y labels giorni
  ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom'].forEach((d, i) => {
    doc
      .fillColor(C.textMuted)
      .font('Helvetica')
      .fontSize(8)
      .text(d, ix + 24, hy + 56 + i * (130 / 7) + 4, { lineBreak: false });
  });

  // Trend card
  const tx2 = ix + 596,
    tw2 = iw - 596,
    ty2 = hy,
    th2 = (hh - 16) / 2;
  card(doc, tx2, ty2, tw2, th2);
  doc
    .fillColor(C.text)
    .font('Helvetica-Bold')
    .fontSize(13)
    .text('Trend ultime 8 settimane', tx2 + 14, ty2 + 10, { lineBreak: false });
  miniTrend(doc, tx2 + 14, ty2 + 36, tw2 - 28, 50, [12, 18, 25, 22, 32, 38, 45, 52], C.clay);

  // Top rooms card
  const ty3 = ty2 + th2 + 16;
  card(doc, tx2, ty3, tw2, th2);
  doc
    .fillColor(C.text)
    .font('Helvetica-Bold')
    .fontSize(13)
    .text('Top aule', tx2 + 14, ty3 + 10, { lineBreak: false });
  miniBars(
    doc,
    tx2 + 14,
    ty3 + 30,
    [
      { label: 'Aula 102', value: 28 },
      { label: 'Sala 5', value: 24 },
      { label: 'Aula 101', value: 18 },
    ],
    tw2 - 130,
    C.dusty,
    16,
  );

  // Insight footer
  card(doc, ix, hy + hh + 14, iw, 38, { fill: C.claySoft, stroke: C.clay });
  doc
    .fillColor(C.clay)
    .font('Helvetica-Bold')
    .fontSize(9)
    .text('INSIGHT', ix + 14, hy + hh + 26, { characterSpacing: 1, lineBreak: false });
  doc
    .fillColor(C.text)
    .font('Helvetica')
    .fontSize(11)
    .text(
      '"L\'aula 102 è satura il martedì 14–17. È ora di un\'altra aula pianoforte?"',
      ix + 70,
      hy + hh + 24,
      { width: iw - 90, lineBreak: false },
    );

  footer(doc, 10, TOTAL);
}

// =============================================
// SLIDE 11 — I numeri di un anno
// =============================================

function slideNumeri(doc) {
  bgFill(doc);
  slideTitle(doc, 'I numeri di un anno.', 'IL CONTO DELLA SERVA', { color: C.clay });
  doc
    .fillColor(C.textMuted)
    .font('Helvetica')
    .fontSize(13)
    .text('Stima per istituto tipo: 50 aule, 1500 utenti, 200 giorni didattici.', 64, 152, {
      lineBreak: false,
    });

  const kpis = [
    {
      value: '-120h',
      label: 'Ore segreteria liberate / anno',
      sub: 'da 15 min al giorno persi al telefono',
      tone: C.sage,
      soft: C.sageSoft,
    },
    {
      value: '-100%',
      label: 'Doppie prenotazioni',
      sub: 'da 5–10 al mese, a zero',
      tone: C.terracotta,
      soft: C.terraSoft,
    },
    {
      value: '-80%',
      label: 'Carta stampata',
      sub: 'tabelloni digitali sostituiscono i fogli affissi',
      tone: C.honey,
      soft: C.honeySoft,
    },
    {
      value: '+30%',
      label: 'Utilizzo aule',
      sub: 'rendi visibili gli slot liberi che oggi nessuno conosce',
      tone: C.dusty,
      soft: C.dustySoft,
    },
  ];
  const colW = 280,
    gapX = 16;
  const startX = (W - (kpis.length * colW + (kpis.length - 1) * gapX)) / 2;
  const yy = 200;
  kpis.forEach((k, i) => {
    const x = startX + i * (colW + gapX);
    softShadow(doc, x, yy, colW, 290);
    card(doc, x, yy, colW, 290, { fill: k.soft, stroke: k.tone });
    doc
      .fillColor(k.tone)
      .font('Helvetica-Bold')
      .fontSize(72)
      .text(k.value, x + 24, yy + 36, { width: colW - 48, lineBreak: false });
    doc
      .fillColor(C.text)
      .font('Helvetica-Bold')
      .fontSize(14)
      .text(k.label, x + 24, yy + 150, { width: colW - 48, lineGap: 2 });
    doc
      .fillColor(C.textMuted)
      .font('Helvetica')
      .fontSize(11)
      .text(k.sub, x + 24, yy + 212, { width: colW - 48, lineGap: 3 });
  });

  // Calc box stile editorial
  card(doc, 64, 522, W - 128, 100, { fill: C.cardSoft, stroke: C.border });
  doc
    .fillColor(C.clay)
    .font('Helvetica-Bold')
    .fontSize(10)
    .text('IL CALCOLO', 88, 538, { characterSpacing: 1.4, lineBreak: false });
  doc
    .fillColor(C.text)
    .font('Helvetica-Oblique')
    .fontSize(15)
    .text('15 telefonate al giorno × 8 minuti × 200 giorni = 4 000 minuti = 67 ore.', 88, 558, {
      width: W - 176,
    });
  doc
    .fillColor(C.textMuted)
    .font('Helvetica')
    .fontSize(12)
    .text(
      'Aggiungi le ricerche manuali su Excel, le mail di chiarimento, le riunioni per risolvere i conflitti: si arriva facilmente alle 120 ore.',
      88,
      588,
      { width: W - 176, lineGap: 2 },
    );

  footer(doc, 11, TOTAL);
}

// =============================================
// SLIDE 12 — Screen mockup: DISPLAY KIOSK
// =============================================

function slideScreenKiosk(doc) {
  bgFill(doc);
  slideTitle(
    doc,
    'Tabelloni digitali pubblici',
    'SCHERMATA · /display · screenshot dal sistema reale',
  );

  // Cornice "monitor" (deep slate, come bezel di un display reale)
  const mx = 80,
    my = 175,
    mw = W - 160,
    mh = 480;
  card(doc, mx - 14, my - 14, mw + 28, mh + 28, {
    fill: C.slateDeep,
    stroke: C.slateDeep,
    radius: 18,
  });

  // Embed dello screenshot reale catturato via puppeteer.
  // Se il file esiste in scripts/screenshots/display.png lo usiamo, altrimenti
  // ricadiamo su un placeholder con istruzioni per generarlo.
  const screenshot = path.join(__dirname, 'screenshots', 'display.png');
  if (fs.existsSync(screenshot)) {
    // pdfkit scala automaticamente l'immagine alle dimensioni date
    doc.save();
    // Clip arrotondato per i bordi della "TV"
    doc.roundedRect(mx, my, mw, mh, 6).clip();
    doc.image(screenshot, mx, my, { width: mw, height: mh });
    doc.restore();
  } else {
    // Fallback: placeholder testuale (raro: lo script capture-screenshots.js
    // viene eseguito prima di generate-slides.js nel flusso standard).
    card(doc, mx, my, mw, mh, { fill: C.bg, stroke: C.bg, radius: 6 });
    doc
      .fillColor(C.textMuted)
      .font('Helvetica-Oblique')
      .fontSize(14)
      .text(
        'Screenshot non disponibile · esegui:\n  node scripts/capture-screenshots.js',
        mx,
        my + mh / 2 - 20,
        { width: mw, align: 'center' },
      );
  }

  // Caption sotto al monitor: chiarisce che è uno screenshot reale, non un mockup
  doc
    .fillColor(C.textMuted)
    .font('Helvetica-Oblique')
    .fontSize(11)
    .text(
      'Screenshot live della pagina /display servita dal backend Aula Book con dati reali del seed.',
      mx,
      my + mh + 24,
      { width: mw, align: 'center', lineBreak: false },
    );

  footer(doc, 12, TOTAL);
}

// =============================================
// SLIDE 13 — Sicurezza & SSO
// =============================================

function slideSicurezza(doc) {
  bgFill(doc);
  slideTitle(doc, 'Sicurezza e privacy, di default.', 'SSO · 2FA · AUDIT · GDPR', {
    color: C.sage,
  });
  doc
    .fillColor(C.textMuted)
    .font('Helvetica')
    .fontSize(14)
    .text('Login con account istituzionali. Audit completo. Conforme GDPR.', 64, 152, {
      lineBreak: false,
    });

  const features = [
    {
      title: 'Microsoft 365 / Google Workspace',
      body: "Login con l'account istituzionale già esistente. Niente password nuove da memorizzare. Compatibile con i piani EDU gratuiti.",
      tone: C.dusty,
      soft: C.dustySoft,
      icon: iconUsers,
    },
    {
      title: '2FA via email',
      body: 'Codice di verifica via email per gli admin. Forzato dopo 7 giorni di grazia. Recovery codes per gli scenari di emergenza.',
      tone: C.clay,
      soft: C.claySoft,
      icon: iconKey,
    },
    {
      title: 'Audit log completo',
      body: 'Ogni azione admin tracciata: chi, cosa, quando, da quale IP. 730 giorni di retention. Filtrabile e esportabile.',
      tone: C.honey,
      soft: C.honeySoft,
      icon: iconClipboard,
    },
    {
      title: 'Conforme GDPR',
      body: 'Export dati personali, cancellazione su richiesta, gestione consensi, sub-processor list. Pronto per il responsabile della protezione dati.',
      tone: C.sage,
      soft: C.sageSoft,
      icon: iconLock,
    },
  ];

  const colW = 560,
    rowH = 200,
    gapX = 32,
    gapY = 24;
  const startX = 64,
    startY = 200;
  features.forEach((f, i) => {
    const col = i % 2,
      row = Math.floor(i / 2);
    const x = startX + col * (colW + gapX);
    const y = startY + row * (rowH + gapY);
    softShadow(doc, x, y, colW, rowH);
    card(doc, x, y, colW, rowH);
    doc.fillColor(f.soft).rect(x, y, 6, rowH).fill();
    doc
      .fillColor(f.soft)
      .roundedRect(x + 28, y + 28, 56, 56, 12)
      .fill();
    f.icon(doc, x + 44, y + 44, 24, f.tone);
    doc
      .fillColor(C.text)
      .font('Helvetica-Bold')
      .fontSize(20)
      .text(f.title, x + 100, y + 32, { width: colW - 124 });
    doc
      .fillColor(C.textMuted)
      .font('Helvetica')
      .fontSize(13)
      .text(f.body, x + 100, y + 70, { width: colW - 124, lineGap: 4 });
  });

  footer(doc, 13, TOTAL, { color: C.sage });
}

// =============================================
// SLIDE 14 — Costi & infrastruttura
// =============================================

function slideCosti(doc) {
  bgFill(doc);
  slideTitle(doc, 'Quanto costa? Confronto provider reali.', 'INFRASTRUTTURA · prezzi 2025', {
    color: C.honey,
  });
  doc
    .fillColor(C.textMuted)
    .font('Helvetica')
    .fontSize(13)
    .text(
      'Listini pubblici dei principali provider VPS europei e americani · taglie Piccolo (< 1500 utenti) e Medio (1500–3000).',
      64,
      152,
      { lineBreak: false },
    );

  // ============================================================
  // CARD SINISTRA — Confronto provider (occupa il 60% di larghezza)
  // ============================================================
  const lx = 64,
    ly = 200,
    lw = 720,
    lh = 420;
  card(doc, lx, ly, lw, lh);
  doc
    .fillColor(C.honey)
    .font('Helvetica-Bold')
    .fontSize(11)
    .text('SETUP MINIMO · PROVIDER A CONFRONTO', lx + 24, ly + 20, {
      characterSpacing: 1.4,
      lineBreak: false,
    });
  doc
    .fillColor(C.text)
    .font('Helvetica-Bold')
    .fontSize(22)
    .text('Lo stesso software, scegli tu dove ospitarlo.', lx + 24, ly + 42, { lineBreak: false });

  // Specs box dei due tagli (riga sotto al titolo)
  doc
    .fillColor(C.cardSoft)
    .roundedRect(lx + 24, ly + 78, lw - 48, 38, 6)
    .fill();
  doc
    .fillColor(C.textMuted)
    .font('Helvetica')
    .fontSize(10)
    .text('PICCOLO', lx + 38, ly + 86, { characterSpacing: 1, lineBreak: false });
  doc
    .fillColor(C.text)
    .font('Helvetica-Bold')
    .fontSize(11)
    .text('2 vCPU · 4 GB RAM · 40–80 GB SSD', lx + 38, ly + 100, { lineBreak: false });
  doc
    .fillColor(C.textMuted)
    .font('Helvetica')
    .fontSize(10)
    .text('MEDIO', lx + 396, ly + 86, { characterSpacing: 1, lineBreak: false });
  doc
    .fillColor(C.text)
    .font('Helvetica-Bold')
    .fontSize(11)
    .text('4 vCPU · 8 GB RAM · 80–160 GB SSD', lx + 396, ly + 100, { lineBreak: false });

  // Header tabella
  const tx = lx + 24,
    ty = ly + 138;
  const colProvider = tx + 6;
  const colPiccolo = tx + 220;
  const colMedio = tx + 410;
  const colSede = tx + 600;
  doc
    .fillColor(C.textSubtle)
    .font('Helvetica-Bold')
    .fontSize(9)
    .text('PROVIDER', colProvider, ty, { characterSpacing: 0.8, lineBreak: false });
  doc.text('PICCOLO €/mese · €/anno', colPiccolo, ty, { characterSpacing: 0.6, lineBreak: false });
  doc.text('MEDIO €/mese · €/anno', colMedio, ty, { characterSpacing: 0.6, lineBreak: false });
  doc.text('SEDE', colSede, ty, { characterSpacing: 0.8, lineBreak: false });
  thinDivider(doc, tx, ty + 16, lw - 48);

  // Righe provider — prezzi pubblici 2025 (listino base, IVA esclusa)
  const providers = [
    {
      name: 'Hetzner Cloud',
      plan: 'CX22 / CX32',
      piccolo: '4 €',
      pAnno: '~48 €/anno',
      medio: '7 €',
      mAnno: '~84 €/anno',
      sede: 'DE',
      best: true,
    },
    {
      name: 'IONOS',
      plan: 'VPS Linux L / XL',
      piccolo: '5 €',
      pAnno: '~60 €/anno',
      medio: '10 €',
      mAnno: '~120 €/anno',
      sede: 'DE / IT',
    },
    {
      name: 'Aruba Cloud',
      plan: 'Cloud VPS Small / M',
      piccolo: '6 €',
      pAnno: '~72 €/anno',
      medio: '15 €',
      mAnno: '~180 €/anno',
      sede: 'IT',
    },
    {
      name: 'OVHcloud',
      plan: 'VPS Value / Comfort',
      piccolo: '7 €',
      pAnno: '~84 €/anno',
      medio: '18 €',
      mAnno: '~216 €/anno',
      sede: 'FR / IT',
    },
    {
      name: 'DigitalOcean',
      plan: 'Basic Premium',
      piccolo: '22 €',
      pAnno: '~264 €/anno',
      medio: '44 €',
      mAnno: '~528 €/anno',
      sede: 'US',
    },
  ];
  let ry = ty + 22;
  const rowH = 38;
  providers.forEach((p, i) => {
    if (p.best) {
      doc
        .fillColor(C.honeySoft)
        .roundedRect(tx, ry - 4, lw - 48, rowH, 4)
        .fill();
    } else if (i % 2 === 0) {
      doc
        .fillColor(C.cardSoft)
        .rect(tx, ry - 4, lw - 48, rowH)
        .fill();
    }
    // Nome + plan
    doc
      .fillColor(C.text)
      .font('Helvetica-Bold')
      .fontSize(11)
      .text(p.name, colProvider, ry + 2, { width: 200, lineBreak: false });
    doc
      .fillColor(C.textSubtle)
      .font('Helvetica')
      .fontSize(8)
      .text(p.plan, colProvider, ry + 16, { width: 200, lineBreak: false });
    // Piccolo
    doc
      .fillColor(C.text)
      .font('Helvetica-Bold')
      .fontSize(13)
      .text(p.piccolo + ' / mese', colPiccolo, ry + 2, { width: 180, lineBreak: false });
    doc
      .fillColor(C.textMuted)
      .font('Helvetica')
      .fontSize(9)
      .text(p.pAnno, colPiccolo, ry + 18, { width: 180, lineBreak: false });
    // Medio
    doc
      .fillColor(C.text)
      .font('Helvetica-Bold')
      .fontSize(13)
      .text(p.medio + ' / mese', colMedio, ry + 2, { width: 180, lineBreak: false });
    doc
      .fillColor(C.textMuted)
      .font('Helvetica')
      .fontSize(9)
      .text(p.mAnno, colMedio, ry + 18, { width: 180, lineBreak: false });
    // Sede + badge "best"
    doc
      .fillColor(C.textMuted)
      .font('Helvetica')
      .fontSize(10)
      .text(p.sede, colSede, ry + 8, { width: 80, lineBreak: false });
    if (p.best) {
      // Badge "TOP" senza stella (★ U+2605 non è in Helvetica WinAnsi).
      // Lo rendiamo come pill ambra contrastato per attirare l'occhio.
      doc
        .fillColor(C.honey)
        .roundedRect(colSede + 56, ry + 6, 38, 16, 8)
        .fill();
      doc
        .fillColor(C.bg)
        .font('Helvetica-Bold')
        .fontSize(8)
        .text('TOP', colSede + 56, ry + 10, { width: 38, align: 'center', lineBreak: false });
    }
    ry += rowH;
  });

  // Note in basso card
  doc
    .fillColor(C.textSubtle)
    .font('Helvetica-Oblique')
    .fontSize(9)
    .text(
      'Listino base IVA esclusa · IPv4 e snapshot inclusi sui provider EU · banda da 20 TB/mese inclusa per Piccolo e Medio.',
      tx,
      ly + lh - 30,
      { width: lw - 48, lineBreak: false },
    );

  // ============================================================
  // CARD DESTRA — Riepilogo Piccolo + Medio (40% di larghezza)
  // ============================================================
  const rx = lx + lw + 16,
    rw = W - 64 - rx,
    rh1 = 202,
    rh2 = 202;
  // PICCOLO
  card(doc, rx, ly, rw, rh1);
  doc
    .fillColor(C.sage)
    .font('Helvetica-Bold')
    .fontSize(10)
    .text('PICCOLO', rx + 20, ly + 18, { characterSpacing: 1.4, lineBreak: false });
  doc
    .fillColor(C.text)
    .font('Helvetica-Bold')
    .fontSize(22)
    .text('Conservatori fino a', rx + 20, ly + 36, { lineBreak: false });
  doc
    .fillColor(C.sage)
    .font('Helvetica-Bold')
    .fontSize(28)
    .text('1500 utenti', rx + 20, ly + 62, { lineBreak: false });
  // KPI piccolo
  const piccoloKpi = [
    ['Aule', '< 30'],
    ['Kiosk', '< 30'],
    ['VPS', '2 vCPU · 4 GB'],
  ];
  let py = ly + 108;
  piccoloKpi.forEach((k) => {
    doc
      .fillColor(C.textMuted)
      .font('Helvetica')
      .fontSize(11)
      .text(k[0], rx + 20, py, { width: 80, lineBreak: false });
    doc
      .fillColor(C.text)
      .font('Helvetica-Bold')
      .fontSize(11)
      .text(k[1], rx + 100, py, { width: rw - 120, lineBreak: false });
    py += 22;
  });
  // Range prezzo
  doc
    .fillColor(C.sageSoft)
    .roundedRect(rx + 20, ly + rh1 - 36, rw - 40, 24, 4)
    .fill();
  doc
    .fillColor(C.sage)
    .font('Helvetica-Bold')
    .fontSize(11)
    .text('A partire da ~48 €/anno', rx + 30, ly + rh1 - 31, { lineBreak: false });
  doc
    .fillColor(C.text)
    .font('Helvetica')
    .fontSize(10)
    .text('(Hetzner CX22)', rx + 30 + 160, ly + rh1 - 30, { lineBreak: false });

  // MEDIO
  const my = ly + rh1 + 16;
  card(doc, rx, my, rw, rh2);
  doc
    .fillColor(C.dusty)
    .font('Helvetica-Bold')
    .fontSize(10)
    .text('MEDIO', rx + 20, my + 18, { characterSpacing: 1.4, lineBreak: false });
  doc
    .fillColor(C.text)
    .font('Helvetica-Bold')
    .fontSize(22)
    .text('Conservatori', rx + 20, my + 36, { lineBreak: false });
  doc
    .fillColor(C.dusty)
    .font('Helvetica-Bold')
    .fontSize(28)
    .text('1500–3000 utenti', rx + 20, my + 62, { lineBreak: false });
  const medioKpi = [
    ['Aule', '30–60'],
    ['Kiosk', '30–60'],
    ['VPS', '4 vCPU · 8 GB'],
  ];
  let myy = my + 108;
  medioKpi.forEach((k) => {
    doc
      .fillColor(C.textMuted)
      .font('Helvetica')
      .fontSize(11)
      .text(k[0], rx + 20, myy, { width: 80, lineBreak: false });
    doc
      .fillColor(C.text)
      .font('Helvetica-Bold')
      .fontSize(11)
      .text(k[1], rx + 100, myy, { width: rw - 120, lineBreak: false });
    myy += 22;
  });
  doc
    .fillColor(C.dustySoft)
    .roundedRect(rx + 20, my + rh2 - 36, rw - 40, 24, 4)
    .fill();
  doc
    .fillColor(C.dusty)
    .font('Helvetica-Bold')
    .fontSize(11)
    .text('A partire da ~84 €/anno', rx + 30, my + rh2 - 31, { lineBreak: false });
  doc
    .fillColor(C.text)
    .font('Helvetica')
    .fontSize(10)
    .text('(Hetzner CX32)', rx + 30 + 160, my + rh2 - 30, { lineBreak: false });

  footer(doc, 14, TOTAL, { color: C.honey });
}

// =============================================
// SLIDE 15 — Integrazioni pronte
// =============================================

function slideIntegrazioni(doc) {
  bgFill(doc);
  slideTitle(doc, 'Si integra con quello che già hai.', 'INTEGRAZIONI');
  doc
    .fillColor(C.textMuted)
    .font('Helvetica')
    .fontSize(14)
    .text('Niente "isole digitali". Aula Book parla con i sistemi del conservatorio.', 64, 152, {
      lineBreak: false,
    });

  const integrations = [
    {
      title: 'Isidata',
      subtitle: 'Anagrafica studenti e docenti',
      body: 'Importazione XLSX/CSV con anteprima diff: vedi cosa cambia prima di applicare. Mai cancellati locali — soft-disable degli orfani. Fino a 5000 record per file.',
      tone: C.sage,
      soft: C.sageSoft,
      glyph: 'IS',
    },
    {
      title: 'Microsoft 365',
      subtitle: 'SSO + sync utenti',
      body: 'Login con Entra ID (Microsoft 365 A1 EDU gratuito). Sync anagrafica via Microsoft Graph. Mapping da gruppo a ruolo automatico.',
      tone: C.dusty,
      soft: C.dustySoft,
      glyph: 'MS',
    },
    {
      title: 'Google Workspace',
      subtitle: 'SSO + sync utenti',
      body: 'Login con account @cons-tuonome.edu.it (Workspace EDU Fundamentals gratuito). Sync via Admin SDK. Restrizione a un dominio specifico.',
      tone: C.terracotta,
      soft: C.terraSoft,
      glyph: 'G',
    },
    {
      title: 'Calendario iCal',
      subtitle: 'Outlook · Apple · Google Calendar',
      body: 'Ogni utente ha un link iCal personale: le sue prenotazioni appaiono nel calendario nativo del telefono. Aggiornamento automatico, niente import manuale.',
      tone: C.honey,
      soft: C.honeySoft,
      glyph: 'iC',
    },
  ];

  const colW = 560,
    rowH = 210,
    gapX = 32,
    gapY = 24;
  const startX = 64,
    startY = 200;
  integrations.forEach((it, i) => {
    const col = i % 2,
      row = Math.floor(i / 2);
    const x = startX + col * (colW + gapX);
    const y = startY + row * (rowH + gapY);
    softShadow(doc, x, y, colW, rowH);
    card(doc, x, y, colW, rowH);
    // Tile glyph
    doc
      .fillColor(it.soft)
      .roundedRect(x + 24, y + 24, 70, 70, 14)
      .fill();
    doc
      .fillColor(it.tone)
      .font('Helvetica-Bold')
      .fontSize(22)
      .text(it.glyph, x + 24, y + 48, { width: 70, align: 'center', lineBreak: false });
    // Title + subtitle
    doc
      .fillColor(C.text)
      .font('Helvetica-Bold')
      .fontSize(22)
      .text(it.title, x + 110, y + 28, { lineBreak: false });
    doc
      .fillColor(it.tone)
      .font('Helvetica-Bold')
      .fontSize(10)
      .text(it.subtitle.toUpperCase(), x + 110, y + 56, {
        characterSpacing: 0.8,
        lineBreak: false,
      });
    doc
      .fillColor(C.textMuted)
      .font('Helvetica')
      .fontSize(13)
      .text(it.body, x + 110, y + 80, { width: colW - 130, lineGap: 4 });
  });

  footer(doc, 15, TOTAL);
}

// =============================================
// SLIDE 16 — Closing
// =============================================

function slideClosing(doc) {
  bgFill(doc, C.slateDeep);

  // Cerchi decorativi
  doc.save();
  doc
    .fillColor(C.clay)
    .opacity(0.16)
    .circle(W - 200, 200, 280)
    .fill();
  doc
    .fillColor(C.honey)
    .opacity(0.1)
    .circle(220, H - 180, 320)
    .fill();
  doc.opacity(1).restore();

  logoMark(doc, 110, 110, 50, C.clay);
  doc
    .fillColor(C.bg)
    .font('Helvetica-Bold')
    .fontSize(28)
    .text('Aula Book', 156, 92, { lineBreak: false });
  doc
    .fillColor('#bdb6a8')
    .font('Helvetica')
    .fontSize(12)
    .text('Sistema di prenotazione aule per il conservatorio', 156, 130, { lineBreak: false });

  // Hero closing
  doc
    .fillColor(C.bg)
    .font('Helvetica-Bold')
    .fontSize(72)
    .text('Pronti a iniziare?', 110, 230, { lineBreak: false });
  doc
    .fillColor(C.clay)
    .font('Helvetica-Bold')
    .fontSize(64)
    .text('Mezza giornata di setup.', 110, 320, { lineBreak: false });
  doc
    .fillColor(C.bg)
    .font('Helvetica-Bold')
    .fontSize(64)
    .text('Risultati dal primo giorno.', 110, 396, { lineBreak: false });

  const finalPoints = [
    'Open-source, self-hostable',
    'Dati sempre nel vostro server',
    'Roadmap aperta — feature richieste valutate caso per caso',
  ];
  let yy = 510;
  finalPoints.forEach((p) => {
    doc
      .fillColor(C.clay)
      .circle(126, yy + 7, 4)
      .fill();
    doc.fillColor('#bdb6a8').font('Helvetica').fontSize(15).text(p, 144, yy, { lineBreak: false });
    yy += 28;
  });

  doc
    .font('Helvetica')
    .fontSize(10)
    .fillColor('#7e776a')
    .text(
      'Aula Book · ' +
        new Date().toLocaleDateString('it-IT', { year: 'numeric', month: 'long', day: 'numeric' }),
      48,
      H - 36,
      { lineBreak: false },
    );
}

// =============================================
// MAIN
// =============================================

function generate() {
  const out = path.join(__dirname, '..', '..', 'docs', 'slides-presentazione.pdf');
  fs.mkdirSync(path.dirname(out), { recursive: true });

  const doc = new PDFDocument({
    size: [W, H],
    margin: 0,
    info: {
      Title: 'Aula Book — Presentazione per direttori',
      Author: 'Aula Book',
      Subject: 'Sistema di prenotazione aule per il conservatorio',
      Keywords: 'aulabook, conservatorio, prenotazione, presentazione',
    },
  });
  const stream = fs.createWriteStream(out);
  doc.pipe(stream);

  const slides = [
    slideCover,
    slideProblema,
    slideSoluzione,
    slideScreenDashboard,
    slidePrima,
    slideDopo,
    slideScreenWeekly,
    slideScreenForm,
    slideConflitti,
    slideScreenAnalytics,
    slideNumeri,
    slideScreenKiosk,
    slideSicurezza,
    slideCosti,
    slideIntegrazioni,
    slideClosing,
  ];

  slides.forEach((slideFn, i) => {
    if (i > 0) doc.addPage({ size: [W, H], margin: 0 });
    slideFn(doc);
  });

  doc.end();
  return new Promise((resolve, reject) => {
    stream.on('finish', () => resolve(out));
    stream.on('error', reject);
  });
}

if (require.main === module) {
  generate().then((out) => {
    const stat = fs.statSync(out);
    console.log(`✓ ${out} generato (${(stat.size / 1024).toFixed(1)} KB · 16 slide)`);
  });
}

module.exports = { generate };
