#!/usr/bin/env python3
"""Chart helpers for the paper, drawn with Pillow (no matplotlib on this machine)."""
import json, sys, numpy as np
from PIL import Image, ImageDraw, ImageFont
FONT = '/usr/share/fonts/TTF/DejaVuSans.ttf'
BLUE, ORANGE, AQUA, INK, MUTED, GRID = '#2a78d6', '#eb6834', '#1baf7a', '#0b0b0b', '#52514e', '#e6e5e1'
def load(path):
    d = json.load(open(path)); return {k: np.array([r[k] for r in d]) for k in d[0]}
def daily(x, h):
    w = max(1, int(round(24 / np.median(np.diff(h))))); return np.convolve(x, np.ones(w) / w, 'same'), w
def fmt(v, step):
    d = 0 if step >= 1 else 2; v = 0.0 if abs(v) < step / 1000 else v; return f'{v:.{d}f}'
def plot(out, series, xlabel, ylabel, xlim, ylim, hline=None, W=1650, H=760, s=2, xt=None, yt=None, R=40, L=110):
    """series: list of dict(x, y, label, color, width, alpha). Rendered at s x and downsampled for antialiasing."""
    im = Image.new('RGB', (W * s, H * s), '#ffffff'); dr = ImageDraw.Draw(im, 'RGBA')
    f = ImageFont.truetype(FONT, 26 * s); fs = ImageFont.truetype(FONT, 24 * s)
    L, R, T, B = L * s, R * s, 30 * s, 80 * s
    px = lambda x: L + (x - xlim[0]) / (xlim[1] - xlim[0]) * (W * s - L - R)
    py = lambda y: H * s - B - (y - ylim[0]) / (ylim[1] - ylim[0]) * (H * s - T - B)
    xs = xt or (xlim[1] - xlim[0]) / 6; ys = yt or (ylim[1] - ylim[0]) / 5
    xts = np.arange(xlim[0], xlim[1] + 1e-9, xs); yts = np.arange(ylim[0], ylim[1] + 1e-9, ys)
    for y in yts:
        dr.line([(L, py(y)), (W * s - R, py(y))], fill=GRID, width=s)
        dr.text((L - 14 * s, py(y)), fmt(y, ys), fill=MUTED, font=fs, anchor='rm')
    for x in xts:
        dr.text((px(x), H * s - B + 12 * s), fmt(x, xs), fill=MUTED, font=fs, anchor='mt')
    dr.line([(L, py(ylim[0])), (W * s - R, py(ylim[0]))], fill='#c9c8c3', width=s)
    if hline is not None:
        dr.line([(L, py(hline[0])), (W * s - R, py(hline[0]))], fill=(82, 81, 78, 160), width=s)
        dr.text((W * s - R - 6 * s, py(hline[0]) - 6 * s), hline[1], fill=MUTED, font=fs, anchor='rb')
    for se in series:
        x, y = se['x'], se['y']; m = (x >= xlim[0]) & (x <= xlim[1]); x, y = x[m], np.clip(y[m], ylim[0], ylim[1])
        col = tuple(int(se['color'].lstrip('#')[i:i + 2], 16) for i in (0, 2, 4)) + (int(255 * se.get('alpha', 1)),)
        pts = [(px(a), py(b)) for a, b in zip(x, y)]
        dr.line(pts, fill=col, width=se.get('width', 2) * s, joint='curve')
        if se.get('label'):
            lab = se.get('lab', 'end')  # 'end', 'max', or an x value: where the direct label sits
            k = len(pts) - 1 if lab == 'end' else int(np.argmax(y)) if lab == 'max' else int(np.argmin(np.abs(x - lab)))
            lx, ly = pts[k]; dx, dy = se.get('off', (8, 0))
            dr.text((lx + dx * s, ly + dy * s), se['label'], fill=se.get('labelcolor', INK), font=f, anchor=se.get('anchor', 'lm'))
    dr.text((L + (W * s - L - R) / 2, H * s - 18 * s), xlabel, fill=INK, font=f, anchor='mb')
    tmp = Image.new('RGB', (H * s, 40 * s), '#ffffff'); ImageDraw.Draw(tmp).text((H * s / 2, 20 * s), ylabel, fill=INK, font=f, anchor='mm')
    im.paste(tmp.rotate(90, expand=True), (8 * s, 0))
    im.resize((W, H), Image.LANCZOS).save(out)

def hbar(out, rows, xlabel, xlim, W=1650, s=2, xt=None):
    """rows: list of (label, value, color, note). One bar per row, value printed at the end."""
    H = 100 + 46 * len(rows); im = Image.new('RGB', (W * s, H * s), '#ffffff'); dr = ImageDraw.Draw(im)
    f = ImageFont.truetype(FONT, 26 * s); fs = ImageFont.truetype(FONT, 24 * s)
    L, R, T = 560 * s, 200 * s, 16 * s
    px = lambda x: L + (x - xlim[0]) / (xlim[1] - xlim[0]) * (W * s - L - R)
    for x in (np.arange(xlim[0], xlim[1] + 1e-9, xt) if xt else np.linspace(xlim[0], xlim[1], 6)):
        dr.line([(px(x), T), (px(x), H * s - 80 * s)], fill=GRID, width=s); dr.text((px(x), H * s - 74 * s), f'{x:g}', fill=MUTED, font=fs, anchor='mt')
    for k, (label, v, col, note) in enumerate(rows):
        y = T + (k + 0.5) * 46 * s; dr.text((L - 16 * s, y), label, fill=INK, font=f, anchor='rm')
        if v is None: dr.text((px(xlim[0]) + 8 * s, y), note, fill=MUTED, font=fs, anchor='lm'); continue
        x1 = px(min(v, xlim[1])); dr.rounded_rectangle([px(xlim[0]), y - 11 * s, x1, y + 11 * s], radius=4 * s, fill=col)
        dr.text((x1 + 10 * s, y), note, fill=INK, font=fs, anchor='lm')
    dr.text((L + (W * s - L - R) / 2, H * s - 6 * s), xlabel, fill=INK, font=f, anchor='mb')
    im.resize((W, H), Image.LANCZOS).save(out)
