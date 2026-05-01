"""Mini renderer per icone lucide-react: legge i file
`frontend/node_modules/lucide-react/dist/esm/icons/<name>.js`, estrae le
primitive (path/circle/rect/line) e le disegna su un PIL.Image.

Lucide usa viewBox 24×24, stroke-width 2, stroke-linecap round,
stroke-linejoin round, fill=none. Il rendering qui replica quel look:
linee tonde con spessore proporzionale.
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Iterable

from PIL import Image, ImageDraw

try:
    from svgpathtools import parse_path
except ImportError:
    parse_path = None  # type: ignore


LUCIDE_ICONS_DIR = Path(
    "/Users/danilorusso/Desktop/prenota-aule/conservatory-app/frontend/"
    "node_modules/lucide-react/dist/esm/icons"
)
VIEWBOX = 24.0


def _strip_js(text: str) -> str:
    """Remove block comments + string-key 'key: ...,' pairs to ease parsing."""
    text = re.sub(r"/\*.*?\*/", "", text, flags=re.S)
    return text


_PRIMITIVE_RE = re.compile(
    r'\[\s*"(?P<tag>path|circle|rect|line|polygon|polyline|ellipse)"\s*,\s*\{(?P<attrs>[^}]*)\}\s*\]',
    re.S,
)
_ATTR_RE = re.compile(r'(?P<key>\w+)\s*:\s*"(?P<value>[^"]*)"')


_REEXPORT_RE = re.compile(r"export\s*\{\s*default\s*\}\s*from\s*['\"]\./([\w-]+)\.js['\"]")


def _parse_icon_file(path: Path) -> list[tuple[str, dict[str, str]]]:
    """Ritorna lista di (tag, attrs_dict). Segue re-export
    `export { default } from './<name>.js'` di lucide (es. bar-chart-3 →
    chart-column)."""
    if not path.exists():
        return []
    src = _strip_js(path.read_text())
    # Re-export?
    m = _REEXPORT_RE.search(src)
    if m:
        return _parse_icon_file(path.parent / f"{m.group(1)}.js")
    out = []
    for pm in _PRIMITIVE_RE.finditer(src):
        tag = pm.group("tag")
        attrs = {k.group("key"): k.group("value") for k in _ATTR_RE.finditer(pm.group("attrs"))}
        out.append((tag, attrs))
    return out


def _scale(v: float, size: int) -> float:
    return v / VIEWBOX * size


def _draw_path_segment(d: ImageDraw.ImageDraw, path_d: str, size: int,
                       fill, width: int) -> None:
    """Sample SVG path con svgpathtools → segmenti di linea."""
    if parse_path is None:
        # Fallback senza svgpathtools: niente da disegnare.
        return
    try:
        path = parse_path(path_d)
    except Exception:
        return
    # Ogni segmento campionato in N punti proporzionali alla sua lunghezza.
    for seg in path:
        try:
            length = seg.length()
        except Exception:
            length = 1.0
        steps = max(8, int(length * 4))
        prev = None
        for k in range(steps + 1):
            t = k / steps
            try:
                p = seg.point(t)
            except Exception:
                continue
            cur = (_scale(p.real, size), _scale(p.imag, size))
            if prev is not None:
                d.line([prev, cur], fill=fill, width=width)
            prev = cur


def render_icon(name: str, size: int = 64,
                color: tuple[int, int, int] = (15, 23, 42),
                stroke_width: float | None = None) -> Image.Image:
    """Rendi un'icona lucide come PIL.Image RGBA trasparente."""
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    icon_path = LUCIDE_ICONS_DIR / f"{name}.js"
    if not icon_path.exists():
        # disegna un placeholder (X) per debug
        d.line([(0, 0), (size, size)], fill=(220, 38, 38, 255), width=2)
        d.line([(0, size), (size, 0)], fill=(220, 38, 38, 255), width=2)
        return img

    width = max(2, int(round((stroke_width if stroke_width is not None else size / 12))))
    fill = color + (255,)

    for tag, attrs in _parse_icon_file(icon_path):
        if tag == "path":
            _draw_path_segment(d, attrs.get("d", ""), size, fill, width)
        elif tag == "circle":
            cx = _scale(float(attrs.get("cx", 0)), size)
            cy = _scale(float(attrs.get("cy", 0)), size)
            r = _scale(float(attrs.get("r", 0)), size)
            bbox = [cx - r, cy - r, cx + r, cy + r]
            d.ellipse(bbox, outline=fill, width=width)
        elif tag == "rect":
            x = _scale(float(attrs.get("x", 0)), size)
            y = _scale(float(attrs.get("y", 0)), size)
            w = _scale(float(attrs.get("width", 0)), size)
            h = _scale(float(attrs.get("height", 0)), size)
            rx = float(attrs.get("rx", 0))
            radius = _scale(rx, size) if rx else 0
            if radius:
                d.rounded_rectangle([x, y, x + w, y + h], radius=radius,
                                    outline=fill, width=width)
            else:
                d.rectangle([x, y, x + w, y + h], outline=fill, width=width)
        elif tag == "line":
            x1 = _scale(float(attrs.get("x1", 0)), size)
            y1 = _scale(float(attrs.get("y1", 0)), size)
            x2 = _scale(float(attrs.get("x2", 0)), size)
            y2 = _scale(float(attrs.get("y2", 0)), size)
            d.line([(x1, y1), (x2, y2)], fill=fill, width=width)
        elif tag in ("polyline", "polygon"):
            pts_str = attrs.get("points", "")
            nums = [float(x) for x in re.split(r"[\s,]+", pts_str.strip()) if x]
            pts = [(_scale(nums[i], size), _scale(nums[i + 1], size))
                   for i in range(0, len(nums) - 1, 2)]
            if len(pts) >= 2:
                if tag == "polygon":
                    pts.append(pts[0])
                for a, b in zip(pts, pts[1:]):
                    d.line([a, b], fill=fill, width=width)
        elif tag == "ellipse":
            cx = _scale(float(attrs.get("cx", 0)), size)
            cy = _scale(float(attrs.get("cy", 0)), size)
            rx = _scale(float(attrs.get("rx", 0)), size)
            ry = _scale(float(attrs.get("ry", 0)), size)
            d.ellipse([cx - rx, cy - ry, cx + rx, cy + ry],
                      outline=fill, width=width)
    return img


def paste_icon_on(img: Image.Image, name: str, cx: int, cy: int,
                  size: int = 48, color=(15, 23, 42)) -> Image.Image:
    """Renderizza icona lucide a 4× resolution e la incolla centrata."""
    hi = render_icon(name, size=size * 4, color=color, stroke_width=size / 3)
    hi = hi.resize((size, size), Image.LANCZOS)
    base = img.convert("RGBA")
    base.alpha_composite(hi, (int(cx - size / 2), int(cy - size / 2)))
    return base.convert("RGB")
