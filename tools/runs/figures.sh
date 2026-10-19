#!/bin/bash
# Paper figures and tables, and website images, from the outputs of jobs.sh.
# The tables (WORK/table.tex, conv.tex, sweep.tex, maps/depth_table.txt) are pasted into paper/ice9.tex by hand,
# and the numbers in the paper text and on the website are read from them and from maps/diag_*.txt, eb_*.txt, mb_f.txt.
# usage: tools/runs/figures.sh [WORK]   (needs numpy and Pillow)
set -e
HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$HERE/../.." && pwd)
W=${1:-$HERE/work}
F=$ROOT/paper/fig
cd "$F"
python3 scenarios.py "$W" . > "$W/table.tex"
python3 plot.py "$W/hourly" .
python3 timeline.py "$W" timeline.png
python3 convtable.py "$W/conv" > "$W/conv.tex"
python3 sweeptable.py "$W/snow" > "$W/sweep.tex"
python3 schematic.py
cp "$W/maps/m_s_12.png" map_sinks_24d.png
cp "$W/maps/m_f_12.png" map_floats_24d.png
cp "$W/maps/m_s_40.png" map_sinks_80d.png
cp "$W/maps/m_f_40.png" map_floats_80d.png
cp "$W/maps/m_os_1500.png" overlay_sinks_8y.png
cp "$W/maps/m_of_1500.png" overlay_floats_8y.png
cp "$W/maps/depth_table.txt" depth_table.txt
cp "$W/site_phi/sinks_day02_globe_atlantic.png" globe_sinks_48h.png
cp timeline.png "$ROOT/docs/paper/timeline.png"
# website images: stills and the first-weeks animations
# stills: temperature view as {case}_{stage}_*.webp, natural colour as nat_{case}_{stage}_*.webp;
# hero globes in natural colour, first-month flat maps in the temperature view
python3 - "$W" "$ROOT/docs/img" <<'EOF'
import sys, os, glob
from PIL import Image
W, D = sys.argv[1], sys.argv[2]
for sub, pre in (('site', ''), ('site_nat', 'nat_')):
    for f in glob.glob(f'{W}/{sub}/*_*.png'):
        name = os.path.basename(f)[:-4].replace('_day05', '_d5').replace('_day10', '_d10').replace('_day15', '_d15')
        if '_day' in name: continue
        im = Image.open(f)
        if '_globe_' in name: im = im.resize((600, 600), Image.LANCZOS)
        im.save(f'{D}/{pre}{name}.webp', 'WEBP', quality=82, method=6)
def anim(sub, c, view, out, size=None):
    frames = []
    for d in range(1, 16):
        im = Image.open(f'{W}/{sub}/{c}_day{d:02d}_{view}.png').convert('RGBA')
        frames.append(im.resize(size, Image.LANCZOS) if size else im)
    dur = [400]*len(frames); dur[-1] = 2000
    frames[0].save(f'{D}/{out}', 'WEBP', save_all=True, append_images=frames[1:], duration=dur, loop=0, quality=78, method=6)
for c in ('sinks', 'floats'):
    anim('site_nat', c, 'globe_atlantic', f'anim_{c}_globe.webp', (560, 560))
    anim('site', c, 'flat', f'anim_{c}_flat.webp')
print('website images written')
EOF
echo "figures in $F; tables in $W"
