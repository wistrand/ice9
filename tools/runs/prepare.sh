#!/bin/bash
# Prepare the app copies the paper runs use, in WORK (default tools/runs/work):
#   app/    docs/sim with inject.js added as line 2, which exposes internal state to the harness
#   cap15/  the same with the convective cap at 1.5 K (scenario caplow_sinks)
#   cap5/   the same with the convective cap at 5 K (scenario caphigh_sinks)
#   sat.rgba  the satellite image as raw RGBA, for siterender.mjs
# usage: tools/runs/prepare.sh [WORK]
set -e
HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$HERE/../.." && pwd)
W=${1:-$HERE/work}
mkdir -p "$W"
for v in app cap15 cap5; do
  rm -rf "$W/$v"
  cp -r "$ROOT/docs/sim" "$W/$v"
done
python3 - "$W" "$HERE/inject.js" <<'EOF'
import sys
W, inj = sys.argv[1], open(sys.argv[2]).read().rstrip('\n') + '\n'
for v, cap in (('app', None), ('cap15', '1.5'), ('cap5', '5')):
    p = f'{W}/{v}/app.js'
    first, rest = open(p).read().split('\n', 1)
    assert first.startswith('(async function'), 'app.js must start with the async IIFE'
    if cap:
        assert rest.count('const CONV_DT = 3;') == 1, 'CONV_DT not found'
        rest = rest.replace('const CONV_DT = 3;', f'const CONV_DT = {cap};')
    open(p, 'w').write(first + '\n' + inj + rest)
EOF
python3 -c "
import sys
from PIL import Image
open(sys.argv[2], 'wb').write(Image.open(sys.argv[1]).convert('RGBA').tobytes())" "$ROOT/docs/sim/data/satellite.jpg" "$W/sat.rgba"
echo "prepared $W"
