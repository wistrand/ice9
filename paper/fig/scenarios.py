#!/usr/bin/env python3
"""Scenario sweep (0.5 degree, 48 h frames, 12 years): summary table (LaTeX rows to stdout) and the scenario figures.
Usage: scenarios.py <dir with sweep2/*.json> <out dir>"""
import sys, numpy as np
from chart import *
SRC, OUT = sys.argv[1], sys.argv[2]
NAMES = [('base_sinks', 'Baseline (sinking)'), ('vonnegut_sinks', 'No latent heat'), ('slow_sinks', 'Front 5 km/h'), ('fast_sinks', 'Front 41 km/h'),
         ('coolslow_sinks', 'Radiative response 0.25x'), ('coolfast_sinks', 'Radiative response 2x'), ('latlow_sinks', 'Latent heat 334 kJ/kg'), ('lathigh_sinks', 'Latent heat 669 kJ/kg'),
         ('noatmo_sinks', 'No atmosphere'), ('nosolar_sinks', 'No diurnal or seasonal cycle'), ('nocurrents_sinks', 'No currents or storm seeding'), ('nodepth_sinks', 'Uniform depth'),
         ('nosnow_sinks', 'No snowfall'), ('caplow_sinks', 'Convective cap 1.5 K'), ('caphigh_sinks', 'Convective cap 5 K'),
         ('nogh_sinks', 'No water-vapour greenhouse'), ('noclouds_sinks', 'No clouds'),
         ('base_floats', 'Floating: baseline'), ('slow_floats', 'Floating: front 5 km/h'), ('fast_floats', 'Floating: front 41 km/h'), ('vonnegut_floats', 'Floating: no latent heat'), ('nosnow_floats', 'Floating: no snowfall'),
         ('nogh_floats', 'Floating: no greenhouse'), ('noclouds_floats', 'Floating: no clouds'),
         ('life_floats', 'Floating: life in the brine')]
R = {k: load(f'{SRC}/sweep/{k}.json') for k, _ in NAMES}
def yrs(d): return d['h'] / 24 / 365
def at(d, key, year):
    i = int(np.argmin(np.abs(yrs(d) - year))); return d[key][i]
def when(x, h, th):
    i = np.argmax(x >= th); return h[i] / 24 if x[i] >= th else None
def summary(d):
    h = d['h']; dt = np.median(np.diff(h)); w = max(1, int(round(24 / dt))); Ts = np.convolve(d['Ta'], np.ones(w) / w, 'same'); v = slice(w, len(h) - w)
    ip = np.argmax(Ts[v]) + w
    lw = d['lw'] if 'lw' in d else np.zeros_like(h)
    return dict(lw1=at(d, 'lw', 1) * 100 if 'lw' in d else 0, lw12=lw[-1] * 100, f120=at(d, 'fm', 120 / 365) * 100, f1=at(d, 'fm', 1) * 100, f5=at(d, 'fm', 5) * 100, f12=d['fm'][-1] * 100, tsurf=when(d['f'], h, 0.99),
                rise=Ts[ip] - 14, tpeak=h[ip] / 24 / 365, air12=Ts[len(h) - w - 1], heat=d['heatIn'].sum())
fmt = lambda v, u='': '--' if v is None else f'{v:.0f}{u}'
print('% scenario & 120 d & 1 yr & 5 yr & 12 yr & surface day & air peak & peak yr & air 12 yr & heat & land white 1 yr')
for k, label in NAMES:
    s = summary(R[k]); heat = s['heat'] / R['base_sinks']['heatIn'].sum()
    print(f"{label} & {s['f120']:.0f} & {s['f1']:.0f} & {s['f5']:.0f} & {s['f12']:.0f} & {fmt(s['tsurf'])} & {s['rise']:+.1f} & {s['tpeak']:.1f} & {s['air12']:.1f} & {heat:.2f} & {s['lw1']:.0f} \\\\")
def smooth(d):
    w = max(1, int(round(24 / np.median(np.diff(d['h']))))); w = max(w, 4); return np.convolve(d['Ta'], np.ones(w) / w, 'same')[w:-w], yrs(d)[w:-w]
def nice(lo, hi, step):
    return (np.floor(lo / step) * step, np.ceil(hi / step) * step)
