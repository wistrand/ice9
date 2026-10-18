#!/usr/bin/env python3
"""Snow deposition sensitivity: land white (%) at 30 d, the first-summer minimum and 365 d, for all land / deserts / interiors.
Usage: sweeptable.py <dir with sweep json>"""
import sys, json, glob
D = sys.argv[1]
R = {}
for f in glob.glob(f'{D}/L*.json'):
    r = json.load(open(f)); R[(r['LOFT'], r['THRESH'], r['WASH'], r['RB'], r['RX'])] = r
P = {(1, 1): 'today + extra', (1, 0): 'today only', (0.5, 0.25): 'half today, quarter extra'}
SEL = [((1, 1, 1, 1, 1), 'Baseline'), ((0.01, 1, 1, 1, 1), 'Lofting $\\times$0.01'), ((1, 100, 1, 1, 1), 'Threshold $\\times$100'),
       ((1, 1, 3, 1, 1), 'Washout $\\times$3'), ((1, 1, 1, 1, 0), 'No extra rain'), ((1, 1, 1, 0.5, 0.25), 'Half rain, quarter extra'),
       ((1, 10, 3, 1, 1), 'Washout $\\times$3, threshold $\\times$10'), ((0.01, 100, 3, 1, 1), 'All three crystal factors pessimistic')]
c = lambda v: f'{v[0]:.0f}/{v[1]:.0f}/{v[2]:.0f}'
for k, lab in SEL:
    r = R[k]; print(f"{lab} & {c(r['d30'])} & {c(r['summerMin'])} & {c(r['d365'])} \\\\")
n80 = sum(1 for r in R.values() if r['d365'][0] >= 80); n50 = sum(1 for r in R.values() if r['d365'][0] >= 50)
print(f'% of {len(R)} combinations: {n80} keep >= 80% of land white at one year, {n50} keep >= 50%')
