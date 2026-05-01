#!/usr/bin/env python3
"""Generate the 'Cadenza vs ASIMUT — Direzione' PDF presentation.

Output:
- /Users/danilorusso/Desktop/prenota-aule/conservatory-app/promo/slides_directors/slide_XX.png (1920x1080)
- /Users/danilorusso/Desktop/prenota-aule/Cadenza_vs_Asimut_Direzione.pdf
"""

import math
import os
import random
from PIL import Image, ImageDraw, ImageFilter, ImageFont

W, H = 1920, 1080

# Palette derived from the real webapp design tokens (frontend/src/index.css).
# HSL → RGB conversion of the tokens used in the app's light theme.
NAVY_DEEP = (15, 23, 42)        # foreground (titles, dark surfaces)
NAVY = (28, 56, 115)            # primary 222 60% 28% (buttons/CTA, headers)
NAVY_MID = (28, 56, 115)
NAVY_LIGHT = (51, 87, 158)
GOLD = (243, 148, 5)            # warning 38 92% 50%  (accent)
GOLD_LIGHT = (250, 188, 80)
GOLD_PALE = (252, 215, 155)
WHITE = (255, 255, 255)         # background
DIM = (148, 163, 184)           # muted shade
INK = (15, 23, 42)              # text foreground
PAPER = (248, 250, 252)         # very light surface (slate-50)
PAPER_DARK = (226, 232, 240)    # border (slate-200)
GREEN = (22, 163, 74)           # success 142 71% 36%
GREEN_DARK = (16, 122, 56)
RED = (220, 38, 38)             # destructive 0 72% 51%
RED_DARK = (175, 26, 26)
NEUTRAL = (100, 116, 139)       # muted-foreground 215 16% 47%

ROOT = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(ROOT, "slides_directors")
os.makedirs(OUT, exist_ok=True)
PDF_OUT = "/Users/danilorusso/Desktop/prenota-aule/Cadenza_vs_Asimut_Direzione.pdf"

ICON_PATH = "/Users/danilorusso/Desktop/prenota-aule/cadenza.png"

HELV = "/System/Library/Fonts/HelveticaNeue.ttc"
ARIAL_BOLD = "/System/Library/Fonts/Supplemental/Arial Bold.ttf"
ARIAL_BLACK = "/System/Library/Fonts/Supplemental/Arial Black.ttf"
ARIAL = "/System/Library/Fonts/Supplemental/Arial.ttf"
CRIMSON_BLACK = "/Library/Fonts/CrimsonPro-Black.ttf"
CRIMSON_BOLD = "/Library/Fonts/CrimsonPro-Bold.ttf"
CRIMSON_REG = "/Library/Fonts/CrimsonPro-Regular.ttf"
CRIMSON_LIGHT = "/Library/Fonts/CrimsonPro-Light.ttf"


# ────────── helpers ──────────


def font(path, size):
    return ImageFont.truetype(path, size)


def text_size(draw, txt, fnt):
    l, t, r, b = draw.textbbox((0, 0), txt, font=fnt)
    return r - l, b - t, l, t


def t_centered(draw, xy, txt, fnt, fill):
    cx, cy = xy
    w, h, ox, oy = text_size(draw, txt, fnt)
    draw.text((cx - w / 2 - ox, cy - h / 2 - oy), txt, font=fnt, fill=fill)


def t_(draw, xy, txt, fnt, fill, anchor="lt"):
    x, y = xy
    w, h, ox, oy = text_size(draw, txt, fnt)
    if anchor == "lt":
        draw.text((x - ox, y - oy), txt, font=fnt, fill=fill)
    elif anchor == "lm":
        draw.text((x - ox, y - h / 2 - oy), txt, font=fnt, fill=fill)
    elif anchor == "mt":
        draw.text((x - w / 2 - ox, y - oy), txt, font=fnt, fill=fill)
    elif anchor == "mm":
        draw.text((x - w / 2 - ox, y - h / 2 - oy), txt, font=fnt, fill=fill)
    elif anchor == "rt":
        draw.text((x - w - ox, y - oy), txt, font=fnt, fill=fill)
    elif anchor == "rm":
        draw.text((x - w - ox, y - h / 2 - oy), txt, font=fnt, fill=fill)


def gradient_bg(top, bottom, vertical=True):
    img = Image.new("RGB", (W, H), top)
    px = img.load()
    if vertical:
        for y in range(H):
            t = y / (H - 1)
            r = int(top[0] * (1 - t) + bottom[0] * t)
            g = int(top[1] * (1 - t) + bottom[1] * t)
            b = int(top[2] * (1 - t) + bottom[2] * t)
            for x in range(W):
                px[x, y] = (r, g, b)
    else:
        for x in range(W):
            t = x / (W - 1)
            r = int(top[0] * (1 - t) + bottom[0] * t)
            g = int(top[1] * (1 - t) + bottom[1] * t)
            b = int(top[2] * (1 - t) + bottom[2] * t)
            for y in range(H):
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


def add_grain(img, amount=12):
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


def gold_underline(draw, x, y, width=180, thickness=6):
    draw.rectangle([x, y, x + width, y + thickness], fill=GOLD)


def header_bar(img, title, kicker=None, page=None, total=None):
    """Draw the small Cadenza icon + title bar at the top of light slides."""
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
    t_(d, (115, H - 30), "Cadenza · Confronto direzione", font(ARIAL_BOLD, 22), INK, anchor="lm")
    if page is not None and total is not None:
        t_(d, (W - 80, H - 30), f"{page:02d} / {total:02d}", font(HELV, 22), NEUTRAL, anchor="rm")
    return img


def light_canvas():
    return gradient_bg(PAPER, PAPER_DARK)


def dark_canvas():
    img = gradient_bg(NAVY_DEEP, NAVY)
    img = add_radial_glow(img, int(W * 0.78), int(H * 0.30), GOLD, max_r=900, alpha_max=55)
    return img


def rounded_card(d, xy, fill, outline=None, radius=18, width=2):
    d.rounded_rectangle(xy, radius=radius, fill=fill, outline=outline, width=width)


# ────────── slide renderers ──────────


