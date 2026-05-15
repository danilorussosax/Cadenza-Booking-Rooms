'use strict';

/**
 * build-manual-html.js
 *
 * Genera `docs/MANUALE_ADMIN.html` — versione impaginata A4 di
 * `docs/MANUALE_ADMIN.md`. Il file è self-contained (CSS embedded, niente
 * asset esterni a parte gli screenshot relativi a `screenshots/...`).
 *
 * Uso:
 *   node backend/scripts/build-manual-html.js
 *   open docs/MANUALE_ADMIN.html
 *   # poi Cmd+P → Salva come PDF (formato A4 già configurato in @page)
 *
 * Convertitore Markdown → HTML in-house (zero deps): copre il subset
 * effettivamente usato dal manuale (heading 1-4, tabelle GFM, code fences,
 * blockquote, liste -/numerate, hr, bold/italic, inline code, link, img).
 *
 * Layout A4: @page con margini 18/22mm, header con titolo manuale, footer
 * con numerazione "n / N". Capitoli (h2) iniziano in nuova pagina.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const SRC = path.join(ROOT, 'docs', 'MANUALE_ADMIN.md');
const OUT = path.join(ROOT, 'docs', 'MANUALE_ADMIN.html');

// ──────────────────────────────────────────────────────────────────────────
// Markdown → HTML
// ──────────────────────────────────────────────────────────────────────────

function escapeHtml(s) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function inline(text) {
  // L'ordine conta: prima inline code (toglie i delimitatori `…`), poi link,
  // poi bold (** preferito su *), poi italic (* singolo).
  let out = '';
  // Replace `inline code` first via placeholder per evitare interpretazioni interne.
  const codes = [];
  text = text.replace(/`([^`\n]+)`/g, (_, c) => {
    codes.push(c);
    return `C${codes.length - 1}`;
  });

  // Image ![alt](src)
  text = text.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g, (_, alt, src, title) => {
    const t = title ? ` title="${escapeHtml(title)}"` : '';
    return `<img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}"${t}>`;
  });

  // Link [text](url)
  text = text.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g, (_, txt, url, title) => {
    const t = title ? ` title="${escapeHtml(title)}"` : '';
    return `<a href="${escapeHtml(url)}"${t}>${inlineNonLink(txt)}</a>`;
  });

  // Bold / italic: applicati DOPO i link per non interferire con [..](..).
  text = inlineNonLink(text);

  // Restore inline code. I `\x01` (SOH) prima e dopo `C<n>` sono delimitatori intenzionali (chars di controllo improbabili nei manuali â niente collisioni con `C12` legittimi).
  // eslint-disable-next-line no-control-regex
  text = text.replace(/C(\d+)/g, (_, n) => `<code>${escapeHtml(codes[Number(n)])}</code>`);

  out += text;
  return out;
}

function inlineNonLink(text) {
  // Bold **text**
  text = text.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  // Italic *text* (non preceduto da spazio*spazio per evitare list-bullet ambiguity)
  text = text.replace(/(^|[\s(])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  // Strike ~~text~~
  text = text.replace(/~~([^~\n]+)~~/g, '<s>$1</s>');
  return text;
}

function escapeForCode(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Tokenizer block-level. Lavora su array di linee, emette HTML.
 */
