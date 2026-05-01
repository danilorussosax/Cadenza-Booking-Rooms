#!/usr/bin/env python3
"""Genera un IDML editabile della presentazione "Cadenza · Direzione".

Filosofia
---------
- Le sole **schermate del software** (slide 5-10) restano embedded come PNG.
- **Tutto il resto è ricostruito** come elementi nativi InDesign:
  rettangoli colorati per le card, linee per le sottolineature, e text
  frame con paragraph/character style → totalmente editabile.
- Tabelle ricostruite come griglie di rettangoli + text frame (non come
  IDML Table — più semplici da modificare in InDesign).

Output: /Users/danilorusso/Desktop/prenota-aule/Cadenza_Presentazione_Direzione.idml
"""

from __future__ import annotations

import io
import os
import sys
import zipfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lucide_idml import build_icon_xml

ROOT = Path(__file__).resolve().parent
SLIDES_DIR = ROOT / "slides_proposta"
ICON_PATH = Path(
    "/Users/danilorusso/Desktop/prenota-aule/conservatory-app/frontend/public/cadenza.png"
)
OUT_PATH = Path("/Users/danilorusso/Desktop/prenota-aule/Cadenza_Presentazione_Direzione.idml")

# Pagina 1920×1080 pt (quoziente di un 1080p video). InDesign usa pt.
W, H = 1920.0, 1080.0
DOMVERSION = "16.0"
XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'

# ────────── colour swatches (HSL→RGB dei design token webapp) ──────────
SWATCHES: dict[str, tuple[int, int, int]] = {
    "NavyDeep":  (15, 23, 42),
    "Navy":      (28, 56, 115),
    "NavyLight": (51, 87, 158),
    "Gold":      (243, 148, 5),
    "GoldLight": (250, 188, 80),
    "GoldPale":  (252, 215, 155),
    "Paper":     (248, 250, 252),
    "PaperDark": (226, 232, 240),
    "Ink":       (15, 23, 42),
    "Neutral":   (100, 116, 139),
    "Dim":       (148, 163, 184),
    "Green":     (22, 163, 74),
    "GreenDark": (16, 122, 56),
    "Red":       (220, 38, 38),
    "RedDark":   (175, 26, 26),
    "Violet":    (139, 92, 246),
}

# ────────── paragraph styles ──────────
# (font_size_pt, fill_swatch, font_style, leading)
PARAGRAPH_STYLES: dict[str, dict[str, Any]] = {
    "CoverTitle":   {"size": 180, "color": "Paper",     "style": "Bold",    "leading": 200, "tracking": 0},
    "CoverSub":     {"size": 50,  "color": "GoldLight", "style": "Bold",    "leading": 60},
    "CoverTagline": {"size": 30,  "color": "Dim",       "style": "Regular", "leading": 38},
    "Author":       {"size": 28,  "color": "GoldPale",  "style": "Bold",    "leading": 36},
    "Kicker":       {"size": 22,  "color": "Gold",      "style": "Bold",    "tracking": 100},
    "H1":           {"size": 50,  "color": "Ink",       "style": "Bold",    "leading": 60},
    "H2":           {"size": 38,  "color": "Ink",       "style": "Bold",    "leading": 46},
    "H3":           {"size": 32,  "color": "Ink",       "style": "Bold",    "leading": 40},
    "Subtitle":     {"size": 36,  "color": "Navy",      "style": "Regular", "leading": 44},
    "Body":         {"size": 24,  "color": "Ink",       "style": "Regular", "leading": 32},
    "BodyLight":    {"size": 22,  "color": "Dim",       "style": "Regular", "leading": 30},
    "BodyDim":      {"size": 22,  "color": "Neutral",   "style": "Regular", "leading": 30},
    "BigNumber":    {"size": 130, "color": "Gold",      "style": "Bold",    "leading": 140},
    "MetricNum":    {"size": 80,  "color": "Navy",      "style": "Bold",    "leading": 90},
    "MetricLabel":  {"size": 28,  "color": "Ink",       "style": "Bold",    "leading": 34},
    "MetricSub":    {"size": 20,  "color": "Neutral",   "style": "Regular", "leading": 26},
    "Caption":      {"size": 22,  "color": "Neutral",   "style": "Regular", "leading": 28},
    "CardTitle":    {"size": 34,  "color": "Ink",       "style": "Bold",    "leading": 42},
    "CardBody":     {"size": 22,  "color": "Ink",       "style": "Regular", "leading": 30},
    "Route":        {"size": 20,  "color": "Navy",      "style": "Bold",    "leading": 26},
    "TableHeader":  {"size": 22,  "color": "Paper",     "style": "Bold",    "leading": 28},
    "TableCell":    {"size": 22,  "color": "Ink",       "style": "Regular", "leading": 28},
    "TableCellNeg": {"size": 22,  "color": "Neutral",   "style": "Regular", "leading": 28},
    "TableCellPos": {"size": 22,  "color": "GreenDark", "style": "Bold",    "leading": 28},
    "TableCellRed": {"size": 22,  "color": "RedDark",   "style": "Bold",    "leading": 28},
    "Saving":       {"size": 28,  "color": "NavyDeep",  "style": "Bold",    "leading": 34},
    "Footer":       {"size": 18,  "color": "Neutral",   "style": "Regular", "leading": 22},
    "PageNum":      {"size": 18,  "color": "Neutral",   "style": "Regular"},
}


# ────────── element data model ──────────


@dataclass
class El:
    """Slide element. type ∈ {rect, text, image, line}.

    Coordinate sono in pt nello spazio pagina (origine top-left = 0,0).
    """
    type: str
    x: float = 0
    y: float = 0
    w: float = 0
    h: float = 0
    fill: str | None = None
    stroke: str | None = None
    stroke_w: float = 0
    radius: float = 0
    text: str = ""
    style: str = "Body"
    align: str = "left"   # left | center | right
    src: str | None = None
    extra: dict = field(default_factory=dict)


# ────────── helpers per generare gli element delle slide ──────────


def page_bg(color="Paper") -> El:
    return El(type="rect", x=0, y=0, w=W, h=H, fill=color)


def card(x, y, w, h, *, fill="Paper", stroke="PaperDark",
         stroke_w=2.0, radius=18.0) -> El:
    return El(type="rect", x=x, y=y, w=w, h=h, fill=fill,
              stroke=stroke, stroke_w=stroke_w, radius=radius)


def rect(x, y, w, h, fill, *, radius=0) -> El:
    return El(type="rect", x=x, y=y, w=w, h=h, fill=fill, radius=radius)


def text(x, y, w, h, text, style="Body", align="left") -> El:
    return El(type="text", x=x, y=y, w=w, h=h,
              text=text, style=style, align=align)


def image(x, y, w, h, src) -> El:
    return El(type="image", x=x, y=y, w=w, h=h, src=src)


def line(x1, y1, x2, y2, color="Gold", weight=6) -> El:
    return El(type="line", x=x1, y=y1, w=x2 - x1, h=y2 - y1,
              fill=color, stroke_w=weight)


def icon(name: str, cx: float, cy: float, size: float,
         color: str = "Ink", stroke_w: float | None = None) -> El:
    """Lucide vector icon — emette path/oval/rect/line IDML stroke-only.
    `color` è il nome dello swatch (deve esistere in Graphic.xml)."""
    return El(type="icon", x=cx, y=cy, w=size, h=size,
              fill=color, stroke_w=stroke_w or 0,
              extra={"icon_name": name})


def header_strip(slide_idx, total, title, kicker=None):
    """Top-bar (icona + kicker + titolo + linea oro + numero pagina)."""
    out = [
        image(50, 65, 60, 60, src="cadenza.png"),
    ]
    if kicker:
        out.append(text(140, 65, 700, 26, kicker.upper(), style="Kicker"))
    out.append(text(140, 95, 1200, 60, title, style="H1"))
    out.append(rect(140, 165, 80, 5, fill="Gold"))
    out.append(text(W - 250, 95, 200, 26,
                    f"{slide_idx:02d} / {total:02d}", style="PageNum",
                    align="right"))
    return out


def footer_strip(slide_idx, total):
    return [
        rect(0, H - 60, W, 1, fill="PaperDark"),
        image(50, H - 50, 30, 30, src="cadenza.png"),
        text(95, H - 48, 800, 26,
             "Cadenza · Per i direttori dei conservatori",
             style="Footer"),
        text(W - 250, H - 48, 200, 26,
             f"{slide_idx:02d} / {total:02d}", style="PageNum",
             align="right"),
    ]


