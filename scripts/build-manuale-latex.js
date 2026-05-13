#!/usr/bin/env node
'use strict';

/**
 * build-manuale-latex.js
 *
 * Converte docs/MANUALE_ADMIN.md → docs/MANUALE_ADMIN.tex senza dipendenze
 * esterne. Pensato per il manuale Cadenza, non un convertitore generico.
 *
 * Uso:
 *   node scripts/build-manuale-latex.js
 *   node scripts/build-manuale-latex.js --input docs/MANUALE_ADMIN.md --output docs/MANUALE_ADMIN.tex
 *
 * Per la compilazione finale a PDF è richiesto un toolchain LaTeX (xelatex
 * consigliato per il supporto Unicode/emoji). Istruzioni in docs/screenshots/README.md.
 */

const fs = require('fs');
const path = require('path');

// ----- CLI args -----
const args = process.argv.slice(2);
function flag(name, fallback) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
}
const inputPath = path.resolve(
  flag('--input', path.join(__dirname, '..', 'docs', 'MANUALE_ADMIN.md')),
);
const outputPath = path.resolve(
  flag('--output', path.join(__dirname, '..', 'docs', 'MANUALE_ADMIN.tex')),
);

// ----- Lettura -----
const raw = fs.readFileSync(inputPath, 'utf8');

// ----- 1) Strip YAML frontmatter (lo sostituiamo con un preambolo LaTeX nostro) -----
let body = raw;
if (body.startsWith('---')) {
  const end = body.indexOf('\n---', 3);
  if (end > 0) {
    body = body.slice(end + 4).replace(/^\s*\n/, '');
  }
}

// ----- 2) Rimuoviamo il blocco <style>...</style> destinato al rendering HTML -----
body = body.replace(/<style>[\s\S]*?<\/style>/g, '');

