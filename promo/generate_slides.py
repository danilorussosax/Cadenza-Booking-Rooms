#!/usr/bin/env python3
"""Render Cadenza promo slides at 1920x1080 (PNG) into ./slides/."""

import math
import os
from PIL import Image, ImageDraw, ImageFilter, ImageFont

W, H = 1920, 1080

# Palette derived from the real webapp (frontend/src/index.css HSL → RGB)
NAVY = (28, 56, 115)            # primary 222 60% 28%
NAVY_DEEP = (15, 23, 42)        # foreground / dark surface
NAVY_MID = (22, 40, 86)
NAVY_LIGHT = (51, 87, 158)
GOLD = (243, 148, 5)            # warning 38 92% 50%
GOLD_LIGHT = (250, 188, 80)
WHITE = (255, 255, 255)
DIM = (148, 163, 184)
INK = (15, 23, 42)
PAPER = (248, 250, 252)
PAPER_DARK = (226, 232, 240)
NEUTRAL = (100, 116, 139)
GREEN = (22, 163, 74)
RED = (220, 38, 38)
SHOTS_DIR_FROM_HERE = "screenshots"

ROOT = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(ROOT, "slides")
os.makedirs(OUT, exist_ok=True)

ICON_PATH = "/Users/danilorusso/Desktop/prenota-aule/cadenza.png"
_ICON_CACHE = {}


def load_icon(size):
    key = int(size)
    if key not in _ICON_CACHE:
        ic = Image.open(ICON_PATH).convert("RGBA")
        _ICON_CACHE[key] = ic.resize((key, key), Image.LANCZOS)
    return _ICON_CACHE[key]


def paste_icon(img, cx, cy, size, glow=True):
    """Paste icona.png centered on (cx, cy) with optional soft gold glow behind."""
    base = img.convert("RGBA")
    if glow:
        overlay = Image.new("RGBA", base.size, (0, 0, 0, 0))
        od = ImageDraw.Draw(overlay)
        max_r = int(size * 0.95)
        for r in range(max_r, 0, -6):
            a = int(70 * (1 - r / max_r) ** 2.4)
            od.ellipse(
                [cx - r, cy - r, cx + r, cy + r], fill=GOLD + (a,)
            )
        base = Image.alpha_composite(base, overlay)
    icon = load_icon(size)
    base.alpha_composite(icon, (int(cx - size / 2), int(cy - size / 2)))
    return base.convert("RGB")


def paste_screenshot(img, x, y, w, h, name, *, shadow=True):
    """Embed a real webapp screenshot at (x, y) inside w×h, preserving aspect."""
    src = Image.open(os.path.join(ROOT, SHOTS_DIR_FROM_HERE, name)).convert("RGB")
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
    # subtle border
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([cx - 1, cy - 1, cx + nw + 1, cy + nh + 1],
                        radius=10, outline=PAPER_DARK, width=1)
    return img

HELV = "/System/Library/Fonts/HelveticaNeue.ttc"
ARIAL_BOLD = "/System/Library/Fonts/Supplemental/Arial Bold.ttf"
ARIAL_BLACK = "/System/Library/Fonts/Supplemental/Arial Black.ttf"
ARIAL = "/System/Library/Fonts/Supplemental/Arial.ttf"
CRIMSON_BLACK = "/Library/Fonts/CrimsonPro-Black.ttf"
CRIMSON_BOLD = "/Library/Fonts/CrimsonPro-Bold.ttf"
CRIMSON_REG = "/Library/Fonts/CrimsonPro-Regular.ttf"
CRIMSON_LIGHT = "/Library/Fonts/CrimsonPro-Light.ttf"


def font(path, size):
    return ImageFont.truetype(path, size)


def text_size(draw, txt, fnt):
    l, t, r, b = draw.textbbox((0, 0), txt, font=fnt)
    return r - l, b - t, l, t


def draw_text_centered(draw, xy, txt, fnt, fill):
    cx, cy = xy
    w, h, ox, oy = text_size(draw, txt, fnt)
    draw.text((cx - w / 2 - ox, cy - h / 2 - oy), txt, font=fnt, fill=fill)