# ────────── slides ──────────


def slide_01_cover(idx, total):
    return [
        page_bg("NavyDeep"),
        rect(0, 0, W, H, fill="Navy"),  # gradient simulato con due strati
        # Effetto gradient soft: rettangoli con alpha simulato non
        # supportati da default; usiamo un singolo Navy come compromesso
        # editabile. L'utente può applicare un gradient da InDesign.
        image((W - 260) / 2, H * 0.18, 260, 260, src="cadenza.png"),
        text(0, H * 0.48, W, 200, "CADENZA", style="CoverTitle", align="center"),
        line(W / 2 - 130, H * 0.62, W / 2 + 130, H * 0.62, color="Gold", weight=6),
        text(0, H * 0.66, W, 70, "Software gratuito per il Conservatorio",
             style="CoverSub", align="center"),
        text(0, H * 0.74, W, 50,
             "Booking aule · Monte Ore · Strumenti · Avvisi · Kiosk",
             style="CoverTagline", align="center"),
        text(0, H * 0.84, W, 50,
             "Sviluppato da Danilo Russo, docente del Conservatorio",
             style="Author", align="center"),
        text(0, H * 0.91, W, 40,
             "30 aprile 2026 · Presentazione per Direzione, DSGA e responsabili IT",
             style="CoverTagline", align="center"),
    ]


def slide_02_perche(idx, total):
    out = [page_bg("Paper")]
    out += header_strip(idx, total, "Perché parliamo di questo, oggi", kicker="INTRO")

    cards_data = [
        ("21 mld €", "PNRR Missione 4",
         "Stanziati per la digitalizzazione delle istituzioni AFAM entro il 2026."),
        ("79", "Conservatori statali",
         "Più 50 istituti AFAM. Pubblica amministrazione con vincoli GDPR, MEPA, ANIS, conservazione sostitutiva."),
        ("3-15k€", "Budget software gestionale",
         "ASIMUT costa 15.000-40.000 €/anno. Le alternative italiane non sono verticali sul Conservatorio."),
    ]
    cw, gap = 540, 30
    base_x = (W - 3 * cw - 2 * gap) / 2
    by = 250
    for i, (big, label, body) in enumerate(cards_data):
        x = base_x + i * (cw + gap)
        out += [
            card(x, by, cw, 600, fill="Paper", stroke="PaperDark", radius=22),
            text(x, by + 90, cw, 150, big, style="BigNumber", align="center"),
            line(x + cw / 2 - 60, by + 250, x + cw / 2 + 60, by + 250, color="Gold", weight=4),
            text(x, by + 280, cw, 50, label, style="CardTitle", align="center"),
            text(x + 30, by + 360, cw - 60, 220, body, style="CardBody", align="center"),
        ]
    out += footer_strip(idx, total)
    return out


def slide_03_uno_pagina(idx, total):
    out = [page_bg("Paper")]
    out += header_strip(idx, total, "Cadenza in una pagina", kicker="COSA È")
    out += [
        text(80, 230, W - 160, 60,
             "Una piattaforma open-source progettata", style="H2"),
        text(80, 290, W - 160, 60,
             "specificamente per i conservatori italiani.",
             style="Subtitle"),
    ]
    metrics = [
        ("31",   "modelli Sequelize",     "Architettura solida verificata"),
        ("100+", "endpoint API",          "REST coerente, documentazione fluente"),
        ("169",  "test automatici",       "Continuous integration GitHub Actions"),
        ("3",    "lingue supportate",     "Italiano · Inglese · Spagnolo"),
        ("1",    "deploy command",        "VPS Ubuntu o Docker, zero lock-in cloud"),
        ("0",    "doppie prenotazioni",   "Garantito a livello DB Postgres EXCLUDE"),
    ]
    by = 380
    cw = (W - 200 - 30 * 2) / 3
    for i, (val, lbl, sub) in enumerate(metrics):
        col, row = i % 3, i // 3
        x = 90 + col * (cw + 30)
        y = by + row * 240
        out += [
            card(x, y, cw, 210, fill="Paper", stroke="PaperDark", radius=18),
            text(x + 30, y + 30, cw - 60, 100, val, style="MetricNum"),
            text(x + 30, y + 130, cw - 60, 40, lbl, style="MetricLabel"),
            text(x + 30, y + 175, cw - 60, 30, sub, style="MetricSub"),
        ]
    out += footer_strip(idx, total)
    return out


def slide_04_4_risposte(idx, total):
    out = [page_bg("Paper")]
    out += header_strip(idx, total, "Quattro risposte concrete",
                        kicker="DOMINI FUNZIONALI")
    items = [
        ("calendar-plus", "Booking aule",
         "Self-service in 3 tap. Anti-overlap garantito DB.\n"
         "Approval workflow per sale concerti. Waitlist auto-promote.",
         "/booking · /rooms · /my-bookings", "NavyLight"),
        ("clock", "Monte Ore docenti",
         "Workflow contrattuale del Conservatorio: vincoli 2-4 giorni\n"
         "per settimana, soglia 324h/anno, sospensioni didattiche.",
         "/monte-ore · pannello docente + admin", "Gold"),
        ("package", "Inventario strumenti",
         "Catalogo + prestiti (5 stati). Reminder T-2gg, auto-overdue.\n"
         "PDF di consegna, email transazionali.",
         "/instruments · /my-loans", "Green"),
        ("megaphone", "Avvisi & Kiosk",
         "Bacheca con audience filter (ruolo · corso · edificio).\n"
         "Display di sala con rotazione concerti + annunci.",
         "/announcements · /display", "Violet"),
    ]
    by, cw, rh = 240, (W - 200) / 2, 350
    for i, (icon_name, title, body, route, color) in enumerate(items):
        col, row = i % 2, i // 2
        x = 90 + col * (cw + 20)
        y = by + row * (rh + 20)
        # icon badge top-right (rounded square in card color)
        badge_x = x + cw - 100
        badge_y = y + 30
        out += [
            card(x, y, cw, rh, fill="Paper", stroke="PaperDark", radius=18),
            rect(x, y, 8, rh, fill=color, radius=4),
            rect(badge_x, badge_y, 70, 70, fill=color, radius=14),
            icon(icon_name, badge_x + 35, badge_y + 35, 44, color="Paper",
                 stroke_w=4),
            text(x + 40, y + 40, cw - 180, 50, title, style="H3"),
            text(x + 40, y + 130, cw - 70, 100, body, style="CardBody"),
            text(x + 40, y + rh - 60, cw - 70, 30,
                 "•  " + route, style="Route"),
        ]
    out += footer_strip(idx, total)
    return out


def slide_screenshot(idx, total, kicker, title, png, caption):
    """Slide con UNA screenshot reale (slide 5-10)."""
    out = [page_bg("Paper")]
    out += header_strip(idx, total, title, kicker=kicker)
    # Image area
    img_x, img_y = 90, 215
    img_w, img_h = W - 180, 760
    out += [
        card(img_x, img_y, img_w, img_h, fill="Paper",
             stroke="PaperDark", radius=14),
        image(img_x + 12, img_y + 12, img_w - 24, img_h - 24, src=png),
        text(80, H - 95, W - 160, 30, caption,
             style="Caption", align="center"),
    ]
    out += footer_strip(idx, total)
    return out


def slide_05_dashboard(idx, total):
    return slide_screenshot(idx, total,
        "SCHERMATA REALE · /dashboard", "Dashboard docente",
        "dashboard.png",
        "Quattro KPI personali, calendario aule giornaliero con drag-to-create, agenda prossime prenotazioni.")


def slide_06_rooms(idx, total):
    return slide_screenshot(idx, total,
        "SCHERMATA REALE · /rooms", "Aule del Conservatorio",
        "rooms.png",
        "Catalogo navigabile per edificio, capienza, dotazione. Filtri per attrezzatura, tipologia, prenotabilità.")


def slide_07_booking(idx, total):
    return slide_screenshot(idx, total,
        "SCHERMATA REALE · /booking", "Prenota un'aula",
        "booking.png",
        "Timeline 30' (08-22), legenda tipologia (studio · lezione · prova · concerto), drag-to-select.")


def slide_08_monte_ore(idx, total):
    return slide_screenshot(idx, total,
        "SCHERMATA REALE · /admin/monte-ore", "Monte Ore docenti — pannello admin",
        "admin-monte-ore.png",
        "Workflow proposte annuali → approvazione coordinatore → generazione prenotazioni ricorrenti.")