def slide_01_cover(idx, total):
    img = dark_canvas()
    img = paste_icon(img, W // 2, int(H * 0.30), size=300)
    d = ImageDraw.Draw(img)
    t_centered(d, (W // 2, int(H * 0.55)), "CADENZA", font(CRIMSON_BLACK, 180), WHITE)
    gold_underline(d, W // 2 - 90, int(H * 0.65) + 8, width=180, thickness=6)
    t_centered(d, (W // 2, int(H * 0.74)), "vs ASIMUT", font(CRIMSON_BOLD, 90), GOLD_LIGHT)
    t_centered(d, (W // 2, int(H * 0.83)),
               "Confronto economico e di funzionalità per la direzione",
               font(HELV, 38), DIM)
    t_centered(d, (W // 2, int(H * 0.90)),
               "Aprile 2026 · Per direttori e responsabili amministrativi",
               font(HELV, 26), DIM)
    return finalize(img, idx)


def slide_02_executive(idx, total):
    img = light_canvas()
    img = header_bar(img, "Sintesi per la direzione", "EXECUTIVE SUMMARY", idx, total)
    d = ImageDraw.Draw(img)

    # 3 metriche grandi
    metrics = [
        ("80%", "in meno di costo annuo\nrispetto ad ASIMUT", GOLD),
        ("100%", "compliance PA italiana\n(SPID · GDPR Garante · ANIS)", GREEN_DARK),
        ("0,5", "giorni di setup\nper essere operativi", NAVY),
    ]
    cw = 540
    gap = 30
    base_x = (W - 3 * cw - 2 * gap) // 2
    by = 280
    for i, (big, label, color) in enumerate(metrics):
        x = base_x + i * (cw + gap)
        rounded_card(d, [x, by, x + cw, by + 380], fill=WHITE, outline=PAPER_DARK, radius=22, width=2)
        t_centered(d, (x + cw // 2, by + 130), big, font(CRIMSON_BLACK, 180), color)
        for j, line in enumerate(label.split("\n")):
            t_centered(d, (x + cw // 2, by + 270 + j * 40),
                       line, font(HELV, 30), INK)

    # Bottom statement
    rounded_card(d, [80, 720, W - 80, 880], fill=NAVY_DEEP, outline=GOLD, radius=22, width=3)
    t_centered(d, (W // 2, 770),
               "Cadenza copre il 100% delle funzioni room-booking di ASIMUT,",
               font(CRIMSON_BOLD, 40), WHITE)
    t_centered(d, (W // 2, 820),
               "aggiunge le verticali italiane (Monte Ore, SPID, ANIS),",
               font(CRIMSON_BOLD, 40), WHITE)
    t_centered(d, (W // 2, 855),
               "e costa una frazione del listino del leader globale.",
               font(CRIMSON_BOLD, 40), GOLD_LIGHT)
    return finalize(img, idx)


def slide_03_problem(idx, total):
    img = light_canvas()
    img = header_bar(img, "ASIMUT è ottimo. Ma costoso e non italiano.",
                     "PERCHÉ UN'ALTERNATIVA", idx, total)
    d = ImageDraw.Draw(img)

    issues = [
        ("Pricing premium", "15.000 – 40.000 €/anno per istituti medio-grandi.\nFuori budget per la maggior parte dei conservatori italiani."),
        ("Cloud-only · estero",  "Server in Danimarca/USA. Niente self-hosting,\nniente data residency in Italia, vincolo a SaaS perpetuo."),
        ("Niente verticale italiana", "Senza SPID/CIE, senza export ANIS/MIUR,\nsenza Monte Ore docenti, senza PEC."),
        ("Lingua e supporto", "Interfaccia EN/DK, supporto in inglese,\nfuso orario centrale-europeo. Niente onboarding in italiano."),
    ]
    by = 240
    cw = (W - 200) // 2
    rh = 220
    for i, (title, body) in enumerate(issues):
        col = i % 2
        row = i // 2
        x = 80 + col * (cw + 40)
        y = by + row * (rh + 30)
        rounded_card(d, [x, y, x + cw, y + rh], fill=WHITE, outline=PAPER_DARK, radius=18, width=2)
        # red dot
        d.ellipse([x + 28, y + 38, x + 60, y + 70], fill=RED)
        t_(d, (x + 80, y + 30), title, font(CRIMSON_BOLD, 42), INK)
        for j, line in enumerate(body.split("\n")):
            t_(d, (x + 80, y + 100 + j * 42), line, font(HELV, 28), INK)

    return finalize(img, idx)


def slide_04_cadenza_overview(idx, total):
    img = light_canvas()
    img = header_bar(img, "Cadenza in una pagina", "COSA È", idx, total)
    d = ImageDraw.Draw(img)

    t_(d, (90, 230), "Sistema di prenotazione aule, eventi e Monte Ore",
       font(CRIMSON_BOLD, 50), INK)
    t_(d, (90, 290), "verticale per i conservatori italiani.",
       font(CRIMSON_REG, 50), NAVY)

    bullets = [
        "Stack moderno open-source — Node + React + Postgres",
        "Web app + PWA installabile su mobile + kiosk concerti",
        "Anti-overlap garantito a livello DB (Postgres EXCLUDE)",
        "Integrato con Isidata, importazione anagrafica corsi/docenti",
        "GDPR-Garante 06/2021 di default · 2FA · audit log SHA-256",
        "Italiano · supporto in italiano · fattura PA · MEPA-ready",
    ]
    for i, b in enumerate(bullets):
        y = 410 + i * 56
        d.ellipse([90, y + 14, 110, y + 34], fill=GOLD)
        t_(d, (140, y), b, font(HELV, 32), INK)

    # right side: a stylized device showing the dashboard
    draw_phone_mockup(img, 1280, 240, 540, 720)

    return finalize(img, idx)


def slide_05_feature_table(idx, total):
    img = light_canvas()
    img = header_bar(img, "Confronto funzionale", "FEATURE PARITY", idx, total)
    d = ImageDraw.Draw(img)

    rows = [
        # (label, asimut, cadenza, note)
        ("Room booking self-service",     True, True,  ""),
        ("Calendario settimanale aule",   True, True,  ""),
        ("Eventi pubblici / sale concerti", True, True, ""),
        ("Mobile · PWA installabile",      True, True,  ""),
        ("Anti-overlap garantito DB",     "soft", True, "Cadenza usa EXCLUDE"),
        ("Monte Ore docenti AFAM",        False, True, "Verticale italiana"),
        ("SPID / CIE",                    False, True, "Compliance PA"),
        ("Export ANIS / MIUR",            False, True, "Compliance PA"),
        ("Inventario strumenti",          False, True, "Verticale italiana"),
        ("Bot Telegram / WhatsApp",       False, True, ""),
        ("Self-host / on-premise",        False, True, "Listino dedicato"),
        ("Italiano nativo · supporto IT", "parziale", True, ""),
    ]
    headers = ("Funzionalità", "ASIMUT", "Cadenza", "Note")
    cols = [(80, 950), (950, 1180), (1180, 1410), (1410, W - 80)]
    by = 230
    rh = 56

    # header row
    rounded_card(d, [cols[0][0], by, cols[-1][1], by + rh],
                 fill=NAVY_DEEP, outline=None, radius=10, width=0)
    for (x0, x1), txt in zip(cols, headers):
        t_(d, ((x0 + x1) // 2, by + rh // 2), txt,
           font(ARIAL_BOLD, 26), WHITE, anchor="mm")

    for i, (label, a, c, note) in enumerate(rows):
        y = by + (i + 1) * rh
        if i % 2 == 0:
            d.rectangle([cols[0][0], y, cols[-1][1], y + rh], fill=WHITE)
        # label
        t_(d, (cols[0][0] + 24, y + rh // 2), label, font(HELV, 26), INK, anchor="lm")
        # asimut + cadenza cells
        for col_idx, val in [(1, a), (2, c)]:
            x0, x1 = cols[col_idx]
            cx, cy = (x0 + x1) // 2, y + rh // 2
            if val is True:
                d.ellipse([cx - 16, cy - 16, cx + 16, cy + 16], fill=GREEN)
                d.line([cx - 8, cy, cx - 2, cy + 6], fill=WHITE, width=4)
                d.line([cx - 2, cy + 6, cx + 9, cy - 6], fill=WHITE, width=4)
            elif val is False:
                d.ellipse([cx - 16, cy - 16, cx + 16, cy + 16], fill=RED)
                d.line([cx - 7, cy - 7, cx + 7, cy + 7], fill=WHITE, width=4)
                d.line([cx - 7, cy + 7, cx + 7, cy - 7], fill=WHITE, width=4)
            else:
                t_(d, (cx, cy), str(val), font(ARIAL_BOLD, 22), GOLD, anchor="mm")
        # note
        if note:
            t_(d, (cols[3][0] + 16, y + rh // 2), note,
               font(HELV, 22), NEUTRAL, anchor="lm")

    # legend
    ly = by + (len(rows) + 1) * rh + 30
    d.ellipse([100, ly, 124, ly + 24], fill=GREEN)
    t_(d, (140, ly + 12), "Coperto", font(HELV, 24), INK, anchor="lm")
    d.ellipse([260, ly, 284, ly + 24], fill=RED)
    t_(d, (300, ly + 12), "Non coperto", font(HELV, 24), INK, anchor="lm")
    t_(d, (470, ly + 12), "soft / parziale = supportato in modo limitato",
       font(HELV, 22), NEUTRAL, anchor="lm")

    return finalize(footer_bar(img, idx, total), idx)


def slide_06_cost_1500(idx, total):
    return cost_simulation_slide(
        idx, total,
        size_label="1.500 utenti",
        kicker="SIMULAZIONE COSTI · CONSERVATORIO MEDIO",
        title="Costo annuo per 1.500 utenti",
        asimut_low=15000, asimut_high=22000,
        cadenza_plan="Cadenza Professional",
        cadenza_year=4800, cadenza_month=400,
        sub="≈ 250 docenti · 1.250 studenti · 50 aule · 2 edifici · multi-anno",
        savings_low=10200, savings_high=17200,
    )


def slide_07_cost_3000(idx, total):
    return cost_simulation_slide(
        idx, total,
        size_label="3.000 utenti",
        kicker="SIMULAZIONE COSTI · CONSERVATORIO GRANDE",
        title="Costo annuo per 3.000 utenti",
        asimut_low=25000, asimut_high=40000,
        cadenza_plan="Cadenza Enterprise PA",
        cadenza_year=9600, cadenza_month=800,
        sub="≈ 400 docenti · 2.600 studenti · 80 aule · 3+ edifici · sale concerti",
        savings_low=15400, savings_high=30400,
    )


def cost_simulation_slide(idx, total, *, size_label, kicker, title,
                          asimut_low, asimut_high, cadenza_plan,
                          cadenza_year, cadenza_month, sub,
                          savings_low, savings_high):
    img = light_canvas()
    img = header_bar(img, title, kicker, idx, total)
    d = ImageDraw.Draw(img)

    t_(d, (90, 220), sub, font(HELV, 26), NEUTRAL)

    # two large cards side by side
    by = 270
    cw = (W - 240) // 2
    # ASIMUT card
    x0 = 80
    rounded_card(d, [x0, by, x0 + cw, by + 580], fill=WHITE,
                 outline=PAPER_DARK, radius=24, width=3)
    rounded_card(d, [x0, by, x0 + cw, by + 80], fill=NAVY_DEEP, radius=24, width=0)
    d.rectangle([x0, by + 60, x0 + cw, by + 80], fill=NAVY_DEEP)
    t_centered(d, (x0 + cw // 2, by + 40), "ASIMUT", font(ARIAL_BLACK, 38), WHITE)

    t_centered(d, (x0 + cw // 2, by + 170),
               f"{asimut_low:,}".replace(",", ".") +
               f" – {asimut_high:,}".replace(",", ".") + " €",
               font(CRIMSON_BLACK, 90), RED_DARK)
    t_centered(d, (x0 + cw // 2, by + 250), "all'anno · IVA esclusa", font(HELV, 26), NEUTRAL)
    items_a = [
        "SaaS cloud-only (server in Danimarca)",
        "Pricing su preventivo, scala con FTE",
        "Onboarding e training fatturati a parte",
        "Setup tipico: 8-12 settimane",
        "Lingua di supporto: inglese · CET",
    ]
    for i, it in enumerate(items_a):
        d.ellipse([x0 + 60, by + 320 + i * 44 + 10, x0 + 76, by + 320 + i * 44 + 26], fill=NEUTRAL)
        t_(d, (x0 + 100, by + 320 + i * 44), it, font(HELV, 24), INK)

    # CADENZA card
    x1 = x0 + cw + 80
    rounded_card(d, [x1, by, x1 + cw, by + 580], fill=WHITE,
                 outline=GOLD, radius=24, width=4)
    rounded_card(d, [x1, by, x1 + cw, by + 80], fill=NAVY_DEEP, radius=24, width=0)
    d.rectangle([x1, by + 60, x1 + cw, by + 80], fill=NAVY_DEEP)
    t_centered(d, (x1 + cw // 2, by + 40), cadenza_plan, font(ARIAL_BLACK, 38), GOLD_LIGHT)

    t_centered(d, (x1 + cw // 2, by + 170),
               f"{cadenza_year:,}".replace(",", ".") + " €",
               font(CRIMSON_BLACK, 110), GREEN_DARK)
    t_centered(d, (x1 + cw // 2, by + 250),
               f"all'anno · {cadenza_month} €/mese · IVA esclusa", font(HELV, 26), NEUTRAL)
    items_c = [
        "SaaS in Italia oppure self-host on-premise",
        "Listino chiuso, nessun extra a sorpresa",
        "Onboarding incluso · formazione staff",
        "Setup tipico: 0,5 – 2 giornate",
        "Lingua di supporto: italiano · UTC+1",
    ]
    for i, it in enumerate(items_c):
        d.ellipse([x1 + 60, by + 320 + i * 44 + 10, x1 + 76, by + 320 + i * 44 + 26], fill=GOLD)
        t_(d, (x1 + 100, by + 320 + i * 44), it, font(HELV, 24), INK)

    # bottom: risparmio
    sy = by + 620
    rounded_card(d, [80, sy, W - 80, sy + 90], fill=NAVY_DEEP, radius=20, width=0)
    save_text = (
        f"Risparmio stimato per {size_label}: "
        f"{savings_low:,}".replace(",", ".") +
        f" – {savings_high:,}".replace(",", ".") + " € all'anno"
    )
    t_centered(d, (W // 2, sy + 45), save_text, font(CRIMSON_BOLD, 42), GOLD_LIGHT)

    return finalize(footer_bar(img, idx, total), idx)


def slide_08_5y_tco(idx, total):
    img = light_canvas()
    img = header_bar(img, "TCO a 5 anni · 1.500 e 3.000 utenti", "TOTAL COST OF OWNERSHIP", idx, total)
    d = ImageDraw.Draw(img)

    # Bar chart: 5y cumulative
    # 1500: ASIMUT mid 18.5k → 92.5k; Cadenza 4.8k → 24k
    # 3000: ASIMUT mid 32.5k → 162.5k; Cadenza 9.6k → 48k
    series = [
        ("1.500 utenti · 5 anni",
         92500, 24000, "ASIMUT (medio)", "Cadenza Professional"),
        ("3.000 utenti · 5 anni",
         162500, 48000, "ASIMUT (medio)", "Cadenza Enterprise PA"),
    ]

    cx_left = 90
    chart_y = 270
    chart_w = W - 180
    chart_h = 700
    sub_h = chart_h // 2 - 40
    max_val = max(s[1] for s in series) * 1.1
    by_pad = 20

    for k, (label, asimut_v, cad_v, asimut_lbl, cad_lbl) in enumerate(series):
        sy = chart_y + k * (sub_h + 50)
        t_(d, (cx_left, sy), label, font(CRIMSON_BOLD, 36), INK)
        # bars
        bar_h = 60
        bg_x = cx_left + 350  # leave room for left labels
        bg_w = chart_w - 350 - 360  # leave room for right delta bubble
        # Asimut bar
        ya = sy + 70
        wa = int(asimut_v / max_val * bg_w)
        d.rounded_rectangle([bg_x, ya, bg_x + bg_w, ya + bar_h], radius=8, fill=PAPER_DARK)
        d.rounded_rectangle([bg_x, ya, bg_x + wa, ya + bar_h], radius=8, fill=RED_DARK)
        t_(d, (bg_x - 20, ya + bar_h // 2), asimut_lbl,
           font(ARIAL_BOLD, 22), INK, anchor="rm")
        t_(d, (bg_x + wa + 20, ya + bar_h // 2),
           f"{asimut_v:,}".replace(",", ".") + " €",
           font(ARIAL_BOLD, 28), RED_DARK, anchor="lm")
        # Cadenza bar
        yc = ya + bar_h + 22
        wc = int(cad_v / max_val * bg_w)
        d.rounded_rectangle([bg_x, yc, bg_x + bg_w, yc + bar_h], radius=8, fill=PAPER_DARK)
        d.rounded_rectangle([bg_x, yc, bg_x + wc, yc + bar_h], radius=8, fill=GREEN_DARK)
        t_(d, (bg_x - 20, yc + bar_h // 2), cad_lbl,
           font(ARIAL_BOLD, 22), INK, anchor="rm")
        t_(d, (bg_x + wc + 20, yc + bar_h // 2),
           f"{cad_v:,}".replace(",", ".") + " €",
           font(ARIAL_BOLD, 28), GREEN_DARK, anchor="lm")
        # delta bubble
        delta = asimut_v - cad_v
        bx = bg_x + bg_w + 60
        bcy = (ya + yc + bar_h) // 2
        d.rounded_rectangle([bx, bcy - 50, bx + 320, bcy + 50],
                            radius=24, fill=NAVY_DEEP)
        t_(d, (bx + 160, bcy - 22),
           f"− {delta:,}".replace(",", ".") + " €",
           font(CRIMSON_BLACK, 40), GOLD_LIGHT, anchor="mm")
        t_(d, (bx + 160, bcy + 24), "risparmio 5 anni",
           font(HELV, 22), DIM, anchor="mm")

    return finalize(footer_bar(img, idx, total), idx)


def slide_09_compliance(idx, total):
    img = dark_canvas()
    d = ImageDraw.Draw(img)
    t_centered(d, (W // 2, 160), "Compliance PA italiana", font(CRIMSON_BLACK, 78), WHITE)
    gold_underline(d, W // 2 - 80, 240, width=160, thickness=5)
    t_centered(d, (W // 2, 305),
               "Quattro requisiti che ASIMUT non copre nativamente.",
               font(HELV, 30), DIM)

    badges = [
        ("SPID / CIE", "Identità digitale obbligatoria PA",
         "AgID · DPCM 24/10/2014"),
        ("GDPR Garante", "Provvedimento 06/2021",
         "Cookie · DPIA · ROPA"),
        ("ANIS · MIUR", "Anagrafica nazionale studenti",
         "Export annuale automatizzato"),
        ("PEC · CAD", "Conservazione sostitutiva",
         "Codice Amministrazione Digitale"),
    ]
    bx = 200
    by = 430
    bw = (W - 400 - 60) // 2
    bh = 220
    for i, (t, s, foot) in enumerate(badges):
        col = i % 2
        row = i // 2
        x = bx + col * (bw + 60)
        y = by + row * (bh + 40)
        rounded_card(d, [x, y, x + bw, y + bh], fill=NAVY_LIGHT,
                     outline=GOLD, radius=20, width=2)
        # check mark badge
        d.ellipse([x + 30, y + 60, x + 110, y + 140], fill=GOLD)
        d.line([x + 50, y + 100, x + 70, y + 122], fill=NAVY_DEEP, width=8)
        d.line([x + 70, y + 122, x + 96, y + 80], fill=NAVY_DEEP, width=8)
        t_(d, (x + 140, y + 50), t, font(ARIAL_BLACK, 50), WHITE)
        t_(d, (x + 140, y + 115), s, font(HELV, 28), DIM)
        t_(d, (x + 140, y + 165), foot, font(HELV, 24), GOLD_LIGHT)
    return finalize(img, idx)


SHOTS_DIR = os.path.join(ROOT, "screenshots")


def embed_screenshot(img, x, y, w, h, png_name, *, browser_chrome=True):
    """Place a real screenshot into the slide, optionally with a faux
    browser chrome (rounded window with traffic-lights + URL bar)."""
    d = ImageDraw.Draw(img)
    if browser_chrome:
        d.rounded_rectangle([x, y, x + w, y + h], radius=18, fill=WHITE,
                            outline=PAPER_DARK, width=2)
        d.rectangle([x, y, x + w, y + 50], fill=(245, 245, 240))
        d.line([(x, y + 50), (x + w, y + 50)], fill=PAPER_DARK, width=1)
        for i, c in enumerate([(255, 95, 86), (255, 189, 46), (39, 201, 63)]):
            d.ellipse([x + 18 + i * 28, y + 18, x + 36 + i * 28, y + 36], fill=c)
        d.rounded_rectangle([x + 130, y + 14, x + w - 130, y + 38],
                            radius=8, fill=WHITE, outline=PAPER_DARK, width=1)
        url = png_name.replace('.png', '').replace('-', '/')
        t_centered(d, (x + w // 2, y + 26),
                   f"cadenza.conservatorio.it/{url}",
                   font(HELV, 18), NEUTRAL)
        inner_y = y + 50
        inner_h = h - 50
    else:
        inner_y = y
        inner_h = h
        d.rounded_rectangle([x, y, x + w, y + h], radius=18, fill=WHITE,
                            outline=PAPER_DARK, width=2)
    # Load and fit screenshot into inner box, preserving aspect
    src = Image.open(os.path.join(SHOTS_DIR, png_name)).convert("RGB")
    sw, sh = src.size
    target_w = w - 24
    target_h = inner_h - 24
    scale = min(target_w / sw, target_h / sh)
    nw, nh = int(sw * scale), int(sh * scale)
    src = src.resize((nw, nh), Image.LANCZOS)
    cx = x + (w - nw) // 2
    cy = inner_y + (inner_h - nh) // 2
    img.paste(src, (cx, cy))
    return img


def slide_10_screen_dashboard(idx, total):
    img = light_canvas()
    img = header_bar(img, "Dashboard docente", "SCHERMATA REALE · /dashboard", idx, total)
    embed_screenshot(img, 90, 215, W - 180, 800, "dashboard.png", browser_chrome=False)
    return finalize(footer_bar(img, idx, total), idx)


def slide_11_screen_weekly(idx, total):
    img = light_canvas()
    img = header_bar(img, "Aule del conservatorio", "SCHERMATA REALE · /rooms", idx, total)
    embed_screenshot(img, 90, 215, W - 180, 800, "rooms.png", browser_chrome=False)
    return finalize(footer_bar(img, idx, total), idx)


def slide_12_screen_booking(idx, total):
    img = light_canvas()
    img = header_bar(img, "Prenota un'aula", "SCHERMATA REALE · /booking", idx, total)
    embed_screenshot(img, 90, 215, W - 180, 800, "booking.png", browser_chrome=False)
    return finalize(footer_bar(img, idx, total), idx)


def slide_13_screen_analytics(idx, total):
    img = light_canvas()
    img = header_bar(img, "Le mie prenotazioni", "SCHERMATA REALE · /my-bookings", idx, total)
    embed_screenshot(img, 90, 215, W - 180, 800, "my-bookings.png", browser_chrome=False)
    return finalize(footer_bar(img, idx, total), idx)


def slide_14_migration(idx, total):
    img = light_canvas()
    img = header_bar(img, "Da ASIMUT a Cadenza in 4 settimane",
                     "PERCORSO DI MIGRAZIONE", idx, total)
    d = ImageDraw.Draw(img)
    weeks = [
        ("Settimana 1", "Setup", "Provisioning · branding · SPID test"),
        ("Settimana 2", "Migrazione dati", "Import aule, utenti, calendari · da CSV/ASIMUT"),
        ("Settimana 3", "Pilota", "Pilota su 1 dipartimento · feedback · fine-tuning"),
        ("Settimana 4", "Rollout", "Tutto il conservatorio · formazione staff"),
    ]
    bx = 80
    by = 320
    cw = (W - 160 - 30 * 3) // 4
    for i, (wk, tt, body) in enumerate(weeks):
        x = bx + i * (cw + 30)
        rounded_card(d, [x, by, x + cw, by + 460], fill=WHITE,
                     outline=PAPER_DARK, radius=20, width=2)
        rounded_card(d, [x, by, x + cw, by + 90], fill=NAVY_DEEP, radius=20, width=0)
        d.rectangle([x, by + 70, x + cw, by + 90], fill=NAVY_DEEP)
        t_centered(d, (x + cw // 2, by + 45), wk, font(ARIAL_BOLD, 30), GOLD_LIGHT)
        # number circle
        d.ellipse([x + cw // 2 - 50, by + 130, x + cw // 2 + 50, by + 230],
                  fill=GOLD)
        t_centered(d, (x + cw // 2, by + 180),
                   str(i + 1), font(CRIMSON_BLACK, 70), NAVY_DEEP)
        t_centered(d, (x + cw // 2, by + 280), tt, font(CRIMSON_BOLD, 38), INK)
        # body wrapped
        for j, line in enumerate(wrap_text(body, 24)):
            t_centered(d, (x + cw // 2, by + 350 + j * 36),
                       line, font(HELV, 22), INK)
        # arrow
        if i < len(weeks) - 1:
            ax = x + cw + 5
            ay = by + 230
            d.polygon([(ax, ay - 12), (ax + 18, ay), (ax, ay + 12)], fill=GOLD)

    rounded_card(d, [80, 820, W - 80, 970], fill=NAVY_DEEP, radius=20, width=0)
    t_centered(d, (W // 2, 870),
               "Coesistenza con ASIMUT durante il pilota.",
               font(CRIMSON_BOLD, 38), WHITE)
    t_centered(d, (W // 2, 925),
               "Switch totale solo dopo validazione direzione.",
               font(HELV, 30), DIM)
    return finalize(footer_bar(img, idx, total), idx)


def slide_15_pricing(idx, total):
    img = light_canvas()
    img = header_bar(img, "Listino Cadenza", "QUATTRO LIVELLI", idx, total)
    d = ImageDraw.Draw(img)

    plans = [
        ("Self-Host",     "800 €/anno",  "IT interno",       ["Codice sorgente", "Aggiornamenti", "Support base"], False),
        ("Starter",       "2.400 €/anno", "<200 studenti",   ["Room booking", "Eventi · Kiosk", "Email", "≤ 50 aule"], False),
        ("Professional",  "4.800 €/anno", "200–600 studenti", ["+ Monte Ore", "+ Inventario strumenti", "+ Bacheca", "+ Analytics", "+ Bot Telegram"], True),
        ("Enterprise PA", "9.600 €/anno", ">600 studenti",   ["+ SPID/CIE", "+ PEC", "+ ANIS/MIUR", "+ Esse3 sync", "SLA 99.5%"], False),
    ]
    bx = 80
    by = 240
    cw = (W - 160 - 30 * 3) // 4
    for i, (name, price, target, feats, highlight) in enumerate(plans):
        x = bx + i * (cw + 30)
        outline = GOLD if highlight else PAPER_DARK
        ow = 4 if highlight else 2
        rounded_card(d, [x, by, x + cw, by + 700], fill=WHITE,
                     outline=outline, radius=22, width=ow)
        rounded_card(d, [x, by, x + cw, by + 90],
                     fill=NAVY_DEEP if highlight else NAVY_LIGHT, radius=22, width=0)
        d.rectangle([x, by + 70, x + cw, by + 90],
                    fill=NAVY_DEEP if highlight else NAVY_LIGHT)
        t_centered(d, (x + cw // 2, by + 45), name,
                   font(ARIAL_BLACK, 32), GOLD_LIGHT if highlight else WHITE)
        t_centered(d, (x + cw // 2, by + 150), price,
                   font(CRIMSON_BLACK, 50), NAVY_DEEP if not highlight else GOLD)
        t_centered(d, (x + cw // 2, by + 215), target,
                   font(HELV, 24), NEUTRAL)
        # divider
        d.line([(x + 30, by + 250), (x + cw - 30, by + 250)],
               fill=PAPER_DARK, width=2)
        for j, ft in enumerate(feats):
            d.ellipse([x + 40, by + 280 + j * 50 + 10, x + 56, by + 280 + j * 50 + 26],
                      fill=GOLD if highlight else NAVY)
            t_(d, (x + 70, by + 280 + j * 50), ft, font(HELV, 24), INK)
        if highlight:
            t_centered(d, (x + cw // 2, by + 660), "MIGLIOR RAPPORTO",
                       font(ARIAL_BOLD, 22), GOLD)

    return finalize(footer_bar(img, idx, total), idx)


def slide_16_cta(idx, total):
    img = dark_canvas()
    img = paste_icon(img, W // 2, int(H * 0.30), size=240)
    d = ImageDraw.Draw(img)
    t_centered(d, (W // 2, int(H * 0.55)), "CADENZA",
               font(CRIMSON_BLACK, 170), WHITE)
    gold_underline(d, W // 2 - 130, int(H * 0.65) + 8, width=260, thickness=6)
    t_centered(d, (W // 2, int(H * 0.74)),
               "Stesso prodotto. Costo dimezzato.",
               font(CRIMSON_BOLD, 60), GOLD_LIGHT)
    t_centered(d, (W // 2, int(H * 0.81)),
               "Verticale italiano per definizione.",
               font(CRIMSON_BOLD, 60), DIM)
    t_centered(d, (W // 2, int(H * 0.91)),
               "Demo in italiano · cadenza-app.it · staff@cadenza-app.it",
               font(HELV, 30), DIM)
    return finalize(img, idx)


# ────────── mockup helpers (real-like screenshots) ──────────


def wrap_text(text, max_chars):
    words = text.split()
    lines, cur = [], ""
    for w in words:
        if len(cur) + len(w) + 1 <= max_chars:
            cur = (cur + " " + w).strip()
        else:
            if cur:
                lines.append(cur)
            cur = w
    if cur:
        lines.append(cur)
    return lines


def draw_phone_mockup(img, x, y, w, h):
    """Phone-shaped device showing dashboard cards."""
    d = ImageDraw.Draw(img)
    # frame
    d.rounded_rectangle([x, y, x + w, y + h], radius=44, fill=(245, 245, 240),
                        outline=GOLD, width=4)
    d.rounded_rectangle([x + 24, y + 28, x + w - 24, y + h - 28],
                        radius=24, fill=(248, 250, 254))
    # status bar
    d.rounded_rectangle([x + 24, y + 28, x + w - 24, y + 100],
                        radius=24, fill=NAVY_DEEP)
    d.rectangle([x + 24, y + 80, x + w - 24, y + 100], fill=NAVY_DEEP)
    t_(d, (x + 60, y + 50), "Cadenza", font(CRIMSON_BLACK, 32), WHITE)
    t_(d, (x + w - 60, y + 50), "9:41", font(ARIAL_BOLD, 24), WHITE, anchor="rt")
    # tab bar
    tabs = ["Oggi", "Aule", "Eventi", "Profilo"]
    tab_y = y + h - 80
    d.rectangle([x + 24, tab_y, x + w - 24, y + h - 28], fill=WHITE)
    tw = (w - 48) // 4
    for i, tab in enumerate(tabs):
        cx = x + 24 + i * tw + tw // 2
        color = GOLD if i == 0 else NEUTRAL
        d.ellipse([cx - 12, tab_y + 14, cx + 12, tab_y + 38], outline=color, width=2)
        t_centered(d, (cx, tab_y + 60), tab, font(HELV, 18), color)

    # cards
    cy = y + 130
    items = [
        ("09:00", "Sala A · Lezione Pianoforte", "Conf."),
        ("11:00", "Sala B · Disponibile", "Libera"),
        ("14:30", "Auditorium · Prova ensemble", "Conf."),
        ("16:00", "Sala C · Lezione Violino", "Conf."),
        ("18:00", "Sala A · Studio individuale", "Pend."),
    ]
    for i, (time, label, badge) in enumerate(items):
        ry = cy + i * 86
        d.rounded_rectangle([x + 50, ry, x + w - 50, ry + 76], radius=12, fill=(238, 240, 250))
        d.rectangle([x + 50, ry, x + 62, ry + 76],
                    fill=GOLD if i % 2 == 0 else NAVY)
        t_(d, (x + 80, ry + 12), time, font(ARIAL_BOLD, 22), INK)
        t_(d, (x + 80, ry + 42), label, font(HELV, 20), INK)
        bcol = GREEN if "Conf" in badge else (GOLD if "Lib" in badge else NEUTRAL)
        d.rounded_rectangle([x + w - 130, ry + 22, x + w - 60, ry + 56],
                            radius=8, fill=bcol)
        t_centered(d, (x + w - 95, ry + 39), badge, font(ARIAL_BOLD, 18), WHITE)


def draw_dashboard_mockup(img, x, y, w, h):
    """Full-width dashboard showing sidebar + cards + agenda."""
    d = ImageDraw.Draw(img)
    # outer frame (browser chrome)
    d.rounded_rectangle([x, y, x + w, y + h], radius=18, fill=WHITE,
                        outline=PAPER_DARK, width=2)
    # window bar
    d.rectangle([x, y, x + w, y + 50], fill=PAPER_DARK)
    for i, c in enumerate([(255, 95, 86), (255, 189, 46), (39, 201, 63)]):
        d.ellipse([x + 18 + i * 28, y + 18, x + 36 + i * 28, y + 36], fill=c)
    t_centered(d, (x + w // 2, y + 25),
               "cadenza.conservatorio.it/docente",
               font(HELV, 22), NEUTRAL)
    # sidebar
    sb = 240
    d.rectangle([x, y + 50, x + sb, y + h], fill=NAVY_DEEP)
    # logo (gold equalizer-like glyph + wordmark, drawn directly on img)
    bars = [(0.4, GOLD_LIGHT), (0.7, GOLD), (1.0, GOLD), (0.6, GOLD_LIGHT)]
    bx = x + 24
    for ratio, col in bars:
        bh = int(28 * ratio)
        d.rounded_rectangle([bx, y + 105 - bh, bx + 6, y + 110],
                            radius=2, fill=col)
        bx += 10
    t_(d, (x + 78, y + 92), "Cadenza", font(CRIMSON_BOLD, 24), WHITE, anchor="lm")
    items = [("Oggi", True), ("Aule", False), ("Monte Ore", False),
             ("Eventi", False), ("Strumenti", False), ("Bacheca", False),
             ("Statistiche", False), ("Profilo", False)]
    for i, (label, active) in enumerate(items):
        iy = y + 140 + i * 50
        if active:
            d.rectangle([x, iy - 8, x + sb, iy + 32], fill=NAVY_LIGHT)
            d.rectangle([x, iy - 8, x + 6, iy + 32], fill=GOLD)
        d.ellipse([x + 30, iy + 8, x + 42, iy + 20], outline=GOLD if active else DIM, width=2)
        t_(d, (x + 60, iy + 14), label, font(HELV, 20),
           WHITE if active else DIM, anchor="lm")

    # main content
    mx = x + sb + 30
    my = y + 80
    t_(d, (mx, my), "Buongiorno, Prof. Rossi", font(CRIMSON_BLACK, 42), INK)
    t_(d, (mx, my + 60),
       "Mercoledì 29 aprile · 4 prenotazioni oggi · Monte Ore: 218 / 324 h",
       font(HELV, 22), NEUTRAL)
    # cards row
    crow = my + 130
    metrics = [("Prenotazioni mese", "37", GREEN_DARK),
               ("Ore svolte", "218", NAVY),
               ("Eventi prossimi", "5", GOLD),
               ("Avvisi nuovi", "2", RED_DARK)]
    cw = 220
    for i, (lbl, val, col) in enumerate(metrics):
        cx = mx + i * (cw + 20)
        d.rounded_rectangle([cx, crow, cx + cw, crow + 130],
                            radius=14, fill=PAPER, outline=PAPER_DARK, width=1)
        t_(d, (cx + 20, crow + 18), lbl, font(HELV, 20), NEUTRAL)
        t_(d, (cx + 20, crow + 50), val, font(CRIMSON_BLACK, 64), col)
    # agenda card
    ay = crow + 160
    ah = h - (ay - y) - 30
    d.rounded_rectangle([mx, ay, x + w - 30, ay + ah],
                        radius=14, fill=PAPER, outline=PAPER_DARK, width=1)
    t_(d, (mx + 24, ay + 18), "Agenda · oggi e domani",
       font(CRIMSON_BOLD, 26), INK)
    t_(d, (x + w - 50, ay + 18), "vedi tutto", font(HELV, 20),
       NAVY, anchor="rt")
    # rows
    rows = [
        ("Oggi 09:00", "Pianoforte · Sala A.101", "Lezione", "Confermata"),
        ("Oggi 14:30", "Auditorium", "Prova orchestra", "Confermata"),
        ("Oggi 17:00", "Sala B.203", "Studio individuale", "Pending"),
        ("Domani 10:30", "Sala A.101", "Pianoforte", "Confermata"),
        ("Domani 16:00", "Sala Concerto", "Saggio classe", "In attesa"),
    ]
    for i, (when, where, kind, status) in enumerate(rows):
        ry = ay + 70 + i * 60
        if i % 2 == 0:
            d.rectangle([mx + 10, ry - 10, x + w - 40, ry + 40], fill=WHITE)
        d.ellipse([mx + 24, ry + 10, mx + 44, ry + 30], fill=GOLD)
        t_(d, (mx + 60, ry), when, font(ARIAL_BOLD, 22), INK)
        t_(d, (mx + 250, ry), where, font(HELV, 22), INK)
        t_(d, (mx + 580, ry), kind, font(HELV, 22), NAVY)
        # status badge
        bcol = GREEN if "Conf" in status else (NEUTRAL if "Pend" in status else GOLD)
        d.rounded_rectangle([x + w - 220, ry, x + w - 60, ry + 36],
                            radius=10, fill=bcol)
        t_centered(d, (x + w - 140, ry + 18), status, font(ARIAL_BOLD, 18), WHITE)


def draw_weekly_grid(img, x, y, w, h):
    d = ImageDraw.Draw(img)
    # frame
    d.rounded_rectangle([x, y, x + w, y + h], radius=18, fill=WHITE,
                        outline=PAPER_DARK, width=2)
    # window bar
    d.rectangle([x, y, x + w, y + 50], fill=PAPER_DARK)
    for i, c in enumerate([(255, 95, 86), (255, 189, 46), (39, 201, 63)]):
        d.ellipse([x + 18 + i * 28, y + 18, x + 36 + i * 28, y + 36], fill=c)
    t_centered(d, (x + w // 2, y + 25),
               "cadenza.conservatorio.it/aule", font(HELV, 22), NEUTRAL)

    # toolbar
    ty = y + 70
    t_(d, (x + 30, ty + 18), "Settimana 28 apr – 3 mag · Edificio: Sede centrale",
       font(CRIMSON_BOLD, 26), INK)
    for i, lbl in enumerate(["< Prec", "Oggi", "Succ >"]):
        bx = x + w - 60 - (3 - i) * 130
        d.rounded_rectangle([bx, ty, bx + 110, ty + 44], radius=10,
                            fill=NAVY if lbl == "Oggi" else WHITE,
                            outline=NAVY, width=2)
        t_centered(d, (bx + 55, ty + 22), lbl, font(ARIAL_BOLD, 22),
                   WHITE if lbl == "Oggi" else NAVY)

    # grid
    gx = x + 30
    gy = ty + 80
    gw = w - 60
    gh = h - (gy - y) - 30
    days = ["Lun 28", "Mar 29", "Mer 30", "Gio 1", "Ven 2", "Sab 3"]
    aule = ["A.101", "A.102", "A.103", "Sala 5", "Sala 6", "Auditorium"]
    cols = len(days)
    rows = len(aule)
    head_w = 120
    cell_w = (gw - head_w) // cols
    cell_h = gh // (rows + 1)

    # background
    d.rectangle([gx, gy, gx + gw, gy + gh], fill=(248, 248, 244))

    # day headers
    d.rectangle([gx + head_w, gy, gx + head_w + cell_w * cols, gy + cell_h],
                fill=NAVY_DEEP)
    for i, day in enumerate(days):
        cx = gx + head_w + i * cell_w + cell_w // 2
        t_centered(d, (cx, gy + cell_h // 2), day, font(ARIAL_BOLD, 22), GOLD_LIGHT)

    # room rows
    for r, aula in enumerate(aule):
        ry = gy + cell_h + r * cell_h
        d.rectangle([gx, ry, gx + head_w, ry + cell_h], fill=PAPER_DARK)
        t_(d, (gx + 16, ry + cell_h // 2), aula,
           font(ARIAL_BOLD, 22), INK, anchor="lm")
        # row separator
        d.line([(gx, ry), (gx + gw, ry)], fill=PAPER_DARK, width=1)

    # vertical separators
    for c in range(cols + 1):
        cxx = gx + head_w + c * cell_w
        d.line([(cxx, gy), (cxx, gy + gh)], fill=PAPER_DARK, width=1)

    # bookings — colored blocks
    BOOK_COLORS = {
        "lezione":   (52, 120, 220),   # blue
        "studio":    (46, 160, 96),    # green
        "prova":     (224, 140, 36),   # orange
        "concerto":  (200, 60, 70),    # red
        "direzione": (98, 86, 220),    # purple
    }
    bookings = [
        # (room_idx, day_idx, start_col_frac, end_col_frac, kind, label)
        (0, 0, 0.05, 0.45, "lezione",  "Prof. Rossi"),
        (0, 0, 0.50, 0.85, "studio",   "Stud."),
        (0, 2, 0.20, 0.70, "lezione",  "Prof. Bianchi"),
        (0, 4, 0.35, 0.95, "prova",    "Prova"),
        (1, 1, 0.05, 0.55, "lezione",  "Prof. Verdi"),
        (1, 3, 0.40, 0.85, "concerto", "Bach"),
        (1, 5, 0.45, 0.85, "studio",   "Stud."),
        (2, 0, 0.10, 0.55, "lezione",  "Prof. Conti"),
        (2, 2, 0.40, 0.70, "studio",   "Stud."),
        (2, 3, 0.45, 0.85, "prova",    "Quartetto"),
        (3, 1, 0.55, 0.85, "direzione","Direz."),
        (3, 4, 0.55, 0.90, "concerto", "Saggio"),
        (4, 2, 0.40, 0.75, "lezione",  "Prof. Greco"),
        (4, 4, 0.55, 0.95, "studio",   "Stud."),
        (5, 3, 0.30, 0.85, "concerto", "Mozart"),
    ]
    for (r, c, s, e, kind, label) in bookings:
        ry0 = gy + cell_h + r * cell_h + 6
        ry1 = ry0 + cell_h - 12
        cx0 = gx + head_w + c * cell_w + int(cell_w * s)
        cx1 = gx + head_w + c * cell_w + int(cell_w * e)
        col = BOOK_COLORS[kind]
        d.rounded_rectangle([cx0, ry0, cx1, ry1], radius=8, fill=col)
        # truncate label if needed
        bw_av = cx1 - cx0 - 10
        f = font(ARIAL_BOLD, 18)
        lw, lh, _, _ = text_size(d, label, f)
        if lw < bw_av - 4:
            t_centered(d, ((cx0 + cx1) // 2, (ry0 + ry1) // 2),
                       label, f, WHITE)

    # legend
    ly = gy + gh + 18
    legend = [("Lezione", BOOK_COLORS["lezione"]), ("Studio", BOOK_COLORS["studio"]),
              ("Prova", BOOK_COLORS["prova"]), ("Concerto", BOOK_COLORS["concerto"]),
              ("Direzione", BOOK_COLORS["direzione"])]
    lx = gx
    for (lbl, col) in legend:
        d.rounded_rectangle([lx, ly, lx + 26, ly + 22], radius=4, fill=col)
        t_(d, (lx + 36, ly + 11), lbl, font(HELV, 22), INK, anchor="lm")
        lx += 200


def draw_booking_form(img, x, y, w, h):
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([x, y, x + w, y + h], radius=18, fill=WHITE,
                        outline=PAPER_DARK, width=2)
    # window bar
    d.rectangle([x, y, x + w, y + 50], fill=PAPER_DARK)
    for i, c in enumerate([(255, 95, 86), (255, 189, 46), (39, 201, 63)]):
        d.ellipse([x + 18 + i * 28, y + 18, x + 36 + i * 28, y + 36], fill=c)
    t_centered(d, (x + w // 2, y + 25),
               "cadenza.conservatorio.it/prenota",
               font(HELV, 22), NEUTRAL)

    # form panel left
    pw = (w - 60) // 2
    px = x + 30
    py = y + 80
    t_(d, (px, py), "Nuova prenotazione", font(CRIMSON_BLACK, 42), INK)
    t_(d, (px, py + 60), "Tutti i campi obbligatori sono evidenziati.",
       font(HELV, 22), NEUTRAL)

    fields = [
        ("Aula",         "Sala A.101 — Pianoforte (45 m²)",  True),
        ("Data",         "29 aprile 2026 (mer)",             True),
        ("Inizio",       "14:30",                            True),
        ("Fine",         "16:00",                            True),
        ("Tipologia",    "Lezione individuale",              True),
        ("Note",         "Allievo: Maria Bianchi · 4° anno", False),
    ]
    fy = py + 120
    for i, (lbl, val, req) in enumerate(fields):
        d.rounded_rectangle([px, fy + i * 70, px + pw - 40, fy + i * 70 + 56],
                            radius=10, fill=PAPER, outline=PAPER_DARK, width=1)
        t_(d, (px + 16, fy + i * 70 + 8), lbl + (" *" if req else ""),
           font(HELV, 16), NEUTRAL)
        t_(d, (px + 16, fy + i * 70 + 30), val, font(ARIAL_BOLD, 22), INK)

    # buttons
    by_btn = py + 120 + 6 * 70 + 30
    d.rounded_rectangle([px, by_btn, px + 220, by_btn + 56],
                        radius=10, fill=NAVY_DEEP)
    t_centered(d, (px + 110, by_btn + 28), "Verifica disponibilità",
               font(ARIAL_BOLD, 22), WHITE)
    d.rounded_rectangle([px + 240, by_btn, px + 380, by_btn + 56],
                        radius=10, fill=GOLD)
    t_centered(d, (px + 310, by_btn + 28), "Conferma",
               font(ARIAL_BOLD, 24), NAVY_DEEP)

    # right: live availability preview
    rx = x + 30 + pw + 10
    ry = py
    rw = pw - 30
    d.rounded_rectangle([rx, ry, rx + rw, ry + h - 110],
                        radius=14, fill=PAPER, outline=PAPER_DARK, width=1)
    t_(d, (rx + 24, ry + 18), "Disponibilità · Sala A.101",
       font(CRIMSON_BOLD, 28), INK)
    t_(d, (rx + 24, ry + 60), "Mer 29 aprile · 08:00 – 22:00",
       font(HELV, 22), NEUTRAL)
    # timeline
    tl_x = rx + 24
    tl_y = ry + 110
    tl_w = rw - 48
    tl_h = 60
    d.rounded_rectangle([tl_x, tl_y, tl_x + tl_w, tl_y + tl_h],
                        radius=8, fill=(238, 240, 250))
    blocks = [(0.10, 0.20, "Lezione"), (0.30, 0.40, "Lezione"),
              (0.43, 0.53, "Tu"),  (0.65, 0.78, "Prova"),
              (0.80, 0.92, "Studio")]
    for s, e, lab in blocks:
        col = GOLD if lab == "Tu" else NAVY_LIGHT
        x0 = tl_x + int(s * tl_w)
        x1 = tl_x + int(e * tl_w)
        d.rounded_rectangle([x0, tl_y, x1, tl_y + tl_h], radius=6, fill=col)
        if lab:
            t_centered(d, ((x0 + x1) // 2, tl_y + tl_h // 2),
                       lab, font(ARIAL_BOLD, 18), WHITE)
    # hour markers
    for hh in range(8, 23, 2):
        frac = (hh - 8) / 14
        mx_ = tl_x + int(frac * tl_w)
        d.line([(mx_, tl_y + tl_h), (mx_, tl_y + tl_h + 8)],
               fill=NEUTRAL, width=1)
        t_centered(d, (mx_, tl_y + tl_h + 28), f"{hh:02d}",
                   font(HELV, 18), NEUTRAL)

    # status
    rounded_card(d, [rx + 24, ry + 240, rx + rw - 24, ry + 320],
                 fill=GREEN, radius=12, width=0)
    t_(d, (rx + 50, ry + 280),
       "✓ Slot disponibile · nessun conflitto rilevato",
       font(ARIAL_BOLD, 24), WHITE, anchor="lm")
    # quote info
    t_(d, (rx + 24, ry + 360), "Quote utilizzate questa settimana",
       font(CRIMSON_BOLD, 26), INK)
    quotas = [("Studio individuale", 6, 8),
              ("Prova ensemble", 2, 4),
              ("Lezioni singole", 12, 20)]
    for i, (lbl, used, total) in enumerate(quotas):
        qy = ry + 410 + i * 70
        t_(d, (rx + 24, qy), lbl, font(HELV, 22), INK)
        t_(d, (rx + rw - 24, qy), f"{used} / {total}",
           font(ARIAL_BOLD, 22), INK, anchor="rt")
        # progress bar
        bar_w = rw - 48
        d.rounded_rectangle([rx + 24, qy + 32, rx + 24 + bar_w, qy + 46],
                            radius=6, fill=PAPER_DARK)
        d.rounded_rectangle([rx + 24, qy + 32, rx + 24 + int(bar_w * used / total), qy + 46],
                            radius=6, fill=GOLD if used / total > 0.7 else GREEN)


def draw_analytics(img, x, y, w, h):
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([x, y, x + w, y + h], radius=18, fill=WHITE,
                        outline=PAPER_DARK, width=2)
    d.rectangle([x, y, x + w, y + 50], fill=PAPER_DARK)
    for i, c in enumerate([(255, 95, 86), (255, 189, 46), (39, 201, 63)]):
        d.ellipse([x + 18 + i * 28, y + 18, x + 36 + i * 28, y + 36], fill=c)
    t_centered(d, (x + w // 2, y + 25),
               "cadenza.conservatorio.it/admin/analytics",
               font(HELV, 22), NEUTRAL)

    # KPI strip
    ky = y + 80
    kpis = [("Prenotazioni", "1.847", "+12% vs sett.scorsa", GREEN_DARK),
            ("Tasso occupazione", "73%", "+4 pp", GREEN_DARK),
            ("No-show", "2,1%", "-0,8 pp", GREEN_DARK),
            ("Aule attive", "47 / 52", "5 in manutenzione", NAVY)]
    cw = (w - 60 - 30 * 3) // 4
    for i, (lbl, val, sub, col) in enumerate(kpis):
        cx = x + 30 + i * (cw + 30)
        d.rounded_rectangle([cx, ky, cx + cw, ky + 130],
                            radius=14, fill=PAPER, outline=PAPER_DARK, width=1)
        t_(d, (cx + 20, ky + 14), lbl, font(HELV, 20), NEUTRAL)
        t_(d, (cx + 20, ky + 42), val, font(CRIMSON_BLACK, 56), INK)
        t_(d, (cx + 20, ky + 100), sub, font(HELV, 18), col)

    # heatmap card (left)
    chart_y = ky + 160
    chart_h = h - (chart_y - y) - 60
    hmw = (w - 60 - 30) * 0.62
    hmx = x + 30
    d.rounded_rectangle([hmx, chart_y, hmx + hmw, chart_y + chart_h],
                        radius=14, fill=PAPER, outline=PAPER_DARK, width=1)
    t_(d, (hmx + 20, chart_y + 16), "Heatmap occupazione · 7×24",
       font(CRIMSON_BOLD, 26), INK)
    t_(d, (hmx + 20, chart_y + 50), "Lun–Dom × ore 08:00–22:00",
       font(HELV, 18), NEUTRAL)
    cell = 26
    cols = 14
    rows = 7
    margin_x = 80
    margin_y = 110
    random.seed(42)
    for r in range(rows):
        for c in range(cols):
            v = random.random()
            # bias higher in afternoons
            if 4 <= c <= 10:
                v = min(1.0, v + 0.25)
            rr = int(NAVY_LIGHT[0] * (1 - v) + GOLD[0] * v)
            gg = int(NAVY_LIGHT[1] * (1 - v) + GOLD[1] * v)
            bb = int(NAVY_LIGHT[2] * (1 - v) + GOLD[2] * v)
            x0 = hmx + margin_x + c * cell
            y0 = chart_y + margin_y + r * cell
            d.rounded_rectangle([x0 + 2, y0 + 2, x0 + cell - 2, y0 + cell - 2],
                                radius=4, fill=(rr, gg, bb))
    # axis labels
    for r, day in enumerate(["L", "M", "M", "G", "V", "S", "D"]):
        t_(d, (hmx + margin_x - 16, chart_y + margin_y + r * cell + cell // 2),
           day, font(ARIAL_BOLD, 18), NEUTRAL, anchor="rm")
    for c in range(0, cols, 2):
        h_label = 8 + c
        t_(d, (hmx + margin_x + c * cell + cell // 2,
               chart_y + margin_y + rows * cell + 12),
           f"{h_label:02d}", font(HELV, 16), NEUTRAL, anchor="mt")
    # legend
    ly = chart_y + chart_h - 50
    t_(d, (hmx + 20, ly), "Bassa", font(HELV, 18), NEUTRAL)
    grad_w = 200
    for i in range(grad_w):
        v = i / grad_w
        rr = int(NAVY_LIGHT[0] * (1 - v) + GOLD[0] * v)
        gg = int(NAVY_LIGHT[1] * (1 - v) + GOLD[1] * v)
        bb = int(NAVY_LIGHT[2] * (1 - v) + GOLD[2] * v)
        d.line([(hmx + 100 + i, ly), (hmx + 100 + i, ly + 14)],
               fill=(rr, gg, bb), width=1)
    t_(d, (hmx + 100 + grad_w + 10, ly), "Alta", font(HELV, 18), NEUTRAL)

    # right: top rooms + trend
    rx = hmx + hmw + 30
    rw = w - 60 - hmw - 30
    # top rooms
    rh1 = (chart_h - 30) // 2
    d.rounded_rectangle([rx, chart_y, rx + rw, chart_y + rh1],
                        radius=14, fill=PAPER, outline=PAPER_DARK, width=1)
    t_(d, (rx + 20, chart_y + 16), "Top aule per occupazione",
       font(CRIMSON_BOLD, 26), INK)
    rooms = [("Sala A.101", 92), ("Auditorium", 87), ("Sala B.203", 81),
             ("Sala 5", 76), ("Sala 6", 64)]
    for i, (name, pct) in enumerate(rooms):
        ry = chart_y + 70 + i * 50
        t_(d, (rx + 20, ry + 12), name, font(HELV, 22), INK)
        bw = rw - 220
        d.rounded_rectangle([rx + 200, ry + 14, rx + 200 + bw, ry + 30],
                            radius=6, fill=PAPER_DARK)
        d.rounded_rectangle([rx + 200, ry + 14, rx + 200 + int(bw * pct / 100), ry + 30],
                            radius=6, fill=GOLD)
        t_(d, (rx + rw - 20, ry + 12), f"{pct}%",
           font(ARIAL_BOLD, 22), INK, anchor="rt")

    # trend
    d.rounded_rectangle([rx, chart_y + rh1 + 30, rx + rw, chart_y + chart_h],
                        radius=14, fill=PAPER, outline=PAPER_DARK, width=1)
    t_(d, (rx + 20, chart_y + rh1 + 46), "Trend prenotazioni · 8 settimane",
       font(CRIMSON_BOLD, 26), INK)
    cx0 = rx + 40
    cy0 = chart_y + rh1 + 110
    cw_chart = rw - 80
    ch_chart = chart_h - rh1 - 130
    # axes
    d.line([(cx0, cy0 + ch_chart), (cx0 + cw_chart, cy0 + ch_chart)],
           fill=NEUTRAL, width=2)
    d.line([(cx0, cy0), (cx0, cy0 + ch_chart)], fill=NEUTRAL, width=2)
    pts = [0.45, 0.52, 0.50, 0.61, 0.68, 0.66, 0.75, 0.82]
    n = len(pts)
    for i in range(n - 1):
        x1 = cx0 + i * cw_chart // (n - 1)
        x2 = cx0 + (i + 1) * cw_chart // (n - 1)
        y1 = cy0 + int((1 - pts[i]) * ch_chart)
        y2 = cy0 + int((1 - pts[i + 1]) * ch_chart)
        d.line([(x1, y1), (x2, y2)], fill=NAVY, width=4)
    for i, p in enumerate(pts):
        xx = cx0 + i * cw_chart // (n - 1)
        yy = cy0 + int((1 - p) * ch_chart)
        d.ellipse([xx - 6, yy - 6, xx + 6, yy + 6], fill=GOLD)
    # x labels
    for i in range(n):
        xx = cx0 + i * cw_chart // (n - 1)
        t_(d, (xx, cy0 + ch_chart + 6),
           f"S{i+1}", font(HELV, 16), NEUTRAL, anchor="mt")


def finalize(img, idx):
    img = add_grain(img, amount=10)
    path = os.path.join(OUT, f"slide_{idx:02d}.png")
    img.save(path, "PNG", optimize=True)
    print(f"  ✓ {os.path.basename(path)}")
    return path


SLIDES = [
    slide_01_cover,
    slide_02_executive,
    slide_03_problem,
    slide_04_cadenza_overview,
    slide_05_feature_table,
    slide_06_cost_1500,
    slide_07_cost_3000,
    slide_08_5y_tco,
    slide_09_compliance,
    slide_10_screen_dashboard,
    slide_11_screen_weekly,
    slide_12_screen_booking,
    slide_13_screen_analytics,
    slide_14_migration,
    slide_15_pricing,
    slide_16_cta,
]


def main():
    n = len(SLIDES)
    print(f"Rendering {n} slides → {OUT}")
    for i, fn in enumerate(SLIDES, start=1):
        fn(i, n)

    # Build PDF
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
