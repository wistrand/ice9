#!/usr/bin/env python3
"""Main-comparison charts. Usage: plot.py <dir with cmp_*.json and air_*.json> <out dir>"""
import sys
from chart import *
SRC, OUT = sys.argv[1], sys.argv[2]
load_ = load
load = lambda n: load_(f"{SRC}/{n}")
A, Bf = load('cmp_sinks.json'), load('cmp_floats.json'); h = A['h'] / 24
TaA, w = daily(A['Ta'], A['h']); TaB, _ = daily(Bf['Ta'], Bf['h']); v = slice(w, len(h) - w)
plot(f'{OUT}/air.png', [
    dict(x=h, y=A['Ta'], color=BLUE, width=1, alpha=0.35), dict(x=h, y=Bf['Ta'], color=ORANGE, width=1, alpha=0.35),
    dict(x=h[v], y=TaA[v], color=BLUE, label='sinking', off=(8, -12)), dict(x=h[v], y=TaB[v], color=ORANGE, label='floating', off=(8, 12))],
    'days after seeding', 'mean air temperature, °C', (0, 90), (10, 50), hline=(14, 'start, 14 °C'), xt=15, yt=5, R=130)
on, off = load('air_on.json'), load('air_off.json'); ho = on['h'] / 24
wo, w2 = daily(on['Ta'], on['h']); wf, _ = daily(off['Ta'], off['h'])
plot(f'{OUT}/wobble.png', [
    dict(x=ho, y=on['Ta'] - wo, color=BLUE, label='day/night on', off=(8, -14)),
    dict(x=off['h'] / 24, y=off['Ta'] - wf, color=ORANGE, label='day/night off', off=(8, 16))],
    'days after seeding', 'air temperature minus its daily mean, K', (12, 36), (-0.06, 0.06), xt=4, yt=0.02, R=260, L=150)
print('ok')