def slide_09_analytics(idx, total):
    return slide_screenshot(idx, total,
        "SCHERMATA REALE · /admin/analytics", "Analytics direzione",
        "admin-analytics.png",
        "Heatmap occupazione 7×24, top aule, no-show rate, trend 8 settimane, export CSV/PDF.")


def slide_10_structure(idx, total):
    return slide_screenshot(idx, total,
        "SCHERMATA REALE · /admin/structure", "Struttura del Conservatorio",
        "admin-structure.png",
        "Anagrafica istituti, edifici, aule e catalogo dotazioni — tutto in un'unica pagina.")


def grid_table(headers, rows, x, y, total_w, *, header_fill="NavyDeep",
               cell_styles=None, col_widths=None, row_h=64):
    """Disegna una tabella come griglia di rettangoli + text frame.
    `cell_styles[r][c]` (opzionale) sovrascrive lo style della cella.
    """
    out = []
    n_cols = len(headers)
    if col_widths is None:
        col_widths = [total_w / n_cols] * n_cols
    # Header bar
    out.append(rect(x, y, total_w, row_h, fill=header_fill, radius=10))
    cx = x
    for j, h in enumerate(headers):
        out.append(text(cx, y, col_widths[j], row_h, h,
                        style="TableHeader", align="center"))
        cx += col_widths[j]
    # Body rows
    for i, row in enumerate(rows):
        ry = y + (i + 1) * row_h
        if i % 2 == 0:
            out.append(rect(x, ry, total_w, row_h, fill="Paper"))
        cx = x
        for j, cell in enumerate(row):
            if cell_styles and cell_styles[i][j]:
                style = cell_styles[i][j]
            else:
                style = "TableCell" if cell != "—" else "TableCellNeg"
            out.append(text(cx + 16, ry, col_widths[j] - 32, row_h, cell,
                            style=style, align="left" if j == 0 else "center"))
            cx += col_widths[j]
    return out


def slide_11_vs_asimut(idx, total):
    out = [page_bg("Paper")]
    out += header_strip(idx, total, "Cadenza vs ASIMUT", kicker="CONFRONTO 1/2")
    headers = ["Aspetto", "ASIMUT", "Cadenza"]
    rows = [
        ["Pricing annuo (medio)",     "15.000-40.000 €",       "463-2.003 €"],
        ["Cloud / Self-host",         "Solo cloud (Danimarca)", "Cloud IT o self-host"],
        ["Lingua / supporto",         "Inglese, fuso CET",     "Italiano, made in Italy"],
        ["Monte Ore docenti AFAM",    "—",                     "✓ verticale italiana"],
        ["SPID / CIE",                "—",                     "Roadmap Sprint E"],
        ["ANIS / MIUR export",        "—",                     "Roadmap Sprint E"],
        ["Bot Telegram / WhatsApp",   "—",                     "✓ production-ready"],
        ["Inventario strumenti",      "Generico",              "✓ workflow prestito"],
    ]
    cell_styles = [
        [None, None, "TableCellPos"],
        [None, None, "TableCellPos"],
        [None, None, "TableCellPos"],
        [None, "TableCellNeg", "TableCellPos"],
        [None, "TableCellNeg", "TableCell"],
        [None, "TableCellNeg", "TableCell"],
        [None, "TableCellNeg", "TableCellPos"],
        [None, None, "TableCellPos"],
    ]
    out += grid_table(headers, rows, x=80, y=240, total_w=W - 160,
                      col_widths=[800, 510, 450], cell_styles=cell_styles)
    out += footer_strip(idx, total)
    return out


def slide_12_vs_easystaff(idx, total):
    out = [page_bg("Paper")]
    out += header_strip(idx, total,
                        "Cadenza vs EasyStaff / EasyAcademy",
                        kicker="CONFRONTO 2/2")
    headers = ["Aspetto", "EasyStaff", "Cadenza"]
    rows = [
        ["Verticalità Conservatori",  "Pacchetto università generaliste",
         "Verticale AFAM dal giorno 1"],
        ["Monte Ore",                 "—", "✓ workflow contrattuale Conservatorio"],
        ["Eventi / sale concerti",    "—", "✓ approval + iCal + kiosk"],
        ["Inventario strumenti",      "—", "✓ catalogo + prestiti completo"],
        ["Pricing AFAM medio",        "8.000-15.000 €", "463-2.003 €"],
        ["Onboarding tipico",         "8-12 settimane", "0,5-2 giornate"],
        ["Open-source / self-host",   "—", "✓ codice sorgente in licenza"],
        ["Lingua e supporto",         "Italiano OK", "Italiano + IT/EN/ES"],
    ]
    cell_styles = [
        [None, None, "TableCellPos"],
        [None, "TableCellNeg", "TableCellPos"],
        [None, "TableCellNeg", "TableCellPos"],
        [None, "TableCellNeg", "TableCellPos"],
        [None, None, "TableCellPos"],
        [None, None, "TableCellPos"],
        [None, "TableCellNeg", "TableCellPos"],
        [None, None, "TableCellPos"],
    ]
    out += grid_table(headers, rows, x=80, y=240, total_w=W - 160,
                      col_widths=[800, 510, 450], cell_styles=cell_styles)
    out += footer_strip(idx, total)
    return out


def slide_13_compliance(idx, total):
    out = [page_bg("NavyDeep"), rect(0, 0, W, H, fill="Navy")]
    # title
    out += [
        text(0, 130, W, 100, "Italiano per definizione",
             style="CoverSub", align="center"),
        line(W / 2 - 80, 250, W / 2 + 80, 250, color="Gold", weight=5),
        text(0, 290, W, 50,
             "Quattro garanzie che i competitor esteri non offrono nativamente.",
             style="CoverTagline", align="center"),
    ]
    badges = [
        ("flag", "Codice italiano",
         "Sviluppato in Italia, manutenzione in italiano",
         "Niente time-zone CET-only, niente lingua di supporto inglese"),
        ("shield-check", "GDPR Garante 06/2021",
         "Cookie, DPIA, ROPA, audit log",
         "Provvedimento 06/2021 e art. 13-17 GDPR coperti by-default"),
        ("scale", "Roadmap PA italiana",
         "SPID/CIE · PEC · ANIS/MIUR",
         "Sprint E pianificato, sviluppo on-demand al primo Conservatorio"),
        ("building-2", "MEPA-ready",
         "Pubblica amministrazione, MEPA, fattura elettronica",
         "Tutti i piani sotto soglia 75.000 € (affidamento diretto)"),
    ]
    bx, by = 200, 420
    bw = (W - 400 - 60) / 2
    bh = 220
    for i, (icon_name, t1, t2, foot) in enumerate(badges):
        col, row = i % 2, i // 2
        x = bx + col * (bw + 60)
        y = by + row * (bh + 30)
        out += [
            card(x, y, bw, bh, fill="NavyLight", stroke="Gold",
                 stroke_w=2, radius=20),
            # gold badge with vector lucide icon
            rect(x + 30, y + 60, 100, 100, fill="Gold", radius=20),
            icon(icon_name, x + 80, y + 110, 64, color="NavyDeep",
                 stroke_w=4),
            text(x + 160, y + 50, bw - 180, 50, t1, style="MetricLabel"),
            text(x + 160, y + 100, bw - 180, 30, t2, style="BodyLight"),
            text(x + 160, y + 145, bw - 180, 60, foot, style="BodyDim"),
        ]
    return out  # no footer (dark slide)