def draw_text(draw, xy, txt, fnt, fill, anchor="lt"):
    x, y = xy
    w, h, ox, oy = text_size(draw, txt, fnt)
    if anchor == "lt":
        draw.text((x - ox, y - oy), txt, font=fnt, fill=fill)
    elif anchor == "lm":
        draw.text((x - ox, y - h / 2 - oy), txt, font=fnt, fill=fill)
    elif anchor == "rt":
        draw.text((x - w - ox, y - oy), txt, font=fnt, fill=fill)
    elif anchor == "rm":
        draw.text((x - w - ox, y - h / 2 - oy), txt, font=fnt, fill=fill)
    elif anchor == "mt":
        draw.text((x - w / 2 - ox, y - oy), txt, font=fnt, fill=fill)
    elif anchor == "mm":
        draw.text((x - w / 2 - ox, y - h / 2 - oy), txt, font=fnt, fill=fill)


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


def add_radial_glow(img, cx, cy, color, max_r=900, alpha_max=110):
    overlay = Image.new("RGBA", img.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(overlay)
    for r in range(max_r, 0, -10):
        a = int(alpha_max * (1 - r / max_r) ** 2.4)
        d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=color + (a,))
    base = img.convert("RGBA")
    base = Image.alpha_composite(base, overlay)
    return base.convert("RGB")


def add_grain(img, amount=8):
    """Subtle film-grain noise."""
    import random

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


def draw_logo_bars(img, cx, baseline_y, scale=1.0):
    """Cadenza equalizer-bar mark, centered horizontally on cx."""
    # ratios approximate cadenza.svg: outer faded white, inner gold tall
    bars = [
        (0.30, (255, 255, 255, 130)),
        (0.55, (255, 255, 255, 180)),
        (0.78, GOLD + (255,)),
        (1.00, GOLD + (255,)),
        (0.85, GOLD + (255,)),
        (0.60, (255, 255, 255, 180)),
        (0.32, (255, 255, 255, 130)),
    ]
    bar_w = int(28 * scale)
    gap = int(14 * scale)
    base_h = int(280 * scale)
    total_w = len(bars) * bar_w + (len(bars) - 1) * gap
    x = cx - total_w / 2
    overlay = Image.new("RGBA", img.size, (0, 0, 0, 0))
    od = ImageDraw.Draw(overlay)
    radius = max(4, int(6 * scale))
    for ratio, color in bars:
        h = int(base_h * ratio)
        rect = [x, baseline_y - h, x + bar_w, baseline_y]
        od.rounded_rectangle(rect, radius=radius, fill=color)
        x += bar_w + gap
    base = img.convert("RGBA")
    base = Image.alpha_composite(base, overlay)
    return base.convert("RGB")


def draw_decor_lines(img, alpha=24):
    """Faint horizontal staff-like lines for musical feel."""
    overlay = Image.new("RGBA", img.size, (0, 0, 0, 0))
    od = ImageDraw.Draw(overlay)
    for i in range(5):
        y = 200 + i * 22
        od.line([(W - 520, y), (W - 80, y)], fill=(255, 255, 255, alpha), width=2)
    base = img.convert("RGBA")
    base = Image.alpha_composite(base, overlay)
    return base.convert("RGB")


def gold_underline(draw, x, y, width=180, thickness=6):
    draw.rectangle([x, y, x + width, y + thickness], fill=GOLD)


