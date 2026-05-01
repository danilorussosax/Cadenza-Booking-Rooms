#!/usr/bin/env python3
"""Generate the full 'Cadenza · Presentazione per i Direttori' PDF.

Tratto dal documento di marketing/tecnico `Proposta.md`. Pensato come
illustrazione delle potenzialità del software e dei punti di forza
rispetto a ASIMUT / EasyStaff. Stile grafico identico alla piattaforma
(palette derivata da `frontend/src/index.css`, screenshot reali, font
Helvetica/Crimson, rounded cards 18-22px).

Output:
- promo/slides_proposta/slide_XX.png  (1920×1080 PNG)
- /Users/danilorusso/Desktop/prenota-aule/Cadenza_Presentazione_Direzione.pdf
"""

import os
import random
import sys
from PIL import Image, ImageDraw, ImageFilter, ImageFont

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lucide_render import render_icon

W, H = 1920, 1080

# Palette derivata dai design token reali della webapp (light theme).
NAVY_DEEP = (15, 23, 42)        # foreground
NAVY = (28, 56, 115)            # primary
NAVY_MID = (22, 40, 86)
NAVY_LIGHT = (51, 87, 158)
GOLD = (243, 148, 5)            # warning / accent
GOLD_LIGHT = (250, 188, 80)
GOLD_PALE = (252, 215, 155)
WHITE = (255, 255, 255)
PAPER = (248, 250, 252)
PAPER_DARK = (226, 232, 240)
DIM = (148, 163, 184)
INK = (15, 23, 42)
NEUTRAL = (100, 116, 139)
GREEN = (22, 163, 74)
GREEN_DARK = (16, 122, 56)
RED = (220, 38, 38)
RED_DARK = (175, 26, 26)

ROOT = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(ROOT, "slides_proposta")
SHOTS = os.path.join(ROOT, "screenshots")
# Master icon: prefer la copia pubblica (stessa che la webapp serve come logo).
# Fallback all'altra collocazione se la prima manca.
_ICON_CANDIDATES = [
    "/Users/danilorusso/Desktop/prenota-aule/conservatory-app/frontend/public/cadenza.png",
    "/Users/danilorusso/Desktop/prenota-aule/cadenza.png",
    "/Users/danilorusso/Desktop/prenota-aule/ALTRI FILE DI USO/cadenza.png",
]
ICON_PATH = next((p for p in _ICON_CANDIDATES if os.path.exists(p)), _ICON_CANDIDATES[0])
PDF_OUT = "/Users/danilorusso/Desktop/prenota-aule/Cadenza_Presentazione_Direzione.pdf"
os.makedirs(OUT, exist_ok=True)

HELV = "/System/Library/Fonts/HelveticaNeue.ttc"
ARIAL_BOLD = "/System/Library/Fonts/Supplemental/Arial Bold.ttf"
ARIAL_BLACK = "/System/Library/Fonts/Supplemental/Arial Black.ttf"
ARIAL = "/System/Library/Fonts/Supplemental/Arial.ttf"
CRIMSON_BLACK = "/Library/Fonts/CrimsonPro-Black.ttf"
CRIMSON_BOLD = "/Library/Fonts/CrimsonPro-Bold.ttf"
CRIMSON_REG = "/Library/Fonts/CrimsonPro-Regular.ttf"


# ─────────── helpers ───────────


def font(path, size):
    return ImageFont.truetype(path, size)


def text_size(d, txt, fnt):
    l, t, r, b = d.textbbox((0, 0), txt, font=fnt)
    return r - l, b - t, l, t


def t_centered(d, xy, txt, fnt, fill):
    cx, cy = xy
    w, h, ox, oy = text_size(d, txt, fnt)
    d.text((cx - w / 2 - ox, cy - h / 2 - oy), txt, font=fnt, fill=fill)


def t_(d, xy, txt, fnt, fill, anchor="lt"):
    x, y = xy
    w, h, ox, oy = text_size(d, txt, fnt)
    if anchor == "lt":
        d.text((x - ox, y - oy), txt, font=fnt, fill=fill)
    elif anchor == "lm":
        d.text((x - ox, y - h / 2 - oy), txt, font=fnt, fill=fill)
    elif anchor == "mt":
        d.text((x - w / 2 - ox, y - oy), txt, font=fnt, fill=fill)
    elif anchor == "mm":
        d.text((x - w / 2 - ox, y - h / 2 - oy), txt, font=fnt, fill=fill)
    elif anchor == "rt":
        d.text((x - w - ox, y - oy), txt, font=fnt, fill=fill)
    elif anchor == "rm":
        d.text((x - w - ox, y - h / 2 - oy), txt, font=fnt, fill=fill)


def gradient_bg(top, bottom):
    img = Image.new("RGB", (W, H), top)
    px = img.load()
    for y in range(H):
        t = y / (H - 1)
        r = int(top[0] * (1 - t) + bottom[0] * t)
        g = int(top[1] * (1 - t) + bottom[1] * t)
        b = int(top[2] * (1 - t) + bottom[2] * t)
        for x in range(W):
            px[x, y] = (r, g, b)
    return img


def add_radial_glow(img, cx, cy, color, max_r=900, alpha_max=70):
    overlay = Image.new("RGBA", img.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(overlay)
    for r in range(max_r, 0, -10):
        a = int(alpha_max * (1 - r / max_r) ** 2.4)
        d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=color + (a,))
    base = img.convert("RGBA")
    base = Image.alpha_composite(base, overlay)
    return base.convert("RGB")


