#!/usr/bin/env python3
"""Convergence table: days to land 90% white and (sinking) to 38% frozen, frozen by mass (%) and mean air (°C, mean over the preceding day) at fixed times, by grid, time step and seed.
Usage: convtable.py <dir with conv runs>"""
import sys, numpy as np
from chart import load
D = sys.argv[1]
ROWS = [('grid1', '1°, 48 h'), ('grid2', '0.5°, 48 h'), ('grid4', '0.25°, 48 h'), ('grid8', '0.125°, 48 h'),
        ('dt12', '0.5°, 12 h'), ('dt2', '0.5°, 2 h'), ('seed2', '0.5°, 48 h, seed 2'), ('seed3', '0.5°, 48 h, seed 3')]
def at(d, key, x):
    h = d['h'] / 24
    return np.interp(min(x, h[-1]), h, d[key]) if x <= h[-1] + 3 else None
def air(d, x):
    h = d['h'] / 24
    if x > h[-1] + 3: return None
    x = min(x, h[-1]); m = (h > x - 2.05) & (h <= x + 0.01)  # the last two days: 48 h runs sample every other day
    return d['Ta'][m].mean()
f = lambda v, n=1: '--' if v is None else f'{v:.{n}f}'
for case, title in (('s', 'sinking'), ('f', 'floating')):
    print(f'% {title}: day land 90% white, day 38% frozen | frozen % at 30 d, 1 yr, 3 yr | air °C at 1 yr, 3 yr')
    for k, lab in ROWS:
        try: d = load(f'{D}/{k}_{case}.json')
        except FileNotFoundError: print(f'{lab} & (running)'); continue
        h = d['h'] / 24; white = h[np.argmax(d['lw'] >= 0.9)]; stall = h[np.argmax(d['fm'] >= 0.38)] if case == 's' else None
        print(f"{lab} & {f(white, 0)} & {f(stall, 0)} & {f(at(d,'fm',30)*100 if at(d,'fm',30) is not None else None)} & {f(at(d,'fm',365)*100 if at(d,'fm',365) is not None else None)} & {f(at(d,'fm',1095)*100 if at(d,'fm',1095) is not None else None)} & {f(air(d,364))} & {f(air(d,1094))} \\\\")
