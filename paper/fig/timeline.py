#!/usr/bin/env python3
"""Lead figure: a timeline per scenario (sinking, floating) on a log time axis, with event markers over two strips:
ocean frozen (%) and mean air temperature (°C). Curves: the 12-year 0.5° baseline runs (48 h steps), and thinner
the 3-year 0.5° runs with 2 h steps, which resolve the first weeks (rain seeding the ocean is lagged a tick at 48 h).
Usage: timeline.py <dir with hourly/, sweep/ and conv/> <out png>"""
import sys, math, numpy as np
from PIL import Image, ImageDraw, ImageFont
from chart import load, daily, FONT, BLUE, ORANGE, AQUA, INK, MUTED, GRID
SRC, OUT = sys.argv[1], sys.argv[2]
s = 2
W, PH = 1650, 600  # width, panel height (at s = 1)
L, R = 150, 60
f = ImageFont.truetype(FONT, 21 * s); fb = ImageFont.truetype(FONT.replace("DejaVuSans", "DejaVuSans-Bold"), 21 * s)
ft = ImageFont.truetype(FONT.replace("DejaVuSans", "DejaVuSans-Bold"), 26 * s); fs = ImageFont.truetype(FONT, 19 * s)
T0, T1 = 2.0, 4383.0  # days: the first sample of the 2 h runs
def px(d): return (L + (W - L - R) * (math.log10(max(d, T0)) - math.log10(T0)) / (math.log10(T1) - math.log10(T0))) * s