def add_grain(img, amount=10):
    random.seed(42)
    overlay = Image.new("RGBA", img.size, (0, 0, 0, 0))
    px = overlay.load()
    for y in range(0, H, 2):
        for x in range(0, W, 2):
            if random.random() < 0.5:
                a = random.randint(0, amount)
                v = 255 if random.random() < 0.5 else 0
                px[x, y] = (v, v, v, a)
    base = img.convert("RGBA")
    base = Image.alpha_composite(base, overlay)
    return base.convert("RGB")


_ICON_CACHE = {}


def load_icon(size):
    key = int(size)
    if key not in _ICON_CACHE:
        ic = Image.open(ICON_PATH).convert("RGBA")
        _ICON_CACHE[key] = ic.resize((key, key), Image.LANCZOS)
    return _ICON_CACHE[key]


def paste_icon(img, cx, cy, size):
    base = img.convert("RGBA")
    icon = load_icon(size)
    base.alpha_composite(icon, (int(cx - size / 2), int(cy - size / 2)))
    return base.convert("RGB")


def paste_lucide(img, name, cx, cy, size, color=(15, 23, 42)):
    """Renderizza icona lucide vettoriale a 4x e la incolla centrata."""
    base = img.convert("RGBA")
    hi = render_icon(name, size=size * 4, color=color, stroke_width=size / 3)
    hi = hi.resize((int(size), int(size)), Image.LANCZOS)
    base.alpha_composite(hi, (int(cx - size / 2), int(cy - size / 2)))
    return base.convert("RGB")


def gold_underline(d, x, y, width=180, thickness=6):
    d.rectangle([x, y, x + width, y + thickness], fill=GOLD)


def light_canvas():
    return gradient_bg(PAPER, PAPER_DARK)


def dark_canvas():
    img = gradient_bg(NAVY_DEEP, NAVY)
    img = add_radial_glow(img, int(W * 0.78), int(H * 0.30), GOLD, max_r=900, alpha_max=55)
    return img


def header_bar(img, title, kicker=None, page=None, total=None):
    d = ImageDraw.Draw(img)
    img = paste_icon(img, 90, 95, 72)
    d = ImageDraw.Draw(img)
    if kicker:
        t_(d, (160, 70), kicker.upper(), font(ARIAL_BOLD, 22), GOLD)
    t_(d, (160, 100), title, font(CRIMSON_BLACK, 50), INK)
    gold_underline(d, 160, 165, width=80, thickness=5)
    if page is not None and total is not None:
        t_(d, (W - 80, 95), f"{page:02d} / {total:02d}", font(HELV, 22), NEUTRAL, anchor="rm")
    return img


def footer_bar(img, page=None, total=None):
    d = ImageDraw.Draw(img)
    d.rectangle([0, H - 60, W, H - 59], fill=PAPER_DARK)
    img = paste_icon(img, 80, H - 30, 36)
    d = ImageDraw.Draw(img)
    t_(d, (115, H - 30), "Cadenza · Per i direttori dei conservatori",
       font(ARIAL_BOLD, 22), INK, anchor="lm")
    if page is not None and total is not None:
        t_(d, (W - 80, H - 30), f"{page:02d} / {total:02d}",
           font(HELV, 22), NEUTRAL, anchor="rm")
    return img


def rounded_card(d, xy, fill, outline=None, radius=18, width=2):
    d.rounded_rectangle(xy, radius=radius, fill=fill, outline=outline, width=width)


def embed_screenshot(img, x, y, w, h, name, *, shadow=True):
    src = Image.open(os.path.join(SHOTS, name)).convert("RGB")
    sw, sh = src.size
    scale = min(w / sw, h / sh)
    nw, nh = int(sw * scale), int(sh * scale)
    src = src.resize((nw, nh), Image.LANCZOS)
    cx = x + (w - nw) // 2
    cy = y + (h - nh) // 2
    if shadow:
        shadow_layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
        sd = ImageDraw.Draw(shadow_layer)
        for k in range(8):
            a = int(40 * (1 - k / 8))
            sd.rounded_rectangle(
                [cx - 4 + k, cy + 6 + k, cx + nw + 4 - k, cy + nh + 10 - k],
                radius=14, fill=(0, 0, 0, a),
            )
        base = img.convert("RGBA")
        base = Image.alpha_composite(base, shadow_layer)
        img = base.convert("RGB")
    img.paste(src, (cx, cy))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([cx - 1, cy - 1, cx + nw + 1, cy + nh + 1],
                        radius=10, outline=PAPER_DARK, width=1)
    return img


# ─────────── slide renderers ───────────


