#!/bin/bash
# Every run behind the paper and the website, at most JOBS (default 10) at a time. Run prepare.sh first.
# airstudy.mjs args: <appDir> <steps> <res> <speed> <day/night 0|1> <out.json>
#   res: cells per degree (1, 2 = 0.5 deg, 4, 8); speed: slider value, hours per step = 10^(speed/100*2.68-1)
#   (100 = 48 h, 78 = 12 h, 49 = 2 h, 37 = 1 h); 2200 steps at 48 h = 12 years.
# Outputs: sweep/ (25 scenarios), hourly/, conv/, snow/ (54 snow sweep runs), maps/, site/.
# The 12-year 0.5 deg runs take hours each; the 2 h convergence runs take longest.
# PART=k/n runs every n-th job starting at job k (0-based), to split the list across machines.
# usage: [PART=k/n] [JOBS=n] tools/runs/jobs.sh [WORK]
set -e
HERE=$(cd "$(dirname "$0")" && pwd)
W=${1:-$HERE/work}
A=$W/app
cd "$W"
mkdir -p sweep hourly conv snow maps site site_nat
J=$W/jobs.txt
: > "$J"
air() { echo "env $1 node $HERE/airstudy.mjs ${2:-$A} 2200 2 100 ${3:-1} $W/sweep/$4.json > /dev/null" >> "$J"; }
# scenarios: 12 years, 0.5 deg, 48 h steps
air "FLOATS=0" "" 1 base_sinks
air "RATE=35" "" 1 slow_sinks
air "RATE=70" "" 1 fast_sinks
air "THERMO=0" "" 1 vonnegut_sinks
air "COOL=1" "" 1 coolslow_sinks
air "COOL=8" "" 1 coolfast_sinks
air "LAT=80" "" 1 latlow_sinks
air "LAT=160" "" 1 lathigh_sinks
air "ATMO=0" "" 1 noatmo_sinks
air "FLOATS=0" "" 0 nosolar_sinks
air "CURRENTS=0 AIRBORNE=0" "" 1 nocurrents_sinks
air "DEPTH=0" "" 1 nodepth_sinks
air "SNOW=0" "" 1 nosnow_sinks
air "FLOATS=0" "$W/cap15" 1 caplow_sinks
air "FLOATS=0" "$W/cap5" 1 caphigh_sinks
air "GH=0" "" 1 nogh_sinks
air "CLOUDS=0" "" 1 noclouds_sinks
air "FLOATS=1" "" 1 base_floats
air "FLOATS=1 RATE=35" "" 1 slow_floats
air "FLOATS=1 RATE=70" "" 1 fast_floats
air "FLOATS=1 THERMO=0" "" 1 vonnegut_floats
air "FLOATS=1 SNOW=0" "" 1 nosnow_floats
air "FLOATS=1 GH=0" "" 1 nogh_floats
air "FLOATS=1 CLOUDS=0" "" 1 noclouds_floats
air "FLOATS=1 LIFE=1" "" 1 life_floats
# hourly, 0.25 deg: first 90 days, and the day/night comparison
for c in "0 sinks" "1 floats"; do set -- $c; echo "env FLOATS=$1 node $HERE/airstudy.mjs $A 2200 4 37 1 $W/hourly/cmp_$2.json > /dev/null" >> "$J"; done
echo "env FLOATS=0 node $HERE/airstudy.mjs $A 1500 4 37 1 $W/hourly/air_on.json > /dev/null" >> "$J"
echo "env FLOATS=0 node $HERE/airstudy.mjs $A 1500 4 37 0 $W/hourly/air_off.json > /dev/null" >> "$J"
# convergence: grids (3 years; 0.125 deg 1 year), steps, seeds
for c in "0 s" "1 f"; do set -- $c
  for g in 1 2 4; do echo "env SEED=1 FLOATS=$1 node $HERE/airstudy.mjs $A 548 $g 100 1 $W/conv/grid${g}_$2.json > /dev/null" >> "$J"; done
  echo "env SEED=1 FLOATS=$1 node $HERE/airstudy.mjs $A 183 8 100 1 $W/conv/grid8_$2.json > /dev/null" >> "$J"
  echo "env SEED=1 FLOATS=$1 node $HERE/airstudy.mjs $A 2190 2 78 1 $W/conv/dt12_$2.json > /dev/null" >> "$J"
  echo "env SEED=1 FLOATS=$1 node $HERE/airstudy.mjs $A 12760 2 49 1 $W/conv/dt2_$2.json > /dev/null" >> "$J"
  for s in 2 3; do echo "env SEED=$s FLOATS=$1 node $HERE/airstudy.mjs $A 548 2 100 1 $W/conv/seed${s}_$2.json > /dev/null" >> "$J"; done