def slide_14_costi_reali(idx, total):
    out = [page_bg("Paper")]
    out += header_strip(idx, total, "Costi reali per il Conservatorio",
                        kicker="TUTTO QUI")
    out += [
        text(80, 230, W - 160, 60,
             "Software gratuito. Pagate solo l'infrastruttura.",
             style="H2"),
        text(80, 295, W - 160, 50,
             "Niente licenze, niente canoni, niente lock-in.",
             style="Subtitle"),
    ]
    rows = [
        ("server", "VPS Hetzner CPX31",
         "4 vCPU · 8 GB · 160 GB SSD · datacenter EU",
         "192 €", "/anno"),
        ("globe", "Dominio + Let's Encrypt",
         "Sotto-dominio del Conservatorio. TLS gratuito.",
         "15 €", "/anno"),
        ("database", "Backup off-site",
         "Hetzner Storage Box 1 TB, 30 giorni retention",
         "36 €", "/anno"),
        ("sparkles", "Claude Pro (manutenzione AI-assisted)",
         "Per evoluzioni e bug fix. Opzionale: Max 1.760 €/anno",
         "220 €", "/anno"),
    ]
    by, rh = 380, 110
    for i, (icon_name, lbl, sub, price, unit) in enumerate(rows):
        y = by + i * (rh + 12)
        out += [
            card(80, y, W - 160, rh, fill="Paper", stroke="PaperDark", radius=14),
            rect(80, y, 8, rh, fill="Gold"),
            # icon in a soft gold-pale square
            rect(110, y + 25, 60, 60, fill="GoldPale", radius=12),
            icon(icon_name, 140, y + 55, 36, color="Gold", stroke_w=3),
            text(190, y + 18, W - 560, 40, lbl, style="CardTitle"),
            text(190, y + 65, W - 560, 30, sub, style="BodyDim"),
            text(W - 280, y + 22, 200, 60, price, style="MetricNum"),
            text(W - 280, y + 80, 200, 30, unit, style="Caption"),
        ]
    # Total bar
    ty = by + 4 * (rh + 12) + 10
    out += [
        rect(80, ty, W - 160, 110, fill="NavyDeep", radius=18),
        text(110, ty + 22, W - 500, 40,
             "Totale annuo Conservatorio", style="H3"),
        text(110, ty + 70, W - 500, 30,
             "Tutto incluso, IVA esclusa", style="BodyLight"),
        text(W - 280, ty + 26, 200, 70, "≈ 463 €",
             style="CoverSub"),
    ]
    out += footer_strip(idx, total)
    return out


def slide_15_tco(idx, total):
    out = [page_bg("Paper")]
    out += header_strip(idx, total, "Quanto risparmiate davvero",
                        kicker="TCO 1 / 5 / 10 ANNI")
    headers = ["Periodo", "ASIMUT (medio)", "Cadenza Pro", "Risparmio"]
    rows = [
        ["Anno 1",  "22.500 €",  "463 €",   "− 22.037 €"],
        ["3 anni",  "67.500 €",  "1.389 €", "− 66.111 €"],
        ["5 anni",  "112.500 €", "2.315 €", "− 110.185 €"],
        ["10 anni", "225.000 €", "4.630 €", "− 220.370 €"],
    ]
    cell_styles = [[None, "TableCellRed", "TableCellPos", None] for _ in rows]
    out += grid_table(headers, rows, x=80, y=240, total_w=W - 160,
                      col_widths=[520, 400, 400, W - 160 - 1320], row_h=70)
    # Risparmio bubbles
    by_table = 240
    rh = 70
    for i in range(4):
        y = by_table + (i + 1) * rh
        out += [
            rect(W - 160 - (W - 160 - 1320) + 80 + 30, y + 8,
                 (W - 160 - 1320) - 60, rh - 16,
                 fill="Gold", radius=14),
        ]
    # Bullets callout
    cy = by_table + 5 * rh + 60
    out += [
        card(80, cy, W - 160, 280, fill="Paper", stroke="Gold",
             stroke_w=3, radius=18),
        text(110, cy + 24, W - 220, 50,
             "Su 10 anni, 220.000 € equivalgono a:", style="H3"),
    ]
    bullets = [
        "•  ~ 4 stipendi annuali docente di II fascia (lordo amministrazione)",
        "•  ~ 2 organi a canne medi · oppure 6-8 pianoforti gran coda",
        "•  ~ 40-50 borse di studio annuali per studenti meritevoli (5.000 € cad.)",
        "•  ~ 10 ristrutturazioni di un'aula completa di insonorizzazione e impianto audio",
    ]
    for j, b in enumerate(bullets):
        out.append(text(120, cy + 80 + j * 46, W - 240, 40,
                        b, style="CardBody"))
    out += footer_strip(idx, total)
    return out


def slide_16_vps(idx, total):
    out = [page_bg("Paper")]
    out += header_strip(idx, total, "Dove ospitare Cadenza",
                        kicker="VPS · FINO A 5.000 UTENTI")
    headers = ["Provider", "Datacenter",
               "Piano (1.5-3k ut.)", "Piano (3-5k ut.)", "Note"]
    rows = [
        ["Hetzner Cloud",     "DE / FI", "CPX31 — 16 €/mese", "CPX41 — 28 €/mese",
         "★ Miglior prezzo/prestazioni"],
        ["Hetzner Dedicated", "DE",       "CCX23 — 39 €/mese", "CCX33 — 78 €/mese",
         "Carichi predicibili"],
        ["OVHcloud",          "FR / DE",  "VPS Comfort — 15 €/mese",
         "VPS Elite — 29 €/mese",          "Provider EU consolidato"],
        ["Ionos Cloud",       "DE / IT",  "Cloud L — 25 €/mese",
         "Cloud XL — 50 €/mese",           "Sovranità EU, supporto IT"],
        ["Aruba Cloud",       "Italia",   "Smart VS3 — 22 €/mese",
         "Smart VS4 — 50 €/mese",          "★ Sovranità italiana, AGID"],
        ["Register.it",       "Italia",   "Cloud M — 30 €/mese",
         "Cloud L — 60 €/mese",            "MEPA-ready, fattura PA"],
        ["DigitalOcean",      "DE / NL",  "Basic 4/8 — 48 €/mese",
         "Premium 4/8 — 56 €/mese",        "Ecosystem mature"],
    ]
    out += grid_table(headers, rows, x=80, y=230, total_w=W - 160,
                      col_widths=[230, 200, 380, 380, W - 160 - 1190],
                      row_h=60)
    # callout finale
    cy = 230 + 8 * 60 + 30
    out += [
        rect(80, cy, W - 160, 110, fill="NavyDeep", radius=18),
        text(80, cy + 25, W - 160, 40,
             "Tutti gli scenari rientrano in affidamento diretto (D.Lgs. 36/2023, art. 50)",
             style="CoverSub", align="center"),
        text(80, cy + 70, W - 160, 30,
             "Spesa annua totale: 451 € (OVH) — 738 € (Hetzner dedicated) · Tutto in fattura PA elettronica.",
             style="CoverTagline", align="center"),
    ]
    out += footer_strip(idx, total)
    return out


def slide_17_attivazione(idx, total):
    out = [page_bg("Paper")]
    out += header_strip(idx, total, "Cosa serve per partire",
                        kicker="ATTIVAZIONE")
    out += [
        text(80, 230, W - 160, 50,
             "Decisione → operatività in 2-4 settimane.",
             style="H2"),
    ]
    items = [
        ("server", "VPS + dominio",
         "Acquisto del server (Hetzner / Aruba / Ionos / OVH).\nA carico del Conservatorio. ~ 200 €/anno."),
        ("terminal", "Provisioning",
         "Install pacchetti, deploy Cadenza, certificato TLS.\nA carico dell'autore. 2-3 ore una sola volta."),
        ("upload", "Import anagrafica",
         "Utenti, aule, edifici, dotazioni da Excel/CSV.\nAutore + DSGA. 1-2 ore."),
        ("palette", "Branding",
         "Logo del Conservatorio, colori, intestazioni.\nAutore. 30 minuti."),
        ("users", "Formazione admin",
         "Sessione 90 minuti remoto per Direzione/DSGA/IT.\nAutore. Registrabile."),
        ("play-circle", "Formazione utenti",
         "Sessione 60 minuti per docenti / studenti pilota.\nAutore. Materiale video registrato."),
    ]
    by, cw, rh = 320, (W - 200) / 2, 150
    for i, (icon_name, kicker, body) in enumerate(items):
        col, row = i % 2, i // 2
        x = 90 + col * (cw + 20)
        y = by + row * (rh + 16)
        out += [
            card(x, y, cw, rh, fill="Paper", stroke="PaperDark", radius=14),
            rect(x, y, 6, rh, fill="Gold"),
            # icon badge dark navy
            rect(x + 20, y + 30, 80, 80, fill="NavyDeep", radius=14),
            icon(icon_name, x + 60, y + 70, 48, color="GoldLight",
                 stroke_w=4),
            text(x + 120, y + 22, cw - 140, 40, kicker, style="H3"),
            text(x + 120, y + 70, cw - 140, 80, body, style="CardBody"),
        ]
    out += [
        rect(80, 920, W - 160, 70, fill="NavyDeep", radius=18),
        text(80, 940, W - 160, 40,
             "Nessun contratto di licenza. Codice sorgente del Conservatorio.",
             style="CoverSub", align="center"),
    ]
    out += footer_strip(idx, total)
    return out