PW, PH = 900, 640
U = (0, -8)
def pair(prefix, keys, labels, offs, lab_air=('max', 'max', 'max'), anc_air=('mb', 'mb', 'mb'), labx=6, xmax=12, days=False, yfr=(0, 100), anc_fr=('rm', 'rm', 'rm')):
    labx = labx if isinstance(labx, (list, tuple)) else (labx, labx, labx)
    xs = (lambda d: d['h'] / 24) if days else yrs; xl = 'days after seeding' if days else 'years after seeding'; xt = 20 if days else 2
    ser = [(sm[0], sm[1] * (365 if days else 1)) for sm in (smooth(R[k]) for k in keys)]
    lo = min(s[0].min() for s in ser); hi = max(s[0].max() for s in ser); yl = nice(lo - 1, hi + 1, 5)
    plot(f'{OUT}/{prefix}_air.png', [dict(x=s[1], y=s[0], color=c, labelcolor=c, label=l, off=o, anchor=a, lab=lb) for s, l, c, o, lb, a in zip(ser, labels, (BLUE, ORANGE, AQUA), offs[0], lab_air, anc_air)],
         xl, 'mean air temperature, °C', (0, xmax), yl, hline=(14, 'start'), xt=xt, yt=5 if yl[1] - yl[0] <= 40 else 10, W=PW, H=PH)
    plot(f'{OUT}/{prefix}_frozen.png', [dict(x=xs(R[k]), y=R[k]['fm'] * 100, color=c, labelcolor=c, label=l, off=o, anchor=a, lab=lx) for k, l, c, o, lx, a in zip(keys, labels, (BLUE, ORANGE, AQUA), offs[1], labx, anc_fr)],
         xl, 'ocean frozen by mass, %', (0, xmax), yfr, xt=xt, yt=20 if yfr[1] > 60 else 10, W=PW, H=PH)
pair('speed', ['slow_sinks', 'base_sinks', 'fast_sinks'], ['5 km/h', '15 km/h', '41 km/h'], ([(0, 12), (0, 12), U], [(12, 0), (12, 0), (-12, 0)]), lab_air=(30, 22, 14), anc_air=('mt', 'mt', 'mb'), labx=(16, 12, 7), anc_fr=('lm', 'lm', 'rm'), xmax=40, days=True)
pair('cool', ['coolslow_sinks', 'base_sinks', 'coolfast_sinks'], ['feedback 0.25x', 'feedback 1x', 'feedback 2x'], ([U, (0, 12), (0, 12)], [(-12, 18), (-12, 18), (12, -18)]), lab_air=(4, 6, 8), anc_air=('mb', 'mt', 'mt'), labx=(5, 8, 11), yfr=(0, 60))
pair('latent', ['latlow_sinks', 'base_sinks', 'lathigh_sinks'], ['334 kJ/kg', '389 kJ/kg', '669 kJ/kg'], ([(0, 12), (0, 12), U], [(12, -18), (-12, 18), (-12, 18)]), lab_air=(4, 7, 'max'), anc_air=('mt', 'mt', 'mb'), yfr=(0, 60))
# sinks against floats over the full horizon
s1, s2 = smooth(R['base_sinks']), smooth(R['base_floats'])
yl = nice(min(s1[0].min(), s2[0].min()) - 1, max(s1[0].max(), s2[0].max()) + 1, 5)
plot(f'{OUT}/long_air.png', [dict(x=s1[1], y=s1[0], color=BLUE, label='sinking', off=(8, 0)), dict(x=s2[1], y=s2[0], color=ORANGE, label='floating', off=(8, 0))],
     'years after seeding', 'mean air temperature, °C', (0, 12), yl, hline=(14, 'start, 14 °C'), xt=2, yt=5, R=130)
plot(f'{OUT}/long_frozen.png', [dict(x=yrs(R['base_sinks']), y=R['base_sinks']['fm'] * 100, color=BLUE, label='sinking, by mass', off=(8, -12)),
     dict(x=yrs(R['base_floats']), y=R['base_floats']['f'] * 100, color=AQUA, label='floating, surface cover', off=(8, 0)),
     dict(x=yrs(R['base_floats']), y=R['base_floats']['fm'] * 100, color=ORANGE, label='floating, by mass', off=(8, 12))],
     'years after seeding', 'ocean frozen, %', (0, 12), (0, 100), xt=2, yt=20, R=320)
# the first two months: with and without latent heat
d = lambda k: R[k]['h'] / 24
plot(f'{OUT}/vonnegut_frozen.png', [dict(x=d('vonnegut_sinks'), y=R['vonnegut_sinks']['fm'] * 100, color=BLUE, label='no latent heat', off=(-12, -18), anchor='rm', lab=30),
     dict(x=d('base_sinks'), y=R['base_sinks']['fm'] * 100, color=ORANGE, label='with latent heat', off=(12, 18), anchor='lm', lab=30)],
     'days after seeding', 'ocean frozen by mass, %', (0, 120), (0, 100), xt=20, yt=20)
rows = []
for k, label in NAMES:
    s = summary(R[k]); col = ORANGE if 'floats' in k else BLUE
    rows.append((label, s['f12'], col, f"{s['f12']:.0f}%"))
hbar(f'{OUT}/f12.png', rows, 'ocean frozen by mass after 12 years, %', (0, 100), xt=20)
# land under ice-nine snow, first four years
plot(f'{OUT}/snow.png', [dict(x=yrs(R[k]), y=R[k]['lw'] * 100, color=c, label=l, off=o, anchor=a, lab=lb) for k, l, c, o, a, lb in
     (('base_sinks', 'sinking, cap 3 K', BLUE, (14, 0), 'lm', 0.93), ('caphigh_sinks', 'sinking, cap 5 K', AQUA, (0, 14), 'mt', 1.93), ('base_floats', 'floating', ORANGE, (0, 12), 'mt', 0.9))],
     'years after seeding', 'land white with ice-nine snow, %', (0, 4), (0, 100), xt=0.5, yt=20)