function blockify(md) {
  const lines = md.split(/\r?\n/);
  const out = [];
  let i = 0;

  function flushParagraph(buf) {
    const txt = buf.join(' ').trim();
    if (txt) out.push(`<p>${inline(txt)}</p>`);
  }

  while (i < lines.length) {
    const line = lines[i];

    // Code fence
    const fence = line.match(/^```\s*(\w+)?\s*$/);
    if (fence) {
      const lang = fence[1] || '';
      const code = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) {
        code.push(lines[i]);
        i++;
      }
      i++; // skip closing ```
      out.push(
        `<pre class="lang-${escapeHtml(lang)}"><code>${escapeForCode(code.join('\n'))}</code></pre>`,
      );
      continue;
    }

    // Horizontal rule
    if (/^\s*---+\s*$/.test(line)) {
      out.push('<hr>');
      i++;
      continue;
    }

    // Heading ATX
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      const level = h[1].length;
      const txt = h[2].replace(/\s+#+\s*$/, '').trim();
      const id = txt
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
      out.push(`<h${level} id="${id}">${inline(txt)}</h${level}>`);
      i++;
      continue;
    }

    // Blockquote
    if (/^>\s?/.test(line)) {
      const buf = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        buf.push(lines[i].replace(/^>\s?/, ''));
        i++;
      }
      out.push(`<blockquote>${blockify(buf.join('\n'))}</blockquote>`);
      continue;
    }

    // Table (GFM): header row + separator row + body rows
    if (
      /^\|.*\|\s*$/.test(line) &&
      i + 1 < lines.length &&
      /^\|[\s|:-]+\|\s*$/.test(lines[i + 1])
    ) {
      const header = splitRow(line);
      const sep = splitRow(lines[i + 1]);
      const aligns = sep.map((s) => {
        const t = s.trim();
        if (/^:.+:$/.test(t)) return 'center';
        if (/:$/.test(t)) return 'right';
        if (/^:/.test(t)) return 'left';
        return null;
      });
      i += 2;
      const body = [];
      while (i < lines.length && /^\|.*\|\s*$/.test(lines[i])) {
        body.push(splitRow(lines[i]));
        i++;
      }
      out.push(renderTable(header, aligns, body));
      continue;
    }

    // Lists: -, *, + (unordered) and 1. 2. (ordered)
    if (/^\s*([-*+]|\d+\.)\s+/.test(line)) {
      const ordered = /^\s*\d+\./.test(line);
      const tag = ordered ? 'ol' : 'ul';
      const items = [];
      let cur = null;
      while (i < lines.length) {
        const l = lines[i];
        const m = l.match(/^\s*(?:[-*+]|\d+\.)\s+(.*)$/);
        if (m) {
          if (cur) items.push(cur);
          cur = [m[1]];
          i++;
        } else if (/^\s+\S/.test(l) && cur) {
          // continuation line (4+ spaces or indented)
          cur.push(l.replace(/^\s+/, ''));
          i++;
        } else if (
          l.trim() === '' &&
          i + 1 < lines.length &&
          /^\s*([-*+]|\d+\.)\s+/.test(lines[i + 1])
        ) {
          // blank line between items: keep going
          i++;
        } else {
          break;
        }
      }
      if (cur) items.push(cur);
      const lis = items
        .map((parts) => {
          const text = parts.join(' ').trim();
          return `<li>${inline(text)}</li>`;
        })
        .join('');
      out.push(`<${tag}>${lis}</${tag}>`);
      continue;
    }

    // Blank line
    if (/^\s*$/.test(line)) {
      i++;
      continue;
    }

    // Paragraph: gather until blank/heading/list/etc.
    const buf = [];
    while (
      i < lines.length &&
      !/^\s*$/.test(lines[i]) &&
      !isBlockBoundary(lines[i], lines[i + 1])
    ) {
      buf.push(lines[i]);
      i++;
    }
    flushParagraph(buf);
  }

  return out.join('\n');
}