def slide_18_roadmap(idx, total):
    out = [page_bg("Paper")]
    out += header_strip(idx, total, "Roadmap 12 mesi", kicker="PROSSIMI PASSI")
    sprints = [
        ("sparkles",       "Sprint A", "UX quick wins",
         "Push notif · iframe concerti · Privacy display · Card avvisi", "Q2 2026"),
        ("bar-chart-3",    "Sprint B", "Analytics +",
         "Maintenance schedule · Report email YoY analytics", "Q2 2026"),
        ("calendar-check", "Sprint C", "Task mgmt eventi",
         "Gap parità ASIMUT (staff workflow)", "Q3 2026"),
        ("wrench",         "Sprint D", "Tech debt",
         "Docker compose · Sequelize-CLI · Coverage 70%", "Q3 2026"),
        ("shield-check",   "Sprint E", "PA italiana",
         "SPID/CIE · PEC · ANIS/MIUR · Conservazione", "Q4 2026"),
        ("bot",            "Sprint F", "Bot completi",
         "WhatsApp Cloud · Signal · Email IMAP poller", "Q1 2027"),
    ]
    by = 250
    cw = (W - 180 - 30 * 5) / 6
    for i, (icon_name, k, t1, body, when) in enumerate(sprints):
        x = 90 + i * (cw + 30)
        out += [
            card(x, by, cw, 540, fill="Paper", stroke="PaperDark", radius=16),
            rect(x, by, cw, 70, fill="NavyDeep", radius=16),
            text(x, by + 18, cw, 40, k, style="MetricLabel", align="center"),
            # gold disc with vector icon
            rect(x + cw / 2 - 40, by + 100, 80, 80, fill="Gold", radius=40),
            icon(icon_name, x + cw / 2, by + 140, 50, color="NavyDeep",
                 stroke_w=4),
            text(x, by + 220, cw, 40, t1, style="CardTitle", align="center"),
            text(x + 10, by + 290, cw - 20, 160, body, style="CardBody",
                 align="center"),
            text(x, by + 480, cw, 40, when, style="Kicker", align="center"),
        ]
    out += footer_strip(idx, total)
    return out


def slide_19_cta(idx, total):
    return [
        page_bg("NavyDeep"),
        rect(0, 0, W, H, fill="Navy"),
        image((W - 220) / 2, H * 0.18, 220, 220, src="cadenza.png"),
        text(0, H * 0.46, W, 200, "CADENZA", style="CoverTitle", align="center"),
        line(W / 2 - 130, H * 0.59, W / 2 + 130, H * 0.59, color="Gold", weight=6),
        text(0, H * 0.65, W, 70, "Un dono al Conservatorio.",
             style="CoverSub", align="center"),
        text(0, H * 0.72, W, 70, "Per i prossimi dieci anni almeno.",
             style="CoverSub", align="center"),
        text(0, H * 0.83, W, 50,
             "Danilo Russo · docente del Conservatorio",
             style="Author", align="center"),
        text(0, H * 0.91, W, 40,
             "Una demo dal vivo, in italiano: 30 minuti per mostrarvi tutto.",
             style="CoverTagline", align="center"),
    ]


SLIDES = [
    slide_01_cover,
    slide_02_perche,
    slide_03_uno_pagina,
    slide_04_4_risposte,
    slide_05_dashboard,
    slide_06_rooms,
    slide_07_booking,
    slide_08_monte_ore,
    slide_09_analytics,
    slide_10_structure,
    slide_11_vs_asimut,
    slide_12_vs_easystaff,
    slide_13_compliance,
    slide_14_costi_reali,
    slide_15_tco,
    slide_16_vps,
    slide_17_attivazione,
    slide_18_roadmap,
    slide_19_cta,
]


# ────────── XML generation ──────────


def color_self(name: str) -> str:
    return f"Color/{name}"


def swatch_self(name: str) -> str:
    return f"Swatch/{name}"


def fonts_xml() -> str:
    return (
        XML_DECL
        + '<idPkg:Fonts xmlns:idPkg="http://ns.adobe.com/AdobeInDesign/idml/1.0/packaging" '
        f'DOMVersion="{DOMVERSION}">\n'
        '  <FontFamily Self="FontFamily/Helvetica" Name="Helvetica">\n'
        '    <Font Self="Font/Helvetica" FontFamily="Helvetica" Name="Helvetica" '
        'PostScriptName="Helvetica" Status="Installed" FontStyleName="Regular" '
        'FontType="Type1Font" WritingScript="0" Composite="false"/>\n'
        '    <Font Self="Font/Helvetica%20Bold" FontFamily="Helvetica" Name="Helvetica Bold" '
        'PostScriptName="Helvetica-Bold" Status="Installed" FontStyleName="Bold" '
        'FontType="Type1Font" WritingScript="0" Composite="false"/>\n'
        '  </FontFamily>\n'
        '</idPkg:Fonts>\n'
    )


def styles_xml() -> str:
    """Paragraph + character styles."""
    para_styles = []
    for name, props in PARAGRAPH_STYLES.items():
        size = props["size"]
        leading = props.get("leading", size * 1.2)
        font_style = props["style"]
        color = props["color"]
        tracking = props.get("tracking", 0)
        para_styles.append(
            f'    <ParagraphStyle Self="ParagraphStyle/{name}" '
            f'Name="{name}" Imported="false" '
            f'NextStyle="ParagraphStyle/{name}" KeyboardShortcut="0 0" '
            f'PointSize="{size}" Leading="{leading}" '
            f'FillColor="{color_self(color)}" Tracking="{tracking}" '
            f'FontStyle="{font_style}">\n'
            f'      <Properties>\n'
            f'        <AppliedFont type="string">Helvetica</AppliedFont>\n'
            f'      </Properties>\n'
            f'    </ParagraphStyle>'
        )
    return (
        XML_DECL
        + '<idPkg:Styles xmlns:idPkg="http://ns.adobe.com/AdobeInDesign/idml/1.0/packaging" '
        f'DOMVersion="{DOMVERSION}">\n'
        '  <RootCharacterStyleGroup Self="u139">\n'
        '    <CharacterStyle Self="CharacterStyle/$ID/[No character style]" '
        'Imported="false" KeyboardShortcut="0 0" Name="$ID/[No character style]"/>\n'
        '  </RootCharacterStyleGroup>\n'
        '  <RootParagraphStyleGroup Self="u140">\n'
        '    <ParagraphStyle Self="ParagraphStyle/$ID/[No paragraph style]" '
        'Imported="false" Name="$ID/[No paragraph style]" '
        'NextStyle="ParagraphStyle/$ID/[No paragraph style]" '
        'KeyboardShortcut="0 0" PointSize="12" '
        'FillColor="Color/Black" FontStyle="Regular">\n'
        '      <Properties>\n'
        '        <AppliedFont type="string">Helvetica</AppliedFont>\n'
        '      </Properties>\n'
        '    </ParagraphStyle>\n'
        + "\n".join(para_styles) + "\n"
        '  </RootParagraphStyleGroup>\n'
        '  <RootObjectStyleGroup Self="u141">\n'
        '    <ObjectStyle Self="ObjectStyle/$ID/[None]" Name="$ID/[None]" '
        'AppliedParagraphStyle="ParagraphStyle/$ID/[No paragraph style]"/>\n'
        '  </RootObjectStyleGroup>\n'
        '  <RootTableStyleGroup Self="u142">\n'
        '    <TableStyle Self="TableStyle/$ID/[No table style]" '
        'Name="$ID/[No table style]" '
        'NextStyle="TableStyle/$ID/[No table style]"/>\n'
        '  </RootTableStyleGroup>\n'
        '  <RootCellStyleGroup Self="u143">\n'
        '    <CellStyle Self="CellStyle/$ID/[None]" Name="$ID/[None]"/>\n'
        '  </RootCellStyleGroup>\n'
        '</idPkg:Styles>\n'
    )


