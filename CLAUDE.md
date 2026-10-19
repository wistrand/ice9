Guidance for agents working in this repo. Read this first, then the relevant
file in `agent_docs/`.

## What this is

A single-page browser simulation of ice-nine spreading through the oceans. Plain
HTML, CSS and one classic script in `docs/`, served as static files (GitHub Pages
from `docs/`). No build, no package manager, no runtime libraries. On load,
`docs/sim/app.js` fetches a zlib-compressed 0.125° cell mask, block-averages it onto the
chosen grid, then runs a stochastic front plus a heat model each animation frame
and paints the result to a canvas (flat map or orthographic globe).

## Layout

| Path                          | Role                                                                                                               |
|-------------------------------|--------------------------------------------------------------------------------------------------------------------|
| `docs/index.html`             | the project website (landing page): timeline, findings, render gallery, model summary, paper link                  |
| `docs/site.css`               | website styles (system fonts, light/dark tokens); `docs/img/` holds the renders, `docs/paper/` the PDF and figures |
| `docs/sim/index.html`         | markup: map box, legend, run bar, stats grid, controls, a link to the website and paper                            |
| `docs/sim/style.css`          | layout and theme tokens (light/dark via `prefers-color-scheme` and `data-theme`)                                   |
| `docs/sim/app.js`             | the whole app: data load, model, rendering, UI wiring (one async IIFE)                                             |
| `docs/sim/data/cells.bin`     | 2880x1440 (0.125°) cell mask, raw zlib stream (format in architecture doc)                                         |
| `docs/sim/data/satellite.jpg` | 2880x1440 equirectangular ETOPO1 relief for satellite mode                                                         |
| `docs/sim/data/precip.bin`    | 360x180 (1°) annual land precipitation from GPCC (DWD, CC BY 4.0), for snowfall                                    |
| `tools/build_data.py`         | rebuilds `docs/sim/data/` from public sources (not part of the served app)                                         |
| `tools/runs/`                 | headless Node runs and scripts behind every paper number, figure and website image (see its README)                |
| `paper/`                      | the paper: `ice9.tex`, figure scripts and figures in `fig/`; the built PDF is copied to `docs/paper/`              |
| `agent_docs/`                 | deep dives (linked below)                                                                                          |

## Commands

```bash
python3 -m http.server -d docs 8000   # website at http://localhost:8000, simulation at /sim/
node --check docs/sim/app.js          # syntax check
python3 tools/build_data.py           # rebuild docs/sim/data/ from public sources (numpy + Pillow)
tools/runs/prepare.sh && tools/runs/jobs.sh && tools/runs/figures.sh   # rerun the paper (hours to days)
```

There are no tests and no build. `file://` does not work (fetch is blocked).

## Docs

- [agent_docs/architecture.md](agent_docs/architecture.md): data format, grid state arrays, the per-step pipeline, the skip and once-per-tick shortcuts that keep fine grids affordable, rendering paths. Read before changing the model or the renderer.
- [agent_docs/data.md](agent_docs/data.md): where `cells.bin`, `satellite.jpg` and `precip.bin` come from, the rebuild script, and how closely a rebuild matches. Read before touching `docs/sim/data/` or `tools/`.
- [agent_docs/physics.md](agent_docs/physics.md): where every constant comes from, the exchange formulas, what is still tuned. Read before changing any number in `app.js`.
- [agent_docs/gotchas.md](agent_docs/gotchas.md): traps and the reasons behind odd-looking code. Skim before touching propagation, heat, counters or loading.

## Invariants

