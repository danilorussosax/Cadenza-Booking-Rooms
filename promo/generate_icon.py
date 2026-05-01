#!/usr/bin/env python3
"""Render the Cadenza app icon and export every size needed.

Visual concept
--------------
- Soft rounded square in NAVY with subtle vertical gradient.
- A symmetrical equalizer made of 5 bars (the "cadenza" — a musical climax),
  the central one in gold, the others in cool cream/light navy.
- A thin arc connects the tops of the bars, evoking a musical phrase.
- A small dot ornament between the two highest bars (a fermata).

Outputs
-------
- /Users/danilorusso/Desktop/prenota-aule/cadenza.png         (1024×1024, master)
- /Users/danilorusso/Desktop/prenota-aule/icona.png           (1024×1024, alias)
- frontend/public/icon-192.png                                (192×192)
- frontend/public/icon-512.png                                (512×512)
- frontend/public/icon-maskable-192.png                       (192×192, safe-area padded)
- frontend/public/icon-maskable-512.png                       (512×512, safe-area padded)
- /Users/danilorusso/Desktop/prenota-aule/cadenza.svg         (vector master)
- frontend/public/assets/icona.svg                            (favicon vector)
"""

import os
import math
from PIL import Image, ImageDraw, ImageFilter

# Colour tokens aligned with frontend/src/index.css
NAVY_DEEP = (15, 23, 42)        # foreground
NAVY = (28, 56, 115)            # primary 222 60% 28%
NAVY_LIGHT = (51, 87, 158)
GOLD = (243, 148, 5)            # warning accent 38 92% 50%
GOLD_DEEP = (200, 122, 8)
CREAM = (245, 232, 200)
WHITE = (255, 255, 255)

ROOT_DESK = "/Users/danilorusso/Desktop/prenota-aule"
ROOT_FE = os.path.join(ROOT_DESK, "conservatory-app", "frontend", "public")


def linear_gradient(size, top, bottom):
    img = Image.new("RGB", (size, size), top)
    px = img.load()
    for y in range(size):
        t = y / (size - 1)
        r = int(top[0] * (1 - t) + bottom[0] * t)
        g = int(top[1] * (1 - t) + bottom[1] * t)
        b = int(top[2] * (1 - t) + bottom[2] * t)
        for x in range(size):
            px[x, y] = (r, g, b)
    return img


def radial_glow(size, cx, cy, color, max_r, alpha_max):
    overlay = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(overlay)
    for r in range(max_r, 0, -8):
        a = int(alpha_max * (1 - r / max_r) ** 2.4)
        d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=color + (a,))
    return overlay