function isBlockBoundary(line, next) {
  if (/^#{1,6}\s/.test(line)) return true;
  if (/^```/.test(line)) return true;
  if (/^>\s?/.test(line)) return true;
  if (/^\s*---+\s*$/.test(line)) return true;
  if (/^\s*([-*+]|\d+\.)\s+/.test(line)) return true;
  if (/^\|.*\|\s*$/.test(line) && next && /^\|[\s|:-]+\|\s*$/.test(next)) return true;
  return false;
}

function splitRow(line) {
  // Strip leading/trailing pipes and split. Cells are trimmed.
  return line
    .replace(/^\s*\|/, '')
    .replace(/\|\s*$/, '')
    .split('|')
    .map((c) => c.trim());
}

function renderTable(header, aligns, body) {
  const th = header
    .map((c, j) => {
      const a = aligns[j] ? ` style="text-align:${aligns[j]}"` : '';
      return `<th${a}>${inline(c)}</th>`;
    })
    .join('');
  const trs = body
    .map((row) => {
      const tds = row
        .map((c, j) => {
          const a = aligns[j] ? ` style="text-align:${aligns[j]}"` : '';
          return `<td${a}>${inline(c)}</td>`;
        })
        .join('');
      return `<tr>${tds}</tr>`;
    })
    .join('');
  return `<table><thead><tr>${th}</tr></thead><tbody>${trs}</tbody></table>`;
}

// ──────────────────────────────────────────────────────────────────────────
// HTML wrapper + CSS A4
// ──────────────────────────────────────────────────────────────────────────

const CSS = `
:root {
  --ink: #1c1f26;
  --ink-soft: #4a4f5a;
  --line: #d8dbe2;
  --rule: #2a2f3a;
  --code-bg: #f4f5f8;
  --code-ink: #2a2f3a;
  --accent: #8b6f3f;
  --quote-bg: #faf7f1;
  --quote-bar: #b9985a;
}

@page {
  size: A4;
  margin: 22mm 18mm 22mm 18mm;
  @top-left  { content: "Cadenza · Manuale Amministratore v1.2"; font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 8.5pt; color: #6b7080; }
  @top-right { content: "1 maggio 2026"; font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 8.5pt; color: #6b7080; }
  @bottom-center { content: counter(page) " / " counter(pages); font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 9pt; color: #6b7080; }
}
@page :first {
  @top-left  { content: ""; }
  @top-right { content: ""; }
  @bottom-center { content: ""; }
}

* { box-sizing: border-box; }

html, body {
  margin: 0;
  padding: 0;
  font-family: 'Helvetica Neue', 'Inter', Arial, sans-serif;
  font-size: 10pt;
  line-height: 1.45;
  color: var(--ink);
  background: white;
}

/* Cover */
.cover {
  break-after: page;
  page-break-after: always;
  min-height: calc(100vh - 0px);
  display: flex;
  flex-direction: column;
  justify-content: center;
  padding: 0;
}
.cover h1 {
  font-size: 32pt;
  font-weight: 700;
  margin: 0 0 8pt 0;
  letter-spacing: -0.5pt;
  border: none;
}
.cover .sub {
  font-size: 14pt;
  color: var(--ink-soft);
  margin: 0 0 24pt 0;
  font-style: italic;
}
.cover .meta {
  font-size: 10pt;
  color: var(--ink-soft);
  border-top: 1pt solid var(--line);
  padding-top: 12pt;
  margin-top: 24pt;
  line-height: 1.7;
}
.cover .meta strong { color: var(--ink); }

/* Headings */
h1, h2, h3, h4, h5, h6 {
  font-family: 'Helvetica Neue', 'Inter', Arial, sans-serif;
  color: var(--ink);
  line-height: 1.25;
  margin: 16pt 0 8pt 0;
  page-break-after: avoid;
}
h1 { font-size: 22pt; font-weight: 700; border-bottom: 1.5pt solid var(--rule); padding-bottom: 4pt; }
h2 {
  font-size: 16pt;
  font-weight: 700;
  margin-top: 0;
  padding-top: 0;
  border-bottom: 1pt solid var(--line);
  padding-bottom: 3pt;
  /* Capitolo nuovo = nuova pagina */
  page-break-before: always;
  break-before: page;
}
h3 { font-size: 12.5pt; font-weight: 700; margin-top: 14pt; color: var(--accent); }
h4 { font-size: 11pt; font-weight: 700; margin-top: 12pt; }

/* Toglie page-break dal primo h2 dopo la cover (l'indice non è un capitolo numerato) */
section.front h2 { page-break-before: auto; break-before: auto; }

/* Paragrafi e spaziatura base */
p { margin: 0 0 6pt 0; orphans: 3; widows: 3; }

/* Liste */
ul, ol { margin: 4pt 0 8pt 0; padding-left: 18pt; }
li { margin: 2pt 0; }
li > p { margin: 0; }

/* Link */
a { color: #2c5d8a; text-decoration: none; }
a:hover { text-decoration: underline; }

/* Code */
code {
  font-family: 'SF Mono', 'Menlo', 'Consolas', monospace;
  font-size: 8.8pt;
  background: var(--code-bg);
  padding: 1pt 3pt;
  border-radius: 2pt;
  color: var(--code-ink);
  word-break: break-word;
}
pre {
  background: var(--code-bg);
  border: 0.5pt solid var(--line);
  border-radius: 3pt;
  padding: 8pt 10pt;
  margin: 6pt 0 10pt 0;
  font-family: 'SF Mono', 'Menlo', 'Consolas', monospace;
  font-size: 8.4pt;
  line-height: 1.4;
  color: var(--code-ink);
  overflow-x: visible;
  white-space: pre-wrap;
  word-break: break-word;
  page-break-inside: avoid;
  break-inside: avoid;
}
pre code { background: transparent; padding: 0; font-size: inherit; border-radius: 0; }

/* Blockquote */
blockquote {
  border-left: 2pt solid var(--quote-bar);
  background: var(--quote-bg);
  padding: 6pt 10pt;
  margin: 6pt 0 10pt 0;
  color: var(--ink);
  border-radius: 0 3pt 3pt 0;
  page-break-inside: avoid;
  break-inside: avoid;
}
blockquote > :last-child { margin-bottom: 0; }

/* Tabelle */
table {
  width: 100%;
  border-collapse: collapse;
  margin: 6pt 0 12pt 0;
  font-size: 9pt;
  page-break-inside: auto;
  break-inside: auto;
}
thead { display: table-header-group; }
tr { page-break-inside: avoid; break-inside: avoid; }
th, td {
  border: 0.4pt solid var(--line);
  padding: 4pt 6pt;
  text-align: left;
  vertical-align: top;
  word-break: break-word;
}
th {
  background: #f1eee5;
  font-weight: 700;
  color: var(--ink);
  page-break-after: avoid;
}
tbody tr:nth-child(even) { background: #fafaf7; }

/* Hr */
hr {
  border: 0;
  border-top: 0.7pt solid var(--line);
  margin: 14pt 0;
}

/* Immagini (screenshots) */
img {
  max-width: 100%;
  height: auto;
  display: block;
  margin: 8pt auto;
  border: 0.5pt solid var(--line);
  border-radius: 3pt;
  page-break-inside: avoid;
}

/* Indice manuale (lista numerata in cima al doc) */
section.toc ol {
  list-style: decimal;
  padding-left: 20pt;
}
section.toc ol li { margin: 3pt 0; }

/* Visualizzazione su schermo (browser) ─ niente di patologico */
@media screen {
  html { background: #ececec; }
  body {
    max-width: 210mm;
    margin: 16mm auto;
    padding: 22mm 18mm;
    box-shadow: 0 1px 3px rgba(0,0,0,0.08), 0 8px 24px rgba(0,0,0,0.06);
    background: white;
  }
  .cover { min-height: 240mm; }
}
`;

function buildHtml(bodyHtml) {
  // Estrae il primo h1 + paragrafo seguente per la cover, e marca come "front"
  // l'indice (la lista numerata appena dopo l'h1) per non page-break-arsi.
  return `<!DOCTYPE html>
<html lang="it">
<head>
<meta charset="utf-8">
<title>Cadenza · Manuale Amministratore v1.2 — A4</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>${CSS}</style>
</head>
<body>
<div class="cover">
  <h1>Cadenza<br><small style="font-size:18pt; font-weight:400; color:var(--ink-soft);">Manuale Amministratore</small></h1>
  <div class="sub">Sistema di gestione e prenotazione aule per Conservatorio musicale</div>
  <div class="meta">
    <strong>Versione</strong>: 1.2 · <strong>Data</strong>: 1 maggio 2026 · <strong>Lingua</strong>: italiano<br>
    <strong>Destinatari</strong>: Direttori, DSGA, responsabili IT e coordinatori didattici dei Conservatori<br>
    <strong>Prerequisiti</strong>: account con ruolo <code>admin</code> su una installazione Cadenza già provisionata<br><br>
    <em>Documento generato automaticamente da</em> <code>backend/scripts/build-manual-html.js</code><br>
    <em>per stampa A4 — apri in browser e usa Stampa → Salva come PDF</em>
  </div>
</div>
<section class="front">
${bodyHtml}
</section>
</body>
</html>`;
}

// ──────────────────────────────────────────────────────────────────────────
// Main
// ──────────────────────────────────────────────────────────────────────────

function main() {
  if (!fs.existsSync(SRC)) {
    console.error(`✗ Sorgente non trovato: ${SRC}`);
    process.exit(1);
  }
  let md = fs.readFileSync(SRC, 'utf8');

  // 1) Strip YAML frontmatter (--- ... ---) all'inizio del file: contiene
  //    metadati pandoc (papersize, geometry, header-includes…) che non
  //    devono finire nell'HTML — il wrapper definisce il proprio CSS A4.
  md = md.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '');

  // 2) Strip HTML comment iniziale (note di build sul layout A4) e <style>
  //    inline (anch'esso solo per stampa MD-native): il wrapper ha già
  //    una stylesheet completa.
  md = md.replace(/^\s*<!--[\s\S]*?-->\s*/m, '');
  md = md.replace(/<style[\s\S]*?<\/style>\s*/i, '');

  // 3) Rimuovi l'h1 + il blockquote di intestazione iniziali — già in cover.
  md = md.replace(/^# Cadenza · Manuale Amministratore[\s\S]*?(?=\n## |$)/, '');

  const bodyHtml = blockify(md);
  const html = buildHtml(bodyHtml);
  fs.writeFileSync(OUT, html, 'utf8');
  const kb = (Buffer.byteLength(html, 'utf8') / 1024).toFixed(1);
  console.log(`✓ Generato ${path.relative(ROOT, OUT)} (${kb} KB)`);
  console.log('  Apri nel browser e usa Cmd+P → Salva come PDF (formato A4 già configurato).');
}

main();
