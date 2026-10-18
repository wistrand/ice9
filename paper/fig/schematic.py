#!/usr/bin/env python3
"""Schematic of the two column models (sinks: one layer; floats: mixed layer over a deep layer)."""
from PIL import Image, ImageDraw, ImageFont
FONT = '/usr/share/fonts/TTF/DejaVuSans.ttf'; s = 2; W, H = 1650, 700
im = Image.new('RGB', (W * s, H * s), '#ffffff'); dr = ImageDraw.Draw(im)
f = ImageFont.truetype(FONT, 24 * s); fb = ImageFont.truetype(FONT, 28 * s); fs = ImageFont.truetype(FONT, 21 * s)
INK, MUTED, WATER, DEEP, CRUST, SLUSH, AIR, WARM = '#0b0b0b', '#52514e', '#9ec5f4', '#2a78d6', '#eaf6ff', '#d6e9fb', '#f3f2ee', '#f0b9a0'
def arrow(x0, y0, x1, y1, col=INK, w=3, head=14, dash=False):
    if dash:
        n = 14; pts = [(x0 + (x1 - x0) * k / n, y0 + (y1 - y0) * k / n) for k in range(n + 1)]
        for k in range(0, n, 2): dr.line([pts[k], pts[k + 1]], fill=col, width=w * s)
    else: dr.line([(x0, y0), (x1, y1)], fill=col, width=w * s)
    import math; a = math.atan2(y1 - y0, x1 - x0); h = head * s
    dr.polygon([(x1, y1), (x1 - h * math.cos(a - 0.4), y1 - h * math.sin(a - 0.4)), (x1 - h * math.cos(a + 0.4), y1 - h * math.sin(a + 0.4))], fill=col)
def panel(x, title, layers, notes):
    dr.text((x + 300 * s, 30 * s), title, fill=INK, font=fb, anchor='mm')
    dr.rectangle([x, 70 * s, x + 600 * s, 130 * s], fill=AIR, outline='#c9c8c3', width=s); dr.text((x + 12 * s, 100 * s), 'air (1° grid, radiates to space)', fill=MUTED, font=fs, anchor='lm')
    for (y0, y1, col, label, sub) in layers:
        dr.rectangle([x, y0 * s, x + 600 * s, y1 * s], fill=col, outline='#c9c8c3', width=s)
        dr.text((x + 12 * s, (y0 + 18) * s), label, fill=INK, font=f, anchor='lt')
        for j, line in enumerate((sub or '').split('\n')): dr.text((x + 12 * s, (y0 + 50 + 28 * j) * s), line, fill=MUTED, font=fs, anchor='lt')
    dr.rectangle([x, 640 * s, x + 600 * s, 660 * s], fill='#8c8577'); dr.text((x + 12 * s, 650 * s), 'sea floor', fill='#ffffff', font=fs, anchor='lm')
    for (yy, text) in notes: dr.text((x + 612 * s, yy * s), text, fill=MUTED, font=fs, anchor='lm')
# sinks
x = 60 * s
panel(x, 'sinking solid: one layer', [(140, 640, SLUSH, 'whole column, one temperature', 'slush from the surface to the floor within hours\nlatent heat shared over the full depth\nsurface cooling drives convection in the mush')], [])
arrow(x + 560 * s, 420 * s, x + 560 * s, 150 * s, w=4)   # heat up
arrow(x + 560 * s, 120 * s, x + 560 * s, 78 * s, w=4)
dr.text((x + 544 * s, 300 * s), 'heat out', fill=INK, font=f, anchor='rm')
for k in range(4): arrow(x + (90 + 60 * k) * s, (330 + 40 * k) * s, x + (90 + 60 * k) * s, (400 + 40 * k) * s, col=DEEP, w=2, head=10)
dr.text((x + 12 * s, 600 * s), 'crystals sink and grow as they fall', fill=DEEP, font=fs, anchor='lm')
# floats
x = 860 * s
panel(x, 'floating solid: mixed layer over deep layer',
      [(140, 200, CRUST, 'crust', None), (200, 290, WATER, 'mixed layer, 100 m', 'the front, the latent heat, the air exchange'),
       (290, 640, WARM, 'deep layer, to the floor', 'eddy diffusion 1e-4 m²/s, crust 1e-6 m²/s;\nbrine from the crust makes the layer above\ndenser: the two overturn and mix,\nand the deep water freezes against the\ncrystals; stops near 39% at the melting point')], [])
arrow(x + 560 * s, 275 * s, x + 560 * s, 150 * s, w=4); arrow(x + 560 * s, 120 * s, x + 560 * s, 78 * s, w=4)
dr.text((x + 544 * s, 170 * s), 'heat out', fill=INK, font=f, anchor='rm')
arrow(x + 560 * s, 560 * s, x + 560 * s, 300 * s, w=2, head=10, dash=True); dr.text((x + 544 * s, 590 * s), 'slow, or overturn', fill=MUTED, font=fs, anchor='rm')
im.resize((W, H), Image.LANCZOS).save('columns.png'); print('ok')
