#!/usr/bin/env python3
"""Rebuild docs/sim/data/cells.bin, docs/sim/data/satellite.jpg and docs/sim/data/precip.bin from public sources.

Needs numpy and Pillow. Downloads about 80 MB into the cache directory on first run.
Peak memory is about 1.5 GB (the 1 km GLOBE mask is held as a bool array).
The app reads the base resolution from the size of cells.bin and offers no grid finer than it.

    python3 tools/build_data.py                  # writes docs/sim/data/
    python3 tools/build_data.py --out /tmp/x     # write elsewhere to compare
    python3 tools/build_data.py --res 4          # 0.25 degree base data (default 8 = 0.125 degree)
    python3 tools/build_data.py --only precip    # rebuild one file (cells, satellite, precip)

See agent_docs/data.md for the derivation and how closely it matched the original data files.
"""
import argparse, gzip, os, struct, sys, urllib.request, zipfile, zlib
from collections import deque

import numpy as np
from PIL import Image, ImageDraw, ImageEnhance

Image.MAX_IMAGE_PIXELS = None
BR = 8             # base cells per degree (--res); the app reads it from the file size
BW, BH = 360 * BR, 180 * BR  # row 0 at 90N, column 0 at 180W
SS = 4              # supersampling for polygon coverage

NE = 'https://naturalearth.s3.amazonaws.com/'
SOURCES = {
    'globe.npz': 'https://raw.githubusercontent.com/toddkarin/global-land-mask/master/global_land_mask/globe_combined_mask_compressed.npz',
    'etopo1.jpg': 'https://www.ngdc.noaa.gov/mgg/image/color_etopo1_ice_low.jpg',
    'bathy.zip': NE + '10m_physical/ne_10m_bathymetry_all.zip',
    'lakes.zip': NE + '10m_physical/ne_10m_lakes.zip',
    'rivers.zip': NE + '10m_physical/ne_10m_rivers_lake_centerlines.zip',
    # GPCC Precipitation Analysis Climatology V2025, 1 degree, monthly normals 1971-2000 (DWD, CC BY 4.0; doi:10.5676/DWD_GPCC/CLIMAT_V2025_100)
    'gpcc.nc.gz': 'https://opendata.dwd.de/climate_environment/GPCC/GPCC_Precipitation_Analysis_Climatology/Version_2025/gpcc_precipitation_analysis_climatology_1971_2000_v2025_100.nc.gz',
}
# Natural Earth depth layers, shallow to deep; the index + 1 is the depth level in the low nibble (LEVEL_M in app.js)
ANTARCTIC_MM = 171  # mean snowfall over the Antarctic ice sheet, mm/yr (Palerme et al. 2014, CloudSat); GPCC has no data there
BATHY = ['L_0', 'K_200', 'J_1000', 'I_2000', 'H_3000', 'G_4000', 'F_5000', 'E_6000', 'D_7000', 'C_8000', 'B_9000', 'A_10000']


def fetch(cache):
    os.makedirs(cache, exist_ok=True)
    for name, url in SOURCES.items():
        path = os.path.join(cache, name)
        if not os.path.exists(path):
            print('downloading', url, file=sys.stderr)
            urllib.request.urlretrieve(url, path + '.part')
            os.replace(path + '.part', path)
        if name.endswith('.zip'):
            d = path[:-4]
            if not os.path.isdir(d):
                with zipfile.ZipFile(path) as z:
                    z.extractall(d)


def read_shp(path):
    """Yield the parts of each polygon or polyline record as Nx2 (lon, lat) arrays."""
    d = open(path, 'rb').read()
    p = 100
    while p < len(d):
        _, clen = struct.unpack('>ii', d[p:p + 8])
        rec = d[p + 8:p + 8 + clen * 2]
        p += 8 + clen * 2
        if struct.unpack('<i', rec[:4])[0] == 0:
            continue
        npart, npt = struct.unpack('<ii', rec[36:44])
        parts = list(struct.unpack('<%di' % npart, rec[44:44 + 4 * npart])) + [npt]
        pts = np.frombuffer(rec[44 + 4 * npart:44 + 4 * npart + 16 * npt], '<f8').reshape(-1, 2)
        yield [pts[parts[i]:parts[i + 1]] for i in range(npart)]