def series(path):
    b = load(path)
    tb, w = daily(b['Ta'], b['h'])
    k = slice(w // 2, len(tb) - w // 2)  # drop the half-windows the smoothing pads at the ends
    return dict(d=b['h'][k] / 24, fm=b['fm'][k] * 100, f=b['f'][k] * 100, Ta=tb[k])

EVENTS = {
    'sinks': [(3.2, 'day 3', '10% frozen; rain seeds the sea'),
              (7, 'day 7: the freeze stalls', '38% frozen; land 59% white'),
              (10, 'day 10', 'land 93% white; rain 6x today'),
              (16, 'day 16', 'air peaks at 43 °C'),
              (299, 'end of first summer', 'snow cover at its lowest: 91% of land'),
              (1460, 'year 4', '1.7 m of ocean held as snow on land'),
              (2990, 'year 8', 'shelves: 13% frozen through; 3.2 m on land'),
              (4383, 'year 12', '44% frozen; air 35 °C')],
    'floats': [(7, 'day 7', 'crust 26%; land 51% white'),
               (19, 'day 19', 'air peaks at 41 °C; land white'),
               (365, 'year 1', '28-31% frozen; crust 49%; deep ocean overturning'),
               (730, 'year 2', '42% frozen; crust 64-67%'),
               (1560, 'year 4.3', 'crust 90%'),
               (1703, 'year 4.7', 'air below 14 °C'),
               (2056, 'year 5.6', 'air below 0 °C'),
               (2108, 'year 5.8', 'crust closed; rain stops'),
               (4383, 'year 12', '43.7% frozen (limit); air -37 °C')],
}
TITLES = {'sinks': 'Sinking ice-nine', 'floats': 'Floating ice-nine'}

def layout(case):
    tmp = ImageDraw.Draw(Image.new('RGB', (10, 10)))
    rows, placed = [], []
    for d, head, stat in EVENTS[case]:
        x = px(d); wdt = max(tmp.textlength(head, font=fb), tmp.textlength(stat, font=f)) + 14 * s
        right = x + wdt > (W - R) * s  # near the right edge: label ends at the marker
        x0, x1 = (x - wdt, x) if right else (x, x + wdt)
        k = 0
        while k < len(rows) and any(not (x1 < a or x0 > b) for a, b in rows[k]): k += 1
        if k == len(rows): rows.append([])
        rows[k].append((x0 - 6 * s, x1 + 6 * s)); placed.append((x, k, head, stat, right))
    return placed, len(rows)
ROWH, SH, GAP = 54, 150, 34
LAY = {c: layout(c) for c in ('sinks', 'floats')}
PHs = {c: 44 + LAY[c][1] * ROWH + 14 + 2 * SH + GAP + 50 for c in LAY}
im = Image.new('RGB', (W * s, (PHs['sinks'] + PHs['floats'] + 30) * s), '#ffffff'); dr = ImageDraw.Draw(im)
yoff = 0
for case in ('sinks', 'floats'):
    y0 = yoff * s; yoff += PHs[case] + 30
    placed, nrow = LAY[case]
    dr.text((L * s, y0 + 6 * s), TITLES[case], fill=INK, font=ft, anchor='lt')
    top = y0 + 44 * s; rowh = ROWH * s
    strip0 = top + nrow * rowh + 14 * s
    strips = [('ocean frozen, %', 0, 100, 25), ('mean air temperature, °C', -40, 50, 20)]
    sd = series(f'{SRC}/sweep/base_{case}.json')
    s2 = series(f'{SRC}/conv/dt2_{case[0]}.json')
    col = BLUE if case == 'sinks' else ORANGE
    for j, (lab, lo, hi, step) in enumerate(strips):
        ya = strip0 + j * (SH + GAP) * s
        h = SH * s
        py = lambda v: ya + h - (v - lo) / (hi - lo) * h
        for v in range(lo, hi + 1, step):
            dr.line([(L * s, py(v)), ((W - R) * s, py(v))], fill=GRID, width=s)
            dr.text(((L - 10) * s, py(v)), f'{v}', fill=MUTED, font=fs, anchor='rm')
        dr.text(((L + 6) * s, ya - 2 * s), lab, fill=INK, font=fs, anchor='lb')
        if j == 1:  # today's mean, dashed
            for xx in range(L * s, (W - R) * s, 16 * s): dr.line([(xx, py(14)), (xx + 8 * s, py(14))], fill=MUTED, width=s)
            dr.text(((W - R) * s - 4 * s, py(14) - 4 * s), 'today 14 °C', fill=MUTED, font=fs, anchor='rb')
        for src, wd in ((s2, 1.5), (sd, 3)):  # 2 h run thin underneath, 48 h baseline on top
            lines = [(src['fm'], col)] if j == 0 else [(src['Ta'], col)]
            if j == 0 and case == 'floats': lines.append((src['f'], AQUA))
            for y, c in lines:
                pts = [(px(d), py(min(max(v, lo), hi))) for d, v in zip(src['d'], y) if d >= T0]
                dr.line(pts, fill=c, width=int(wd * s), joint='curve')
        if j == 0:
            dr.text((px(2.2), py(88)), 'thick: 48 h steps, 12 years; thin: 2 h steps, 3 years', fill=MUTED, font=fs, anchor='lm')
            dr.text((px(40), py(52) if case == 'sinks' else py(20)), 'by mass', fill=col, font=fs, anchor='lm')
            if case == 'floats': dr.text((px(40), py(52)), 'crust, share of the surface', fill=AQUA, font=fs, anchor='lm')
    bottom = strip0 + (2 * SH + GAP) * s
    for x, k, head, stat, right in placed:  # leaders first, labels on a white backing over them
        dr.line([(x, top + k * rowh + 4 * s), (x, bottom)], fill='#b9b7b1', width=s)
    for x, k, head, stat, right in placed:
        yl = top + k * rowh; tx = x - 6 * s if right else x + 6 * s; an = 'rt' if right else 'lt'
        for txt, fnt, dy in ((head, fb, 0), (stat, f, 25 * s)):
            bb = dr.textbbox((tx, yl + dy), txt, font=fnt, anchor=an)
            dr.rectangle([bb[0] - 3 * s, bb[1] - 2 * s, bb[2] + 3 * s, bb[3] + 2 * s], fill='#ffffff')
            dr.text((tx, yl + dy), txt, fill=INK if fnt is fb else MUTED, font=fnt, anchor=an)
    ticks = [(2, '2 days'), (4, '4 d'), (10, '10 d'), (30, '30 d'), (100, '100 d'), (365, '1 yr'), (730, '2 yr'), (1826, '5 yr'), (4383, '12 yr')]
    for d, t in ticks:
        dr.line([(px(d), bottom), (px(d), bottom + 6 * s)], fill=MUTED, width=s)
        dr.text((px(d), bottom + 10 * s), t, fill=MUTED, font=fs, anchor='mt')
im.resize((W, im.height // s), Image.LANCZOS).save(OUT); print('ok', im.size)
