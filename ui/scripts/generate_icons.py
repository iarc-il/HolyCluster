#!/usr/bin/env python3
"""Render the canonical SVG into the checked-in PWA icons (no runtime dependency).

Run from any directory: python3 ui/scripts/generate_icons.py
Build-time tools: Python 3, PyGObject with Rsvg 2, Pycairo, and Pillow.
On Debian/Ubuntu: python3-gi gir1.2-rsvg-2.0 python3-cairo python3-pil.
"""

from pathlib import Path

import cairo
import gi
from PIL import Image

gi.require_version("Rsvg", "2.0")
from gi.repository import Rsvg

ICONS = Path(__file__).resolve().parents[1] / "public" / "icons"
SOURCE = ICONS / "holycluster.svg"
SUPERSAMPLE = 4


def render(width, height, *, maskable=False):
    """Contain the 121x132 drawing; maskable content fits the central 80% circle."""
    scale = SUPERSAMPLE
    surface = cairo.ImageSurface(cairo.FORMAT_ARGB32, width * scale, height * scale)
    context = cairo.Context(surface)
    context.scale(scale, scale)
    if maskable:
        context.set_source_rgb(1, 1, 1)
        context.paint()
    # The drawing occupies 70% of the canvas, on an opaque white background.
    # Its silhouette (including the crown tips) fits inside the 40%-radius
    # maskable safe circle; main() verifies this after rasterization.
    inset = width * 0.15 if maskable else 0
    viewport = Rsvg.Rectangle()
    viewport.x = inset
    viewport.y = inset
    viewport.width = width - 2 * inset
    viewport.height = height - 2 * inset
    handle = Rsvg.Handle.new_from_file(str(SOURCE))
    if not handle.render_document(context, viewport):
        raise RuntimeError("SVG rendering failed")
    # Cairo exposes native-endian premultiplied pixels; PNG round-trip avoids
    # channel ordering and unpremultiplication assumptions.
    import io

    buffer = io.BytesIO()
    surface.write_to_png(buffer)
    buffer.seek(0)
    with Image.open(buffer) as image:
        return image.convert("RGBA").resize((width, height), Image.Resampling.LANCZOS)


def main():
    for size in (192, 512):
        render(size, size).save(ICONS / f"holycluster-{size}.png")
    maskable = render(512, 512, maskable=True)
    for index, pixel in enumerate(maskable.getdata()):
        if pixel != (255, 255, 255, 255):
            x, y = index % 512 + 0.5, index // 512 + 0.5
            if (x - 256) ** 2 + (y - 256) ** 2 > (512 * 0.4) ** 2:
                raise ValueError("Maskable artwork exceeds the central safe circle")
    maskable.save(ICONS / "holycluster-maskable-512.png")


if __name__ == "__main__":
    main()
