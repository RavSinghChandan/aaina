"""Style previews.

Offline: an illustrated card per style, drawn from the customer's face shape
and the style's silhouette (`shape` in the catalog). Instant and free.

To use a photorealistic image model later, implement `ImageProvider.render`
and select it with AAINA_IMAGE_PROVIDER - the agent manifest does not change.
"""
from __future__ import annotations

import base64
from typing import Any, Protocol

CX = 160  # face centre x


class ImageProvider(Protocol):
    def render(self, option: dict[str, Any], style: dict[str, Any], analysis: dict[str, Any]) -> str: ...


FACES = {
    "oval":     f'<ellipse cx="{CX}" cy="182" rx="56" ry="76"/>',
    "round":    f'<ellipse cx="{CX}" cy="184" rx="64" ry="70"/>',
    "oblong":   f'<ellipse cx="{CX}" cy="182" rx="50" ry="84"/>',
    "square":   f'<path d="M{CX-60},130 Q{CX-60},106 {CX-30},106 L{CX+30},106 Q{CX+60},106 {CX+60},130 L{CX+60},224 Q{CX+58},258 {CX},258 Q{CX-58},258 {CX-60},224 Z"/>',
    "heart":    f'<path d="M{CX-62},150 Q{CX-62},106 {CX},106 Q{CX+62},106 {CX+62},150 Q{CX+58},210 {CX},258 Q{CX-58},210 {CX-62},150 Z"/>',
    "diamond":  f'<path d="M{CX},106 Q{CX+30},112 {CX+62},176 Q{CX+44},228 {CX},258 Q{CX-44},228 {CX-62},176 Q{CX-30},112 {CX},106 Z"/>',
    "triangle": f'<path d="M{CX-40},112 Q{CX},100 {CX+40},112 Q{CX+64},200 {CX+56},230 Q{CX+40},258 {CX},258 Q{CX-40},258 {CX-56},230 Q{CX-64},200 {CX-40},112 Z"/>',
}

# silhouette -> (length, top_height, extras)
SHAPES: dict[str, tuple[str, int, set[str]]] = {
    "buzz": ("short", 4, set()), "crew": ("short", 10, set()), "crop": ("short", 12, {"fringe-forward"}),
    "taper": ("short", 12, set()), "side-part": ("short", 14, {"part"}), "quiff": ("short", 16, {"quiff"}),
    "pompadour": ("short", 22, {"quiff"}), "slick-back": ("short", 14, {"slick"}), "curly-fade": ("short", 18, {"curls"}),
    "hard-part": ("short", 14, {"part", "hardline"}), "caesar": ("short", 9, {"fringe-straight"}), "pixie": ("short", 14, {"fringe-side"}),
    "flow": ("ear", 18, {"part-mid"}), "curtain": ("jaw", 16, {"part-mid"}), "wolf": ("neck", 20, {"shag"}),
    "bob": ("jaw", 14, {"blunt"}), "bob-asym": ("jaw", 14, {"asym"}), "lob": ("shoulder", 14, set()),
    "medium-curly": ("shoulder", 22, {"curls"}), "medium-feathered": ("shoulder", 16, {"feather"}),
    "long-layered": ("long", 16, {"layers"}), "long-framed": ("long", 16, {"framing"}), "long-stepped": ("long", 16, {"steps"}),
    "long-u": ("long", 14, set()), "long-butterfly": ("long", 20, {"framing", "layers"}), "long-bangs": ("long", 16, {"bangs"}),
}
BOTTOM = {"ear": 214, "jaw": 256, "neck": 290, "shoulder": 312, "long": 372}


