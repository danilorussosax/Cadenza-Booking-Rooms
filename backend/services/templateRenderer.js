'use strict';

/**
 * Mini template engine per email Cadenza.
 *
 * Sintassi:
 *   {{path.to.var}}            → sostituzione (HTML-escape automatico)
 *   {{!path.to.var}}           → sostituzione raw (no escape) — usare con cautela
 *   {{#if path.to.var}}…{{/if}} → blocco mostrato solo se var truthy
 *
 * Nessuna logica complessa (no loops, no else): per email di sistema basta.
 */

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function lookup(ctx, path) {
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), ctx);
}

function isTruthy(v) {
  if (v == null) return false;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === 'string') return v.trim().length > 0;
  return Boolean(v);
}

function render(template, ctx, { escape = true } = {}) {
  if (!template) return '';
  let out = String(template);

  // 1. Conditionals — non annidati
  out = out.replace(/\{\{\s*#if\s+([\w.]+)\s*\}\}([\s\S]*?)\{\{\s*\/if\s*\}\}/g, (_, p, body) =>
    isTruthy(lookup(ctx, p)) ? body : '',
  );

  // 2. Variabili raw (HTML inline, no escape) — sintassi {{!path}}
  out = out.replace(/\{\{\s*!([\w.]+)\s*\}\}/g, (_, p) => {
    const v = lookup(ctx, p);
    return v == null ? '' : String(v);
  });

  // 3. Variabili (escape opzionale)
  out = out.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, p) => {
    const v = lookup(ctx, p);
    if (v == null) return '';
    return escape ? escapeHtml(String(v)) : String(v);
  });

  return out;
}

/** Render plain-text (Subject e altri campi non HTML). */
function renderText(template, ctx) {
  return render(template, ctx, { escape: false });
}

/**
 * Estrae la lista di variabili e blocchi #if usati nel template
 * (utile per la UI admin: "Variabili disponibili / usate").
 */
function extractVariables(template) {
  const set = new Set();
  if (!template) return [];
  const re = /\{\{\s*(?:#if\s+|!)?([\w.]+)\s*\}\}/g;
  let m;
  while ((m = re.exec(template))) set.add(m[1]);
  return [...set].sort();
}

module.exports = { render, renderText, extractVariables };