done
# snow sweep: 1 deg, one year, sinking
for L in 1 0.1 0.01; do for N in 1 10 100; do for X in 1 3; do
  for r in "1 1 base" "1 0 noextra" "0.5 0.25 dry"; do set -- $r
    echo "env APP=$A LOFT=$L THRESH=$N WASH=$X RB=$1 RX=$2 OUT=$W/snow/L${L}_N${N}_W${X}_$3.json node $HERE/snowsweep.mjs > /dev/null" >> "$J"
  done
done; done; done
# maps, depth table, diagnostics, energy and mass budgets
echo "node $HERE/render.mjs $A 0 $W/maps/m_s 12 40 1500 > $W/maps/s.txt" >> "$J"
echo "node $HERE/render.mjs $A 1 $W/maps/m_f 12 40 1500 > $W/maps/f.txt" >> "$J"
echo "env SHOWPHI=1 node $HERE/render.mjs $A 0 $W/maps/m_os 40 1500 > $W/maps/os.txt" >> "$J"
echo "env SHOWPHI=1 node $HERE/render.mjs $A 1 $W/maps/m_of 40 1500 > $W/maps/of.txt" >> "$J"
echo "node $HERE/depth.mjs $A > $W/maps/depth_table.txt" >> "$J"
echo "node $HERE/diaghost.mjs $A 0 x 0 > $W/maps/diag_s.txt" >> "$J"
echo "node $HERE/diaghost.mjs $A 1 x 0 > $W/maps/diag_f.txt" >> "$J"
echo "env DAYS=365,1095 node $HERE/ebhost.mjs $A 0 x 0 > $W/maps/eb_s.txt" >> "$J"
echo "env DAYS=365,1095 node $HERE/ebhost.mjs $A 1 x 0 > $W/maps/eb_f.txt" >> "$J"
echo "node $HERE/mbhost.mjs $A 1 x 0 > $W/maps/mb_f.txt" >> "$J"
# website: stills at days 24 and 80 and years 1 and 8 (48 h steps), and 15 daily frames for the first weeks (2 h steps),
# in the temperature view (site/) and in natural colour (site_nat/)
for c in "0 sinks" "1 floats"; do set -- $c
  echo "node $HERE/siterender.mjs $A $1 $W/site/$2 $W/sat.rgba > /dev/null" >> "$J"
  echo "env DAILY=15 VIEWS=atlantic SPEED=49 node $HERE/siterender.mjs $A $1 $W/site/$2 $W/sat.rgba > /dev/null" >> "$J"
  echo "env NATURAL=1 node $HERE/siterender.mjs $A $1 $W/site_nat/$2 $W/sat.rgba > /dev/null" >> "$J"
  echo "env NATURAL=1 DAILY=15 VIEWS=atlantic SPEED=49 node $HERE/siterender.mjs $A $1 $W/site_nat/$2 $W/sat.rgba > /dev/null" >> "$J"
done
if [ -n "$PART" ]; then
  awk -v k="${PART%/*}" -v n="${PART#*/}" '(NR-1)%n==k' "$J" > "$J.part"
  mv "$J.part" "$J"
fi
echo "$(wc -l < "$J") jobs in $J"
XS=""
[ "$(uname)" = Darwin ] && XS="-S 4096"  # BSD xargs caps -I replacements at 255 bytes
tr '\n' '\0' < "$J" | xargs -0 $XS -P "${JOBS:-10}" -I{} bash -c '{} 2>>errors.log && echo ok || echo "FAIL: {}"' | sort | uniq -c