def graphic_xml() -> str:
    """Swatches + Colors per ogni token webapp."""
    swatches = []
    colors = []
    for name, (r, g, b) in SWATCHES.items():
        # Convert RGB 0-255 to InDesign RGB float (0-255 directly works in IDML).
        # Color/Space="RGB" usa valori 0-255 in IDML.
        swatches.append(
            f'  <Swatch Self="Swatch/{name}" Name="{name}" '
            f'ColorEditable="true" ColorRemovable="true" '
            f'Visible="true" SwatchCreatorID="7937"/>'
        )
        colors.append(
            f'  <Color Self="Color/{name}" Model="Process" Space="RGB" '
            f'ColorValue="{r} {g} {b}" Name="{name}" '
            f'ColorEditable="true" ColorRemovable="true" '
            f'Visible="true" SwatchCreatorID="7937" '
            f'AlternateSpace="NoAlternateColor" AlternateColorValue="" '
            f'ColorOverride="Normal"/>'
        )
    return (
        XML_DECL
        + '<idPkg:Graphic xmlns:idPkg="http://ns.adobe.com/AdobeInDesign/idml/1.0/packaging" '
        f'DOMVersion="{DOMVERSION}">\n'
        '  <Swatch Self="Swatch/None" Name="None" ColorEditable="false" '
        'ColorRemovable="false" Visible="true" SwatchCreatorID="7937"/>\n'
        '  <Swatch Self="Swatch/Black" Name="Black" ColorEditable="false" '
        'ColorRemovable="false" Visible="true" SwatchCreatorID="7937"/>\n'
        '  <Swatch Self="Swatch/Paper" Name="Paper" ColorEditable="true" '
        'ColorRemovable="false" Visible="true" SwatchCreatorID="7937"/>\n'
        + "\n".join(swatches) + "\n"
        '  <Color Self="Color/Black" Model="Process" Space="CMYK" '
        'ColorValue="0 0 0 100" ColorOverride="Specialblack" '
        'AlternateSpace="NoAlternateColor" AlternateColorValue="" '
        'Name="Black" ColorEditable="false" ColorRemovable="false" '
        'Visible="true" SwatchCreatorID="7937"/>\n'
        + "\n".join(colors) + "\n"
        '</idPkg:Graphic>\n'
    )


def preferences_xml() -> str:
    return (
        XML_DECL
        + '<idPkg:Preferences xmlns:idPkg="http://ns.adobe.com/AdobeInDesign/idml/1.0/packaging" '
        f'DOMVersion="{DOMVERSION}">\n'
        f'  <DocumentPreference Self="uDocPref" PageHeight="{H}" '
        f'PageWidth="{W}" PageOrientation="Landscape" '
        'PagesPerDocument="1" FacingPages="false" '
        'AllowPageShuffle="true" DocumentBleedTopOffset="0" '
        'DocumentBleedBottomOffset="0" DocumentBleedInsideOrLeftOffset="0" '
        'DocumentBleedOutsideOrRightOffset="0" '
        'DocumentBleedUniformSize="true" SlugTopOffset="0" '
        'SlugBottomOffset="0" SlugInsideOrLeftOffset="0" '
        'SlugRightOrOutsideOffset="0" SlugUniformSize="false" '
        'PreserveLayoutWhenShuffling="true" ColumnDirection="Horizontal" '
        'ColumnGuideColor="Magenta" MarginGuideColor="Violet" '
        'IntentMode="0" StartPageNumber="1"/>\n'
        '  <ViewPreference Self="uViewPref" HorizontalMeasurementUnits="Points" '
        'VerticalMeasurementUnits="Points" RulerOrigin="PageOrigin" '
        'CursorKeyIncrement="2.834" StrokeMeasurementUnits="Points" '
        'TextSizeMeasurementUnits="Points" '
        'ShowRulers="true" ShowFrameEdges="true"/>\n'
        f'  <MarginPreference Self="uMarginPref" Top="0" Bottom="0" Left="0" '
        f'Right="0" ColumnCount="1" ColumnGutter="0" '
        f'ColumnsPositions="0 {W}" ColumnDirection="Horizontal"/>\n'
        '  <TransparencyPreference Self="uTrans"/>\n'
        '  <GeneralPreference Self="uGen"/>\n'
        '  <PageItemDefault Self="uPID" StrokeWeight="0"/>\n'
        '</idPkg:Preferences>\n'
    )


def master_spread_xml() -> str:
    return (
        XML_DECL
        + '<idPkg:MasterSpread xmlns:idPkg="http://ns.adobe.com/AdobeInDesign/idml/1.0/packaging" '
        f'DOMVersion="{DOMVERSION}">\n'
        '  <MasterSpread Self="uMS" Name="A-Master" NamePrefix="A" BaseName="Master" '
        'PageCount="1" ShowMasterItems="true" OverriddenPageItemProps=""/>\n'
        '</idPkg:MasterSpread>\n'
    )


def container_xml() -> str:
    return (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" '
        'version="1.0">\n'
        '  <rootfiles>\n'
        '    <rootfile full-path="designmap.xml" '
        'media-type="application/vnd.adobe.indesign-idml-package"/>\n'
        '  </rootfiles>\n'
        '</container>\n'
    )


def designmap_xml(n_spreads: int, story_ids: list[str]) -> str:
    spread_idrefs = "\n".join(
        f'  <idPkg:Spread src="Spreads/Spread_u{200 + i}.xml" '
        f'xmlns:idPkg="http://ns.adobe.com/AdobeInDesign/idml/1.0/packaging"/>'
        for i in range(n_spreads)
    )
    story_idrefs = "\n".join(
        f'  <idPkg:Story src="Stories/Story_{sid}.xml" '
        f'xmlns:idPkg="http://ns.adobe.com/AdobeInDesign/idml/1.0/packaging"/>'
        for sid in story_ids
    )
    return (
        XML_DECL
        + '<?aid style="50" type="document" readerVersion="6.0" '
        'featureSet="257" product="16.0(180)" ?>\n'
        '<Document xmlns:idPkg="http://ns.adobe.com/AdobeInDesign/idml/1.0/packaging" '
        'Self="d" StoryList="" Name="Cadenza_Presentazione_Direzione.indd" '
        'ZeroPoint="0 0" ActiveLayer="ub" UnusedSwatches="" PreflightProfile="n" '
        'AppliedTOCStyle="n" CMYKProfile="U.S. Web Coated (SWOP) v2" '
        'RGBProfile="sRGB IEC61966-2.1" '
        f'DOMVersion="{DOMVERSION}">\n'
        '  <Language Self="ksItalian" Name="$ID/Italian: 2014" '
        'SingleQuotes="‘’" DoubleQuotes="“”" '
        'PrimaryLanguageName="$ID/Italian: 2014" Id="3"/>\n'
        '  <Layer Self="ub" Name="Layer 1" Visible="true" Locked="false" '
        'IgnoreWrap="false" ShowGuides="true" LockGuides="false" '
        'UI="true" Expendable="true" Printable="true">\n'
        '    <Properties><LayerColor type="enumeration">LightBlue</LayerColor></Properties>\n'
        '  </Layer>\n'
        f'  <Section Self="uSec1" Length="{n_spreads}" Name="" '
        'ContinueNumbering="false" IncludeSectionPrefix="false" '
        'SectionPrefix="" PageNumberStart="1" '
        'PageNumberStyle="Arabic" MarkerForCustomPageNumber="" '
        'PageStart="upage_0"/>\n'
        '  <idPkg:MasterSpread '
        'src="MasterSpreads/MasterSpread_uMS.xml" '
        'xmlns:idPkg="http://ns.adobe.com/AdobeInDesign/idml/1.0/packaging"/>\n'
        f'{spread_idrefs}\n'
        f'{story_idrefs}\n'
        '  <idPkg:BackingStory src="XML/BackingStory.xml" '
        'xmlns:idPkg="http://ns.adobe.com/AdobeInDesign/idml/1.0/packaging"/>\n'
        '  <idPkg:Preferences src="Resources/Preferences.xml" '
        'xmlns:idPkg="http://ns.adobe.com/AdobeInDesign/idml/1.0/packaging"/>\n'
        '  <idPkg:Fonts src="Resources/Fonts.xml" '
        'xmlns:idPkg="http://ns.adobe.com/AdobeInDesign/idml/1.0/packaging"/>\n'
        '  <idPkg:Styles src="Resources/Styles.xml" '
        'xmlns:idPkg="http://ns.adobe.com/AdobeInDesign/idml/1.0/packaging"/>\n'
        '  <idPkg:Graphic src="Resources/Graphic.xml" '
        'xmlns:idPkg="http://ns.adobe.com/AdobeInDesign/idml/1.0/packaging"/>\n'
        '</Document>\n'
    )


