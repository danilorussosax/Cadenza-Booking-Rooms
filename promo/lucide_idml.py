"""Converte le icone lucide-react (path SVG) in primitive IDML
(Polygon con PathGeometry per i path, Oval per i cerchi, Polygon
chiuso per i rect, GraphicLine per le line). Le icone sono "open
paths" con stroke (fill=None), come nel rendering originale lucide.

Uso:
    from lucide_idml import build_icon_xml
    xml_fragment = build_icon_xml("shield-check", uid="ic1",
                                  cx=140, cy=160, size=64,
                                  color_swatch="Color/Gold",
                                  stroke_w=4)
"""
from __future__ import annotations

import math
import re
from pathlib import Path

from svgpathtools import parse_path, CubicBezier, Line, QuadraticBezier, Arc

LUCIDE_ICONS_DIR = Path(
    "/Users/danilorusso/Desktop/prenota-aule/conservatory-app/frontend/"
    "node_modules/lucide-react/dist/esm/icons"
)
VIEWBOX = 24.0

_PRIMITIVE_RE = re.compile(
    r'\[\s*"(?P<tag>path|circle|rect|line|polygon|polyline|ellipse)"\s*,\s*\{(?P<attrs>[^}]*)\}\s*\]',
    re.S,
)
_ATTR_RE = re.compile(r'(?P<key>\w+)\s*:\s*"(?P<value>[^"]*)"')
_REEXPORT_RE = re.compile(
    r"export\s*\{\s*default\s*\}\s*from\s*['\"]\./([\w-]+)\.js['\"]"
)


def _parse_icon(name: str) -> list[tuple[str, dict[str, str]]]:
    p = LUCIDE_ICONS_DIR / f"{name}.js"
    if not p.exists():
        return []
    src = re.sub(r"/\*.*?\*/", "", p.read_text(), flags=re.S)
    m = _REEXPORT_RE.search(src)
    if m:
        return _parse_icon(m.group(1))
    out = []
    for pm in _PRIMITIVE_RE.finditer(src):
        tag = pm.group("tag")
        attrs = {k.group("key"): k.group("value") for k in _ATTR_RE.finditer(pm.group("attrs"))}
        out.append((tag, attrs))
    return out


def _bezier_path_points(segments, scale_xy: tuple[float, float],
                       offset_xy: tuple[float, float]) -> list[str]:
    """Da svgpathtools.Path → lista di <PathPointType> XML.
    Coordinate scalate da viewBox (24×24) a target size, traslate di offset.
    """
    sx, sy = scale_xy
    ox, oy = offset_xy

    def xform(pt):
        # complex (x + yj) → (x_scaled, y_scaled) traslato
        return (pt.real * sx + ox, pt.imag * sy + oy)

    points: list[tuple[tuple[float, float], tuple[float, float], tuple[float, float]]] = []
    # ogni segmento contribuisce con: il proprio anchor di partenza con
    # right-direction = control1 (se cubic) o anchor (se line); poi il
    # punto di arrivo con left-direction = control2 (cubic) o anchor.

    if not segments:
        return []

    # Inizializza con il primo anchor
    first = segments[0].start
    fx = xform(first)
    points.append((fx, fx, fx))  # anchor, leftDir, rightDir (verrà aggiornato)

    for seg in segments:
        if isinstance(seg, Line):
            end = xform(seg.end)
            points[-1] = (points[-1][0], points[-1][1], points[-1][0])  # rightDir = anchor
            points.append((end, end, end))
        elif isinstance(seg, CubicBezier):
            c1 = xform(seg.control1)
            c2 = xform(seg.control2)
            end = xform(seg.end)
            # update last point's rightDirection = control1
            anc, ld, _ = points[-1]
            points[-1] = (anc, ld, c1)
            # new point: leftDirection = control2
            points.append((end, c2, end))
        elif isinstance(seg, QuadraticBezier):
            # convert to cubic
            start = seg.start
            end = seg.end
            ctl = seg.control
            c1 = start + 2 / 3 * (ctl - start)
            c2 = end + 2 / 3 * (ctl - end)
            anc, ld, _ = points[-1]
            points[-1] = (anc, ld, xform(c1))
            points.append((xform(end), xform(c2), xform(end)))
        elif isinstance(seg, Arc):
            # approssimazione: spezza in pezzi cubici
            try:
                n = max(3, int(abs(seg.delta) / 30))
            except Exception:
                n = 4
            for k in range(1, n + 1):
                t0 = (k - 1) / n
                t1 = k / n
                # piccolo pezzetto come cubic da svgpathtools (.cropped)
                try:
                    sub = seg.cropped(t0, t1)
                except Exception:
                    sub = None
                if sub is None:
                    end = xform(seg.point(t1))
                    points.append((end, end, end))
                else:
                    cubics = sub.as_cubic_curves(curves=1) if hasattr(sub, "as_cubic_curves") else None
                    if cubics:
                        for cb in cubics:
                            c1 = xform(cb.control1)
                            c2 = xform(cb.control2)
                            end = xform(cb.end)
                            anc, ld, _ = points[-1]
                            points[-1] = (anc, ld, c1)
                            points.append((end, c2, end))
                    else:
                        end = xform(sub.end)
                        anc, ld, _ = points[-1]
                        points[-1] = (anc, ld, anc)
                        points.append((end, end, end))
        else:
            end = xform(seg.end)
            points.append((end, end, end))

    xml = []
    for anc, ld, rd in points:
        xml.append(
            f'<PathPointType Anchor="{anc[0]:.3f} {anc[1]:.3f}" '
            f'LeftDirection="{ld[0]:.3f} {ld[1]:.3f}" '
            f'RightDirection="{rd[0]:.3f} {rd[1]:.3f}"/>'
        )
    return xml