def raster(path, ss, lines=False):
    """Rasterize a shapefile onto the base grid supersampled by ss. Holes are cleared by ring orientation."""
    W, H = BW * ss, BH * ss
    im = Image.new('L', (W, H), 0)
    dr = ImageDraw.Draw(im)
    for parts in read_shp(path):
        for pt in parts:
            xy = [((x + 180) / 360 * W, (90 - y) / 180 * H) for x, y in pt]
            if lines:
                dr.line(xy, fill=255, width=1)
            else:
                a, b = pt[:, 0], pt[:, 1]
                hole = np.sum(a[:-1] * b[1:] - a[1:] * b[:-1]) > 0  # outer rings are clockwise
                dr.polygon(xy, fill=0 if hole else 255)
    return np.asarray(im) > 0


def coverage(path):
    return raster(path, SS).reshape(BH, SS, BW, SS).mean((1, 3))


def land_fraction(npz):
    """Share of 1 km GLOBE land pixels in each base cell (120/BR pixels on a side)."""
    m = np.load(npz, allow_pickle=False)['mask']  # True = ocean, 21600x43200
    b = 120 // BR
    f = np.empty((BH, BW))
    for r in range(BH):
        f[r] = 1 - m[r * b:(r + 1) * b].reshape(b, BW, b).mean((0, 2))
    return f


def detached(water):
    """Water cells not 4-connected to the largest water body (the world ocean). Longitude wraps."""
    wl = water.tolist()  # plain lists are much faster than numpy scalars in this loop
    lab = [[0] * BW for _ in range(BH)]
    sizes = [0]
    for y0, x0 in zip(*np.nonzero(water)):
        y0, x0 = int(y0), int(x0)
        if lab[y0][x0]:
            continue
        n = len(sizes)
        lab[y0][x0] = n
        dq = deque([(y0, x0)])
        c = 0
        while dq:
            y, x = dq.popleft()
            c += 1
            for yy, xx in ((y + 1, x), (y - 1, x), (y, (x + 1) % BW), (y, (x - 1) % BW)):
                if 0 <= yy < BH and wl[yy][xx] and not lab[yy][xx]:
                    lab[yy][xx] = n
                    dq.append((yy, xx))
        sizes.append(c)
    return water & (np.array(lab, np.int32) != int(np.argmax(sizes)))


def build_cells(cache):
    lf = land_fraction(os.path.join(cache, 'globe.npz'))
    lakes = coverage(os.path.join(cache, 'lakes', 'ne_10m_lakes.shp')) > 0
    lake = lakes | detached(lf <= 0.5)  # NE lakes, plus seas the base grid cuts off (Black Sea)
    land = (lf > 0.5) & ~lake
    level = np.zeros((BH, BW), np.uint8)
    for k, name in enumerate(BATHY):
        level[coverage(os.path.join(cache, 'bathy', 'ne_10m_bathymetry_%s.shp' % name)) >= 0.5] = k + 1
    river = raster(os.path.join(cache, 'rivers', 'ne_10m_rivers_lake_centerlines.shp'), 1, lines=True)  # 1 px at base resolution
    cells = (land.astype(np.uint8) << 7) | (lake.astype(np.uint8) << 6) | (river.astype(np.uint8) << 5) | level
    return zlib.compress(cells.tobytes(), 9)


def build_satellite(cache, path):
    im = Image.open(os.path.join(cache, 'etopo1.jpg')).convert('RGB').resize((BW, BH), Image.BILINEAR)
    im = ImageEnhance.Brightness(ImageEnhance.Color(im).enhance(0.75)).enhance(0.62)
    im.save(path, quality=80, optimize=True)