def base_canvas(variant="hero"):
    if variant == "hero":
        img = gradient_bg(NAVY_DEEP, NAVY)
        img = add_radial_glow(img, W // 2, int(H * 0.55), GOLD, max_r=1100, alpha_max=70)
    elif variant == "stat":
        img = gradient_bg(NAVY, NAVY_DEEP)
        img = add_radial_glow(img, int(W * 0.78), int(H * 0.5), GOLD, max_r=900, alpha_max=55)
    elif variant == "split":
        img = gradient_bg(NAVY_MID, NAVY_DEEP)
        img = add_radial_glow(img, int(W * 0.85), int(H * 0.3), GOLD, max_r=700, alpha_max=50)
    elif variant == "light":
        img = gradient_bg((242, 240, 234), (228, 224, 214))
    else:
        img = gradient_bg(NAVY_DEEP, NAVY)
    return img


# ---------- slide renderers ----------


def slide_01_intro(idx):
    img = base_canvas("hero")
    img = paste_icon(img, W // 2, int(H * 0.34), size=360)
    d = ImageDraw.Draw(img)
    draw_text_centered(d, (W // 2, int(H * 0.62)), "CADENZA", font(CRIMSON_BLACK, 200), WHITE)
    gold_underline(d, W // 2 - 90, int(H * 0.72) + 12, width=180, thickness=6)
    draw_text_centered(
        d,
        (W // 2, int(H * 0.80)),
        "Il sistema di prenotazione aule",
        font(HELV, 52),
        DIM,
    )
    draw_text_centered(
        d, (W // 2, int(H * 0.85)), "pensato per il conservatorio.", font(HELV, 52), DIM
    )
    return finalize(img, idx)


def slide_02_problem(idx):
    img = base_canvas("split")
    d = ImageDraw.Draw(img)
    draw_text(d, (160, 220), "Aule contese.", font(CRIMSON_BLACK, 130), WHITE)
    draw_text(d, (160, 380), "Tempo perso.", font(CRIMSON_BLACK, 130), GOLD_LIGHT)
    gold_underline(d, 160, 565, width=140, thickness=5)
    items = ["Email che si accavallano", "Fogli Excel non sincronizzati", "Telefonate alla portineria"]
    y = 640
    for it in items:
        d.ellipse([160, y + 18, 178, y + 36], fill=GOLD)
        draw_text(d, (210, y), it, font(HELV, 46), DIM)
        y += 80
    return finalize(img, idx)


def slide_03_solution(idx):
    img = base_canvas("hero")
    img = paste_icon(img, W // 2, int(H * 0.30), size=240)
    d = ImageDraw.Draw(img)
    draw_text_centered(d, (W // 2, int(H * 0.55)), "Una sola piattaforma.", font(CRIMSON_BLACK, 110), WHITE)
    draw_text_centered(d, (W // 2, int(H * 0.68)), "Per tutto il conservatorio.", font(CRIMSON_BOLD, 80), GOLD_LIGHT)
    draw_text_centered(
        d,
        (W // 2, int(H * 0.82)),
        "Direzione · Docenti · Studenti · Staff",
        font(HELV, 42),
        DIM,
    )
    return finalize(img, idx)


def slide_04_selfservice(idx):
    img = base_canvas("split")
    d = ImageDraw.Draw(img)
    draw_text(d, (120, 180), "Prenota in 3 tap.", font(CRIMSON_BLACK, 110), WHITE)
    gold_underline(d, 120, 320, width=160, thickness=6)
    draw_text(d, (120, 370), "Self-service.", font(HELV, 44), DIM)
    draw_text(d, (120, 425), "Mobile-first.", font(HELV, 44), DIM)
    draw_text(d, (120, 510), "Web · app installabile · kiosk.", font(HELV, 36), DIM)
    # Real screenshot of the booking page on the right
    img = paste_screenshot(img, 760, 110, 1100, 860, "booking.png")
    return finalize(img, idx)


def slide_05_antioverlap(idx):
    img = base_canvas("stat")
    d = ImageDraw.Draw(img)
    # huge zero
    big = font(CRIMSON_BLACK, 720)
    draw_text_centered(d, (int(W * 0.36), int(H * 0.50)), "0", big, GOLD)
    # circle accent around 0
    d.ellipse([int(W * 0.36) - 280, int(H * 0.50) - 280, int(W * 0.36) + 280, int(H * 0.50) + 280], outline=GOLD, width=4)
    tx = int(W * 0.58)
    draw_text(d, (tx, 280), "Sovrapposizioni.", font(CRIMSON_BLACK, 86), WHITE)
    draw_text(d, (tx, 400), "Garantito.", font(CRIMSON_BOLD, 86), GOLD_LIGHT)
    gold_underline(d, tx, 540, width=160, thickness=5)
    draw_text(d, (tx, 600), "Postgres EXCLUDE constraint", font(HELV, 40), DIM)
    draw_text(d, (tx, 656), "+ transazioni SERIALIZABLE.", font(HELV, 40), DIM)
    draw_text(d, (tx, 740), "Anti-overlap a livello di database,", font(HELV, 34), DIM)
    draw_text(d, (tx, 788), "non a livello di applicazione.", font(HELV, 34), DIM)
    return finalize(img, idx)


def slide_06_workflow(idx):
    img = base_canvas("split")
    d = ImageDraw.Draw(img)
    draw_text(d, (160, 200), "Sale concerti", font(CRIMSON_BLACK, 110), WHITE)
    draw_text(d, (160, 320), "con approvazione.", font(CRIMSON_BLACK, 110), GOLD_LIGHT)
    gold_underline(d, 160, 480, width=160, thickness=6)
    draw_text(d, (160, 540), "Workflow direzione: pending, approved.", font(HELV, 44), DIM)
    draw_text(d, (160, 610), "Lista d'attesa con auto-promote.", font(HELV, 44), DIM)
    draw_text(d, (160, 680), "iCal export con token. Senza scuse.", font(HELV, 44), DIM)
    # status pills decoration
    pills = [("RICHIESTA", GOLD_LIGHT), ("IN ATTESA", (220, 220, 220)), ("APPROVATA", (130, 200, 140))]
    px = 160
    py = 820
    for txt, color in pills:
        f = font(ARIAL_BOLD, 28)
        tw, th, _, _ = text_size(d, txt, f)
        d.rounded_rectangle([px, py, px + tw + 50, py + th + 30], radius=20, fill=color)
        d.text((px + 25 + 0, py + 15 + 0), txt, font=f, fill=NAVY_DEEP)
        px += tw + 80
    return finalize(img, idx)


def slide_07_instruments(idx):
    img = base_canvas("hero")
    d = ImageDraw.Draw(img)
    draw_text_centered(d, (W // 2, 240), "Inventario strumenti.", font(CRIMSON_BLACK, 120), WHITE)
    draw_text_centered(d, (W // 2, 380), "End-to-end.", font(CRIMSON_BOLD, 90), GOLD_LIGHT)
    gold_underline(d, W // 2 - 90, 510, width=180, thickness=5)
    # 5-stage flow
    stages = ["Richiesta", "Approvazione", "Consegna", "Restituzione", "Storico"]
    sx = 160
    sy = 700
    box_w = (W - 320 - (len(stages) - 1) * 30) // len(stages)
    for i, s in enumerate(stages):
        x = sx + i * (box_w + 30)
        d.rounded_rectangle([x, sy, x + box_w, sy + 110], radius=14, fill=NAVY_LIGHT, outline=GOLD, width=2)
        f = font(HELV, 32)
        draw_text_centered(d, (x + box_w // 2, sy + 55), s, f, WHITE)
        if i < len(stages) - 1:
            arrow_x = x + box_w + 5
            d.polygon([(arrow_x, sy + 45), (arrow_x + 18, sy + 55), (arrow_x, sy + 65)], fill=GOLD)
    draw_text_centered(d, (W // 2, 590), "PDF consegna · email · reminder T-2gg · auto-overdue", font(HELV, 38), DIM)
    return finalize(img, idx)


def slide_08_kiosk(idx):
    img = base_canvas("split")
    d = ImageDraw.Draw(img)
    draw_text(d, (120, 180), "Calendario", font(CRIMSON_BLACK, 110), WHITE)
    draw_text(d, (120, 320), "settimanale.", font(CRIMSON_BLACK, 110), GOLD_LIGHT)
    gold_underline(d, 120, 470, width=160, thickness=6)
    draw_text(d, (120, 530), "Aule × giorni · 30 minuti.", font(HELV, 36), DIM)
    draw_text(d, (120, 600), "Display di sala in ogni edificio.", font(HELV, 36), DIM)
    draw_text(d, (120, 670), "Esportabile in PDF A4.", font(HELV, 36), DIM)
    # Real screenshot of dashboard (which contains the weekly calendar)
    img = paste_screenshot(img, 760, 100, 1100, 880, "dashboard.png")
    return finalize(img, idx)


def slide_09_bots(idx):
    img = base_canvas("hero")
    d = ImageDraw.Draw(img)
    draw_text_centered(d, (W // 2, 240), "Prenota anche da chat.", font(CRIMSON_BLACK, 120), WHITE)
    gold_underline(d, W // 2 - 90, 400, width=180, thickness=6)
    draw_text_centered(d, (W // 2, 470), "Un wizard a 3 step. Stesse regole, stesse quote.", font(HELV, 42), DIM)
    # 4 channel chips
    channels = [("Telegram", GOLD), ("WhatsApp", (37, 211, 102)), ("Signal", (62, 105, 248)), ("Email", DIM)]
    cx = W // 2
    cy = 720
    spacing = 60
    f = font(ARIAL_BOLD, 44)
    widths = []
    for name, _ in channels:
        w, _, _, _ = text_size(d, name, f)
        widths.append(w + 80)
    total = sum(widths) + spacing * (len(channels) - 1)
    x = cx - total / 2
    for (name, color), w in zip(channels, widths):
        d.rounded_rectangle([x, cy - 40, x + w, cy + 40], radius=40, fill=color, outline=WHITE, width=2)
        text_color = NAVY_DEEP if color == GOLD else WHITE
        draw_text_centered(d, (x + w / 2, cy), name, f, text_color)
        x += w + spacing
    draw_text_centered(d, (W // 2, 880), "Webhook firmati HMAC · binding OTP · rate-limit per utente", font(HELV, 32), DIM)
    return finalize(img, idx)


def slide_10_announcements(idx):
    img = base_canvas("split")
    d = ImageDraw.Draw(img)
    draw_text(d, (160, 200), "Bacheca", font(CRIMSON_BLACK, 140), WHITE)
    draw_text(d, (160, 360), "multicanale.", font(CRIMSON_BLACK, 140), GOLD_LIGHT)
    gold_underline(d, 160, 540, width=160, thickness=6)
    draw_text(d, (160, 600), "Avvisi mirati per ruolo, corso o edificio.", font(HELV, 44), DIM)
    draw_text(d, (160, 670), "Sul kiosk e via email opt-in.", font(HELV, 44), DIM)
    draw_text(d, (160, 760), "11 template editabili da admin.", font(HELV, 44), DIM)
    draw_text(d, (160, 830), "Cifratura AES-256-GCM su DB.", font(HELV, 44), DIM)
    # mock announcement cards
    cx = 1280
    cy = 230
    for i, (title, sub) in enumerate([
        ("Concerto · Sala Verdi", "Studenti Triennio · 19 mag"),
        ("Esami · sessione estiva", "Tutti · iscrizioni aperte"),
        ("Aula 12 · manutenzione", "Edificio B · 21 mag"),
    ]):
        y = cy + i * 220
        d.rounded_rectangle([cx, y, cx + 540, y + 180], radius=18, fill=(248, 248, 244), outline=GOLD, width=2)
        d.rectangle([cx, y, cx + 12, y + 180], fill=GOLD)
        d.text((cx + 40, y + 30), title, font=font(ARIAL_BOLD, 36), fill=NAVY_DEEP)
        d.text((cx + 40, y + 90), sub, font=font(HELV, 28), fill=(80, 90, 120))
    return finalize(img, idx)


def slide_11_security(idx):
    img = base_canvas("hero")
    d = ImageDraw.Draw(img)
    draw_text_centered(d, (W // 2, 220), "Sicurezza & GDPR.", font(CRIMSON_BLACK, 120), WHITE)
    gold_underline(d, W // 2 - 90, 380, width=180, thickness=6)
    draw_text_centered(d, (W // 2, 450), "Pacchetto GDPR-PA italiana, Garante 06/2021.", font(HELV, 42), DIM)
    badges = [
        ("2FA email", "obbligatoria admin"),
        ("CSP rigorosa", "useDefaults: false"),
        ("Audit log", "anonimizzato SHA-256"),
        ("Export & delete", "art. 17 / 20"),
    ]
    bx = 200
    by = 600
    bw = (W - 400 - 60) // 2
    bh = 170
    for i, (t, s) in enumerate(badges):
        col = i % 2
        row = i // 2
        x = bx + col * (bw + 60)
        y = by + row * (bh + 40)
        d.rounded_rectangle([x, y, x + bw, y + bh], radius=18, fill=NAVY_LIGHT, outline=GOLD, width=2)
        # check mark
        d.rounded_rectangle([x + 30, y + 50, x + 90, y + 110], radius=10, fill=GOLD)
        d.text((x + 120, y + 30), t, font=font(ARIAL_BOLD, 44), fill=WHITE)
        d.text((x + 120, y + 95), s, font=font(HELV, 30), fill=DIM)
    return finalize(img, idx)


def slide_12_analytics(idx):
    img = base_canvas("split")
    d = ImageDraw.Draw(img)
    draw_text(d, (120, 180), "Decisioni", font(CRIMSON_BLACK, 110), WHITE)
    draw_text(d, (120, 320), "sui dati.", font(CRIMSON_BLACK, 110), GOLD_LIGHT)
    gold_underline(d, 120, 470, width=160, thickness=6)
    draw_text(d, (120, 530), "Heatmap occupazione · 7×24.", font(HELV, 36), DIM)
    draw_text(d, (120, 600), "Top aule · trend 8 settimane.", font(HELV, 36), DIM)
    draw_text(d, (120, 670), "Export CSV e PDF in un click.", font(HELV, 36), DIM)
    # Real admin analytics screenshot
    img = paste_screenshot(img, 760, 100, 1100, 880, "admin-analytics.png")
    return finalize(img, idx)


def slide_13_production(idx):
    img = base_canvas("stat")
    d = ImageDraw.Draw(img)
    big = font(CRIMSON_BLACK, 480)
    draw_text(d, (140, 230), "77", big, GOLD)
    draw_text(d, (140, 700), "test verdi.", font(CRIMSON_BOLD, 110), WHITE)
    gold_underline(d, 140, 850, width=160, thickness=5)
    draw_text(d, (140, 905), "Production-ready su PA italiana.", font(HELV, 42), DIM)
    draw_text(d, (int(W * 0.55), 280), "Backend integration tests.", font(HELV, 40), DIM)
    draw_text(d, (int(W * 0.55), 350), "+ E2E Playwright.", font(HELV, 40), DIM)
    draw_text(d, (int(W * 0.55), 420), "+ component test frontend.", font(HELV, 40), DIM)
    draw_text(d, (int(W * 0.55), 530), "CI GitHub Actions.", font(ARIAL_BOLD, 44), WHITE)
    draw_text(d, (int(W * 0.55), 600), "Script deploy idempotente VPS Ubuntu.", font(HELV, 38), DIM)
    draw_text(d, (int(W * 0.55), 670), "Healthcheck DB + transazioni atomiche.", font(HELV, 38), DIM)
    return finalize(img, idx)


def slide_14_cta(idx):
    img = base_canvas("hero")
    img = paste_icon(img, W // 2, int(H * 0.30), size=320)
    d = ImageDraw.Draw(img)
    draw_text_centered(d, (W // 2, int(H * 0.58)), "CADENZA", font(CRIMSON_BLACK, 180), WHITE)
    gold_underline(d, W // 2 - 130, int(H * 0.68) + 8, width=260, thickness=6)
    draw_text_centered(
        d,
        (W // 2, int(H * 0.78)),
        "Il tuo conservatorio,",
        font(CRIMSON_BOLD, 70),
        DIM,
    )
    draw_text_centered(
        d,
        (W // 2, int(H * 0.85)),
        "in armonia.",
        font(CRIMSON_BOLD, 70),
        GOLD_LIGHT,
    )
    return finalize(img, idx)


def finalize(img, idx):
    img = add_grain(img, amount=14)
    path = os.path.join(OUT, f"slide_{idx:02d}.png")
    img.save(path, "PNG", optimize=True)
    print(f"  ✓ {os.path.basename(path)}")
    return path


SLIDES = [
    slide_01_intro,
    slide_02_problem,
    slide_03_solution,
    slide_04_selfservice,
    slide_05_antioverlap,
    slide_06_workflow,
    slide_07_instruments,
    slide_08_kiosk,
    slide_09_bots,
    slide_10_announcements,
    slide_11_security,
    slide_12_analytics,
    slide_13_production,
    slide_14_cta,
]


def main():
    print(f"Rendering {len(SLIDES)} slides → {OUT}")
    for i, fn in enumerate(SLIDES, start=1):
        fn(i)
    print("Done.")


if __name__ == "__main__":
    main()