def _hair(shape: str) -> str:
    length, h, extras = SHAPES.get(shape, ("short", 12, set()))
    top = 104 - h
    parts: list[str] = []
    if length != "short":
        b = BOTTOM[length]
        # back hair behind the face
        bottom = f"Q{CX},{b + 14} {CX - 92},{b}" if "blunt" not in extras else f"L{CX - 92},{b}"
        if "asym" in extras:
            bottom = f"L{CX - 90},{b - 22}"
        parts.append(f'<path class="hb" d="M{CX - 70},150 Q{CX - 74},{top} {CX},{top} Q{CX + 74},{top} {CX + 70},150 L{CX + 92},{b} {bottom} Z"/>')
    # cap over the head
    cap = f'M{CX - 64},168 C{CX - 70},{top + 6} {CX - 40},{top} {CX},{top} C{CX + 40},{top} {CX + 70},{top + 6} {CX + 64},168 C{CX + 56},134 {CX + 40},118 {CX},116 C{CX - 40},118 {CX - 56},134 {CX - 64},168 Z'
    parts.append(f'<path class="hc" d="{cap}"/>')
    if "quiff" in extras:
        parts.append(f'<path class="hc" d="M{CX - 30},{top + 6} Q{CX - 6},{top - 26} {CX + 34},{top - 4} Q{CX + 10},{top + 10} {CX - 30},{top + 12} Z"/>')
    if "curls" in extras:
        for i, x in enumerate(range(CX - 54, CX + 60, 18)):
            parts.append(f'<circle class="hc" cx="{x}" cy="{top + 8 + (i % 2) * 6}" r="13"/>')
    if "fringe-forward" in extras or "fringe-straight" in extras:
        y = 130 if "fringe-straight" in extras else 136
        parts.append(f'<path class="hc" d="M{CX - 50},{top + 14} L{CX + 50},{top + 14} L{CX + 46},{y} L{CX - 46},{y} Z"/>')
    if "fringe-side" in extras or "bangs" in extras:
        parts.append(f'<path class="hc" d="M{CX - 56},{top + 16} Q{CX + 10},{top + 2} {CX + 58},{top + 30} Q{CX + 10},148 {CX - 52},150 Z"/>')
    if "framing" in extras or "feather" in extras:
        parts.append(f'<path class="hl" d="M{CX - 56},150 Q{CX - 72},200 {CX - 60},252 M{CX + 56},150 Q{CX + 72},200 {CX + 60},252"/>')
    if "layers" in extras or "steps" in extras or "shag" in extras:
        for k in range(3):
            y = 230 + k * 40
            parts.append(f'<path class="hl" d="M{CX - 88},{y} q14,-12 28,0 M{CX + 60},{y} q14,-12 28,0"/>')
    if "part" in extras:
        parts.append(f'<path class="{"hp" if "hardline" in extras else "hl"}" d="M{CX - 26},{top + 4} L{CX - 34},128"/>')
    if "part-mid" in extras:
        parts.append(f'<path class="hl" d="M{CX},{top + 2} L{CX},128"/>')
    if "slick" in extras:
        for dx in (-30, -10, 10, 30):
            parts.append(f'<path class="hl" d="M{CX + dx},{top + 10} Q{CX + dx + 4},{top + 30} {CX + dx + 10},140"/>')
    return "".join(parts)


def _rgb(v: Any, default: tuple[int, int, int]) -> tuple[int, int, int]:
    if isinstance(v, (list, tuple)) and len(v) == 3 and all(isinstance(x, (int, float)) and 0 <= x <= 255 for x in v):
        return int(v[0]), int(v[1]), int(v[2])
    return default


def _hex(c: tuple[int, int, int], k: float = 1.0) -> str:
    return "#" + "".join(f"{max(0, min(255, round(x * k))):02x}" for x in c)


SKIN = (217, 160, 122)
HAIR = (43, 29, 20)


class SvgStyleCards:
    """The customer's own colours (skin and hair read from their photo on the phone),
    face shape and beard, wearing the recommended cut."""

    def render(self, option: dict[str, Any], style: dict[str, Any], analysis: dict[str, Any]) -> str:
        face = FACES.get(analysis.get("face_shape", "oval"), FACES["oval"])
        look = analysis.get("appearance") or {}
        skin, hair = _rgb(look.get("skin"), SKIN), _rgb(look.get("hair"), HAIR)
        beard = bool((analysis.get("beard") or {}).get("present"))
        name = option.get("name") or style.get("name", "")
        markup = _hair(style.get("shape", ""))
        beard_svg = (
            f'<path d="M{CX - 56},196 Q{CX - 54},250 {CX - 20},262 Q{CX},270 {CX + 20},262 Q{CX + 54},250 {CX + 56},196 '
            f'Q{CX + 46},236 {CX + 18},238 Q{CX},232 {CX - 18},238 Q{CX - 46},236 {CX - 56},196 Z" fill="url(#hair)" opacity=".94"/>'
            f'<path d="M{CX - 22},218 Q{CX},208 {CX + 22},218 Q{CX},214 {CX - 22},218 Z" fill="url(#hair)"/>'
        ) if beard else ""
        svg = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 400" role="img" aria-label="{name} preview">