def slide_01_cover(idx, total):
    img = dark_canvas()
    img = paste_icon(img, W // 2, int(H * 0.28), size=300)
    d = ImageDraw.Draw(img)
    t_centered(d, (W // 2, int(H * 0.52)), "CADENZA",
               font(CRIMSON_BLACK, 180), WHITE)
    gold_underline(d, W // 2 - 130, int(H * 0.62) + 8, width=260, thickness=6)
    t_centered(d, (W // 2, int(H * 0.70)),
               "Software gratuito per il Conservatorio",
               font(CRIMSON_BOLD, 54), GOLD_LIGHT)
    t_centered(d, (W // 2, int(H * 0.78)),
               "Booking aule · Monte Ore · Strumenti · Avvisi · Kiosk",
               font(HELV, 30), DIM)
    t_centered(d, (W // 2, int(H * 0.87)),
               "Sviluppato da Danilo Russo, docente del Conservatorio",
               font(CRIMSON_BOLD, 28), GOLD_PALE)
    t_centered(d, (W // 2, int(H * 0.93)),
               "29 aprile 2026 · Presentazione per Direzione, DSGA e responsabili IT",
               font(HELV, 22), DIM)
    return finalize(img, idx)


def slide_02_perchè(idx, total):
    img = light_canvas()
    img = header_bar(img, "Perché parliamo di questo, oggi",
                     "INTRO", idx, total)
    d = ImageDraw.Draw(img)

    rows = [
        ("21", "PNRR Missione 4: 21 mld €",
         "Per digitalizzazione e trasformazione delle istituzioni AFAM\nentro il 2026."),
        ("79", "79 Conservatori statali",
         "+ 50 istituti AFAM: pubblica amministrazione con vincoli\nGDPR, MEPA, conservazione sostitutiva, ANIS/MIUR."),
        ("3-15k", "Budget software 3.000–15.000 € / anno",
         "Concorrenti esteri (ASIMUT) costano 15.000–40.000 €.\nLe alternative italiane non sono verticali sul Conservatorio."),
    ]
    by = 250
    cw = 540
    gap = 30
    base_x = (W - 3 * cw - 2 * gap) // 2
    for i, (big, title, body) in enumerate(rows):
        x = base_x + i * (cw + gap)
        rounded_card(d, [x, by, x + cw, by + 600], fill=WHITE,
                     outline=PAPER_DARK, radius=22, width=2)
        t_centered(d, (x + cw // 2, by + 130), big,
                   font(CRIMSON_BLACK, 130), GOLD)
        gold_underline(d, x + cw // 2 - 60, by + 230, width=120, thickness=4)
        t_centered(d, (x + cw // 2, by + 290), title,
                   font(CRIMSON_BOLD, 34), INK)
        for j, line in enumerate(body.split("\n")):
            t_centered(d, (x + cw // 2, by + 380 + j * 38), line,
                       font(HELV, 26), INK)

    return finalize(footer_bar(img, idx, total), idx)


def slide_03_che_cose(idx, total):
    img = light_canvas()
    img = header_bar(img, "Cadenza in una pagina",
                     "COSA È", idx, total)
    d = ImageDraw.Draw(img)

    t_(d, (90, 220),
       "Una piattaforma SaaS open-source progettata",
       font(CRIMSON_BOLD, 50), INK)
    t_(d, (90, 280),
       "specificamente per i conservatori italiani.",
       font(CRIMSON_REG, 50), NAVY)

    bullets = [
        ("31", "modelli Sequelize", "Architettura solida verificata"),
        ("100+", "endpoint API", "REST coerente, documentazione fluente"),
        ("169", "test automatici", "Continuous integration GitHub Actions"),
        ("3", "lingue supportate", "Italiano · Inglese · Spagnolo"),
        ("1", "deploy command", "VPS Ubuntu o Docker, zero lock-in cloud"),
        ("0", "doppie prenotazioni", "Garantito a livello DB Postgres EXCLUDE"),
    ]
    by = 380
    cw = (W - 200 - 30 * 2) // 3
    for i, (val, lbl, sub) in enumerate(bullets):
        col = i % 3
        row = i // 3
        x = 90 + col * (cw + 30)
        y = by + row * 240
        rounded_card(d, [x, y, x + cw, y + 210], fill=WHITE,
                     outline=PAPER_DARK, radius=18, width=2)
        t_(d, (x + 30, y + 30), val, font(CRIMSON_BLACK, 80), NAVY)
        t_(d, (x + 30, y + 130), lbl, font(CRIMSON_BOLD, 30), INK)
        t_(d, (x + 30, y + 170), sub, font(HELV, 22), NEUTRAL)

    return finalize(footer_bar(img, idx, total), idx)


def slide_04_4_risposte(idx, total):
    img = light_canvas()
    img = header_bar(img, "Quattro risposte concrete",
                     "DOMINI FUNZIONALI", idx, total)

    items = [
        ("calendar-plus", "Booking aule",
         "Self-service in 3 tap. Anti-overlap garantito DB.\n"
         "Approval workflow per sale concerti. Waitlist auto-promote.",
         "•  /booking · /rooms · /my-bookings",
         (52, 120, 220)),
        ("clock", "Monte Ore docenti",
         "Workflow contrattuale del Conservatorio (vincoli 2-4 giorni\n"
         "/ settimana, soglia 324h/anno, sospensioni didattiche).",
         "•  /monte-ore · pannello docente + admin",
         GOLD),
        ("package", "Inventario strumenti",
         "Catalogo + prestiti (5 stati). Reminder T-2gg, auto-overdue.\n"
         "PDF di consegna, email transazionali.",
         "•  /instruments · /my-loans",
         (22, 163, 74)),
        ("megaphone", "Avvisi & Kiosk",
         "Bacheca con audience filter (ruolo · corso · edificio).\n"
         "Display di sala con rotazione concerti + annunci.",
         "•  /announcements · /display",
         (139, 92, 246)),
    ]
    by = 240
    cw = (W - 200) // 2
    rh = 350
    for i, (icon_name, title, body, route, color) in enumerate(items):
        col = i % 2
        row = i // 2
        x = 90 + col * (cw + 20)
        y = by + row * (rh + 20)
        d = ImageDraw.Draw(img)
        rounded_card(d, [x, y, x + cw, y + rh], fill=WHITE,
                     outline=PAPER_DARK, radius=18, width=2)
        # left color bar
        d.rounded_rectangle([x, y, x + 8, y + rh], radius=4, fill=color)
        # icon badge top-right of card
        icon_bg_x = x + cw - 100
        icon_bg_y = y + 30
        d.rounded_rectangle(
            [icon_bg_x, icon_bg_y, icon_bg_x + 70, icon_bg_y + 70],
            radius=14, fill=color + (28,) if False else color)
        img = paste_lucide(img, icon_name,
                           icon_bg_x + 35, icon_bg_y + 35, 44,
                           color=(255, 255, 255))
        d = ImageDraw.Draw(img)
        t_(d, (x + 40, y + 40), title, font(CRIMSON_BLACK, 42), INK)
        for j, line in enumerate(body.split("\n")):
            t_(d, (x + 40, y + 130 + j * 38), line, font(HELV, 26), INK)
        t_(d, (x + 40, y + rh - 60), route, font(ARIAL_BOLD, 22), NAVY)

    return finalize(footer_bar(img, idx, total), idx)


def slide_screenshot(idx, total, kicker, title, png, caption):
    img = light_canvas()
    img = header_bar(img, title, kicker, idx, total)
    img = embed_screenshot(img, 90, 215, W - 180, 760, png)
    d = ImageDraw.Draw(img)
    t_centered(d, (W // 2, H - 95), caption, font(HELV, 24), NEUTRAL)
    return finalize(footer_bar(img, idx, total), idx)


def slide_05_screen_dashboard(idx, total):
    return slide_screenshot(
        idx, total,
        "SCHERMATA REALE · /dashboard",
        "Dashboard docente",
        "dashboard.png",
        "Quattro KPI personali, calendario aule giornaliero con drag-to-create, agenda prossime prenotazioni.",
    )


def slide_06_screen_rooms(idx, total):
    return slide_screenshot(
        idx, total,
        "SCHERMATA REALE · /rooms",
        "Aule del Conservatorio",
        "rooms.png",
        "Catalogo navigabile per edificio, capienza, dotazione. Filtri per attrezzatura, tipologia, prenotabilità.",
    )


def slide_07_screen_booking(idx, total):
    return slide_screenshot(
        idx, total,
        "SCHERMATA REALE · /booking",
        "Prenota un'aula",
        "booking.png",
        "Timeline 30' (08–22), legenda tipologia (studio · lezione · prova · concerto), drag-to-select.",
    )


def slide_08_screen_monte_ore(idx, total):
    return slide_screenshot(
        idx, total,
        "SCHERMATA REALE · /admin/monte-ore",
        "Monte Ore docenti — pannello admin",
        "admin-monte-ore.png",
        "Workflow proposte annuali → approvazione coordinatore → generazione prenotazioni ricorrenti.",
    )


def slide_09_screen_analytics(idx, total):
    return slide_screenshot(
        idx, total,
        "SCHERMATA REALE · /admin/analytics",
        "Analytics direzione",
        "admin-analytics.png",
        "Heatmap occupazione 7×24, top aule, no-show rate, trend 8 settimane, export CSV/PDF.",
    )


def slide_10_screen_struttura(idx, total):
    return slide_screenshot(
        idx, total,
        "SCHERMATA REALE · /admin/structure",
        "Struttura del Conservatorio",
        "admin-structure.png",
        "Anagrafica istituti, edifici, aule e catalogo dotazioni — tutto in un'unica pagina.",
    )


def slide_11_vs_asimut(idx, total):
    img = light_canvas()
    img = header_bar(img, "Cadenza vs ASIMUT", "CONFRONTO 1/2", idx, total)
    d = ImageDraw.Draw(img)
    rows = [
        ("Pricing annuo (medio)", "15.000–40.000 €", "2.400–9.600 €"),
        ("Cloud / Self-host", "Solo cloud (Danimarca)", "Cloud IT o self-host"),
        ("Lingua / supporto", "Inglese, fuso CET", "Italiano, made in Italy"),
        ("Monte Ore docenti AFAM", "—", "✓ verticale italiana"),
        ("SPID / CIE", "—", "Roadmap Sprint E"),
        ("ANIS / MIUR export", "—", "Roadmap Sprint E"),
        ("Bot Telegram / WhatsApp", "—", "✓ production-ready"),
        ("Inventario strumenti", "Generico", "✓ workflow prestito completo"),
    ]
    by = 240
    rh = 64
    cols = [(80, 880), (880, 1390), (1390, W - 80)]
    rounded_card(d, [cols[0][0], by, cols[-1][1], by + rh], fill=NAVY_DEEP, radius=10, width=0)
    headers = ("Aspetto", "ASIMUT", "Cadenza")
    for (x0, x1), txt in zip(cols, headers):
        t_centered(d, ((x0 + x1) // 2, by + rh // 2), txt,
                   font(ARIAL_BOLD, 28), WHITE)
    for i, (k, a, c) in enumerate(rows):
        y = by + (i + 1) * rh
        if i % 2 == 0:
            d.rectangle([cols[0][0], y, cols[-1][1], y + rh], fill=WHITE)
        t_(d, (cols[0][0] + 24, y + rh // 2), k, font(HELV, 24), INK, anchor="lm")
        # ASIMUT
        col_a = NEUTRAL if a == "—" else INK
        t_(d, ((cols[1][0] + cols[1][1]) // 2, y + rh // 2), a,
           font(ARIAL_BOLD, 24), col_a, anchor="mm")
        # Cadenza
        col_c = GREEN_DARK if c.startswith('✓') or '€' in c or 'Italian' in c else NAVY
        t_(d, ((cols[2][0] + cols[2][1]) // 2, y + rh // 2), c,
           font(ARIAL_BOLD, 24), col_c, anchor="mm")
    return finalize(footer_bar(img, idx, total), idx)


def slide_12_vs_easystaff(idx, total):
    img = light_canvas()
    img = header_bar(img, "Cadenza vs EasyStaff / EasyAcademy",
                     "CONFRONTO 2/2", idx, total)
    d = ImageDraw.Draw(img)
    rows = [
        ("Verticalità Conservatori", "Pacchetto università generaliste",
         "Verticale AFAM dal giorno 1"),
        ("Monte Ore", "—", "✓ workflow contrattuale Conservatorio"),
        ("Eventi / sale concerti", "—", "✓ approval + iCal + kiosk"),
        ("Inventario strumenti", "—", "✓ catalogo + prestiti completo"),
        ("Pricing AFAM medio", "8.000–15.000 €", "2.400–9.600 €"),
        ("Onboarding tipico", "8-12 settimane", "0,5–2 giornate"),
        ("Open-source / self-host", "—", "✓ codice sorgente in licenza"),
        ("Lingua e supporto", "Italiano OK", "Italiano + IT/EN/ES"),
    ]
    by = 240
    rh = 64
    cols = [(80, 880), (880, 1390), (1390, W - 80)]
    rounded_card(d, [cols[0][0], by, cols[-1][1], by + rh], fill=NAVY_DEEP, radius=10, width=0)
    headers = ("Aspetto", "EasyStaff", "Cadenza")
    for (x0, x1), txt in zip(cols, headers):
        t_centered(d, ((x0 + x1) // 2, by + rh // 2), txt,
                   font(ARIAL_BOLD, 28), WHITE)
    for i, (k, a, c) in enumerate(rows):
        y = by + (i + 1) * rh
        if i % 2 == 0:
            d.rectangle([cols[0][0], y, cols[-1][1], y + rh], fill=WHITE)
        t_(d, (cols[0][0] + 24, y + rh // 2), k, font(HELV, 24), INK, anchor="lm")
        col_a = NEUTRAL if a == "—" else INK
        t_(d, ((cols[1][0] + cols[1][1]) // 2, y + rh // 2), a,
           font(ARIAL_BOLD, 22), col_a, anchor="mm")
        col_c = GREEN_DARK if c.startswith('✓') or '€' in c or 'IT' in c else NAVY
        t_(d, ((cols[2][0] + cols[2][1]) // 2, y + rh // 2), c,
           font(ARIAL_BOLD, 22), col_c, anchor="mm")
    return finalize(footer_bar(img, idx, total), idx)


def slide_13_compliance(idx, total):
    img = dark_canvas()
    d = ImageDraw.Draw(img)
    t_centered(d, (W // 2, 160), "Italiano per definizione",
               font(CRIMSON_BLACK, 84), WHITE)
    gold_underline(d, W // 2 - 80, 250, width=160, thickness=5)
    t_centered(d, (W // 2, 315),
               "Quattro garanzie che i competitor esteri non offrono nativamente.",
               font(HELV, 30), DIM)
    badges = [
        ("flag", "Codice italiano",
         "Sviluppato in Italia, manutenzione in italiano",
         "Niente time-zone CET-only,\nniente lingua di supporto inglese"),
        ("shield-check", "GDPR Garante 06/2021",
         "Cookie, DPIA, ROPA, audit log",
         "Provvedimento 06/2021 e art. 13–17 GDPR\ncoperti by-default"),
        ("scale", "Roadmap PA italiana",
         "SPID/CIE · PEC · ANIS/MIUR",
         "Sprint E pianificato — sviluppo on-demand\nal primo Conservatorio Enterprise"),
        ("building-2", "MEPA-ready",
         "Pubblica amministrazione, MEPA, fattura elettronica",
         "Tutti i piani sotto soglia 75.000 €\n(affidamento diretto art. 50 D.Lgs.36/2023)"),
    ]
    bx = 200
    by = 440
    bw = (W - 400 - 60) // 2
    bh = 230
    for i, (icon_name, t1, t2, foot) in enumerate(badges):
        col = i % 2
        row = i // 2
        x = bx + col * (bw + 60)
        y = by + row * (bh + 30)
        d = ImageDraw.Draw(img)
        rounded_card(d, [x, y, x + bw, y + bh], fill=NAVY_LIGHT,
                     outline=GOLD, radius=20, width=2)
        # gold rounded badge with vector lucide icon
        d.rounded_rectangle([x + 30, y + 60, x + 130, y + 160],
                            radius=20, fill=GOLD)
        img = paste_lucide(img, icon_name, x + 80, y + 110, 64,
                           color=NAVY_DEEP)
        d = ImageDraw.Draw(img)
        t_(d, (x + 160, y + 50), t1, font(ARIAL_BLACK, 38), WHITE)
        t_(d, (x + 160, y + 105), t2, font(HELV, 24), DIM)
        for j, line in enumerate(foot.split("\n")):
            t_(d, (x + 160, y + 150 + j * 28), line, font(HELV, 20), GOLD_LIGHT)
    return finalize(img, idx)


def slide_14_pricing(idx, total):
    """Costi reali del Conservatorio: software gratuito, solo VPS + Claude."""
    img = light_canvas()
    img = header_bar(img, "Costi reali per il Conservatorio",
                     "TUTTO QUI", idx, total)
    d = ImageDraw.Draw(img)

    t_(d, (90, 220),
       "Software gratuito. Pagate solo l'infrastruttura.",
       font(CRIMSON_BOLD, 44), INK)
    t_(d, (90, 280),
       "Niente licenze, niente canoni, niente lock-in.",
       font(CRIMSON_REG, 36), NAVY)

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

    by = 360
    rh = 110
    for i, (icon_name, lbl, sub, price, unit) in enumerate(rows):
        y = by + i * (rh + 12)
        d = ImageDraw.Draw(img)
        rounded_card(d, [80, y, W - 80, y + rh], fill=WHITE,
                     outline=PAPER_DARK, radius=14, width=2)
        # left bar gold
        d.rectangle([80, y, 88, y + rh], fill=GOLD)
        # vector icon in a soft gold square
        d.rounded_rectangle([110, y + 25, 170, y + 85], radius=12, fill=GOLD_PALE)
        img = paste_lucide(img, icon_name, 140, y + 55, 36, color=GOLD)
        d = ImageDraw.Draw(img)
        t_(d, (190, y + 18), lbl, font(CRIMSON_BOLD, 32), INK)
        t_(d, (190, y + 65), sub, font(HELV, 22), NEUTRAL)
        t_(d, (W - 280, y + 22), price, font(CRIMSON_BLACK, 50), NAVY, anchor="lt")
        t_(d, (W - 280, y + 80), unit, font(HELV, 22), NEUTRAL, anchor="lt")

    # Total bar
    ty = by + 4 * (rh + 12) + 10
    rounded_card(d, [80, ty, W - 80, ty + 110], fill=NAVY_DEEP, radius=18, width=0)
    t_(d, (110, ty + 22), "Totale annuo Conservatorio",
       font(CRIMSON_BOLD, 32), WHITE)
    t_(d, (110, ty + 70), "Tutto incluso, IVA esclusa",
       font(HELV, 22), DIM)
    t_(d, (W - 280, ty + 26), "≈ 463 €", font(CRIMSON_BLACK, 56), GOLD_LIGHT, anchor="lt")

    return finalize(footer_bar(img, idx, total), idx)


def slide_15_simulazione_costi(idx, total):
    """TCO comparativo Cadenza vs ASIMUT — su 1, 5, 10 anni."""
    img = light_canvas()
    img = header_bar(img, "Quanto risparmiate davvero",
                     "TCO 1 / 5 / 10 ANNI", idx, total)
    d = ImageDraw.Draw(img)

    # 4 colonne (Periodo, ASIMUT, Cadenza Pro, Risparmio)
    headers = ("Periodo", "ASIMUT (medio)", "Cadenza Pro", "Risparmio")
    rows = [
        ("Anno 1",      "22.500 €",  "463 €",   "− 22.037 €"),
        ("3 anni",      "67.500 €",  "1.389 €", "− 66.111 €"),
        ("5 anni",      "112.500 €", "2.315 €", "− 110.185 €"),
        ("10 anni",     "225.000 €", "4.630 €", "− 220.370 €"),
    ]
    by = 250
    rh = 70
    cols_x = [80, 600, 1000, 1400, W - 80]

    # header row
    rounded_card(d, [cols_x[0], by, cols_x[-1], by + rh],
                 fill=NAVY_DEEP, radius=12, width=0)
    for i, h in enumerate(headers):
        cx = (cols_x[i] + cols_x[i + 1]) // 2
        t_centered(d, (cx, by + rh // 2), h, font(ARIAL_BOLD, 28), WHITE)

    for i, (per, av, cv, sv) in enumerate(rows):
        y = by + (i + 1) * rh
        if i % 2 == 0:
            d.rectangle([cols_x[0], y, cols_x[-1], y + rh], fill=WHITE)
        # Periodo
        t_(d, ((cols_x[0] + cols_x[1]) // 2, y + rh // 2), per,
           font(CRIMSON_BOLD, 28), INK, anchor="mm")
        # ASIMUT
        t_(d, ((cols_x[1] + cols_x[2]) // 2, y + rh // 2), av,
           font(ARIAL_BOLD, 28), RED_DARK, anchor="mm")
        # Cadenza
        t_(d, ((cols_x[2] + cols_x[3]) // 2, y + rh // 2), cv,
           font(ARIAL_BOLD, 28), GREEN_DARK, anchor="mm")
        # Risparmio bubble
        sx0, sx1 = cols_x[3] + 30, cols_x[4] - 30
        sy0, sy1 = y + 8, y + rh - 8
        rounded_card(d, [sx0, sy0, sx1, sy1], fill=GOLD, radius=14, width=0)
        t_(d, ((sx0 + sx1) // 2, (sy0 + sy1) // 2), sv,
           font(CRIMSON_BLACK, 30), NAVY_DEEP, anchor="mm")

    # bottom callout: cosa farci
    cy = by + 5 * rh + 60
    rounded_card(d, [80, cy, W - 80, cy + 280], fill=WHITE,
                 outline=GOLD, radius=18, width=3)
    t_(d, (110, cy + 24), "Su 10 anni, 220.000 € equivalgono a:",
       font(CRIMSON_BOLD, 30), INK)
    bullets = [
        "  ◦  ~ 4 stipendi annuali docente di II fascia (lordo amministrazione)",
        "  ◦  ~ 2 organi a canne medi · oppure 6-8 pianoforti gran coda",
        "  ◦  ~ 40-50 borse di studio annuali per studenti meritevoli (5.000 € cad.)",
        "  ◦  ~ 10 ristrutturazioni di un'aula completa di insonorizzazione e impianto audio",
    ]
    for j, b in enumerate(bullets):
        t_(d, (110, cy + 80 + j * 46), b, font(HELV, 26), INK)

    return finalize(footer_bar(img, idx, total), idx)


def slide_15_bis_vps_sizing(idx, total):
    """Tabella VPS provider per dimensionamento fino a 5.000 utenti."""
    img = light_canvas()
    img = header_bar(img, "Dove ospitare Cadenza",
                     "VPS · FINO A 5.000 UTENTI", idx, total)
    d = ImageDraw.Draw(img)

    headers = ("Provider", "Datacenter", "Piano (Medio · 1.5-3k ut.)",
               "Piano (Grande · 3-5k ut.)", "Note")
    rows = [
        ("Hetzner Cloud", "DE / FI", "CPX31 — 16 €/mese", "CPX41 — 28 €/mese",
         "★ Miglior prezzo/prestazioni"),
        ("Hetzner Dedicated", "DE", "CCX23 — 39 €/mese", "CCX33 — 78 €/mese",
         "Carichi predicibili, no noisy-neighbor"),
        ("OVHcloud", "FR / DE", "VPS Comfort — 15 €/mese", "VPS Elite — 29 €/mese",
         "Provider EU consolidato"),
        ("Ionos Cloud", "DE / IT", "Cloud L — 25 €/mese", "Cloud XL — 50 €/mese",
         "Sovranità EU, supporto IT"),
        ("Aruba Cloud", "Italia", "Smart VS3 — 22 €/mese", "Smart VS4 — 50 €/mese",
         "★ Sovranità italiana piena, AGID"),
        ("Register.it", "Italia", "Cloud M — 30 €/mese", "Cloud L — 60 €/mese",
         "MEPA-ready, fatturazione PA"),
        ("DigitalOcean", "DE / NL", "Basic 4/8 — 48 €/mese", "Premium 4/8 — 56 €/mese",
         "Ecosystem mature, panel friendly"),
    ]
    by = 230
    rh = 60
    cols_x = [80, 320, 530, 920, 1320, W - 80]

    rounded_card(d, [cols_x[0], by, cols_x[-1], by + rh],
                 fill=NAVY_DEEP, radius=12, width=0)
    for i, h in enumerate(headers):
        cx = (cols_x[i] + cols_x[i + 1]) // 2
        t_centered(d, (cx, by + rh // 2), h, font(ARIAL_BOLD, 22), WHITE)

    for i, row in enumerate(rows):
        y = by + (i + 1) * rh
        if i % 2 == 0:
            d.rectangle([cols_x[0], y, cols_x[-1], y + rh], fill=WHITE)
        for j, val in enumerate(row):
            cx = (cols_x[j] + cols_x[j + 1]) // 2
            color = INK
            ftype = font(HELV, 22)
            if j == 0:
                ftype = font(CRIMSON_BOLD, 24)
                if val.startswith("Hetzner Cloud") or val.startswith("Aruba"):
                    color = NAVY
            elif j == 4 and val.startswith("★"):
                color = GOLD_DEEP if False else (200, 122, 8)
                ftype = font(ARIAL_BOLD, 20)
            else:
                ftype = font(HELV, 20)
            t_(d, (cx, y + rh // 2), val, ftype, color, anchor="mm")

    # callout finale
    cy = by + 8 * rh + 30
    rounded_card(d, [80, cy, W - 80, cy + 110], fill=NAVY_DEEP, radius=18, width=0)
    t_centered(d, (W // 2, cy + 30),
               "Tutti gli scenari rientrano in affidamento diretto (D.Lgs. 36/2023, art. 50)",
               font(CRIMSON_BOLD, 28), WHITE)
    t_centered(d, (W // 2, cy + 75),
               "Spesa annua totale: 451 € (OVH) — 738 € (Hetzner dedicated) · Tutto in fattura PA elettronica.",
               font(HELV, 22), GOLD_LIGHT)

    return finalize(footer_bar(img, idx, total), idx)


# Helper colour referenced above
GOLD_DEEP = (200, 122, 8)


def slide_16_pilota(idx, total):
    img = light_canvas()
    img = header_bar(img, "Cosa serve per partire",
                     "ATTIVAZIONE", idx, total)
    d = ImageDraw.Draw(img)
    t_(d, (90, 230),
       "Decisione → operatività in 2-4 settimane.",
       font(CRIMSON_BOLD, 38), INK)

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
    by = 320
    cw = (W - 200) // 2
    rh = 150
    for i, (icon_name, kicker, body) in enumerate(items):
        col = i % 2
        row = i // 2
        x = 90 + col * (cw + 20)
        y = by + row * (rh + 16)
        d = ImageDraw.Draw(img)
        rounded_card(d, [x, y, x + cw, y + rh], fill=WHITE,
                     outline=PAPER_DARK, radius=14, width=2)
        d.rectangle([x, y, x + 6, y + rh], fill=GOLD)
        # icon badge
        d.rounded_rectangle([x + 20, y + 30, x + 100, y + 110],
                            radius=14, fill=NAVY_DEEP)
        img = paste_lucide(img, icon_name, x + 60, y + 70, 48,
                           color=GOLD_LIGHT)
        d = ImageDraw.Draw(img)
        t_(d, (x + 120, y + 22), kicker, font(CRIMSON_BOLD, 32), NAVY)
        for j, line in enumerate(body.split("\n")):
            t_(d, (x + 120, y + 70 + j * 32), line, font(HELV, 22), INK)

    rounded_card(d, [80, 920, W - 80, 990], fill=NAVY_DEEP, radius=20, width=0)
    t_centered(d, (W // 2, 955),
               "Nessun contratto di licenza. Codice sorgente del Conservatorio.",
               font(CRIMSON_BOLD, 28), GOLD_LIGHT)
    return finalize(footer_bar(img, idx, total), idx)


def slide_17_roadmap(idx, total):
    img = light_canvas()
    img = header_bar(img, "Roadmap 12 mesi",
                     "PROSSIMI PASSI", idx, total)
    d = ImageDraw.Draw(img)
    sprints = [
        ("sparkles",       "Sprint A", "UX quick wins", "Push notif · iframe concerti\nPrivacy display · Card avvisi", "Q2 2026"),
        ("bar-chart-3",    "Sprint B", "Analytics +", "Maintenance schedule\nReport email YoY analytics", "Q2 2026"),
        ("calendar-check", "Sprint C", "Task mgmt eventi", "Gap parità ASIMUT\n(staff workflow)", "Q3 2026"),
        ("wrench",         "Sprint D", "Tech debt", "Docker compose\nSequelize-CLI · Coverage 70%", "Q3 2026"),
        ("shield-check",   "Sprint E", "PA italiana", "SPID/CIE · PEC\nANIS/MIUR · Conservazione", "Q4 2026"),
        ("bot",            "Sprint F", "Bot completi", "WhatsApp Cloud · Signal\nEmail IMAP poller", "Q1 2027"),
    ]
    by = 250
    cw = (W - 180 - 30 * 5) // 6
    for i, (icon_name, kicker, title, body, when) in enumerate(sprints):
        x = 90 + i * (cw + 30)
        d = ImageDraw.Draw(img)
        rounded_card(d, [x, by, x + cw, by + 540], fill=WHITE,
                     outline=PAPER_DARK, radius=16, width=2)
        rounded_card(d, [x, by, x + cw, by + 70], fill=NAVY_DEEP, radius=16, width=0)
        d.rectangle([x, by + 50, x + cw, by + 70], fill=NAVY_DEEP)
        t_centered(d, (x + cw // 2, by + 35), kicker, font(ARIAL_BOLD, 24), GOLD_LIGHT)
        # Vector icon in gold disc
        d.ellipse([x + cw // 2 - 40, by + 100, x + cw // 2 + 40, by + 180], fill=GOLD)
        img = paste_lucide(img, icon_name, x + cw // 2, by + 140, 50,
                           color=NAVY_DEEP)
        d = ImageDraw.Draw(img)
        t_centered(d, (x + cw // 2, by + 230), title, font(CRIMSON_BOLD, 26), INK)
        for j, line in enumerate(body.split("\n")):
            t_centered(d, (x + cw // 2, by + 310 + j * 30), line,
                       font(HELV, 20), INK)
        t_centered(d, (x + cw // 2, by + 480), when, font(ARIAL_BOLD, 22), GOLD)
    return finalize(footer_bar(img, idx, total), idx)


def slide_18_cta(idx, total):
    img = dark_canvas()
    img = paste_icon(img, W // 2, int(H * 0.26), size=220)
    d = ImageDraw.Draw(img)
    t_centered(d, (W // 2, int(H * 0.50)), "CADENZA",
               font(CRIMSON_BLACK, 160), WHITE)
    gold_underline(d, W // 2 - 130, int(H * 0.59) + 8, width=260, thickness=6)
    t_centered(d, (W // 2, int(H * 0.68)),
               "Un dono al Conservatorio.",
               font(CRIMSON_BOLD, 48), GOLD_LIGHT)
    t_centered(d, (W // 2, int(H * 0.75)),
               "Per i prossimi dieci anni almeno.",
               font(CRIMSON_BOLD, 48), DIM)
    t_centered(d, (W // 2, int(H * 0.85)),
               "Danilo Russo · docente del Conservatorio",
               font(CRIMSON_BOLD, 30), GOLD_PALE)
    t_centered(d, (W // 2, int(H * 0.91)),
               "Una demo dal vivo, in italiano: 30 minuti per mostrarvi tutto.",
               font(HELV, 26), DIM)
    return finalize(img, idx)


def finalize(img, idx):
    img = add_grain(img, amount=10)
    path = os.path.join(OUT, f"slide_{idx:02d}.png")
    img.save(path, "PNG", optimize=True)
    print(f"  ✓ {os.path.basename(path)}")
    return path


SLIDES = [
    slide_01_cover,
    slide_02_perchè,
    slide_03_che_cose,
    slide_04_4_risposte,
    slide_05_screen_dashboard,
    slide_06_screen_rooms,
    slide_07_screen_booking,
    slide_08_screen_monte_ore,
    slide_09_screen_analytics,
    slide_10_screen_struttura,
    slide_11_vs_asimut,
    slide_12_vs_easystaff,
    slide_13_compliance,
    slide_14_pricing,
    slide_15_simulazione_costi,
    slide_15_bis_vps_sizing,
    slide_16_pilota,
    slide_17_roadmap,
    slide_18_cta,
]


def main():
    n = len(SLIDES)
    print(f"Rendering {n} slides → {OUT}")
    for i, fn in enumerate(SLIDES, start=1):
        fn(i, n)
    paths = sorted(
        os.path.join(OUT, f) for f in os.listdir(OUT)
        if f.startswith("slide_") and f.endswith(".png")
    )
    images = [Image.open(p).convert("RGB") for p in paths]
    images[0].save(PDF_OUT, save_all=True, append_images=images[1:],
                   resolution=150.0)
    print(f"\nPDF → {PDF_OUT}")


if __name__ == "__main__":
    main()