// ----- 3) Utility di escape per LaTeX -----
// Caratteri speciali da neutralizzare quando appaiono in testo "normale".
// & % $ # _ { } ~ ^ \  oltre a < > che non sono problematici ma più sicuri.
function escapeLatex(s) {
  return s
    .replace(/\\/g, '\\textbackslash{}')
    .replace(/([&%$#_{}])/g, '\\$1')
    .replace(/~/g, '\\textasciitilde{}')
    .replace(/\^/g, '\\textasciicircum{}')
    .replace(/</g, '\\textless{}')
    .replace(/>/g, '\\textgreater{}');
}

// Sostituisce gli emoji più comuni del manuale con simboli "stampabili"
// (\faXxx richiederebbe fontawesome; preferiamo testo neutro).
const EMOJI_MAP = {
  '⭐': '\\textbf{[!]}',
  '✓': '\\checkmark{}',
  '✗': '\\texttimes{}',
  '✎': '\\textit{mod.}',
  '🗑': '\\textit{canc.}',
  '📄': '\\textit{PDF}',
  '📤': '\\textit{invia}',
  '⚠': '\\textbf{!}',
  'ⓘ': '\\textbf{i}',
  '🔄': '\\textit{(ricarica)}',
  '✅': '\\textcolor{green!60!black}{\\checkmark{}}',
  '❌': '\\textcolor{red}{$\\times$}',
  '🤖': '',
  '🎵': '',
  '🎻': '',
  '📺': '',
  '📢': '',
  '✉️': '',
  '🔒': '',
  '🔐': '',
  '🌍': '',
  '♿': '',
  '📱': '',
  '📥': '',
  '📊': '',
  '🤝': '',
  '🟢': '\\textcolor{green!60!black}{$\\bullet$}',
  '🟡': '\\textcolor{yellow!70!black}{$\\bullet$}',
  '🟠': '\\textcolor{orange}{$\\bullet$}',
  '🔴': '\\textcolor{red}{$\\bullet$}',
  '🔵': '\\textcolor{blue}{$\\bullet$}',
  '⇄': '$\\leftrightarrow$',
  '→': '$\\rightarrow$',
  '←': '$\\leftarrow$',
  '↻': '\\textit{(ricarica)}',
  '⤒': '$\\uparrow$',
  '⋮': '\\textbf{:}',
  '—': '---',
  '–': '--',
  '…': '\\ldots{}',
  '≤': '$\\leq$',
  '≥': '$\\geq$',
  '€': '\\euro{}',
};
function replaceEmojis(s) {
  for (const [k, v] of Object.entries(EMOJI_MAP)) {
    s = s.split(k).join(v);
  }
  return s;
}

// ----- 4) Parsing line-by-line con state machine -----
const lines = body.split('\n');
const out = [];

// Stato corrente
let i = 0;
const N = lines.length;

function rtrim(s) {
  return s.replace(/\s+$/, '');
}

// Converte gli inline Markdown comuni → LaTeX
// (bold, italic, code, link, image inline). Va chiamata dopo aver fatto
// escapeLatex sulla parte di testo non-inline.
//
// Strategia: cerco i token con regex, splitto la stringa in segmenti,
// applico escapeLatex sui segmenti "letterali" e renderizzo gli inline.
function renderInline(text, sharedTokens) {
  // Tokenizzatore semplice. Ordine: code, image, link, bold, italic.
  // I token vengono sostituiti con placeholder e poi rimessi al posto giusto
  // dopo l'escape.
  //
  // `sharedTokens` permette ai livelli ricorsivi (bold/italic che a loro volta
  // contengono inline code/link) di lavorare sullo stesso indice di placeholder
  // del livello esterno: senza questo, `\\texttt{...}` dentro `**bold**` si
  // perderebbe perché l'indice del child non corrisponde più all'array padre.
  const tokens = sharedTokens || [];
  // Pre-step: gli "escape Markdown" (\\*  \\_  \\#  \\[  …) devono diventare
  // il carattere letterale prima del nostro escapeLatex (che vedrebbe il \\
  // come backslash da escapare). Usiamo un placeholder neutro temporaneo
  // così che il successivo renderInline non lo reinterpreti come token Markdown.
  let s = text.replace(/\\([*_`#\[\]()<>|!~+\-.\\])/g, (_, c) => {
    const ph = `\x00ESC${tokens.length}\x00`;
    tokens.push(escapeLatex(c));
    return ph;
  });

  function pushTok(rendered) {
    const ph = `\x00TOK${tokens.length}\x00`;
    tokens.push(rendered);
    return ph;
  }

  // Code inline `…`
  s = s.replace(/`([^`]+)`/g, (_, code) => pushTok(`\\texttt{${escapeLatex(code)}}`));

  // Image  ![alt](path)
  s = s.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_, alt, src) => {
    const safeSrc = src.replace(/^\.\//, '');
    const altText = escapeLatex(alt);
    return pushTok(
      `\\begin{figure}[H]\\centering\\includegraphics[width=0.95\\linewidth]{${safeSrc}}\\caption*{${altText}}\\end{figure}`,
    );
  });

  // Link [text](url)
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, url) => {
    return pushTok(`\\href{${url.replace(/#/g, '\\#').replace(/%/g, '\\%')}}{${escapeLatex(label)}}`);
  });

  // Bold **text**  e __text__
  s = s.replace(/\*\*([^*]+)\*\*/g, (_, t) => pushTok(`\\textbf{${renderInline(t, tokens)}}`));

  // Italic *text*  (evita di matchare doppi che già sono bold)
  s = s.replace(/(?<![*\w])\*([^*\n]+)\*(?!\*)/g, (_, t) =>
    pushTok(`\\textit{${renderInline(t, tokens)}}`),
  );
  // Italic _text_  (sintassi alternativa Markdown). Lookbehind/lookahead
  // zero-width per evitare di scambiare gli `_` interni a nomi file
  // (AUDIT_QUALITA_…) e per permettere match consecutivi sulla stessa stringa.
  s = s.replace(/(?<=^|[\s(])_([^\n_]+)_(?=$|[\s.,:;!?)])/g, (_, t) =>
    pushTok(`\\textit{${escapeLatex(t)}}`),
  );

  // Ora s contiene placeholder + testo "puro" che va escapato.
  // Suddivido per placeholder (sia TOK che ESC condividono lo stesso array
  // `tokens` indicizzato in sequenza, ma usiamo prefissi diversi solo per
  // chiarezza di intent — il numero è univoco).
  let out = s
    .split(/\x00(?:TOK|ESC)(\d+)\x00/)
    .map((seg, idx) => {
      if (idx % 2 === 1) return tokens[Number(seg)];
      return replaceEmojis(escapeLatex(seg));
    })
    .join('');
  // Secondo pass: espande placeholder annidati dentro stringhe già emesse
  // da altri pushTok (caso italic/bold ricorsivi). Max 5 passi di sicurezza.
  for (let pass = 0; pass < 5 && /\x00(TOK|ESC)\d+\x00/.test(out); pass++) {
    out = out.replace(/\x00(?:TOK|ESC)(\d+)\x00/g, (_, n) => tokens[Number(n)] ?? '');
  }
  return out;
}

// Helper: heading
function heading(level, text) {
  const inline = renderInline(text);
  if (level === 1) return `\\section*{${inline}}\n\\addcontentsline{toc}{section}{${inline}}\n`;
  if (level === 2) return `\\section{${inline}}\n`;
  if (level === 3) return `\\subsection{${inline}}\n`;
  if (level === 4) return `\\subsubsection{${inline}}\n`;
  if (level === 5) return `\\paragraph{${inline}}\n`;
  return `\\paragraph{${inline}}\n`;
}

// ----- Helper: parse Markdown table from current line, return LaTeX + new index -----
function tryParseTable(start) {
  // Una tabella Markdown qui è del tipo:
  // | A | B |
  // | --- | --- |
  // | 1 | 2 |
  if (!/^\s*\|/.test(lines[start])) return null;
  if (!/^\s*\|[\s:|-]+\|\s*$/.test(lines[start + 1] || '')) return null;

  const rows = [];
  let j = start;
  while (j < N && /^\s*\|/.test(lines[j])) {
    const row = lines[j]
      .trim()
      .replace(/^\|/, '')
      .replace(/\|$/, '')
      .split('|')
      .map((c) => c.trim());
    rows.push(row);
    j++;
  }
  if (rows.length < 2) return null;
  const header = rows[0];
  const data = rows.slice(2); // riga 1 è il separatore --- | --- | ...
  const ncols = header.length;
  // Usa tabularx per impacchettare colonne larghe in modo automatico.
  const colSpec = '|' + Array.from({ length: ncols }, () => 'X|').join('');
  const renderRow = (r) =>
    r
      .map((c) => renderInline(c).replace(/\n/g, ' '))
      .concat(Array.from({ length: Math.max(0, ncols - r.length) }, () => ''))
      .slice(0, ncols)
      .join(' & ') + ' \\\\';

  const out = [];
  out.push('\\begin{table}[H]');
  out.push('\\centering');
  out.push('\\small');
  out.push(`\\begin{tabularx}{\\linewidth}{${colSpec}}`);
  out.push('\\hline');
  out.push('\\rowcolor{tableheader} ' + renderRow(header));
  out.push('\\hline');
  for (const r of data) {
    out.push(renderRow(r));
    out.push('\\hline');
  }
  out.push('\\end{tabularx}');
  out.push('\\end{table}');
  return { latex: out.join('\n') + '\n', nextIndex: j };
}

while (i < N) {
  const line = lines[i];
  const trimmed = line.trim();

  // Blank
  if (trimmed === '') {
    out.push('');
    i++;
    continue;
  }

  // Fenced code block ``` … ```
  const fenceMatch = trimmed.match(/^```(\w*)\s*$/);
  if (fenceMatch) {
    const buf = [];
    i++;
    while (i < N && !/^```\s*$/.test(lines[i])) {
      buf.push(lines[i]);
      i++;
    }
    if (i < N) i++; // chiude
    // Sostituiamo le emoji-icone più comuni con varianti ASCII: lstlisting è
    // verbatim, le sequenze LaTeX (\\textbf{...}) verrebbero mostrate letteralmente.
    const ASCII_FOR_LST = {
      'ⓘ': '(i)',
      '⚠': '(!)',
      '✓': '[v]',
      '✗': '[x]',
      '🔄': '(refresh)',
      '✅': '[OK]',
      '❌': '[NO]',
      '⭐': '[*]',
      '→': '->',
      '←': '<-',
      '↓': 'v',
      '↑': '^',
      '⋮': ':',
      '≥': '>=',
      '≤': '<=',
    };
    let code = buf.join('\n');
    for (const [k, v] of Object.entries(ASCII_FOR_LST)) code = code.split(k).join(v);
    out.push('\\begin{lstlisting}');
    out.push(code);
    out.push('\\end{lstlisting}');
    continue;
  }

  // Heading
  const hm = trimmed.match(/^(#{1,6})\s+(.+)$/);
  if (hm) {
    out.push(heading(hm[1].length, hm[2]));
    i++;
    continue;
  }

  // Blockquote (gestisce più righe consecutive con > all'inizio)
  if (trimmed.startsWith('> ')) {
    const buf = [];
    while (i < N && lines[i].trim().startsWith('>')) {
      buf.push(lines[i].trim().replace(/^>\s?/, ''));
      i++;
    }
    out.push('\\begin{quote}');
    out.push(renderInline(buf.join(' ')));
    out.push('\\end{quote}');
    continue;
  }

  // Tabella
  const tbl = tryParseTable(i);
  if (tbl) {
    out.push(tbl.latex);
    i = tbl.nextIndex;
    continue;
  }

  // Lista bulleted (-, *, +)
  if (/^\s*[-*+]\s+/.test(line) && !/^\s*[-*+]\s*$/.test(line)) {
    const items = [];
    while (i < N && /^\s*[-*+]\s+/.test(lines[i])) {
      let content = lines[i].replace(/^\s*[-*+]\s+/, '');
      // Continuazioni indentate
      while (i + 1 < N && /^\s{2,}\S/.test(lines[i + 1])) {
        i++;
        content += ' ' + lines[i].trim();
      }
      items.push(content);
      i++;
    }
    out.push('\\begin{itemize}');
    for (const it of items) out.push(`  \\item ${renderInline(it)}`);
    out.push('\\end{itemize}');
    continue;
  }

  // Lista numerata
  if (/^\s*\d+\.\s+/.test(line)) {
    const items = [];
    while (i < N && /^\s*\d+\.\s+/.test(lines[i])) {
      let content = lines[i].replace(/^\s*\d+\.\s+/, '');
      while (i + 1 < N && /^\s{2,}\S/.test(lines[i + 1])) {
        i++;
        content += ' ' + lines[i].trim();
      }
      items.push(content);
      i++;
    }
    out.push('\\begin{enumerate}');
    for (const it of items) out.push(`  \\item ${renderInline(it)}`);
    out.push('\\end{enumerate}');
    continue;
  }

  // Separator orizzontale ---
  if (/^---+$/.test(trimmed)) {
    out.push('\\medskip\\hrule\\medskip');
    i++;
    continue;
  }

  // Paragrafo (consuma fino a riga vuota o struttura)
  const paragraph = [line];
  i++;
  while (
    i < N &&
    lines[i].trim() !== '' &&
    !/^(\s*[-*+]\s+|\s*\d+\.\s+|#{1,6}\s+|>\s|```)/.test(lines[i]) &&
    !/^\s*\|/.test(lines[i])
  ) {
    paragraph.push(lines[i]);
    i++;
  }
  out.push(renderInline(paragraph.join(' ')));
}

// ----- 5) Preamble LaTeX -----
const preamble = `% Manuale Admin Cadenza — generato da scripts/build-manuale-latex.js
% Compilare con: xelatex MANUALE_ADMIN.tex (consigliato per Unicode)
%                oppure pdflatex (gli emoji vengono mappati in testo neutro)
\\documentclass[11pt,a4paper]{article}

\\usepackage[utf8]{inputenc}
\\usepackage[T1]{fontenc}
\\usepackage{lmodern}
\\usepackage[italian]{babel}
\\usepackage[a4paper,top=22mm,bottom=22mm,left=18mm,right=18mm]{geometry}
\\usepackage{graphicx}
\\usepackage{xcolor}
\\usepackage{tabularx}
\\usepackage{longtable}
\\usepackage{array}
\\usepackage{colortbl}
\\usepackage{enumitem}
\\usepackage{float}
\\usepackage{titlesec}
\\usepackage{fancyhdr}
\\usepackage{lastpage}
\\usepackage{eurosym}
\\usepackage{amssymb}
\\usepackage{textcomp}
\\usepackage[bookmarks=true,colorlinks=true,linkcolor={blue!60!black},urlcolor={blue!60!black},citecolor={blue!60!black}]{hyperref}
\\usepackage{listings}

% --- Listings (code blocks) ---
\\lstset{
  basicstyle=\\ttfamily\\small,
  breaklines=true,
  frame=single,
  framesep=4pt,
  rulecolor=\\color{black!20},
  backgroundcolor=\\color{black!3},
  columns=fullflexible,
  keepspaces=true,
  showstringspaces=false,
}

% --- Colori tabelle ---
\\definecolor{tableheader}{HTML}{F1EEE5}

% --- Header/footer ---
\\pagestyle{fancy}
\\fancyhf{}
\\fancyhead[L]{\\small Cadenza · Manuale Amministratore v1.6}
\\fancyhead[R]{\\small 13 maggio 2026}
\\fancyfoot[C]{\\small\\thepage{} / \\pageref{LastPage}}
\\renewcommand{\\headrulewidth}{0.4pt}

% --- Titoli sezione con stile leggero ---
\\titleformat{\\section}
  {\\Large\\bfseries\\color{black!85}}{\\thesection}{0.7em}{}
\\titlespacing*{\\section}{0pt}{14pt}{8pt}
\\titleformat{\\subsection}
  {\\large\\bfseries\\color{black!75}}{\\thesubsection}{0.7em}{}
\\titleformat{\\subsubsection}
  {\\normalsize\\bfseries\\color{black!60}}{\\thesubsubsection}{0.7em}{}

% --- Imposta i path immagini (gli alt riferiscono screenshots/* dal docs/) ---
\\graphicspath{{./}{screenshots/}}

% --- Quote/Blockquote più tenue ---
\\renewenvironment{quote}
  {\\begin{list}{}{%
      \\setlength{\\leftmargin}{8pt}%
      \\setlength{\\rightmargin}{8pt}%
      \\setlength{\\topsep}{6pt}%
      \\setlength{\\parsep}{0pt}}%
      \\item\\relax\\color{black!75}\\itshape}
  {\\end{list}}

\\setlength{\\parindent}{0pt}
\\setlength{\\parskip}{6pt}

% --- Frontmatter ---
\\title{Cadenza --- Manuale Amministratore}
\\author{Danilo Russo, docente del Conservatorio}
\\date{13 maggio 2026}

\\begin{document}

\\maketitle
\\thispagestyle{fancy}

\\tableofcontents
\\clearpage

`;

const postamble = '\n\\end{document}\n';

// ----- 6) Scrittura output -----
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, preamble + out.join('\n') + postamble, 'utf8');
const bytes = fs.statSync(outputPath).size;
console.log(`✓ Scritto ${outputPath} (${(bytes / 1024).toFixed(1)} KB)`);
console.log('  Compila con: cd docs && xelatex MANUALE_ADMIN.tex');