<defs>
 <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0B1A05"/><stop offset="1" stop-color="#00262A"/></linearGradient>
 <linearGradient id="hair" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="{_hex(hair, 1.25)}"/><stop offset="1" stop-color="{_hex(hair, .7)}"/></linearGradient>
 <radialGradient id="skin" cx="45%" cy="38%" r="70%"><stop offset="0" stop-color="{_hex(skin, 1.06)}"/><stop offset="1" stop-color="{_hex(skin, .9)}"/></radialGradient>
</defs>
<rect width="320" height="400" rx="24" fill="url(#bg)"/>
<circle cx="{CX}" cy="190" r="150" fill="none" stroke="#86BC25" stroke-opacity=".18"/>
<circle cx="{CX}" cy="190" r="120" fill="none" stroke="#00ABAB" stroke-opacity=".14" stroke-dasharray="3 6"/>
<path d="M{CX - 34},250 L{CX - 30},300 Q{CX},314 {CX + 30},300 L{CX + 34},250 Z" fill="{_hex(skin, .86)}"/>
<path d="M{CX - 120},400 Q{CX - 110},310 {CX},304 Q{CX + 110},310 {CX + 120},400 Z" fill="#E8E4DC"/>
<path d="M{CX - 30},304 L{CX},336 L{CX + 30},304" fill="none" stroke="#C9C2B6" stroke-width="2"/>
<g fill="url(#hair)" class="back">{_back_only(markup)}</g>
<g fill="{_hex(skin, .92)}"><ellipse cx="{CX - 58}" cy="190" rx="9" ry="16"/><ellipse cx="{CX + 58}" cy="190" rx="9" ry="16"/></g>
<g fill="url(#skin)" stroke="{_hex(skin, .78)}" stroke-width="1.5">{face}</g>
<g fill="none" stroke="{_hex(hair, .9)}" stroke-width="4" stroke-linecap="round"><path d="M{CX - 34},168 Q{CX - 22},162 {CX - 10},167"/><path d="M{CX + 10},167 Q{CX + 22},162 {CX + 34},168"/></g>
<g fill="#2A1E16"><ellipse cx="{CX - 22}" cy="184" rx="5" ry="3.4"/><ellipse cx="{CX + 22}" cy="184" rx="5" ry="3.4"/></g>
<path d="M{CX - 3},190 Q{CX - 7},206 {CX - 2},210 Q{CX + 4},211 {CX + 6},208" fill="none" stroke="{_hex(skin, .7)}" stroke-width="2" stroke-linecap="round"/>
{beard_svg}
<path d="M{CX - 13},226 Q{CX},233 {CX + 13},226" fill="none" stroke="#7A3F33" stroke-width="2.4" stroke-linecap="round"/>
<g fill="url(#hair)">{_front_only(markup)}</g>
</svg>'''
        svg = (svg.replace('class="hl"', f'fill="none" stroke="{_hex(hair, 1.7)}" stroke-width="2" stroke-linecap="round"')
                  .replace('class="hp"', 'fill="none" stroke="#E8D9C8" stroke-width="2.4"'))
        return "data:image/svg+xml;base64," + base64.b64encode(svg.encode()).decode()


def _back_only(markup: str) -> str:
    return "".join(p + "/>" for p in markup.split("/>") if 'class="hb"' in p)


def _front_only(markup: str) -> str:
    return "".join(p + "/>" for p in markup.split("/>") if p and 'class="hb"' not in p)


_PROVIDER: ImageProvider = SvgStyleCards()


def render_previews(options: list[dict[str, Any]], styles_by_id: dict[str, dict[str, Any]], analysis: dict[str, Any]) -> list[dict[str, str]]:
    out = []
    for opt in options:
        style = styles_by_id.get(opt.get("style_id"), {})
        out.append({"style_id": opt.get("style_id", ""), "image": _PROVIDER.render(opt, style, analysis),
                    "caption": f"Your colours and face shape, illustrated: preview of {opt.get('name', 'this cut')} on a {analysis.get('face_shape', 'oval')} face"})
    return out