def backing_story_xml() -> str:
    return (
        XML_DECL
        + '<idPkg:BackingStory xmlns:idPkg="http://ns.adobe.com/AdobeInDesign/idml/1.0/packaging" '
        f'DOMVersion="{DOMVERSION}">\n'
        '  <XmlStory Self="uBackingStory" AppliedTOCStyle="n" '
        'TrackChanges="false" StoryTitle="$ID/" AppliedNamedGrid="n">\n'
        '    <StoryPreference Self="uBSPref" OpticalMarginAlignment="false" '
        'OpticalMarginSize="12" FrameType="TextFrameType" StoryOrientation="Horizontal" '
        'StoryDirection="LeftToRightDirection"/>\n'
        '    <InCopyExportOption Self="uBSICX" IncludeGraphicProxies="true" '
        'IncludeAllResources="false"/>\n'
        '  </XmlStory>\n'
        '</idPkg:BackingStory>\n'
    )


def escape_xml(s: str) -> str:
    return (s.replace("&", "&amp;")
             .replace("<", "&lt;")
             .replace(">", "&gt;")
             .replace('"', "&quot;"))


def story_xml(story_id: str, text_content: str, paragraph_style: str,
              align: str = "left") -> str:
    """Single-paragraph story; multi-line `text_content` su \\n diventa
    Br elements."""
    just_map = {"left": "LeftAlign", "center": "CenterAlign", "right": "RightAlign"}
    just = just_map.get(align, "LeftAlign")
    # escape and split on \n -> Br
    paragraphs = text_content.split("\n")
    para_xml_blocks = []
    for i, para in enumerate(paragraphs):
        content = escape_xml(para)
        para_xml_blocks.append(
            f'    <ParagraphStyleRange '
            f'AppliedParagraphStyle="ParagraphStyle/{paragraph_style}" '
            f'Justification="{just}">\n'
            f'      <CharacterStyleRange '
            f'AppliedCharacterStyle="CharacterStyle/$ID/[No character style]">\n'
            f'        <Content>{content}</Content>\n'
            + ("        <Br/>\n" if i < len(paragraphs) - 1 else "")
            + f'      </CharacterStyleRange>\n'
            f'    </ParagraphStyleRange>'
        )
    return (
        XML_DECL
        + '<idPkg:Story xmlns:idPkg="http://ns.adobe.com/AdobeInDesign/idml/1.0/packaging" '
        f'DOMVersion="{DOMVERSION}">\n'
        f'  <Story Self="{story_id}" AppliedTOCStyle="n" TrackChanges="false" '
        'StoryTitle="$ID/" AppliedNamedGrid="n">\n'
        f'    <StoryPreference Self="{story_id}p" OpticalMarginAlignment="false" '
        'OpticalMarginSize="12" FrameType="TextFrameType" '
        'StoryOrientation="Horizontal" '
        'StoryDirection="LeftToRightDirection"/>\n'
        f'    <InCopyExportOption Self="{story_id}ic" IncludeGraphicProxies="true" '
        'IncludeAllResources="false"/>\n'
        + "\n".join(para_xml_blocks) + "\n"
        '  </Story>\n'
        '</idPkg:Story>\n'
    )


def page_xml(page_idx: int) -> str:
    return (
        f'    <Page Self="upage_{page_idx}" AppliedMaster="uMS" '
        f'OverrideList="" MasterPageTransform="1 0 0 1 0 0" Name="{page_idx + 1}" '
        f'AppliedAlternateLayout="uSec1" LayoutRule="UseMaster" '
        f'AppliedTrapPreset="TrapPreset/$ID/kDefaultTrapStyleName" '
        f'GridStartingPoint="TopOutside" UseMasterGrid="true" '
        f'GeometricBounds="0 0 {H} {W}" ItemTransform="1 0 0 1 0 0">\n'
        f'      <Properties>\n'
        f'        <Descriptor type="list">\n'
        f'          <ListItem type="string">arabic-1</ListItem>\n'
        f'          <ListItem type="enumeration">Arabic</ListItem>\n'
        f'          <ListItem type="boolean">true</ListItem>\n'
        f'          <ListItem type="boolean">false</ListItem>\n'
        f'          <ListItem type="long">{page_idx + 1}</ListItem>\n'
        f'          <ListItem type="string"/>\n'
        f'          <ListItem type="enumeration">DoublesidedDocument</ListItem>\n'
        f'          <ListItem type="enumeration">RightHand</ListItem>\n'
        f'        </Descriptor>\n'
        f'      </Properties>\n'
        f'      <MarginPreference Self="uMP_{page_idx}" ColumnCount="1" '
        f'ColumnGutter="0" Top="0" Bottom="0" Left="0" Right="0" '
        f'ColumnDirection="Horizontal" ColumnsPositions="0 {W}"/>\n'
        f'    </Page>\n'
    )


def rect_path_points(x0: float, y0: float, x1: float, y1: float) -> str:
    pts = [(x0, y0), (x0, y1), (x1, y1), (x1, y0)]
    return "".join(
        f'<PathPointType Anchor="{a} {b}" '
        f'LeftDirection="{a} {b}" RightDirection="{a} {b}"/>'
        for (a, b) in pts
    )


def render_rect(uid: str, el: El) -> str:
    """Pure rectangle (no content), used for backgrounds, cards, accent bars."""
    cx = el.x + el.w / 2
    cy = el.y + el.h / 2
    half_w = el.w / 2
    half_h = el.h / 2
    fill_attr = f'FillColor="{color_self(el.fill)}"' if el.fill else 'FillColor="Swatch/None"'
    stroke_attr = (f'StrokeColor="{color_self(el.stroke)}" StrokeWeight="{el.stroke_w}"'
                   if el.stroke and el.stroke_w > 0
                   else 'StrokeColor="Swatch/None" StrokeWeight="0"')
    radius = el.radius
    if radius > 0:
        # Use CornerOption=Rounded with corner radius
        corner_attrs = (f'TopLeftCornerOption="RoundedCorner" '
                        f'TopLeftCornerRadius="{radius}" '
                        f'TopRightCornerOption="RoundedCorner" '
                        f'TopRightCornerRadius="{radius}" '
                        f'BottomLeftCornerOption="RoundedCorner" '
                        f'BottomLeftCornerRadius="{radius}" '
                        f'BottomRightCornerOption="RoundedCorner" '
                        f'BottomRightCornerRadius="{radius}" ')
    else:
        corner_attrs = ""
    return (
        f'    <Rectangle Self="{uid}" StoryTitle="$ID/" '
        f'ContentType="Unassigned" Visible="true" Name="" '
        f'{fill_attr} {stroke_attr} {corner_attrs}'
        f'GradientFillStart="0 0" GradientFillLength="0" '
        f'GradientFillAngle="0" ItemLayer="ub" Locked="false" '
        f'AppliedObjectStyle="ObjectStyle/$ID/[None]" '
        f'ItemTransform="1 0 0 1 {cx} {cy}">\n'
        f'      <Properties>\n'
        f'        <PathGeometry>\n'
        f'          <GeometryPathType PathOpen="false">\n'
        f'            <PathPointArray>\n'
        f'              {rect_path_points(-half_w, -half_h, half_w, half_h)}\n'
        f'            </PathPointArray>\n'
        f'          </GeometryPathType>\n'
        f'        </PathGeometry>\n'
        f'      </Properties>\n'
        f'    </Rectangle>\n'
    )


def render_image(uid: str, el: El, image_uid: str, link_uid: str) -> str:
    cx = el.x + el.w / 2
    cy = el.y + el.h / 2
    half_w = el.w / 2
    half_h = el.h / 2
    return (
        f'    <Rectangle Self="{uid}" StoryTitle="$ID/" '
        f'ContentType="GraphicType" Visible="true" Name="" '
        f'FillColor="Swatch/None" StrokeColor="Swatch/None" StrokeWeight="0" '
        f'ItemLayer="ub" Locked="false" '
        f'AppliedObjectStyle="ObjectStyle/$ID/[None]" '
        f'ItemTransform="1 0 0 1 {cx} {cy}">\n'
        f'      <Properties>\n'
        f'        <PathGeometry>\n'
        f'          <GeometryPathType PathOpen="false">\n'
        f'            <PathPointArray>\n'
        f'              {rect_path_points(-half_w, -half_h, half_w, half_h)}\n'
        f'            </PathPointArray>\n'
        f'          </GeometryPathType>\n'
        f'        </PathGeometry>\n'
        f'      </Properties>\n'
        f'      <Image Self="{image_uid}" Visible="true" Name="" '
        f'ItemTransform="1 0 0 1 -{half_w} -{half_h}" '
        f'LocalDisplaySetting="Default" ImageRenderingIntent="UseColorSettings" '
        f'AppliedObjectStyle="ObjectStyle/$ID/[None]" Space="$ID/RGB" '
        f'ActualPpi="72 72" EffectivePpi="72 72" ImageTypeName="$ID/Photoshop" '
        f'ItemLayer="ub" Locked="false">\n'
        f'        <Properties>\n'
        f'          <Profile type="string">$ID/Embedded</Profile>\n'
        f'          <GraphicBounds Left="0" Top="0" Right="{el.w}" Bottom="{el.h}"/>\n'
        f'        </Properties>\n'
        f'        <Link Self="{link_uid}" '
        f'AssetURL="$ID/" AssetID="$ID/" '
        f'LinkResourceURI="file:Links/{el.src}" '
        f'LinkResourceFormat="$ID/PNG" StoredState="Normal" '
        f'LinkClassID="35906" LinkClientID="257" '
        f'LinkResourceModified="false" LinkObjectModified="false" '
        f'ShowInUI="true" CanEmbed="true" CanUnembed="true" '
        f'CanPackage="true" ImportPolicy="NoAutoImport" '
        f'ExportPolicy="NoAutoExport" LinkImportStamp="" '
        f'LinkImportModificationTime="" LinkImportTime="" '
        f'LinkResourceSize="0~0"/>\n'
        f'      </Image>\n'
        f'    </Rectangle>\n'
    )


