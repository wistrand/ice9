# Architecture

Everything lives in `docs/sim/app.js`, one `async` IIFE. Symbols below are top-level
functions or variables inside it.

## Contents
- Load
- Base data format
- Grid build
- State arrays
- Time stepping
- Atmosphere and currents
- Rendering
- Stats and UI

## Load

`loadCells()` fetches `data/cells.bin` and inflates it with
`DecompressionStream('deflate')` (zlib format). On failure `base` is `null` and the
loading overlay shows an error instead of building. After that the script runs
synchronously: wires the UI, starts the satellite image load
(`satImg.src='data/satellite.jpg'`), then `build()`, `fit()`, `seaIceEdges()`,
`draw()`, `stats()`, and the `requestAnimationFrame(loop)`.

## Base data format

`base` is a `Uint8Array` of `BW*BH` cells at `BR` cells per degree (`BR` = 8, so 2880x1440 at 0.125°, read from the file size). Row 0 is the cell
band just below 90°N, column 0 is just east of 180°W (equirectangular, row-major).

| Bits     | Meaning                                    |
|----------|--------------------------------------------|
| bit 7    | land                                       |
| bit 6    | lake (water not connected to the ocean)    |
| bit 5    | river centerline                           |
| bits 0-3 | depth level, index into `LEVEL_M` (metres) |

Sources and the rebuild script (`tools/build_data.py`) are in
[data.md](data.md).

## Grid build

`build(res)` sets `RES` (1, 2 or 4 cells per degree), `W=360*RES`, `H=180*RES`,
allocates every per-cell array, and block-averages `f=4/RES` base cells per axis:

- Majority land makes a land cell (`grid=1`). Land with a river becomes a river channel (`kind=2`, `grid=0`, shallow, tiny capacity).
- Land inside the Antarctic or Greenland envelopes becomes ice sheet (`kind=3`) with an analytic thickness, a hashed wet-bed mask (`wetBed`) and a cold rest temperature.
- Water where lake cells outnumber ocean cells becomes a lake (`kind=1`).
- Otherwise ocean (`kind=0`): mean depth, `cap = depth/3700` clamped to [0.05, 2.2], surface current from `currentAt`, gyre id from `systemOf`.
- `STRAITS` carves narrow straits that block-averaging closes (Gibraltar, Bosporus, Malacca, Bering and others).
- `buildWeights()` precomputes mass-weighted conduction weights `condW` (4 per cell: E, W, N, S).

Changing the grid select rebuilds everything and resets the run.

## State arrays

| Name       | Type    | Meaning                                                         |
|------------|---------|-----------------------------------------------------------------|
| `grid`     | Uint8   | 0 unseeded water or sheet, 1 land, 2 seeded (contains ice-nine) |
| `kind`     | Uint8   | 0 ocean, 1 lake, 2 river channel, 3 ice sheet                   |
| `phi`      | Float32 | solid ice-nine fraction of the column, 0..1                     |
| `T`, `Tnext`  | Float32 | column temperature °C, and next-step buffer                     |
| `T0`       | Float32 | rest temperature the column relaxes toward                      |
| `cap`      | Float32 | relative heat capacity (depth-scaled)                           |
| `curU`,`curV` | Float32 | surface current east/north, unit 0.06°/h                        |
| `cellSystem`    | Uint8   | gyre index into `GYRES` (7 ACC, 8 equatorial, 255 none)         |
| `seaIceCover`    | Float32 | seasonal sea-ice cover, recomputed once per simulated day       |
| `airT`    | Float32 | 1° air temperature grid, `AW*AH` = 360x180                      |
| `crystals`      | Float32 | 1° airborne crystal concentration (0..1), moved with the air     |
| `snow`     | Float32 | ice-nine snow on land cells, m water equivalent (`landList`)     |
| `airCell`     | Uint32  | map from grid cell to air cell                                  |

Counters are area-weighted (`AREA(i)` = `cosLat[r]`): `frozen` (ocean surface, phi-weighted), `frozenMass` (capacity-weighted),
`inlandFrozen`, `sheetFrozen`, `sysFrozen[k]`; totals `waterCount`, `massTotal` (ocean columns only, summed with `CAP` so it follows the bathymetry checkbox),
`inlandCount`, `sheetMass`, `systemArea[k]`.