def _polygon_xml(uid: str, points_xml: list[str], path_open: bool,
                 stroke_swatch: str, stroke_w: float) -> str:
    """Disegna un Polygon IDML con PathGeometry stroke-only (no fill)."""
    open_attr = "true" if path_open else "false"
    return (
        f'    <Polygon Self="{uid}" StoryTitle="$ID/" '
        f'ContentType="Unassigned" Visible="true" Name="" '
        f'FillColor="Swatch/None" '
        f'StrokeColor="{stroke_swatch}" StrokeWeight="{stroke_w}" '
        f'EndCap="RoundEndCap" EndJoin="RoundEndJoin" '
        f'ItemLayer="ub" Locked="false" '
        f'AppliedObjectStyle="ObjectStyle/$ID/[None]" '
        f'ItemTransform="1 0 0 1 0 0">\n'
        f'      <Properties>\n'
        f'        <PathGeometry>\n'
        f'          <GeometryPathType PathOpen="{open_attr}">\n'
        f'            <PathPointArray>\n'
        f'              {"".join(points_xml)}\n'
        f'            </PathPointArray>\n'
        f'          </GeometryPathType>\n'
        f'        </PathGeometry>\n'
        f'      </Properties>\n'
        f'    </Polygon>\n'
    )


def build_icon_xml(name: str, uid: str, cx: float, cy: float,
                   size: float, color_swatch: str = "Color/Ink",
                   stroke_w: float | None = None) -> str:
    """Ritorna un frammento XML IDML con tutti i sub-path dell'icona,
    centrati su (cx, cy), area `size`×`size`. Stroke-only, no fill.

    NOTA: ritorna il frammento "nudo" (senza wrap Group): da inserire
    direttamente come elementi figli di uno Spread.
    """
    primitives = _parse_icon(name)
    if not primitives:
        return ""
    if stroke_w is None:
        stroke_w = max(1.0, size / 12)
    sx = sy = size / VIEWBOX
    ox = cx - size / 2
    oy = cy - size / 2

    out = []
    for i, (tag, attrs) in enumerate(primitives):
        sub_uid = f"{uid}_{i}"
        if tag == "path":
            try:
                p = parse_path(attrs.get("d", ""))
            except Exception:
                continue
            # Per gestire più sub-path "M ... M ..." dobbiamo splittare
            # quando il segmento.start non coincide con il punto finale
            # del precedente (significa che c'è stato un "M" implicito).
            current: list = []
            for seg in p:
                if current and abs(seg.start - current[-1].end) > 1e-3:
                    # nuovo sub-path
                    pts = _bezier_path_points(current, (sx, sy), (ox, oy))
                    if pts:
                        out.append(_polygon_xml(
                            f"{sub_uid}_{len(out)}", pts,
                            path_open=True,
                            stroke_swatch=color_swatch, stroke_w=stroke_w))
                    current = []
                current.append(seg)
            if current:
                pts = _bezier_path_points(current, (sx, sy), (ox, oy))
                if pts:
                    out.append(_polygon_xml(
                        f"{sub_uid}_{len(out)}", pts,
                        path_open=True,
                        stroke_swatch=color_swatch, stroke_w=stroke_w))
        elif tag == "circle":
            ccx = float(attrs.get("cx", 0)) * sx + ox
            ccy = float(attrs.get("cy", 0)) * sy + oy
            r = float(attrs.get("r", 0)) * sx
            out.append(
                f'    <Oval Self="{sub_uid}" StoryTitle="$ID/" '
                f'ContentType="Unassigned" Visible="true" Name="" '
                f'FillColor="Swatch/None" '
                f'StrokeColor="{color_swatch}" StrokeWeight="{stroke_w}" '
                f'EndCap="RoundEndCap" EndJoin="RoundEndJoin" '
                f'ItemLayer="ub" Locked="false" '
                f'AppliedObjectStyle="ObjectStyle/$ID/[None]" '
                f'ItemTransform="1 0 0 1 {ccx} {ccy}">\n'
                f'      <Properties>\n'
                f'        <PathGeometry>\n'
                f'          <GeometryPathType PathOpen="false">\n'
                f'            <PathPointArray>\n'
                f'              <PathPointType Anchor="-{r} 0" '
                f'LeftDirection="-{r} {r * 0.5523}" '
                f'RightDirection="-{r} -{r * 0.5523}"/>\n'
                f'              <PathPointType Anchor="0 -{r}" '
                f'LeftDirection="-{r * 0.5523} -{r}" '
                f'RightDirection="{r * 0.5523} -{r}"/>\n'
                f'              <PathPointType Anchor="{r} 0" '
                f'LeftDirection="{r} -{r * 0.5523}" '
                f'RightDirection="{r} {r * 0.5523}"/>\n'
                f'              <PathPointType Anchor="0 {r}" '
                f'LeftDirection="{r * 0.5523} {r}" '
                f'RightDirection="-{r * 0.5523} {r}"/>\n'
                f'            </PathPointArray>\n'
                f'          </GeometryPathType>\n'
                f'        </PathGeometry>\n'
                f'      </Properties>\n'
                f'    </Oval>\n'
            )
        elif tag == "rect":
            rx = float(attrs.get("x", 0)) * sx + ox
            ry = float(attrs.get("y", 0)) * sy + oy
            rw = float(attrs.get("width", 0)) * sx
            rh = float(attrs.get("height", 0)) * sy
            radius = float(attrs.get("rx", 0)) * sx
            radius_attr = ""
            if radius > 0:
                radius_attr = (
                    f'TopLeftCornerOption="RoundedCorner" TopLeftCornerRadius="{radius}" '
                    f'TopRightCornerOption="RoundedCorner" TopRightCornerRadius="{radius}" '
                    f'BottomLeftCornerOption="RoundedCorner" BottomLeftCornerRadius="{radius}" '
                    f'BottomRightCornerOption="RoundedCorner" BottomRightCornerRadius="{radius}" '
                )
            cx2 = rx + rw / 2
            cy2 = ry + rh / 2
            hw = rw / 2
            hh = rh / 2
            out.append(
                f'    <Rectangle Self="{sub_uid}" StoryTitle="$ID/" '
                f'ContentType="Unassigned" Visible="true" Name="" '
                f'FillColor="Swatch/None" '
                f'StrokeColor="{color_swatch}" StrokeWeight="{stroke_w}" '
                f'EndCap="RoundEndCap" EndJoin="RoundEndJoin" '
                f'{radius_attr}'
                f'ItemLayer="ub" Locked="false" '
                f'AppliedObjectStyle="ObjectStyle/$ID/[None]" '
                f'ItemTransform="1 0 0 1 {cx2} {cy2}">\n'
                f'      <Properties>\n'
                f'        <PathGeometry>\n'
                f'          <GeometryPathType PathOpen="false">\n'
                f'            <PathPointArray>\n'
                f'              <PathPointType Anchor="-{hw} -{hh}" '
                f'LeftDirection="-{hw} -{hh}" RightDirection="-{hw} -{hh}"/>\n'
                f'              <PathPointType Anchor="-{hw} {hh}" '
                f'LeftDirection="-{hw} {hh}" RightDirection="-{hw} {hh}"/>\n'
                f'              <PathPointType Anchor="{hw} {hh}" '
                f'LeftDirection="{hw} {hh}" RightDirection="{hw} {hh}"/>\n'
                f'              <PathPointType Anchor="{hw} -{hh}" '
                f'LeftDirection="{hw} -{hh}" RightDirection="{hw} -{hh}"/>\n'
                f'            </PathPointArray>\n'
                f'          </GeometryPathType>\n'
                f'        </PathGeometry>\n'
                f'      </Properties>\n'
                f'    </Rectangle>\n'
            )
        elif tag == "line":
            x1 = float(attrs.get("x1", 0)) * sx + ox
            y1 = float(attrs.get("y1", 0)) * sy + oy
            x2 = float(attrs.get("x2", 0)) * sx + ox
            y2 = float(attrs.get("y2", 0)) * sy + oy
            out.append(_polygon_xml(
                sub_uid,
                [
                    f'<PathPointType Anchor="{x1:.3f} {y1:.3f}" '
                    f'LeftDirection="{x1:.3f} {y1:.3f}" '
                    f'RightDirection="{x1:.3f} {y1:.3f}"/>',
                    f'<PathPointType Anchor="{x2:.3f} {y2:.3f}" '
                    f'LeftDirection="{x2:.3f} {y2:.3f}" '
                    f'RightDirection="{x2:.3f} {y2:.3f}"/>',
                ],
                path_open=True,
                stroke_swatch=color_swatch, stroke_w=stroke_w,
            ))
        elif tag in ("polyline", "polygon"):
            nums = [float(x) for x in re.split(r"[\s,]+",
                    attrs.get("points", "").strip()) if x]
            pts = [(nums[i] * sx + ox, nums[i + 1] * sy + oy)
                   for i in range(0, len(nums) - 1, 2)]
            if len(pts) >= 2:
                pp = []
                for x, y in pts:
                    pp.append(
                        f'<PathPointType Anchor="{x:.3f} {y:.3f}" '
                        f'LeftDirection="{x:.3f} {y:.3f}" '
                        f'RightDirection="{x:.3f} {y:.3f}"/>'
                    )
                out.append(_polygon_xml(
                    sub_uid, pp,
                    path_open=(tag == "polyline"),
                    stroke_swatch=color_swatch, stroke_w=stroke_w))

    return "".join(out)
