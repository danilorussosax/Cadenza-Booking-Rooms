#!/usr/bin/env python3
"""Compose icona.png onto each slides_pdf/slide_XX.png, in place of the
existing logo glyph (top-left for cover slides, footer-left for content
slides). Then build AulaBook_Presentazione_Prodotto.pdf from the result.
"""
import glob
import os
from PIL import Image

ROOT = os.path.dirname(os.path.abspath(__file__))
SLIDES_DIR = os.path.join(ROOT, "slides_pdf")
ICON = "/Users/danilorusso/Desktop/prenota-aule/cadenza.png"
PDF_OUT = "/Users/danilorusso/Desktop/prenota-aule/AulaBook_Presentazione_Prodotto.pdf"


COVER_SLIDES = {1, 16}  # slide_01 (intro) and slide_16 (CTA)


def is_cover(slide_path):
    base = os.path.basename(slide_path)
    idx = int(base.replace("slide_", "").replace(".png", ""))
    return idx in COVER_SLIDES


def composite_icon(img, center, size, glow=False):
    base = img.convert("RGBA")
    icon = Image.open(ICON).convert("RGBA").resize((size, size), Image.LANCZOS)
    cx, cy = center
    # erase the area first by filling with the page background sampled near
    # top-right corner (cover) or bottom-right (content)
    base.alpha_composite(icon, (int(cx - size / 2), int(cy - size / 2)))
    return base.convert("RGB")


def patch_slide(path):
    from PIL import ImageDraw
    img = Image.open(path).convert("RGBA")
    cover = is_cover(path)
    if cover:
        bg = img.getpixel((30, 30))
        d = ImageDraw.Draw(img)
        d.rectangle([85, 95, 205, 215], fill=bg)
        img = img.convert("RGB")
        img = composite_icon(img, (140, 152), 100)
    else:
        bg = img.getpixel((30, 30))
        d = ImageDraw.Draw(img)
        d.rectangle([95, 1022, 138, 1058], fill=bg)
        img = img.convert("RGB")
        img = composite_icon(img, (114, 1040), 34)
    img.save(path, "PNG", optimize=True)


def main():
    slides = sorted(glob.glob(os.path.join(SLIDES_DIR, "slide_*.png")))
    for s in slides:
        patch_slide(s)
        print(f"  ✓ {os.path.basename(s)}")
    # Build PDF
    images = [Image.open(s).convert("RGB") for s in slides]
    images[0].save(PDF_OUT, save_all=True, append_images=images[1:],
                   resolution=150.0)
    print(f"\nPDF → {PDF_OUT}")


if __name__ == "__main__":
    main()