## Two-layer column (floats mode)

`floatMode` (set from the `floats` checkbox at `build`) switches ocean columns from one layer to
two. `initOceanColumn(i,r,d)` sets both layouts:

| Mode   | Mixed layer (`T`, `phi`, `cap`)                       | Deep layer (`Td`, `phid`, `capd`)                                         |
|--------|-------------------------------------------------------|---------------------------------------------------------------------------|
| sinks  | whole column, `cap = depth/3700`, `T0 = 2+6cos²`      | none (`capd = 0`)                                                         |
| floats | top `HM` = 100 m, `cap ≥ 0.02`, `T0 = -1+29cos²` (SST) | the rest; `T0d` = mean of an exponential thermocline (500 m) down to 2 °C |

Everything the front does (contact, drift, airborne seeding, latent heat, air exchange,
lateral conduction, drawing) acts on the mixed layer. The deep layer is touched only by:

- `deepStep` (every substep, for seeded columns): vertical exchange with the mixed layer
  (`KV_L`, `KV_I`, implicit); convective overturn when the mixed layer's liquid is denser
  than the deep liquid (`rhoW` of each layer's temperature and liquid salinity), which
  mixes heat over both layers and salt over their liquid and records `overturnMass`; and deep freezing
  once `phi >= 1` or while the column overturns, integrated in increments of at most
  0.02 because the heat per unit solid fraction grows as the layer locks.
- the liquid vertical-exchange term in the heat loop for unseeded columns.

Deep latent heat stays in the deep layer. The deep freezes about 35% of itself and
stalls at its melting point; after that the crust thickens at the `KV_I` rate (cm/yr).
Status shows "Crust over a liquid deep ocean" once the surface is 99% locked.
`useDepth()` is true in floats mode regardless of the bathymetry checkbox (disabled in the UI).

## Time stepping

`loop` calls `tick()` every frame while running; it redraws at most every 45 ms and
updates stats every 250 ms.

`tick()`: hours per frame `h = hoursPerFrame()` from the speed slider, split into up to 16
substeps for numerical stability of diffusion. Once per tick: `updateSun()` (insolation,
night mask, season), `seaIceEdges()`, `updateSystems()` (gyre flow scaled by its basin's
open-surface share), `lifeStep(h)` when the life option is on (algal bloom in the floating crust's brine, `bloom`), `updateRowSea()` (sea-surface warming per air row for the convective cap, and the white sea share `seaWhite`, darkened by any bloom) and
`setAirSeason(true)` (the air climatology for the date). Then `step(hs)` per substep, then status logic
(all frozen, stalled by heat, halted in Vonnegut mode).

`step(h)` order:

1. Collect `frozenList` (all `grid==2`) and the `front` (seeded cells with an unseeded orthogonal neighbour).
2. Contact propagation: `np` passes of `propagate(th)`, 8-neighbour. `rowProbs` turns the per-pass probability into per-row tables `probLiquid`/`probSolid`/`probBasal` (liquid, solid-state, basal) for north-south, east-west (`1/cos(lat)` exponent) and diagonal (`1/sqrt(1+cos²)`) neighbours, so the front is round in kilometres. Blocked where `T >= MELT` when latent heat is on. Ice sheets use `tryIce`.
3. Crystal drift: part-frozen front cells seed one cell downstream along the current.
4. Storm seeding (only with snowfall off): well-frozen cells occasionally seed a cell several cells downwind. With snowfall on, rain carrying crystals seeds lakes, rivers and the sea instead (`snowStep`).
5. Growth and melt: each seeded cell raises `phi` by up to `GROW*h`, in increments of at most 0.1 that each land on the brine-depressed melting point (`MELT-SALT*(1+2*phi)`); above it, `phi` melts back the same way, and a fully melted cell returns to `grid=0`. `warmingPerPhi` gives the warming per unit solid fraction; `addPhi` applies it with the midpoint heat capacity.
6. Heat (latent heat on only): conduction via `condW` (`KH`, negligible), heat carried along currents and wind drift by the conservative exchange pass `advect` (east-west terms divided by `cos(lat)`; applied as `advHeat[i]`), then air-sea exchange from bulk coefficients: the column relaxes toward climatology shifted by the air anomaly (`target`, `cp`) at `hx*KC*h/(ci*(1-p/2))`, modulated ±20% by the diurnal cycle, with the turbulent share of the change going to the air through `airShare` and the longwave share leaving directly; a 100 °C cap vents to the air; in floats mode the slow liquid exchange with the deep layer. Formulas in [physics.md](physics.md). Chunks at rest are skipped (see Performance structure). East-west conduction's `1/cos²(lat)` excess is applied once per tick by `ewConduct`, an implicit per-row solve.
7. On the tick's last substep, with the atmosphere on, `vapourStep(h*last)` (vapour, land rain, cloud cover; crystals when snowfall is on), then with snowfall checked `snowStep(h*last)`: crystals lofted from seeded sea (`frozenList`) and washed out; the vapour fields `vapour` (open-sea evaporation plus `evapAnom`, the latent part of `airShare` accumulated per air cell in the heat loop) and `vapourToday` (today's) gain their sources and rain out; local land rain `landRain[a]` follows from them and freezes where `crystals` is present and the air is below `MELT`, or melts back above it; latent heat goes to `airIn`; rain seeds lakes and rivers (`inlandList`). It must run before `airStep`, because `airIn` is cleared each substep.
8. `airStep(h)`: the heat in `airIn` arrives, the anomaly from `airTclim` is moved by `transportAir` (and, with snowfall, `crystals` and `vapour` too; `vapourToday` is spun up once by `spinVapourToday` and again when the mixing slider changes), then each cell relaxes to `airTclim - drop` at the `T³`-scaled Planck rate, where `drop` is the white ocean share plus `LAND_ALB` times the white land area (`landWhite`).

In floats mode `deepStep` runs for each seeded column every substep, after the surface growth step.

Latent heat is released inside `addPhi` and all of it stays in the column (lateral eddy mixing over a cell is nil on these timescales; `KH`).

## Performance structure

What keeps a step affordable at 0.25° and 0.125°. Behaviour depends on these matching the per-cell rules, so read before changing skip logic.

- `frozenList` is maintained incrementally: `seedCell` appends, and `step` compacts it at the start (dropping melted cells, and duplicates via a temporary `grid` value of 4). New seeds during a step are beyond `frozenN0` and are reached through `front`, as before.
- Heat loop at-rest map: `atRest[i]` is `|T - (T0 + cp*(airT-airTclim))| < 0.3`, measured against the cell's own air-shifted target so a warm world does not defeat the skip. Rows are split into chunks of `CHUNK` = 32 cells; `chunkQuiet` says every cell would skip on its own, `chunkRest` says every cell is at rest. A quiet chunk whose neighbours are at rest is copied to `Tnext` without visiting its cells. Resting ocean, lake and river cells are dormant.
- Interior ice (fully locked, every neighbour locked or land) relaxes once per tick, on the last substep (`step(h,last)` with `last` = substep count), because the relaxation is linear toward a fixed target.
- `ewConduct` runs once per tick with the summed coefficient (it is implicit, so stable at any size), skips exactly flat rows, and solves only water runs with a gradient.
- Airborne seeding draws a Poisson number of launches from `frozenList` instead of a coin per frozen cell.
- Air transport (`transportAir`) is factorised once per diffusion number `d` (`factorAir`, keyed on `trD`): per row east-west with the Sherman-Morrison correction vector stored, and one north-south factorisation shared by every column. All four fields carried each substep reuse it. The arithmetic matches `solveTridiag`/`solveCyclic` operation for operation, so results are bit-identical; anything that changes the air matrices other than `d` (`airCos`, `airCosEdge`) must reset `trD`.
- `olrClim[a]`, today's radiation at each air cell's climatology, is recomputed only when `setAirSeason` moves the season or the greenhouse or cloud switches change; `olrBoth` returns the radiation and its slope from one `exp`.
- `latentK()` and `useDepth()` (and so `CAP()`) read cached values (`latentSet`, `depthSet`) that `readControls` refreshes from the controls' own listeners, registered before every other listener. Never read a DOM control inside a per-cell function.
- The at-rest test computes `hLat` only for cells whose `advHeat` passes the cheap test first.
- Check any performance change with `tools/runs/bitwise.mjs`: it hashes every state array after N seeded steps in seven configurations (sinks, floats, depth off, snowfall off, life, mid-run setting changes, 2 h steps); identical hashes before and after mean the paper runs stay valid.

Rough costs in Node (one tick, including a redraw): 0.25° about 37 ms at default speed and 300-550 ms at high speed; 0.125° about 150-200 ms at default speed with about 450 MB resident.

## Atmosphere and currents

- `airStep`: each air cell takes `airIn` from the sea below, diffuses, is advected by the zonal `wind[r]` profile (mixing and wind act on the anomaly from `airTclim`), and relaxes to an equilibrium `eq = airTclim - drop` (the latitude climatology `airTclim`, which drops as the ocean freezes, an albedo stand-in) at a T^3-scaled rate.
- Currents: `streamFn` sums asymmetric Gaussian stream functions from `GYRES` (narrow west side for strong western boundary currents); `currentAt` differentiates it and adds ACC and equatorial bands. Precomputed per cell in `build`.

## Rendering

- `draw()` writes per-cell RGBA into `gridImg` (`W*H`), puts it on the offscreen canvas `gridCanvas`, rebuilds the river overlay (`drawRivers`, at base resolution `BW*BH`) and the satellite night overlay, then `blit()`.
- The map shows the surface (`fv`): in sinks mode the solid sits on the floor, so a column is drawn as open water tinted by its temperature until it is solid through (whitening over the last tenth of `phi`); in floats mode the crust is the surface, so `fv = phi` of the mixed layer. The satellite veil alpha uses the same `fv`. The deep layer and the slush fraction are visible only through the solid-fraction overlay.
- Colour model: water temperature on one perceptually uniform ramp (`TEMP_STOPS`, interpolated in OKLab into `TLUT`, −25 to 50 °C, lightness rising monotonically and kept below ice white), shaded by bathymetric relief (`shade`, built in `buildShade`, zero-mean so it does not shift a region's tone). Water above its own melting point (`meltPt`, +0.5 K margin for slush pinned at it; `meltPtOpen` for unseeded water) is `HOT`, outside the ramp. Ice-nine is `ICE9` (blue-white), ordinary ice `ICE` (neutral); seasonal sea ice fades where the water has warmed more than 3 K above climatology. The air-temperature overlay uses `TLUT`; the solid-fraction overlay (`showphi`) uses `PLUT` on the whole column and leaves unreached water in its temperature colour. The natural-colour view (`natural`, display only) drops temperature and is drawn for legibility, not to match the albedo: open water is `SEA` with the relief shading; seeded sinking water takes a milky turquoise tint (`MILK`, up to `MILK_MAX` at `phi` = `NAT_FULL`), never white, so the spread shows while the slush does not read as white ice (the model keeps sinking ice on the floor and lets no slush reflect sunlight); the floating crust is `ICE9` at `CRUST_MAX*sqrt(phi/NAT_FULL)`, brighter than its solid fraction because floating ice gathers at the top, and capped below snow white so coastlines stay readable; `HOT` is not shown. It exists because readers took the amber slush for something other than ice. The website hero globes and the gallery's default view use it. `legend()` paints the legend from these constants.
- Flat view `blit()`: canvas transforms for pan/zoom; layers are satellite, `gridCanvas`, rivers, night, then current arrows.
- Globe view `blitGlobe()`: inverse orthographic per screen pixel into `gridPx`, satellite and river buffers, with limb shading. Runs at `dpr=1` (see `fit`).
- Input: pointer events for pan, rotate, pinch; a tap without movement seeds via `seed(q,r)` or `globeToCell`.

## Stats and UI

`stats()` updates the readouts and pushes a history sample; `hist` keeps at most
`HIST_MAX` samples by pairwise merging. `spark()` draws sparklines with colours
read from CSS variables. Slider label text comes from `rateText`, `speedText`,
`coolNames`, `mixNames` and `solidRate`.
