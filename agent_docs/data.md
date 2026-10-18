# Data files

How `docs/sim/data/cells.bin`, `docs/sim/data/satellite.jpg` and `docs/sim/data/precip.bin` were made and how to rebuild
them. The rebuild script is `tools/build_data.py` (numpy + Pillow; the app itself
stays dependency-free).

```bash
python3 tools/build_data.py                # overwrite docs/sim/data/ (0.125°)
python3 tools/build_data.py --res 4        # 0.25° base data instead
python3 tools/build_data.py --out /tmp/x   # build elsewhere to compare first
```

Downloads (about 30 MB) are cached in `tools/cache/`. Peak memory is about 1.5 GB
because the 1 km land mask is loaded whole.

## Contents
- Sources
- cells.bin derivation
- satellite.jpg derivation
- precip.bin derivation
- Match against the original files
- Changing the data

## Sources

| Input                            | URL                                                                                                     | Licence                    |
|----------------------------------|---------------------------------------------------------------------------------------------------------|----------------------------|
| GLOBE 1 km land/ocean mask       | `global-land-mask` package, `globe_combined_mask_compressed.npz` on GitHub (toddkarin/global-land-mask) | public domain (NOAA GLOBE) |
| Natural Earth 10m bathymetry     | `naturalearth.s3.amazonaws.com/10m_physical/ne_10m_bathymetry_all.zip`                                  | public domain              |
| Natural Earth 10m lakes          | `naturalearth.s3.amazonaws.com/10m_physical/ne_10m_lakes.zip`                                           | public domain              |
| Natural Earth 10m rivers         | `naturalearth.s3.amazonaws.com/10m_physical/ne_10m_rivers_lake_centerlines.zip`                         | public domain              |
| ETOPO1 ice-surface colour relief | `www.ngdc.noaa.gov/mgg/image/color_etopo1_ice_low.jpg` (5400x2700)                                      | public domain (NOAA)       |
| GPCC climatology V2025, 1°       | `opendata.dwd.de/climate_environment/GPCC/...climatology_1971_2000_v2025_100.nc.gz` (3 MB)              | CC BY 4.0 (DWD); cite      |

Exact URLs are in `SOURCES` in the script. Natural Earth is public domain. The GLOBE and ETOPO1 entries assume US-government public domain; their licence terms have not been checked. GPCC is DWD open data under CC BY 4.0 (dwd.de/copyright): reuse and redistribution allowed with a source note, and the dataset asks to be cited as Rustemeier, Finger, Schirmeister, Ziese (2025), doi:10.5676/DWD_GPCC/CLIMAT_V2025_100. The website and README carry the credit. Never switch back to WorldClim: its terms forbid redistribution without permission, which a derived grid in a public `docs/` would break.

## cells.bin derivation

Grid: `360*BR x 180*BR` cells (`--res`, default `BR` = 8: 2880x1440 at 0.125°), row 0 at 90°N, column 0 at 180°W.
Each base cell is `120/BR` GLOBE pixels on a side. Polygons are rasterized at 4x supersampling for coverage.

| Bit       | Rule                                                                                               |
|-----------|----------------------------------------------------------------------------------------------------|
| 7 land    | GLOBE land share > 0.5, and not a lake                                                             |
| 6 lake    | any Natural Earth 10m lake coverage, or GLOBE water not 4-connected to the world ocean (lon wraps) |
| 5 river   | Natural Earth 10m river centerlines drawn 1 px wide at base resolution                             |
| 0-3 depth | deepest Natural Earth bathymetry layer covering >= 50% of the cell; `L_0` = 1 ... `A_10000` = 12   |

Consequences worth knowing:

- Depth is computed independently of land, so coastal land cells carry depth levels too.
- GLOBE counts the Caspian Sea, Lake Superior and Lake Victoria as land. Superior and Victoria become lakes through Natural Earth; the Caspian is not in `ne_10m_lakes`, so it stays land (with depth levels from the bathymetry layers).
- The Black Sea is GLOBE ocean, but the Bosporus closes at the base resolution, so the connectivity rule marks it as a lake. The `STRAITS` carving in `app.js` acts on the coarser simulation grid and does not change this.
- Output is `zlib.compress(level 9)`, which `DecompressionStream('deflate')` reads.

## satellite.jpg derivation

ETOPO1 colour relief, bilinear resize to the base grid size (2880x1440 at the default), Pillow `ImageEnhance.Color(0.75)`
then `Brightness(0.62)`, saved as JPEG quality 80. The two factors were fitted
against the original image; the original tool and its exact settings are unknown.

## precip.bin derivation

GPCC Precipitation Analysis Climatology V2025 at 1°, the twelve monthly normals for 1971-2000 summed to mm/yr (land only, rain gauges). GPCC has no data over Antarctica; cells south of 60°S without data get `ANTARCTIC_MM` = 171 mm/yr, the mean snowfall over the ice sheet (Palerme et al. 2014, CloudSat), which loses the coast-to-interior gradient. Other cells with no land data are filled by growing the land values outward (3x3 neighbour mean, repeated), so every cell has a value; only land cells are read. Stored as zlib of 360x180 bytes, row 0 at 90N, column 0 at 180W, byte `b` = `(b/2)²` mm/yr (resolution about 1 mm/yr in deserts, 100 mm/yr at 2.5 m/yr). `read_nc3` in the script reads the NetCDF classic file directly; no netCDF library is needed. Against the WorldClim 2.1 grid used before (1970-2000): land mean 895 vs 900 mm/yr, correlation 0.95, cell ratio median 1.00 (10-90%: 0.78-1.23). `python3 tools/build_data.py --only precip` rebuilds just this file. The app falls back to 0.75 m/yr everywhere if the file is missing.

## Match against the original files

The original data was 0.25°. These numbers compare a `--res 4` build with it; `--res 4` output is byte-identical to the 0.25° file this repo shipped before switching to 0.125°.

The derivation was reverse-engineered, not taken from the original pipeline (which is
not available). `docs/sim/data/` now holds the rebuild; the original files (base64 blocks in the first single-file version of the app) are no longer in the repo. Rebuild versus original, measured before they were removed:

| Item          | Agreement                                     |
|---------------|-----------------------------------------------|
| land bit      | 99.96% (450 cells differ)                     |
| lake bit      | 99.91% (964 cells differ)                     |
| river bit     | 99.98% (168 cells differ)                     |
| depth level   | 85.5% exact, 98.9% within one level           |
| satellite.jpg | RMS 5.2 of 255 per channel, mostly JPEG noise |

- Depth differences sit at band edges (97.8% of original cells match a rebuild level within one cell distance). The original used some other coverage rule and was noisier inside bands; no coverage threshold or point-sample offset reproduced it exactly.
- The original file has no level 9 cells at all. The `D_7000` layer was evidently missing from the original build, so those cells fell to level 8 (6500 m instead of 7500 m). The rebuild includes `D_7000`.
- 7000 m to 8000 m cells are a small share of the ocean, so the effect on the model is small.

## Changing the data

- Keep the bit layout and a size of `360*BR x 180*BR`; `loadCells` derives `BR` from it. A `BR` of 16 would need GLOBE blocks of 7.5 pixels and a larger rasterizer supersample; the script allows only 4 and 8.
- If you change `LEVEL_M` mapping or add a layer, update the `BATHY` list and this doc together.
- After rebuilding, run the app and check the Black Sea, the Great Lakes and the Antarctic coast, which are where the rules interact.