def render_text_frame(uid: str, el: El, story_id: str) -> str:
    cx = el.x + el.w / 2
    cy = el.y + el.h / 2
    half_w = el.w / 2
    half_h = el.h / 2
    return (
        f'    <TextFrame Self="{uid}" ParentStory="{story_id}" '
        f'PreviousTextFrame="n" NextTextFrame="n" ContentType="TextType" '
        f'StoryTitle="$ID/" Visible="true" Name="" '
        f'FillColor="Swatch/None" StrokeColor="Swatch/None" StrokeWeight="0" '
        f'ItemLayer="ub" Locked="false" '
        f'AppliedObjectStyle="ObjectStyle/$ID/[None]" '
        f'ItemTransform="1 0 0 1 {cx} {cy}">\n'
        f'      <Properties>\n'
        f'        <PathGeometry>\n'
        f'          <GeometryPathType PathOpen="false">\n'
        f'            <PathPointArray>\n'
        f'              {rect_path_points(-half_w, -half_h, half_w, half_h)}\n'
        f'            </PathPointArray>\n'
        f'          </GeometryPathType>\n'
        f'        </PathGeometry>\n'
        f'      </Properties>\n'
        f'      <TextFramePreference Self="{uid}p" '
        f'TextColumnCount="1" TextColumnGutter="0" '
        f'AutoSizingReferencePoint="CenterPoint" '
        f'AutoSizingType="Off" '
        f'FirstBaselineOffset="LeadingOffset" MinimumFirstBaselineOffset="0" '
        f'IgnoreWrap="false" Inset="0 0 0 0"/>\n'
        f'    </TextFrame>\n'
    )


def build_spread(spread_idx: int, elements: list[El],
                 story_data: list[tuple[str, str, str, str]]) -> str:
    """story_data is filled in-place: list of (story_id, text, style, align)."""
    self_id = f"u{200 + spread_idx}"
    page_section = page_xml(spread_idx)
    # Render elements
    out_pieces = []
    for i, el in enumerate(elements):
        uid_base = f"u{spread_idx:02d}_{i:03d}"
        if el.type == "rect":
            out_pieces.append(render_rect(uid_base, el))
        elif el.type == "line":
            # rappresentiamo la linea come rettangolo sottile
            line_h = max(el.stroke_w, 1)
            line_el = El(type="rect", x=el.x, y=el.y - line_h / 2,
                         w=el.w, h=line_h, fill=el.fill)
            out_pieces.append(render_rect(uid_base, line_el))
        elif el.type == "image":
            img_uid = f"{uid_base}_img"
            link_uid = f"{uid_base}_lnk"
            out_pieces.append(render_image(uid_base, el, img_uid, link_uid))
        elif el.type == "text":
            story_id = f"st_{spread_idx:02d}_{i:03d}"
            story_data.append((story_id, el.text, el.style, el.align))
            out_pieces.append(render_text_frame(uid_base, el, story_id))
        elif el.type == "icon":
            stroke_w = el.stroke_w if el.stroke_w > 0 else max(1.0, el.w / 12)
            xml = build_icon_xml(
                name=el.extra["icon_name"],
                uid=uid_base,
                cx=el.x, cy=el.y, size=el.w,
                color_swatch=color_self(el.fill or "Ink"),
                stroke_w=stroke_w,
            )
            if xml:
                out_pieces.append(xml)
    return (
        XML_DECL
        + '<idPkg:Spread xmlns:idPkg="http://ns.adobe.com/AdobeInDesign/idml/1.0/packaging" '
        f'DOMVersion="{DOMVERSION}">\n'
        f'  <Spread Self="{self_id}" PageCount="1" BindingLocation="0" '
        f'ShowMasterItems="true" AllowPageShuffle="true" PageTransitionType="None" '
        f'PageTransitionDirection="NotApplicable" PageTransitionDuration="Medium" '
        f'FlattenerOverride="Default">\n'
        f'    <FlattenerPreference Self="uFlat_{spread_idx}"/>\n'
        + page_section
        + "".join(out_pieces)
        + '  </Spread>\n'
        '</idPkg:Spread>\n'
    )


def main():
    if not SLIDES_DIR.exists():
        raise SystemExit(f"Cartella mancante: {SLIDES_DIR}")
    n = len(SLIDES)
    print(f"Building IDML with {n} pages → {OUT_PATH}")

    # Quali PNG ci servono in Links/?
    needed_pngs = set()
    needed_pngs.add("cadenza.png")  # logo embedded
    # Schermate reali (slide 5-10)
    for slide_png in [
        "dashboard.png", "rooms.png", "booking.png",
        "admin-monte-ore.png", "admin-analytics.png", "admin-structure.png",
    ]:
        needed_pngs.add(slide_png)

    # Prepara story_data per tutto il doc
    all_stories: list[tuple[str, str, str, str]] = []
    spreads_xml: list[str] = []
    for idx, fn in enumerate(SLIDES):
        elements = fn(idx + 1, n)
        spreads_xml.append(build_spread(idx, elements, all_stories))

    story_ids = [sid for (sid, _, _, _) in all_stories]

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(OUT_PATH, "w", zipfile.ZIP_DEFLATED) as zf:
        info = zipfile.ZipInfo("mimetype")
        info.compress_type = zipfile.ZIP_STORED
        zf.writestr(info, b"application/vnd.adobe.indesign-idml-package")

        zf.writestr("META-INF/container.xml", container_xml())
        zf.writestr("designmap.xml", designmap_xml(n, story_ids))
        zf.writestr("Resources/Fonts.xml", fonts_xml())
        zf.writestr("Resources/Styles.xml", styles_xml())
        zf.writestr("Resources/Preferences.xml", preferences_xml())
        zf.writestr("Resources/Graphic.xml", graphic_xml())
        zf.writestr("MasterSpreads/MasterSpread_uMS.xml", master_spread_xml())
        zf.writestr("XML/BackingStory.xml", backing_story_xml())

        for i, sx in enumerate(spreads_xml):
            zf.writestr(f"Spreads/Spread_u{200 + i}.xml", sx)
            print(f"  ✓ Spread {i + 1}/{n}")

        for sid, text_content, style, align in all_stories:
            zf.writestr(f"Stories/Story_{sid}.xml",
                        story_xml(sid, text_content, style, align))
        print(f"  ✓ {len(all_stories)} text stories")

        # Embed PNG necessarie in Links/
        # cadenza.png: dal frontend public
        if ICON_PATH.exists():
            zf.write(ICON_PATH, arcname="Links/cadenza.png")
        # screenshot dalle slide_proposta (catturati in promo/screenshots/)
        SHOTS_DIR = ROOT / "screenshots"
        for png in [
            "dashboard.png", "rooms.png", "booking.png",
            "admin-monte-ore.png", "admin-analytics.png", "admin-structure.png",
        ]:
            shot_path = SHOTS_DIR / png
            if shot_path.exists():
                zf.write(shot_path, arcname=f"Links/{png}")
        print(f"  ✓ {len(needed_pngs)} PNG embed in Links/")

    print(f"\nIDML pronto: {OUT_PATH}  ({OUT_PATH.stat().st_size / 1024 / 1024:.1f} MB)")


if __name__ == "__main__":
    main()