- Physical constants are derived, not tuned (`agent_docs/physics.md`). Never change one without a derivation written there.
- No dependencies. No npm, no bundler, no CDN scripts or stylesheets, no web fonts. The page makes no external requests. Use browser built-ins (for example `DecompressionStream` instead of pako) and system font stacks.
- `docs/` stays directly servable as static files. Paths in HTML and JS are relative.
- `docs/CNAME` holds the custom domain `ice9.world` for GitHub Pages; never delete or rename it.
- The simulation is self-contained in `docs/sim/` (its `data/` included); the website at `docs/` root links to it as `sim/`. Website numbers come from the paper runs; update them when the paper changes.
- The column is one layer (sinks mode) or, with the floats toggle (`floatMode`), a mixed layer over a deep layer (`Td`, `phid`, `capd`). Everything the front does acts on the mixed layer; only `deepStep` and the vertical-exchange term touch the deep layer, and both keep `frozenMass` in step. `Td` must be set from `T0d` in both `build` and `reset`.
- Energy is conserved: column enthalpy `(1 - phi/2)*T - phi*(l - MELT/2)` per unit capacity, heat flows weighted by `cap*(1 - phi/2)`, and every flux across the boundary added to `budget`. Never add a heat source or sink without a `budget` entry; re-run the budget check after touching freezing or exchange (see [agent_docs/gotchas.md](agent_docs/gotchas.md)).
- "Ocean frozen" and the end condition are by mass (`frozenMass/massTotal`); "Area locked" and `frozen` are surface area.
- All changes to a cell's solid fraction `phi` go through `addPhi`, which keeps `frozen`, `frozenMass`, `inlandFrozen`, `sheetFrozen` and `sysFrozen` in step and releases latent heat. The only exceptions are the melt-out cleanup branches in `step` that zero `phi` and back the residue out of the same counters; keep them symmetric with `addPhi`.
- The front's realised speed in km/h must not depend on the time step or grid resolution. Propagation probabilities are derived from `frontKmh()`, `RES` and the substep count; see the gotchas doc before touching `p0`, `np` or `rowProbs`.
- The grid is equirectangular: a cell is `cosLat[r]` as wide as it is tall and has that share of an equatorial cell's area. Anything that counts cells, moves something east-west, or exchanges heat east-west must account for it (`AREA(i)`, `rowProbs`, the `/cr` advection terms, `ewConduct`).
- `cells.bin` decodes to `360*BR x 180*BR` bytes for an integer `BR` (cells per degree, now 8); `loadCells` derives `BR`, `BW`, `BH` from the size and rejects anything else. Grid options finer than `BR` are removed at load. Never hard-code the base resolution.

## Conventions

- Code style in `app.js`: one statement per line, two-space indentation, spaces around assignment, comparison and logical operators and after commas; arithmetic stays tight (`i*4+k`). Names are descriptive (`airT`, `condW`, `atRest`, `probLiquid`); the physics notation of [agent_docs/physics.md](agent_docs/physics.md) stays short (`T`, `phi`, `cap`, `ht`, `hx`, `cp`, `k`), and so do loop indices (`i`, `r`, `q`, `a`). The file is split into `// ===== section =====` blocks; add new code to the section it belongs to. Comments explain the physics or the reason, not the syntax. Short one-statement blocks may stay on one line.
- Never run `deno fmt`, `deno lint`, or any formatter on these files.
- Keep `app.js` a classic `defer` script, not a module, so the IIFE's closure scope stays as is.
- The page separates Model settings (change the run) from Display settings (`natural`, `showcur`, `showair`, `showphi`, globe, satellite; read only in rendering). Never let a display setting change the model state.
- Map colours are defined once in `app.js` (the OKLab ramps `TLUT`, `PLUT` and the constants `HOT`, `ICE9`, `ICE`, `SEA`, `MILK`, `NIGHT`) and `legend()` paints the swatches in `index.html` from them. Never hard-code a map colour in the HTML.

## Documentation Style

- Markdown links for doc references you want an agent to follow, not backticks.
  Backticks are fine for source paths in tables and inline code. Align table columns.
- No AI-isms. No em dashes or emojis in project copy. State the point directly.
- Concise; add only what an agent can't infer from the code: the why, constraints, traps.
- State each rule on its own line as always/never.
- Mark inferred claims and open questions; don't present a guess as a fact.
- Keep this file the routing entry point; move subsystem detail into `agent_docs/`.