def render_master(size=1024, *, safe_area=False):
    """Render the icon at the requested square size.

    safe_area: when True the artwork is shrunk to ~80% to satisfy the
    PWA maskable safe-area requirement (the launcher may crop a circular
    or rounded mask covering ~20% of the canvas edge)."""
    base = linear_gradient(size, NAVY_DEEP, NAVY)

    # rounded mask (corner radius ~22% — Apple-like)
    mask = Image.new("L", (size, size), 0)
    md = ImageDraw.Draw(mask)
    md.rounded_rectangle([0, 0, size - 1, size - 1],
                         radius=int(size * 0.22), fill=255)

    # apply mask to gradient — produce RGBA with rounded corners
    icon = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    icon.paste(base, (0, 0), mask)

    # gold radial glow centered low to lift the bars
    glow = radial_glow(size, size // 2, int(size * 0.62),
                       GOLD, max_r=int(size * 0.55), alpha_max=80)
    glow_masked = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    glow_masked.paste(glow, (0, 0), mask)
    icon = Image.alpha_composite(icon, glow_masked)

    # ─── artwork plotted into a "stage" rectangle ──────────────────────
    # safe area: PWA maskable spec keeps content inside an inner 80% circle.
    # We use a 0.78 ratio for the artwork bbox to be safe.
    art_w = int(size * (0.62 if safe_area else 0.74))
    art_h = int(size * (0.46 if safe_area else 0.55))
    art_cx = size // 2
    art_baseline = int(size * 0.78)  # bars sit on this line

    art = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    ad = ImageDraw.Draw(art)

    # 5 bars centred. Heights symmetric: low – mid – HIGH – mid – low.
    n = 5
    bar_w = int(art_w / (n * 2 - 1))   # gaps equal to bar width
    gap = bar_w
    total_w = n * bar_w + (n - 1) * gap
    start_x = art_cx - total_w // 2

    ratios = [0.40, 0.74, 1.00, 0.74, 0.40]
    colours = [
        CREAM,
        WHITE,
        GOLD,
        WHITE,
        CREAM,
    ]

    bar_radius = int(bar_w * 0.45)
    for i in range(n):
        x0 = start_x + i * (bar_w + gap)
        h = int(art_h * ratios[i])
        y0 = art_baseline - h
        col = colours[i]
        ad.rounded_rectangle([x0, y0, x0 + bar_w, art_baseline],
                             radius=bar_radius, fill=col + (255,))

    # ─── arc connecting the bar tops (a musical phrase) ───────────────
    # Sit the arc just above the tallest bar.
    tallest_top = art_baseline - art_h
    arc_r_x = total_w // 2 + int(bar_w * 0.4)
    arc_r_y = int(art_h * 0.22)
    arc_cx = art_cx
    arc_cy = tallest_top - int(arc_r_y * 0.15)
    bbox = [arc_cx - arc_r_x, arc_cy - arc_r_y,
            arc_cx + arc_r_x, arc_cy + arc_r_y]
    arc_w = max(5, int(size * 0.014))
    ad.arc(bbox, 195, 345, fill=(245, 232, 200, 235), width=arc_w)

    # ─── fermata (dot above central bar, just under the arc apex) ────
    fermata_r = int(size * 0.022)
    fy = arc_cy - arc_r_y + fermata_r * 2
    ad.ellipse(
        [art_cx - fermata_r, fy - fermata_r,
         art_cx + fermata_r, fy + fermata_r],
        fill=(245, 232, 200, 245),
    )

    # mask artwork to the rounded-rectangle silhouette so the corners stay
    # crisp when we composite.
    art_masked = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    art_masked.paste(art, (0, 0), mask)
    icon = Image.alpha_composite(icon, art_masked)

    # subtle inner highlight ring
    highlight = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    hd = ImageDraw.Draw(highlight)
    hd.rounded_rectangle(
        [int(size * 0.03), int(size * 0.03),
         int(size * 0.97), int(size * 0.97)],
        radius=int(size * 0.20),
        outline=(255, 255, 255, 28),
        width=max(2, size // 256),
    )
    icon = Image.alpha_composite(icon, highlight)

    return icon


def save_png(img, path, size=None):
    if size and size != img.size[0]:
        img = img.resize((size, size), Image.LANCZOS)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    img.save(path, "PNG", optimize=True)
    print(f"  ✓ {path}  ({img.size[0]}×{img.size[1]})")


SVG_TEMPLATE = """<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" role="img" aria-label="Cadenza">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="rgb(15,23,42)"/>
      <stop offset="100%" stop-color="rgb(28,56,115)"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.5" cy="0.65" r="0.55">
      <stop offset="0%" stop-color="rgba(243,148,5,0.55)"/>
      <stop offset="100%" stop-color="rgba(243,148,5,0)"/>
    </radialGradient>
    <clipPath id="clip"><rect width="1024" height="1024" rx="225" ry="225"/></clipPath>
  </defs>
  <g clip-path="url(#clip)">
    <rect width="1024" height="1024" fill="url(#bg)"/>
    <rect width="1024" height="1024" fill="url(#glow)"/>
    <!-- bars (low-mid-HIGH-mid-low) -->
    {bars}
    <!-- arc -->
    <path d="{arc_path}" stroke="rgb(245,232,200)" stroke-width="12" fill="none" stroke-linecap="round" opacity="0.85"/>
    <!-- fermata -->
    <circle cx="512" cy="{fermata_y}" r="18" fill="white" opacity="0.95"/>
  </g>
  <rect x="32" y="32" width="960" height="960" rx="205" ry="205"
        fill="none" stroke="white" stroke-opacity="0.10" stroke-width="3"/>
</svg>
"""


def render_svg():
    size = 1024
    art_w = int(size * 0.74)
    art_h = int(size * 0.55)
    art_cx = size // 2
    art_baseline = int(size * 0.78)
    n = 5
    bar_w = int(art_w / (n * 2 - 1))
    gap = bar_w
    total_w = n * bar_w + (n - 1) * gap
    start_x = art_cx - total_w // 2
    ratios = [0.42, 0.78, 1.00, 0.78, 0.42]
    colours = ["rgb(245,232,200)", "white", "rgb(243,148,5)", "white", "rgb(245,232,200)"]
    bar_radius = int(bar_w * 0.30)

    bars_svg = []
    for i in range(n):
        x0 = start_x + i * (bar_w + gap)
        h = int(art_h * ratios[i])
        y0 = art_baseline - h
        bars_svg.append(
            f'<rect x="{x0}" y="{y0}" width="{bar_w}" height="{h}" '
            f'rx="{bar_radius}" ry="{bar_radius}" fill="{colours[i]}" />'
        )

    arc_r_x = total_w // 2 + bar_w
    arc_r_y = int(art_h * 0.30)
    arc_cx = art_cx
    arc_cy = int(art_baseline - art_h * 1.00 - arc_r_y * 0.10)
    # Arc from (arc_cx-arc_r_x,arc_cy) to (arc_cx+arc_r_x,arc_cy) via
    # the top, drawn with an SVG elliptical-arc command.
    arc_path = (
        f"M {arc_cx - arc_r_x} {arc_cy} "
        f"A {arc_r_x} {arc_r_y} 0 0 1 {arc_cx + arc_r_x} {arc_cy}"
    )
    fermata_y = arc_cy - arc_r_y - int(size * 0.01)
    return SVG_TEMPLATE.format(
        bars="\n    ".join(bars_svg),
        arc_path=arc_path,
        fermata_y=fermata_y,
    )


def main():
    print("Rendering Cadenza icon master (1024) and standard sizes…")

    master = render_master(1024, safe_area=False)
    master_maskable = render_master(1024, safe_area=True)

    # Master flat (RGB on white-equivalent — keep PNG with alpha for now)
    save_png(master, os.path.join(ROOT_DESK, "cadenza.png"))
    save_png(master, os.path.join(ROOT_DESK, "icona.png"))

    # PWA icons
    save_png(master,          os.path.join(ROOT_FE, "icon-512.png"), 512)
    save_png(master,          os.path.join(ROOT_FE, "icon-192.png"), 192)
    save_png(master_maskable, os.path.join(ROOT_FE, "icon-maskable-512.png"), 512)
    save_png(master_maskable, os.path.join(ROOT_FE, "icon-maskable-192.png"), 192)

    # SVG masters
    svg = render_svg()
    with open(os.path.join(ROOT_DESK, "cadenza.svg"), "w", encoding="utf-8") as f:
        f.write(svg)
    print(f"  ✓ {os.path.join(ROOT_DESK, 'cadenza.svg')}")
    fav = os.path.join(ROOT_FE, "assets", "icona.svg")
    os.makedirs(os.path.dirname(fav), exist_ok=True)
    with open(fav, "w", encoding="utf-8") as f:
        f.write(svg)
    print(f"  ✓ {fav}")

    print("Done.")


if __name__ == "__main__":
    main()