def read_nc3(buf):
    """Minimal reader for NetCDF classic files (CDF-1 and CDF-2, record variables included): {name: array}."""
    assert buf[:3] == b'CDF' and buf[3] in (1, 2), 'not a NetCDF classic file'
    types = {1: ('b', 1), 2: ('S1', 1), 3: ('>i2', 2), 4: ('>i4', 4), 5: ('>f4', 4), 6: ('>f8', 8)}
    off64, pos = buf[3] == 2, [4]

    def u32():
        pos[0] += 4
        return struct.unpack('>I', buf[pos[0] - 4:pos[0]])[0]

    def name():
        n = u32()
        s = buf[pos[0]:pos[0] + n].decode('latin-1')
        pos[0] += (n + 3) // 4 * 4
        return s

    def skip_attrs():
        u32()
        for _ in range(u32()):
            name()
            t, m = u32(), u32()
            pos[0] += (m * types[t][1] + 3) // 4 * 4

    numrecs = u32()
    u32()
    dims = [(name(), u32()) for _ in range(u32())]
    skip_attrs()
    u32()
    specs = []
    for _ in range(u32()):
        k = name()
        ids = [u32() for _ in range(u32())]
        skip_attrs()
        t, vsize = u32(), u32()
        n = 8 if off64 else 4
        begin = struct.unpack('>Q' if off64 else '>I', buf[pos[0]:pos[0] + n])[0]
        pos[0] += n
        specs.append((k, [dims[i][1] for i in ids], t, vsize, begin))
    rec = [sp for sp in specs if sp[1] and sp[1][0] == 0]
    recsize = sum(sp[3] for sp in rec)
    out = {}
    for k, shape, t, vsize, begin in specs:
        dt, sz = types[t]
        if shape and shape[0] == 0:  # record variable: one slab per record, recsize apart
            inner = int(np.prod(shape[1:]))
            slabs = [np.frombuffer(buf[begin + r * recsize:begin + r * recsize + inner * sz], dt) for r in range(numrecs)]
            out[k] = np.stack(slabs).reshape([numrecs] + shape[1:])
        else:
            out[k] = np.frombuffer(buf[begin:begin + int(np.prod(shape)) * sz], dt).reshape(shape)
    return out


def build_precip(cache):
    """1 degree annual land precipitation (GPCC climatology V2025, 1971-2000), zlib of 360x180 bytes, row 0 at 90N.
    A byte b is (b/2)^2 mm/yr. Antarctica, where GPCC has no gauges, gets ANTARCTIC_MM; other cells without land
    data are filled from their neighbours, so every cell has a value."""
    v = read_nc3(gzip.open(os.path.join(cache, 'gpcc.nc.gz')).read())
    lat, lon, m = v['lat'], v['lon'], v['gpcc_precip']
    assert m.shape == (12, 180, 360) and lat[0] > lat[-1] and lon[0] < -179, 'unexpected GPCC grid'
    ok = (m > -1e4).all(axis=0)
    p = np.where(ok, m.sum(axis=0, dtype=np.float64), 0)
    have = ok.copy()
    south = ~have & (lat < -60)[:, None]
    p[south] = ANTARCTIC_MM
    have |= south
    while not have.all():  # grow the land values outward
        s, c = np.zeros_like(p), np.zeros_like(p)
        for dr in (-1, 0, 1):
            for dq in (-1, 0, 1):
                sh = lambda x: np.roll(np.roll(x, dq, axis=1), dr, axis=0)
                s += sh(np.where(have, p, 0))
                c += sh(have.astype(float))
        grow = ~have & (c > 0)
        p[grow] = s[grow] / c[grow]
        have |= grow
    b = np.clip(np.round(2 * np.sqrt(p)), 0, 255).astype(np.uint8)
    return zlib.compress(b.tobytes(), 9)


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--out', default=os.path.join(here, '..', 'docs', 'sim', 'data'))
    ap.add_argument('--cache', default=os.path.join(here, 'cache'))
    ap.add_argument('--res', type=int, default=8, choices=(4, 8), help='base cells per degree (default %(default)s)')
    ap.add_argument('--only', action='append', choices=('cells', 'satellite', 'precip'), help='rebuild only this file (repeatable)')
    a = ap.parse_args()
    global BR, BW, BH
    BR, BW, BH = a.res, 360 * a.res, 180 * a.res
    fetch(a.cache)
    os.makedirs(a.out, exist_ok=True)
    want = set(a.only or ('cells', 'satellite', 'precip'))
    if 'cells' in want:
        open(os.path.join(a.out, 'cells.bin'), 'wb').write(build_cells(a.cache))
    if 'satellite' in want:
        build_satellite(a.cache, os.path.join(a.out, 'satellite.jpg'))
    if 'precip' in want:
        open(os.path.join(a.out, 'precip.bin'), 'wb').write(build_precip(a.cache))
    print('wrote', os.path.normpath(a.out), file=sys.stderr)


if __name__ == '__main__':
    main()
